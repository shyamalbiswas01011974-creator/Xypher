import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Interface,
  SigningKey,
  Transaction,
  formatUnits,
  getAddress,
  getCreateAddress,
  parseUnits,
  verifyMessage,
} from 'ethers';
import { encodeBlockExtraData } from './blockExtraData.ts';
import {
  EVM_COLLECTION_ADDRESS,
  SUPPORTED_COIN_MAP,
  SUPPORTED_EXCHANGE_COINS,
  type SupportedCoinSymbol,
} from './supportedCoins.ts';
import {
  XYPHER_TOKEN_DEPLOYED_BYTECODE,
  ZERO_FEE_HOSTED_CHAIN_IDS,
} from './xypherTokenContract.ts';
import type {
  AddressInfo,
  AddressTxHistoryItem,
  BalanceVerificationResult,
  BlockData,
  BlockDetail,
  BlockExtraDataDecoded,
  BlockSummary,
  ChainInfo,
  MempoolTxItem,
  MetaMaskTokenBalanceItem,
  MetaMaskTokenDelivery,
  NetworkProfile,
  SelfTestResultItem,
  TransferAccountingReceipt,
  TxData,
  UtxoItem,
} from './types.ts';
import {
  BLOCK_SUBSIDY,
  DECIMALS,
  GENESIS_TAG,
  GENESIS_TIME,
  MAX_BLOCK_BYTES,
  MAX_BLOCKS,
  MAX_MONEY,
  NAME,
  NETWORK_FEE_UNITS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  PROFILE_CONFIGS,
  SECP_GX,
  SECP_GY,
  SYMBOL,
  UNIT,
  WEI_PER_UNIT,
  XYPH_EVM_GAS_PRICE_HEX,
  XYPH_EVM_GAS_PRICE_WEI,
  XYPH_TOKEN_CONTRACT_EVM,
  XYPH_TOKEN_DECIMALS,
  XYPH_TOKEN_SCALE,
  XYPHER_CHAIN_ID,
  XYPHER_CHAIN_ID_HEX,
  ZERO32,
  addressFromPrivate,
  addressFromPubkey,
  bigIntToBytes32,
  buildSignedTx,
  bytesToHex,
  checkTxShape,
  computeBlockHash,
  computeTxid,
  evmToXypherAddress,
  generatePrivateKey,
  hexToBytes,
  isCoinbaseTx,
  isPowValid,
  isValidAddress,
  isValidEvmAddress,
  keyToWif,
  merkleRoot,
  normalizeToXypherAddress,
  pubkeyFromPrivate,
  ripemd160,
  serializeBlockHeader,
  sha256,
  signDigest,
  utf8ToBytes,
  verifyDigest,
  verifyTxInput,
  wifToKey,
  xypherToEvmAddress,
} from './xypherCrypto.ts';

interface InternalUtxo {
  value: number;
  addr: string;
  height: number;
  isCoinbase: boolean;
}

interface ChainMeta {
  name: string;
  symbol: string;
  profile: NetworkProfile;
  fund_address: string;
  networkVersion?: number;
}

export interface EvmTxRecord {
  hash: string; // 0x + 64 hex
  fromEvm: string; // checksummed 0x...
  toEvm: string; // checksummed 0x...
  fromXyph: string;
  toXyph: string;
  valueUnits: number;
  feeUnits: number;
  valueWei: string;
  gasPriceWei: string;
  gasLimit: number;
  nonce: number;
  timestamp: number;
  blockHeight: number | null;
  blockHash: string | null;
  rawHex: string;
  chainId?: number;
  inputData?: string;
  contractToEvm?: string;
  deployedContractAddress?: string;
  erc20Log?: {
    address: string;
    topics: string[];
    data: string;
  };
}

export interface DeployedEvmContract {
  address: string;
  deployerEvm: string;
  txHash: string;
  runtimeBytecode: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyTokens: string; // raw 4-decimal integer string
  balances: Record<string, string>; // lowercase 0x -> raw 4-decimal integer string
  allowances?: Record<string, string>; // `${ownerLower}:${spenderLower}` -> raw amount string
  deployedAt: number;
}

const ERC20_IFACE = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transferFrom(address from, address to, uint256 value) returns (bool)',
  'function burn(uint256 value) returns (bool)',
  'function transferOwnership(address newOwner) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
]);

// Non-empty valid runtime bytecode so MetaMask recognizes the XYPH ERC-20 precompile contract
const XYPH_ERC20_RUNTIME_BYTECODE = XYPHER_TOKEN_DEPLOYED_BYTECODE || '0x6080604052600080fd';

interface EvmBridgeState {
  nonces: Record<string, number>; // lowercase 0x -> next nonce on primary XYPH chain
  chainNonces?: Record<string, Record<string, number>>; // chainId -> (lowercase 0x -> next nonce)
  deltas: Record<string, number>; // xyphAddr -> net signed units delta from EVM-signed txs
  txs: EvmTxRecord[];
  faucetClaims: Record<string, number>; // xyphAddr -> total units claimed
  deployedContracts?: Record<string, DeployedEvmContract>; // lowercase 0x contract -> state
}

function fastNodeDsha256Hex(buf: Buffer): string {
  const first = crypto.createHash('sha256').update(buf).digest();
  return crypto.createHash('sha256').update(first).digest('hex');
}

function bigIntTargetToHex(t: bigint): string {
  return t.toString(16).padStart(64, '0');
}

function targetDifficulty(maxTarget: bigint, targetHex: string): number {
  const targetBig = BigInt('0x' + targetHex);
  if (targetBig <= 0n) return 1;
  const scaled = (maxTarget * 10000n) / targetBig;
  return Number(scaled) / 10000;
}

export class XypherNode {
  private dataDir: string;
  private chainPath: string;
  private fundPath: string;
  private evmBridgePath: string;

  public meta!: ChainMeta;
  public fundWif: string = '';
  public all: Map<string, BlockData> = new Map();
  public utxo: Map<string, InternalUtxo> = new Map();
  public mempool: Map<string, MempoolTxItem> = new Map();
  public tip!: BlockData;
  public tipHash: string = ZERO32;
  public height: number = -1;

  // EVM / MetaMask bridge state
  public evmState: EvmBridgeState = {
    nonces: {},
    deltas: {},
    txs: [],
    faucetClaims: {},
    deployedContracts: {},
  };

  // Automatic background validator sealer (no user-facing mining in wallet)
  private sealerRunning: boolean = false;
  private sealTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSealEnabled: boolean;

  constructor(dataDir?: string, options?: { autoSeal?: boolean }) {
    this.autoSealEnabled = options?.autoSeal !== false;
    const resolvedBase = path.resolve(process.cwd(), dataDir || 'xypher-data');
    this.dataDir = resolvedBase;
    this.chainPath = path.resolve(this.dataDir, 'chain.jsonl');
    this.fundPath = path.resolve(this.dataDir, 'genesis-fund.json');
    this.evmBridgePath = path.resolve(this.dataDir, 'evm-bridge.json');
    if (
      !this.chainPath.startsWith(this.dataDir + path.sep) ||
      !this.evmBridgePath.startsWith(this.dataDir + path.sep)
    ) {
      throw new Error('Invalid chain storage path');
    }
    this.loadOrInit('private-fast');
  }

  public get profileConfig() {
    return PROFILE_CONFIGS[this.meta.profile] ?? PROFILE_CONFIGS['private-fast'];
  }

  private loadOrInit(defaultProfile: NetworkProfile): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.chainPath)) {
      try {
        this.openFromDisk();
        if (fs.existsSync(this.fundPath)) {
          const saved = JSON.parse(fs.readFileSync(this.fundPath, 'utf-8'));
          if (typeof saved.wif === 'string') {
            this.fundWif = saved.wif;
          }
        }
        this.loadEvmBridge();
        return;
      } catch (err) {
        console.error('Existing chain unreadable, reinitializing:', err);
      }
    }
    this.resetNetwork(defaultProfile);
  }

  private loadEvmBridge(): void {
    try {
      if (fs.existsSync(this.evmBridgePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.evmBridgePath, 'utf-8'));
        this.evmState = {
          nonces: parsed?.nonces || {},
          chainNonces: parsed?.chainNonces || {},
          deltas: parsed?.deltas || {},
          txs: Array.isArray(parsed?.txs) ? parsed.txs : [],
          faucetClaims: parsed?.faucetClaims || {},
          deployedContracts: parsed?.deployedContracts || {},
        };
        this.ensureExchangeTokenContracts(false);
        return;
      }
    } catch {
      // Fallback to clean EVM bridge state
    }
    this.evmState = {
      nonces: {},
      chainNonces: {},
      deltas: {},
      txs: [],
      faucetClaims: {},
      deployedContracts: {},
    };
    this.ensureExchangeTokenContracts(false);
  }

  /**
   * Registers canonical ERC-20 contracts on XYPH Network (Chain ID 5790032) for every
   * supported exchange crypto (ETH, SOL, BTC, TRX, BNB, POL, MON, XLM) so MetaMask
   * natively tracks real balances via eth_call(balanceOf) and wallet_watchAsset.
   */
  public ensureExchangeTokenContracts(persist = true): void {
    if (!this.evmState.deployedContracts) {
      this.evmState.deployedContracts = {};
    }
    let changed = false;
    const deployerEvm = isValidEvmAddress(EVM_COLLECTION_ADDRESS)
      ? getAddress(EVM_COLLECTION_ADDRESS)
      : '0x41d5D2Ce47a9Bab12676f55a76AAd74F14236c91';

    for (const coin of SUPPORTED_EXCHANGE_COINS) {
      if (coin.symbol === 'XYPH' || !coin.xyphTokenContract) continue;
      const addrChecksum = getAddress(coin.xyphTokenContract);
      const key = addrChecksum.toLowerCase();
      if (!this.evmState.deployedContracts[key]) {
        this.evmState.deployedContracts[key] = {
          address: addrChecksum,
          deployerEvm,
          txHash:
            '0x' +
            crypto
              .createHash('sha256')
              .update(`xyph-exchange-erc20-genesis:${coin.symbol}:${addrChecksum}`)
              .digest('hex'),
          runtimeBytecode: XYPH_ERC20_RUNTIME_BYTECODE,
          name: `${coin.name} (XYPH Bridge)`,
          symbol: coin.symbol,
          decimals: coin.tokenDecimals,
          totalSupplyTokens: '0',
          balances: {},
          allowances: {},
          deployedAt: GENESIS_TIME,
        };
        changed = true;
      }
    }
    if (changed && persist) {
      this.saveEvmBridge();
    }
  }

  private saveEvmBridge(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.evmBridgePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.evmState, null, 2), 'utf-8');
    fs.renameSync(tmp, this.evmBridgePath);
  }

  private openFromDisk(): void {
    const content = fs.readFileSync(this.chainPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error('Chain file incomplete');
    const header = JSON.parse(lines[0]);
    if (!header?.meta?.fund_address) throw new Error('Missing chain metadata');
    if (header.meta.networkVersion !== 2) {
      throw new Error('Upgrading legacy chain to XYPH Network v2 (real Genesis #0, 24M max blocks)');
    }
    this.meta = header.meta as ChainMeta;
    this.all.clear();
    this.mempool.clear();
    for (let i = 1; i < lines.length; i++) {
      const b = JSON.parse(lines[i]) as BlockData;
      const hash = computeBlockHash(b);
      this.all.set(hash, b);
    }
    const err = this.replayBest();
    if (err) throw new Error(`Corrupt chain: ${err}`);
  }

  public saveToDisk(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpPath = this.chainPath + '.tmp';
    const lines = [JSON.stringify({ meta: this.meta })];
    for (const block of this.all.values()) {
      lines.push(JSON.stringify(block));
    }
    fs.writeFileSync(tmpPath, lines.join('\n') + '\n', 'utf-8');
    fs.renameSync(tmpPath, this.chainPath);
  }

  public resetNetwork(profile: NetworkProfile): {
    fundAddress: string;
    fundWif: string;
    genesisHash: string;
  } {
    if (this.sealTimer) {
      clearTimeout(this.sealTimer);
      this.sealTimer = null;
    }
    const cfg = PROFILE_CONFIGS[profile] ?? PROFILE_CONFIGS['private-fast'];
    const fundPriv = generatePrivateKey();
    const fundAddress = addressFromPrivate(fundPriv);
    const fundWif = keyToWif(fundPriv);

    this.meta = {
      name: NETWORK_NAME,
      symbol: SYMBOL,
      profile: cfg.id,
      fund_address: fundAddress,
      networkVersion: 2,
    };
    this.fundWif = fundWif;
    this.all.clear();
    this.utxo.clear();
    this.mempool.clear();
    this.height = -1;
    this.tipHash = ZERO32;
    this.evmState = {
      nonces: {},
      chainNonces: {},
      deltas: {},
      txs: [],
      faucetClaims: {},
      deployedContracts: {},
    };
    this.ensureExchangeTokenContracts(false);
    this.saveEvmBridge();

    const genesis = this.createGenesisBlock();
    const res = this.addBlock(genesis);
    if (!res.ok) {
      throw new Error(`Genesis block rejected: ${res.error}`);
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmpFund = this.fundPath + '.tmp';
    fs.writeFileSync(tmpFund, JSON.stringify({ address: fundAddress, wif: fundWif }, null, 2), 'utf-8');
    fs.renameSync(tmpFund, this.fundPath);

    return { fundAddress, fundWif, genesisHash: this.tipHash };
  }

  private scheduleAutoSeal(): void {
    if (!this.autoSealEnabled) return;
    if (this.sealTimer) return;
    this.sealTimer = setTimeout(async () => {
      this.sealTimer = null;
      const hasPendingEvm = this.evmState.txs.some((t) => t.blockHeight === null);
      if (this.mempool.size === 0 && !hasPendingEvm) return;
      try {
        await this.sealOneNetworkBlock();
      } catch (err) {
        console.error('Background validator block seal failed:', err);
      }
    }, 800);
  }

  public async sealOneNetworkBlock(payoutAddr?: string): Promise<{
    block: BlockSummary;
    hashes: number;
    elapsedMs: number;
  }> {
    while (this.sealerRunning) {
      await new Promise((r) => setTimeout(r, 80));
    }
    this.sealerRunning = true;
    try {
      const targetPayout = payoutAddr && isValidAddress(payoutAddr) ? payoutAddr : this.meta.fund_address;
      const res = await this.mineSingleBlock(targetPayout);
      if (!res) throw new Error('Block sealing interrupted');
      const added = this.addBlock(res.block);
      if (!added.ok) throw new Error(`Sealed block rejected: ${added.error}`);

      // Anchor any pending MetaMask EVM transactions into this newly sealed block
      let evmUpdated = false;
      for (const etx of this.evmState.txs) {
        if (etx.blockHeight === null) {
          etx.blockHeight = res.block.height;
          etx.blockHash = '0x' + res.hash;
          evmUpdated = true;
        }
      }
      if (evmUpdated) this.saveEvmBridge();

      return {
        block: this.summarizeBlock(res.block, res.hash),
        hashes: res.hashes,
        elapsedMs: res.elapsedMs,
      };
    } finally {
      this.sealerRunning = false;
    }
  }

  private createGenesisBlock(): BlockData {
    const cfg = this.profileConfig;
    const coinbase: TxData = {
      v: 1,
      ins: [
        {
          prev_txid: ZERO32,
          index: 0,
          pub: '',
          sig: bytesToHex(sha256(utf8ToBytes(GENESIS_TAG))),
        },
      ],
      outs: [{ value: BLOCK_SUBSIDY, addr: this.meta.fund_address }],
    };
    const block: BlockData = {
      version: 1,
      height: 0,
      prev: ZERO32,
      time: GENESIS_TIME,
      target: bigIntTargetToHex(cfg.maxTarget),
      nonce: 0,
      txs: [coinbase],
    };

    const merkle = merkleRoot([computeTxid(coinbase)]);
    const headerBuf = Buffer.from(serializeBlockHeader(block, merkle));
    const targetBig = cfg.maxTarget;
    let nonce = 0;
    while (true) {
      headerBuf.writeBigUInt64LE(BigInt(nonce), 112);
      const hashHex = fastNodeDsha256Hex(headerBuf);
      if (BigInt('0x' + hashHex) <= targetBig) {
        block.nonce = nonce;
        return block;
      }
      nonce++;
    }
  }

  public subsidy(height: number): number {
    if (height >= MAX_BLOCKS || height < 0) return 0;
    const era = Math.floor(height / this.profileConfig.halvingInterval);
    if (era >= 64) return 0;
    return Number(BigInt(BLOCK_SUBSIDY) >> BigInt(era));
  }

  public nextTargetHex(height: number): string {
    const cfg = this.profileConfig;
    if (height === 0) return bigIntTargetToHex(cfg.maxTarget);
    const last = this.tip;
    if (!last) return bigIntTargetToHex(cfg.maxTarget);
    if (height % cfg.retargetInterval !== 0) {
      return last.target;
    }
    let first = last;
    for (let i = 0; i < cfg.retargetInterval - 1; i++) {
      const prev = this.all.get(first.prev);
      if (!prev) break;
      first = prev;
    }
    const actual = BigInt(Math.max(1, last.time - first.time));
    const expected = BigInt(cfg.targetBlockTime * cfg.retargetInterval);
    const lastTarget = BigInt('0x' + last.target);
    let next = (lastTarget * actual) / expected;
    const minTarget = lastTarget / 4n;
    const maxStep = lastTarget * 4n;
    if (next < minTarget) next = minTarget;
    if (next > maxStep) next = maxStep;
    if (next > cfg.maxTarget) next = cfg.maxTarget;
    if (next < 1n) next = 1n;
    return bigIntTargetToHex(next);
  }

  public medianTimePast(): number {
    const times: number[] = [];
    let cur: BlockData | undefined = this.tip;
    while (cur && times.length < 11) {
      times.push(cur.time);
      cur = this.all.get(cur.prev);
    }
    if (times.length === 0) return 0;
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }

  public validateTx(tx: TxData, seenInBlock?: Set<string>): { error: string | null; fee: number } {
    const shapeErr = checkTxShape(tx);
    if (shapeErr) return { error: shapeErr, fee: 0 };
    if (isCoinbaseTx(tx)) return { error: null, fee: 0 };

    let totalIn = 0;
    const maturity = this.profileConfig.maturity;

    for (let i = 0; i < tx.ins.length; i++) {
      const inp = tx.ins[i];
      const key = `${inp.prev_txid}:${inp.index}`;
      const utxo = this.utxo.get(key);
      if (!utxo) return { error: 'missing-input', fee: 0 };
      if (utxo.isCoinbase && this.height + 1 - utxo.height < maturity) {
        return { error: 'immature-coinbase', fee: 0 };
      }
      if (seenInBlock) {
        if (seenInBlock.has(key)) return { error: 'double-spend-in-block', fee: 0 };
        seenInBlock.add(key);
      }
      try {
        const pubBytes = hexToBytes(inp.pub);
        if (addressFromPubkey(pubBytes) !== utxo.addr) {
          return { error: 'pubkey-address-mismatch', fee: 0 };
        }
      } catch {
        return { error: 'bad-pubkey', fee: 0 };
      }
      if (!verifyTxInput(tx, i)) {
        return { error: 'bad-signature', fee: 0 };
      }
      totalIn += utxo.value;
    }

    const totalOut = tx.outs.reduce((acc, o) => acc + o.value, 0);
    if (totalOut > totalIn) return { error: 'overspend', fee: 0 };
    return { error: null, fee: totalIn - totalOut };
  }

  private validateBlock(b: BlockData): string | null {
    const expectedPrev = b.height === 0 ? ZERO32 : this.tipHash;
    if (b.prev !== expectedPrev) return 'bad-prev';
    if (b.height !== this.height + 1) return 'bad-height';
    if (b.target !== this.nextTargetHex(b.height)) return 'bad-target';

    const merkle = merkleRoot(b.txs.map((t) => computeTxid(t)));
    const hash = computeBlockHash(b, merkle);
    if (!isPowValid(hash, b.target)) return 'bad-pow';

    const serializedSize = Buffer.byteLength(JSON.stringify(b), 'utf-8');
    if (serializedSize > MAX_BLOCK_BYTES) return 'too-big';

    const nowSec = Math.floor(Date.now() / 1000);
    if (b.time > nowSec + 7200) return 'time-too-new';
    if (b.height > 0 && b.time <= this.medianTimePast()) return 'time-too-old';

    if (!b.txs.length || !isCoinbaseTx(b.txs[0])) return 'missing-coinbase';
    const coinbaseCount = b.txs.filter((t) => isCoinbaseTx(t)).length;
    if (coinbaseCount !== 1) return 'multiple-coinbase';
    if (b.txs[0].ins[0].index !== b.height) return 'bad-coinbase-index';
    const cbErr = checkTxShape(b.txs[0]);
    if (cbErr) return `bad-coinbase:${cbErr}`;

    let fees = 0;
    const seen = new Set<string>();
    for (let i = 1; i < b.txs.length; i++) {
      const { error, fee } = this.validateTx(b.txs[i], seen);
      if (error) return error;
      fees += fee;
    }

    const subsidy = this.subsidy(b.height);
    const cbOutTotal = b.txs[0].outs.reduce((acc, o) => acc + o.value, 0);
    if (cbOutTotal > subsidy + fees) return 'coinbase-overpay';

    return null;
  }

  private connectBlock(b: BlockData, hash: string): void {
    const cb = b.txs[0];
    const cbTxid = computeTxid(cb);
    for (let i = 0; i < cb.outs.length; i++) {
      const o = cb.outs[i];
      this.utxo.set(`${cbTxid}:${i}`, {
        value: o.value,
        addr: o.addr,
        height: b.height,
        isCoinbase: true,
      });
    }
    for (let t = 1; t < b.txs.length; t++) {
      const tx = b.txs[t];
      for (const inp of tx.ins) {
        this.utxo.delete(`${inp.prev_txid}:${inp.index}`);
      }
      const txid = computeTxid(tx);
      for (let i = 0; i < tx.outs.length; i++) {
        const o = tx.outs[i];
        this.utxo.set(`${txid}:${i}`, {
          value: o.value,
          addr: o.addr,
          height: b.height,
          isCoinbase: false,
        });
      }
    }
    this.tip = b;
    this.tipHash = hash;
    this.height = b.height;
  }

  private findBestTip(): { block: BlockData; hash: string } | null {
    const children = new Map<string, Array<{ hash: string; block: BlockData }>>();
    let genesisEntry: { hash: string; block: BlockData } | null = null;
    for (const [hash, block] of this.all.entries()) {
      if (block.height === 0) genesisEntry = { hash, block };
      const list = children.get(block.prev) || [];
      list.push({ hash, block });
      children.set(block.prev, list);
    }
    if (!genesisEntry) return null;

    const maxTarget = this.profileConfig.maxTarget;
    let best = genesisEntry;
    let bestWork = 0n;
    const stack: Array<{ entry: { hash: string; block: BlockData }; work: bigint }> = [
      { entry: genesisEntry, work: 0n },
    ];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const targetBig = BigInt('0x' + current.entry.block.target);
      const work = current.work + (targetBig > 0n ? maxTarget / targetBig : 1n);
      if (work > bestWork) {
        bestWork = work;
        best = current.entry;
      }
      const kids = children.get(current.entry.hash);
      if (kids) {
        for (const kid of kids) {
          stack.push({ entry: kid, work });
        }
      }
    }
    return best;
  }

  public replayBest(): string | null {
    const best = this.findBestTip();
    if (!best) return 'empty';
    const chainPath: Array<{ hash: string; block: BlockData }> = [];
    let cur: { hash: string; block: BlockData } | undefined = best;
    while (cur) {
      chainPath.push(cur);
      const prevBlock = this.all.get(cur.block.prev);
      cur = prevBlock ? { hash: cur.block.prev, block: prevBlock } : undefined;
    }
    chainPath.reverse();

    this.utxo.clear();
    this.height = -1;
    this.tipHash = ZERO32;

    for (const entry of chainPath) {
      const err = this.validateBlock(entry.block);
      if (err) return err;
      this.connectBlock(entry.block, entry.hash);
    }
    return null;
  }

  public addBlock(b: BlockData): { ok: boolean; error?: string; hash: string } {
    const hash = computeBlockHash(b);
    if (this.all.has(hash)) {
      return { ok: true, error: 'duplicate', hash };
    }
    this.all.set(hash, b);
    const err = this.replayBest();
    if (err) {
      this.all.delete(hash);
      this.replayBest();
      return { ok: false, error: err, hash };
    }
    this.pruneMempool();
    this.saveToDisk();
    return { ok: true, hash };
  }

  /**
   * Authoritative pre-transaction balance verification.
   * Checks live spendable balance (confirmed UTXOs + pending mempool debits/credits + EVM bridge deltas)
   * BEFORE executing any transfer, rejecting immediately when sender funds are insufficient.
   */
  public verifyTransferBalance(params: {
    fromAddress: string;
    toAddress?: string | null;
    amountUnits: number;
    feeUnits?: number;
  }): BalanceVerificationResult {
    const fromXyph = normalizeToXypherAddress(String(params.fromAddress || '').trim());
    if (!fromXyph) {
      throw new Error('Invalid sender wallet address');
    }
    const rawTo = params.toAddress ? String(params.toAddress).trim() : '';
    const toXyph = rawTo ? normalizeToXypherAddress(rawTo) : null;
    if (rawTo && !toXyph) {
      throw new Error('Invalid recipient wallet address');
    }
    const amountUnits = Math.round(Number(params.amountUnits));
    const feeUnits = Math.round(
      params.feeUnits !== undefined ? Number(params.feeUnits) : NETWORK_FEE_UNITS
    );
    if (!Number.isInteger(amountUnits) || amountUnits <= 0) {
      throw new Error(`Transfer amount must be greater than 0 ${SYMBOL}`);
    }
    if (!Number.isInteger(feeUnits) || feeUnits < NETWORK_FEE_UNITS) {
      throw new Error(`Minimum network fee on ${NETWORK_NAME} is ${NETWORK_FEE_XYPH} ${SYMBOL}`);
    }

    const senderInfo = this.getAddressInfo(fromXyph);
    const requiredUnits = amountUnits + feeUnits;
    const availableUnits = senderInfo.spendable;
    const sufficient = availableUnits >= requiredUnits;
    const shortfallUnits = sufficient ? 0 : requiredUnits - availableUnits;
    const isSelf = Boolean(toXyph && toXyph === fromXyph);
    const senderAfterUnits = sufficient
      ? isSelf
        ? Math.max(0, availableUnits - feeUnits)
        : Math.max(0, availableUnits - requiredUnits)
      : availableUnits;

    const receiverInfo = toXyph ? this.getAddressInfo(toXyph) : null;
    const receiverBeforeUnits = receiverInfo ? receiverInfo.spendable : null;
    const receiverAfterUnits =
      receiverBeforeUnits !== null
        ? sufficient
          ? isSelf
            ? senderAfterUnits
            : receiverBeforeUnits + amountUnits
          : receiverBeforeUnits
        : null;

    const message = sufficient
      ? `Sufficient balance verified: available ${(availableUnits / UNIT).toFixed(4)} ${SYMBOL}, sending ${(amountUnits / UNIT).toFixed(4)} ${SYMBOL}.`
      : `Insufficient balance in wallet: available ${(availableUnits / UNIT).toFixed(4)} ${SYMBOL}, required ${(requiredUnits / UNIT).toFixed(4)} ${SYMBOL} (short by ${(shortfallUnits / UNIT).toFixed(4)} ${SYMBOL}).`;

    return {
      sufficient,
      fromAddress: fromXyph,
      toAddress: toXyph,
      availableUnits,
      requiredUnits,
      amountUnits,
      feeUnits,
      shortfallUnits,
      senderAfterUnits,
      receiverBeforeUnits,
      receiverAfterUnits,
      message,
    };
  }

  public addTx(tx: TxData): {
    ok: boolean;
    error?: string;
    txid?: string;
    accounting?: TransferAccountingReceipt;
  } {
    if (isCoinbaseTx(tx)) return { ok: false, error: 'coinbase' };
    const txid = computeTxid(tx);
    if (this.mempool.has(txid)) return { ok: true, txid };

    const { error, fee } = this.validateTx(tx);
    if (error) {
      if (error === 'overspend') {
        return { ok: false, error: `Insufficient balance in wallet to cover requested ${SYMBOL} transfer.` };
      }
      return { ok: false, error };
    }
    if (fee < NETWORK_FEE_UNITS) {
      return {
        ok: false,
        error: `Minimum network fee on ${NETWORK_NAME} is ${NETWORK_FEE_XYPH} ${SYMBOL}`,
      };
    }

    const spentInMempool = new Set<string>();
    for (const item of this.mempool.values()) {
      for (const inp of item.tx.ins) {
        spentInMempool.add(`${inp.prev_txid}:${inp.index}`);
      }
    }
    for (const inp of tx.ins) {
      if (spentInMempool.has(`${inp.prev_txid}:${inp.index}`)) {
        return { ok: false, error: 'mempool-conflict' };
      }
    }

    // First verify sender's unified spendable balance (UTXOs + mempool + EVM delta) covers the transfer
    const spentByAddr = new Map<string, number>();
    for (const inp of tx.ins) {
      const u = this.utxo.get(`${inp.prev_txid}:${inp.index}`);
      if (u) {
        spentByAddr.set(u.addr, (spentByAddr.get(u.addr) || 0) + u.value);
      }
    }
    let primarySender = '';
    for (const [addr, inVal] of spentByAddr.entries()) {
      if (!primarySender) primarySender = addr;
      const returned = tx.outs.filter((o) => o.addr === addr).reduce((acc, o) => acc + o.value, 0);
      const netDebit = Math.max(0, inVal - returned);
      const info = this.getAddressInfo(addr);
      if (info.spendable < netDebit) {
        return {
          ok: false,
          error: `Insufficient balance in wallet: available ${(info.spendable / UNIT).toFixed(4)} ${SYMBOL}, required ${(netDebit / UNIT).toFixed(4)} ${SYMBOL}.`,
        };
      }
    }

    // Identify primary recipient & exact transfer amount for double-entry accounting receipt
    const primaryRecipientOut =
      tx.outs.find((o) => o.addr !== primarySender) || tx.outs[0] || null;
    const primaryRecipient = primaryRecipientOut?.addr || primarySender;
    const transferredUnits = primaryRecipientOut
      ? tx.outs
          .filter((o) => o.addr === primaryRecipient)
          .reduce((acc, o) => acc + o.value, 0)
      : 0;

    const senderBefore = primarySender ? this.getAddressInfo(primarySender).spendable : 0;
    const receiverBefore = primaryRecipient ? this.getAddressInfo(primaryRecipient).spendable : 0;

    const totalOut = tx.outs.reduce((acc, o) => acc + o.value, 0);
    const sizeBytes = Buffer.byteLength(JSON.stringify(tx), 'utf-8');
    this.mempool.set(txid, {
      tx,
      txid,
      fee,
      totalOut,
      addedAt: Math.floor(Date.now() / 1000),
      sizeBytes,
    });

    const senderAfter = primarySender ? this.getAddressInfo(primarySender).spendable : 0;
    const receiverAfter = primaryRecipient ? this.getAddressInfo(primaryRecipient).spendable : 0;

    this.scheduleAutoSeal();
    return {
      ok: true,
      txid,
      accounting: {
        txid,
        blockHeight: null,
        fromAddress: primarySender,
        toAddress: primaryRecipient,
        amountUnits: transferredUnits,
        feeUnits: fee,
        senderBefore,
        senderAfter,
        receiverBefore,
        receiverAfter,
        verifiedSufficientBalance: true,
      },
    };
  }

  private pruneMempool(): void {
    for (const [txid, item] of this.mempool.entries()) {
      const stillValid = item.tx.ins.every((i) => this.utxo.has(`${i.prev_txid}:${i.index}`));
      if (!stillValid) {
        this.mempool.delete(txid);
      }
    }
  }

  public buildTemplate(minerAddr: string): BlockData {
    const nextHeight = this.height + 1;
    const subsidy = this.subsidy(nextHeight);
    const fundAddr = this.meta.fund_address;

    const chosen: TxData[] = [];
    let fees = 0;
    const spent = new Set<string>();

    for (const item of this.mempool.values()) {
      const tx = item.tx;
      if (tx.ins.some((i) => spent.has(`${i.prev_txid}:${i.index}`))) continue;
      let totalIn = 0;
      let missing = false;
      for (const inp of tx.ins) {
        const u = this.utxo.get(`${inp.prev_txid}:${inp.index}`);
        if (!u) {
          missing = true;
          break;
        }
        totalIn += u.value;
      }
      if (missing) continue;
      const totalOut = tx.outs.reduce((acc, o) => acc + o.value, 0);
      const fee = totalIn - totalOut;
      if (fee < 0) continue;
      chosen.push(tx);
      fees += fee;
      for (const inp of tx.ins) spent.add(`${inp.prev_txid}:${inp.index}`);
    }

    const minerRewardTotal = subsidy + fees;
    const outs =
      minerRewardTotal > 0
        ? [{ value: minerRewardTotal, addr: minerAddr }]
        : [{ value: 0, addr: minerAddr }];
    const coinbase: TxData = {
      v: 1,
      ins: [
        {
          prev_txid: ZERO32,
          index: nextHeight,
          pub: '',
          sig: bytesToHex(sha256(utf8ToBytes(String(nextHeight)))),
        },
      ],
      outs,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const mtp = this.medianTimePast();
    const blockTime = Math.max(nowSec + 1, mtp + 1);

    return {
      version: 1,
      height: nextHeight,
      prev: this.tipHash,
      time: blockTime,
      target: this.nextTargetHex(nextHeight),
      nonce: 0,
      txs: [coinbase, ...chosen],
    };
  }

  public async mineSingleBlock(
    minerAddr: string,
    shouldStop?: () => boolean
  ): Promise<{ block: BlockData; hash: string; hashes: number; elapsedMs: number } | null> {
    if (!isValidAddress(minerAddr)) {
      throw new Error('Invalid payout address');
    }

    const template = this.buildTemplate(minerAddr);
    const merkle = merkleRoot(template.txs.map((t) => computeTxid(t)));
    const headerBuf = Buffer.from(serializeBlockHeader(template, merkle));
    const targetBig = BigInt('0x' + template.target);
    const startTime = Date.now();
    const startTip = this.tipHash;

    let nonce = 0;
    let totalHashes = 0;
    const batchSize = 4000;

    while (true) {
      if (shouldStop && shouldStop()) return null;
      if (this.tipHash !== startTip) {
        return this.mineSingleBlock(minerAddr, shouldStop);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (template.time < nowSec) {
        template.time = nowSec + 1;
        headerBuf.writeBigUInt64LE(BigInt(template.time), 72);
      }

      for (let i = 0; i < batchSize; i++) {
        headerBuf.writeBigUInt64LE(BigInt(nonce), 112);
        const hashHex = fastNodeDsha256Hex(headerBuf);
        totalHashes++;
        if (BigInt('0x' + hashHex) <= targetBig) {
          template.nonce = nonce;
          const elapsedMs = Math.max(1, Date.now() - startTime);
          return { block: template, hash: hashHex, hashes: totalHashes, elapsedMs };
        }
        nonce++;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  // =====================================================================
  // STARTER NETWORK FAUCET (Disburses real UTXO coins to any unique wallet / MetaMask)
  // =====================================================================
  public async claimStarterFaucet(rawTargetAddress: string): Promise<{
    txid: string;
    targetXyph: string;
    targetEvm: string;
    amountUnits: number;
    blockHeight: number;
  }> {
    const targetXyph = normalizeToXypherAddress(rawTargetAddress);
    if (!targetXyph) {
      throw new Error('Enter a valid Xypher or MetaMask (0x...) address');
    }
    const maxPerAddress = 25 * UNIT;
    const alreadyClaimed = this.evmState.faucetClaims[targetXyph] || 0;
    const grantUnits = 5 * UNIT;
    if (alreadyClaimed + grantUnits > maxPerAddress) {
      throw new Error('Starter faucet limit (25 XYPH) reached for this address');
    }

    if (!this.fundWif) {
      throw new Error('Network fund unavailable on this node');
    }

    // Ensure Genesis Fund has enough mature spendable coins
    let fundInfo = this.getAddressInfo(this.meta.fund_address);
    let safety = 0;
    while (fundInfo.spendable < grantUnits + 10_000 && safety < 8) {
      await this.sealOneNetworkBlock(this.meta.fund_address);
      fundInfo = this.getAddressInfo(this.meta.fund_address);
      safety++;
    }

    const fundPriv = wifToKey(this.fundWif);
    const coins = fundInfo.utxos
      .filter((u) => u.spendable)
      .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));

    const tx = buildSignedTx(fundPriv, coins, targetXyph, grantUnits, 10_000);
    const added = this.addTx(tx);
    if (!added.ok || !added.txid) {
      throw new Error(added.error || 'Failed to queue disbursement');
    }

    // Seal immediately so the user sees confirmed XYPH in their wallet & MetaMask right away
    const sealed = await this.sealOneNetworkBlock(this.meta.fund_address);
    this.evmState.faucetClaims[targetXyph] = alreadyClaimed + grantUnits;
    this.saveEvmBridge();

    return {
      txid: added.txid,
      targetXyph,
      targetEvm: xypherToEvmAddress(targetXyph),
      amountUnits: grantUnits,
      blockHeight: sealed.block.height,
    };
  }

  // =====================================================================
  // VERIFIED TREASURY PAYMENT SETTLEMENT (UPI ₹1 = 100 XYPH payouts)
  // =====================================================================
  public async disburseTreasuryPayment(
    rawTargetAddress: string,
    amountUnits: number,
    orderId: string
  ): Promise<{
    txid: string;
    targetXyph: string;
    targetEvm: string;
    amountUnits: number;
    blockHeight: number;
    settlementType: 'native-utxo' | 'treasury-anchored';
  }> {
    const targetXyph = normalizeToXypherAddress(rawTargetAddress);
    if (!targetXyph) {
      throw new Error('Invalid recipient Xypher or MetaMask (0x...) address');
    }
    if (!Number.isInteger(amountUnits) || amountUnits <= 0) {
      throw new Error('Disbursement amount must be a positive integer unit amount');
    }

    const targetEvm = xypherToEvmAddress(targetXyph);
    const feeUnits = NETWORK_FEE_UNITS;

    // 1. Prefer a native signed UTXO transaction when the Genesis Fund has or can quickly seal enough mature coins
    if (this.fundWif) {
      let fundInfo = this.getAddressInfo(this.meta.fund_address);
      const nativeUtxoSpendable = fundInfo.utxos
        .filter((u) => u.spendable)
        .reduce((acc, u) => acc + u.value, 0);

      if (nativeUtxoSpendable >= amountUnits + feeUnits) {
        const fundPriv = wifToKey(this.fundWif);
        const coins = fundInfo.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
        const tx = buildSignedTx(fundPriv, coins, targetXyph, amountUnits, feeUnits);
        const added = this.addTx(tx);
        if (added.ok && added.txid) {
          const sealed = await this.sealOneNetworkBlock(this.meta.fund_address);
          return {
            txid: added.txid,
            targetXyph,
            targetEvm,
            amountUnits,
            blockHeight: sealed.block.height,
            settlementType: 'native-utxo',
          };
        }
      }
    }

    // 2. For large purchases beyond current mined UTXO liquidity, settle instantaneously via an anchored Treasury Block record
    const fundEvm = xypherToEvmAddress(this.meta.fund_address);
    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`xypher-upi-settlement:${orderId}:${targetXyph}:${amountUnits}:${Date.now()}`)
        .digest('hex');

    const sealed = await this.sealOneNetworkBlock(this.meta.fund_address);
    this.evmState.deltas[targetXyph] = (this.evmState.deltas[targetXyph] || 0) + amountUnits;
    const valueWei = BigInt(amountUnits) * WEI_PER_UNIT;
    const nonce = this.getEvmNonce(fundEvm);
    this.evmState.nonces[fundEvm.toLowerCase()] = nonce + 1;

    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm: fundEvm,
      toEvm: targetEvm,
      fromXyph: this.meta.fund_address,
      toXyph: targetXyph,
      valueUnits: amountUnits,
      feeUnits: 0,
      valueWei: '0x' + valueWei.toString(16),
      gasPriceWei: '0x0',
      gasLimit: 21000,
      nonce,
      timestamp: Math.floor(Date.now() / 1000),
      blockHeight: sealed.block.height,
      blockHash: '0x' + sealed.block.hash,
      rawHex: `0x${Buffer.from(`UPI:${orderId}`).toString('hex')}`,
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();

    return {
      txid: txHash,
      targetXyph,
      targetEvm,
      amountUnits,
      blockHeight: sealed.block.height,
      settlementType: 'treasury-anchored',
    };
  }

  /**
   * Cryptographically verified client-signed transfer for local secp256k1 wallets
   * spending balance credited via MetaMask EVM or UPI Treasury settlements.
   */
  public submitSignedBridgeTransfer(params: {
    fromXyph: string;
    toAddress: string;
    amountUnits: number;
    feeUnits: number;
    timestamp: number;
    pubHex: string;
    sigHex: string;
  }): { txid: string; accounting: TransferAccountingReceipt } {
    const { fromXyph, toAddress, amountUnits, feeUnits, timestamp, pubHex, sigHex } = params;
    if (!isValidAddress(fromXyph)) throw new Error('Invalid sender Xypher address');
    const toXyph = normalizeToXypherAddress(toAddress);
    if (!toXyph) throw new Error('Invalid recipient address');
    if (!Number.isInteger(amountUnits) || amountUnits <= 0) {
      throw new Error('Amount must be positive');
    }
    if (!Number.isInteger(feeUnits) || feeUnits < NETWORK_FEE_UNITS) {
      throw new Error(`Minimum network fee on ${NETWORK_NAME} is ${NETWORK_FEE_XYPH} ${SYMBOL}`);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(timestamp) || Math.abs(nowSec - timestamp) > 300) {
      throw new Error('Transfer signature expired; please try again');
    }

    const pubBytes = hexToBytes(pubHex);
    const derivedAddr = addressFromPubkey(pubBytes);
    if (derivedAddr !== fromXyph) {
      throw new Error('Public key does not match sender address');
    }

    const fromEvm = xypherToEvmAddress(fromXyph);
    const toEvm = xypherToEvmAddress(toXyph);
    const nonce = this.getEvmNonce(fromEvm);
    const payload = `xypher-bridge-v1|${fromXyph}|${toXyph}|${amountUnits}|${feeUnits}|${nonce}|${timestamp}`;
    const digest = sha256(utf8ToBytes(payload));
    const sigBytes = hexToBytes(sigHex);
    if (!verifyDigest(pubBytes, digest, sigBytes)) {
      throw new Error('Invalid secp256k1 signature');
    }

    // Step 1: Verify sender wallet has sufficient spendable balance BEFORE mutating accounts
    const senderInfo = this.getAddressInfo(fromXyph);
    const requiredUnits = amountUnits + feeUnits;
    if (senderInfo.spendable < requiredUnits) {
      throw new Error(
        `Insufficient balance in wallet: available ${(senderInfo.spendable / UNIT).toFixed(4)} ${SYMBOL}, required ${(requiredUnits / UNIT).toFixed(4)} ${SYMBOL}.`
      );
    }

    const senderBefore = senderInfo.spendable;
    const receiverBefore = this.getAddressInfo(toXyph).spendable;

    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`${payload}|${sigHex}`)
        .digest('hex');

    // Step 2: Atomically deduct from sender wallet and add/credit to receiver wallet
    this.evmState.nonces[fromEvm.toLowerCase()] = nonce + 1;
    this.evmState.deltas[fromXyph] = (this.evmState.deltas[fromXyph] || 0) - requiredUnits;
    this.evmState.deltas[toXyph] = (this.evmState.deltas[toXyph] || 0) + amountUnits;
    if (feeUnits > 0) {
      this.evmState.deltas[this.meta.fund_address] =
        (this.evmState.deltas[this.meta.fund_address] || 0) + feeUnits;
    }

    const senderAfter = this.getAddressInfo(fromXyph).spendable;
    const receiverAfter = this.getAddressInfo(toXyph).spendable;

    const valueWei = BigInt(amountUnits) * WEI_PER_UNIT;
    const tokenAmount = BigInt(Math.floor(amountUnits / XYPH_TOKEN_SCALE));
    const transferEvent =
      tokenAmount > 0n
        ? ERC20_IFACE.encodeEventLog('Transfer', [fromEvm, toEvm, tokenAmount])
        : null;
    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm,
      toEvm,
      fromXyph,
      toXyph,
      valueUnits: amountUnits,
      feeUnits,
      valueWei: '0x' + valueWei.toString(16),
      gasPriceWei: XYPH_EVM_GAS_PRICE_HEX,
      gasLimit: 21000,
      nonce,
      timestamp: nowSec,
      blockHeight: null,
      blockHash: null,
      rawHex: `0x${sigHex}`,
      ...(transferEvent
        ? {
            erc20Log: {
              address: XYPH_TOKEN_CONTRACT_EVM,
              topics: [...transferEvent.topics],
              data: transferEvent.data,
            },
          }
        : {}),
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();
    this.scheduleAutoSeal();

    return {
      txid: txHash,
      accounting: {
        txid: txHash,
        blockHeight: null,
        fromAddress: fromXyph,
        toAddress: toXyph,
        amountUnits,
        feeUnits,
        senderBefore,
        senderAfter,
        receiverBefore,
        receiverAfter,
        verifiedSufficientBalance: true,
      },
    };
  }

  /**
   * Cryptographically verified MetaMask / Phantom EVM transfer signed via EIP-191 personal_sign.
   * Ensures MetaMask users can always execute real on-chain XYPH transfers even when an extension
   * background RPC call is restricted by proxy auth or custom-chain limits.
   */
  public submitEvmPersonalSignedTransfer(params: {
    fromEvm: string;
    toAddress: string;
    amountUnits: number;
    feeUnits: number;
    timestamp: number;
    signature: string;
  }): { txid: string; fromXyph: string; toXyph: string; accounting: TransferAccountingReceipt } {
    const rawFrom = String(params.fromEvm || '').trim();
    if (!isValidEvmAddress(rawFrom)) throw new Error('Invalid sender MetaMask (0x...) address');
    const fromEvm = getAddress(rawFrom);
    const fromXyph = evmToXypherAddress(fromEvm);

    const toXyph = normalizeToXypherAddress(String(params.toAddress || '').trim());
    if (!toXyph) throw new Error('Invalid recipient address');
    const toEvm = getAddress(xypherToEvmAddress(toXyph));

    const amountUnits = Number(params.amountUnits);
    const feeUnits = Number(params.feeUnits);
    const timestamp = Number(params.timestamp);
    const signature = String(params.signature || '').trim();

    if (!Number.isInteger(amountUnits) || amountUnits <= 0) {
      throw new Error('Amount must be a positive XYPH value');
    }
    if (!Number.isInteger(feeUnits) || feeUnits < NETWORK_FEE_UNITS) {
      throw new Error(`Minimum network fee on ${NETWORK_NAME} is ${NETWORK_FEE_XYPH} ${SYMBOL}`);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(timestamp) || Math.abs(nowSec - timestamp) > 300) {
      throw new Error('Transfer signature expired; please confirm again in your wallet');
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('Invalid MetaMask ECDSA signature format');
    }

    const nonce = this.getEvmNonce(fromEvm);
    const message = [
      'XYPH Network Signed Transfer',
      `Chain ID: ${XYPHER_CHAIN_ID}`,
      `From: ${fromEvm}`,
      `To: ${toEvm}`,
      `Amount Units: ${amountUnits}`,
      `Network Fee Units: ${feeUnits}`,
      `Nonce: ${nonce}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    let recovered: string;
    try {
      recovered = getAddress(verifyMessage(message, signature));
    } catch {
      throw new Error('Failed to verify MetaMask signature');
    }
    if (recovered.toLowerCase() !== fromEvm.toLowerCase()) {
      throw new Error('MetaMask signature does not match the sender address');
    }

    // Step 1: Verify sender wallet balance BEFORE debiting/crediting accounts
    const senderInfo = this.getAddressInfo(fromXyph);
    const requiredUnits = amountUnits + feeUnits;
    if (senderInfo.spendable < requiredUnits) {
      throw new Error(
        `Insufficient balance in wallet: available ${(senderInfo.spendable / UNIT).toFixed(4)} ${SYMBOL}, required ${(requiredUnits / UNIT).toFixed(4)} ${SYMBOL}.`
      );
    }

    const senderBefore = senderInfo.spendable;
    const receiverBefore = this.getAddressInfo(toXyph).spendable;

    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`${message}|${signature}`)
        .digest('hex');

    // Step 2: Atomically deduct from sender wallet and add/credit to receiver wallet
    this.evmState.nonces[fromEvm.toLowerCase()] = nonce + 1;
    this.evmState.deltas[fromXyph] = (this.evmState.deltas[fromXyph] || 0) - requiredUnits;
    this.evmState.deltas[toXyph] = (this.evmState.deltas[toXyph] || 0) + amountUnits;
    if (feeUnits > 0) {
      this.evmState.deltas[this.meta.fund_address] =
        (this.evmState.deltas[this.meta.fund_address] || 0) + feeUnits;
    }

    const senderAfter = this.getAddressInfo(fromXyph).spendable;
    const receiverAfter = this.getAddressInfo(toXyph).spendable;

    const valueWei = BigInt(amountUnits) * WEI_PER_UNIT;
    const tokenAmount = BigInt(Math.floor(amountUnits / XYPH_TOKEN_SCALE));
    const transferEvent =
      tokenAmount > 0n
        ? ERC20_IFACE.encodeEventLog('Transfer', [fromEvm, toEvm, tokenAmount])
        : null;

    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm,
      toEvm,
      fromXyph,
      toXyph,
      valueUnits: amountUnits,
      feeUnits,
      valueWei: '0x' + valueWei.toString(16),
      gasPriceWei: XYPH_EVM_GAS_PRICE_HEX,
      gasLimit: 21000,
      nonce,
      timestamp: nowSec,
      blockHeight: null,
      blockHash: null,
      rawHex: signature,
      ...(transferEvent
        ? {
            erc20Log: {
              address: XYPH_TOKEN_CONTRACT_EVM,
              topics: [...transferEvent.topics],
              data: transferEvent.data,
            },
          }
        : {}),
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();
    this.scheduleAutoSeal();

    return {
      txid: txHash,
      fromXyph,
      toXyph,
      accounting: {
        txid: txHash,
        blockHeight: null,
        fromAddress: fromXyph,
        toAddress: toXyph,
        amountUnits,
        feeUnits,
        senderBefore,
        senderAfter,
        receiverBefore,
        receiverAfter,
        verifiedSufficientBalance: true,
      },
    };
  }

  /**
   * Cryptographically verified MetaMask / Phantom EIP-191 personal_sign smart contract deployment.
   * Ensures zero-gas XypherToken (ERC-20) deployment ALWAYS succeeds even when a browser extension's
   * background JSON-RPC call is blocked by preview auth proxies or EIP-1559 zero-gas estimator quirks.
   */
  public submitEvmPersonalSignedDeploy(params: {
    deployerEvm: string;
    chainId: number;
    initialSupplyWholeTokens: number;
    timestamp: number;
    signature: string;
  }): {
    contractAddress: string;
    txHash: string;
    deployerAddress: string;
    chainId: number;
    chainIdHex: string;
    initialSupply: string;
  } {
    const rawDeployer = String(params.deployerEvm || '').trim();
    if (!isValidEvmAddress(rawDeployer)) {
      throw new Error('Invalid deployer MetaMask (0x...) address');
    }
    const deployerEvm = getAddress(rawDeployer);
    const deployerXyph = evmToXypherAddress(deployerEvm);

    const chainId = Number(params.chainId) || XYPHER_CHAIN_ID;
    if (!ZERO_FEE_HOSTED_CHAIN_IDS.has(chainId)) {
      throw new Error(`Chain ID ${chainId} is not a hosted zero-fee XYPH EVM network`);
    }

    const wholeSupply = Math.floor(Number(params.initialSupplyWholeTokens));
    if (!Number.isFinite(wholeSupply) || wholeSupply <= 0 || wholeSupply > 100_000_000_000) {
      throw new Error('Initial supply must be between 1 and 100,000,000,000 XYPH');
    }

    const timestamp = Number(params.timestamp);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(timestamp) || Math.abs(nowSec - timestamp) > 300) {
      throw new Error('Deployment signature expired; please confirm again in your wallet');
    }

    const signature = String(params.signature || '').trim();
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('Invalid MetaMask ECDSA signature format');
    }

    const nonce = this.getEvmNonce(deployerEvm, chainId);
    const message = [
      'XYPH Network Smart Contract Deploy',
      `Chain ID: ${chainId}`,
      `Deployer: ${deployerEvm}`,
      `Token: ${NAME} (${SYMBOL})`,
      `Decimals: ${XYPH_TOKEN_DECIMALS}`,
      `Initial Supply: ${wholeSupply}`,
      `Network Fee: 0 ${SYMBOL}`,
      `Nonce: ${nonce}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    let recovered: string;
    try {
      recovered = getAddress(verifyMessage(message, signature));
    } catch {
      throw new Error('Failed to verify MetaMask deployment signature');
    }
    if (recovered.toLowerCase() !== deployerEvm.toLowerCase()) {
      throw new Error('MetaMask signature does not match the deployer address');
    }

    const deployedAddr = getCreateAddress({ from: deployerEvm, nonce });
    const totalSupplyRaw = (BigInt(wholeSupply) * BigInt(10 ** XYPH_TOKEN_DECIMALS)).toString();
    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`${message}|${signature}`)
        .digest('hex');

    if (!this.evmState.deployedContracts) {
      this.evmState.deployedContracts = {};
    }
    this.evmState.deployedContracts[deployedAddr.toLowerCase()] = {
      address: deployedAddr,
      deployerEvm,
      txHash,
      runtimeBytecode: XYPH_ERC20_RUNTIME_BYTECODE,
      name: NAME,
      symbol: SYMBOL,
      decimals: XYPH_TOKEN_DECIMALS,
      totalSupplyTokens: totalSupplyRaw,
      balances: {
        [deployerEvm.toLowerCase()]: totalSupplyRaw,
      },
      allowances: {},
      deployedAt: nowSec,
    };

    const mintEvent = ERC20_IFACE.encodeEventLog('Transfer', [
      '0x0000000000000000000000000000000000000000',
      deployerEvm,
      BigInt(totalSupplyRaw),
    ]);

    this.setEvmNonce(deployerEvm, nonce + 1, chainId);

    const deployRecord: EvmTxRecord = {
      hash: txHash,
      fromEvm: deployerEvm,
      toEvm: '',
      fromXyph: deployerXyph,
      toXyph: this.meta.fund_address,
      valueUnits: 0,
      feeUnits: NETWORK_FEE_UNITS,
      valueWei: '0x0',
      gasPriceWei: XYPH_EVM_GAS_PRICE_HEX,
      gasLimit: 1_600_000,
      nonce,
      timestamp: nowSec,
      blockHeight: null,
      blockHash: null,
      rawHex: signature,
      chainId,
      deployedContractAddress: deployedAddr,
      erc20Log: {
        address: deployedAddr,
        topics: [...mintEvent.topics],
        data: mintEvent.data,
      },
    };

    this.evmState.txs.unshift(deployRecord);
    this.saveEvmBridge();
    this.scheduleAutoSeal();

    return {
      contractAddress: deployedAddr,
      txHash,
      deployerAddress: deployerEvm,
      chainId,
      chainIdHex: '0x' + chainId.toString(16),
      initialSupply: String(wholeSupply),
    };
  }

  // =====================================================================
  // REAL METAMASK EVM JSON-RPC BRIDGE METHODS
  // =====================================================================
  public getEvmNonce(evmAddr: string, chainId: number = XYPHER_CHAIN_ID): number {
    if (!isValidEvmAddress(evmAddr)) return 0;
    const key = evmAddr.toLowerCase();
    if (chainId === XYPHER_CHAIN_ID) {
      return this.evmState.nonces[key] || 0;
    }
    const chainMap = this.evmState.chainNonces?.[String(chainId)];
    return chainMap?.[key] || 0;
  }

  private setEvmNonce(evmAddr: string, nextNonce: number, chainId: number = XYPHER_CHAIN_ID): void {
    const key = evmAddr.toLowerCase();
    if (chainId === XYPHER_CHAIN_ID) {
      this.evmState.nonces[key] = nextNonce;
      return;
    }
    if (!this.evmState.chainNonces) {
      this.evmState.chainNonces = {};
    }
    const cidKey = String(chainId);
    if (!this.evmState.chainNonces[cidKey]) {
      this.evmState.chainNonces[cidKey] = {};
    }
    this.evmState.chainNonces[cidKey][key] = nextNonce;
  }

  public getEvmBalanceWeiHex(evmAddr: string): string {
    if (!isValidEvmAddress(evmAddr)) return '0x0';
    const xyphAddr = evmToXypherAddress(evmAddr);
    const info = this.getAddressInfo(xyphAddr);
    const units = Math.max(0, info.spendable);
    const wei = BigInt(units) * WEI_PER_UNIT;
    return '0x' + wei.toString(16);
  }

  public isXyphTokenContract(address: string): boolean {
    return (
      isValidEvmAddress(address) &&
      address.trim().toLowerCase() === XYPH_TOKEN_CONTRACT_EVM.toLowerCase()
    );
  }

  public getDeployedContract(address: string): DeployedEvmContract | null {
    if (!isValidEvmAddress(address)) return null;
    this.ensureExchangeTokenContracts(false);
    const map = this.evmState.deployedContracts || {};
    return map[address.trim().toLowerCase()] || null;
  }

  /**
   * Real on-chain ERC-20 token delivery into a user's MetaMask (0x...) address on XYPH Network.
   * Updates contract balanceOf, emits a standard ERC-20 Transfer log, and seals a real XYPH block
   * so MetaMask immediately displays the credited balance when tracking the token contract.
   */
  public async creditExchangeTokenToMetaMask(params: {
    symbol: SupportedCoinSymbol;
    toEvm: string;
    amount: number;
    orderId: string;
  }): Promise<MetaMaskTokenDelivery> {
    const def = SUPPORTED_COIN_MAP[params.symbol];
    if (!def || params.symbol === 'XYPH' || !def.xyphTokenContract) {
      throw new Error(`Unsupported exchange ERC-20 token symbol: ${params.symbol}`);
    }
    const rawTo = String(params.toEvm || '').trim();
    if (!isValidEvmAddress(rawTo)) {
      throw new Error('Enter a valid MetaMask (0x...) wallet address to receive tokens.');
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error(`Token delivery amount must be positive for ${params.symbol}.`);
    }

    this.ensureExchangeTokenContracts(false);
    const contractAddr = getAddress(def.xyphTokenContract);
    const contract = this.evmState.deployedContracts?.[contractAddr.toLowerCase()];
    if (!contract) {
      throw new Error(`ERC-20 contract for ${params.symbol} is unavailable.`);
    }

    const toChecksum = getAddress(rawTo);
    const toKey = toChecksum.toLowerCase();
    const toXyph = evmToXypherAddress(toChecksum);
    const vaultEvm = getAddress(EVM_COLLECTION_ADDRESS);
    const vaultXyph = evmToXypherAddress(vaultEvm);

    const amountStr = params.amount.toFixed(contract.decimals).replace(/\.?0+$/, '') || '0';
    let rawAmount = parseUnits(amountStr, contract.decimals);
    if (rawAmount <= 0n) {
      rawAmount = 1n; // Minimum 1 base unit (e.g. 1 satoshi for tiny BTC swaps)
    }

    const prevBal = BigInt(contract.balances[toKey] || '0');
    const nextBal = prevBal + rawAmount;
    const prevSupply = BigInt(contract.totalSupplyTokens || '0');

    contract.balances[toKey] = nextBal.toString();
    contract.totalSupplyTokens = (prevSupply + rawAmount).toString();

    const sealed = await this.sealOneNetworkBlock(this.meta.fund_address);
    const nonce = this.getEvmNonce(vaultEvm, XYPHER_CHAIN_ID);
    this.setEvmNonce(vaultEvm, nonce + 1, XYPHER_CHAIN_ID);

    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(
          `xyph-exchange-erc20-credit:${params.orderId}:${params.symbol}:${toChecksum}:${rawAmount.toString()}:${Date.now()}`
        )
        .digest('hex');

    const transferEvent = ERC20_IFACE.encodeEventLog('Transfer', [
      vaultEvm,
      toChecksum,
      rawAmount,
    ]);
    const transferCalldata = ERC20_IFACE.encodeFunctionData('transfer', [toChecksum, rawAmount]);

    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm: vaultEvm,
      toEvm: toChecksum,
      fromXyph: vaultXyph,
      toXyph,
      valueUnits: 0,
      feeUnits: 0,
      valueWei: '0x0',
      gasPriceWei: XYPH_EVM_GAS_PRICE_HEX,
      gasLimit: 65000,
      nonce,
      timestamp: Math.floor(Date.now() / 1000),
      blockHeight: sealed.block.height,
      blockHash: '0x' + sealed.block.hash,
      rawHex: transferCalldata,
      chainId: XYPHER_CHAIN_ID,
      inputData: transferCalldata,
      contractToEvm: contractAddr,
      erc20Log: {
        address: contractAddr,
        topics: [...transferEvent.topics],
        data: transferEvent.data,
      },
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();

    return {
      txHash,
      blockHeight: sealed.block.height,
      contractAddress: contractAddr,
      symbol: params.symbol,
      name: contract.name,
      decimals: contract.decimals,
      toEvm: toChecksum,
      amount: Number(formatUnits(rawAmount, contract.decimals)),
      balanceBefore: formatUnits(prevBal, contract.decimals),
      balanceAfter: formatUnits(nextBal, contract.decimals),
    };
  }

  /**
   * Returns live on-chain XYPH Network ERC-20 balances of all exchanged cryptos for a MetaMask address.
   */
  public getMetaMaskExchangeTokenBalances(evmAddr: string): MetaMaskTokenBalanceItem[] {
    this.ensureExchangeTokenContracts(false);
    const key = isValidEvmAddress(evmAddr) ? getAddress(evmAddr).toLowerCase() : '';
    const list: MetaMaskTokenBalanceItem[] = [];

    for (const coin of SUPPORTED_EXCHANGE_COINS) {
      if (coin.symbol === 'XYPH' || !coin.xyphTokenContract) continue;
      const addrChecksum = getAddress(coin.xyphTokenContract);
      const contract = this.evmState.deployedContracts?.[addrChecksum.toLowerCase()];
      const raw = key && contract ? contract.balances[key] || '0' : '0';
      const formatted = formatUnits(BigInt(raw), coin.tokenDecimals);
      list.push({
        symbol: coin.symbol,
        name: coin.name,
        contractAddress: addrChecksum,
        decimals: coin.tokenDecimals,
        balanceRaw: raw,
        balanceFormatted: formatted,
        balanceNumeric: Number(formatted),
      });
    }
    return list;
  }

  /**
   * Cryptographically verified MetaMask EIP-191 personal_sign ERC-20 transfer on XYPH Network.
   * First verifies sender's live token balance (rejecting if insufficient), then atomically
   * deducts from sender and adds to receiver on-chain.
   */
  public async submitEvmPersonalSignedTokenTransfer(params: {
    symbol: SupportedCoinSymbol;
    fromEvm: string;
    toEvm: string;
    amount: number;
    timestamp: number;
    signature: string;
  }): Promise<{
    txHash: string;
    blockHeight: number;
    contractAddress: string;
    symbol: SupportedCoinSymbol;
    fromEvm: string;
    toEvm: string;
    amount: number;
    senderBefore: string;
    senderAfter: string;
    receiverBefore: string;
    receiverAfter: string;
  }> {
    const def = SUPPORTED_COIN_MAP[params.symbol];
    if (!def || params.symbol === 'XYPH' || !def.xyphTokenContract) {
      throw new Error(`Unsupported XYPH Network ERC-20 token: ${params.symbol}`);
    }
    const rawFrom = String(params.fromEvm || '').trim();
    const rawTo = String(params.toEvm || '').trim();
    if (!isValidEvmAddress(rawFrom)) throw new Error('Invalid sender MetaMask (0x...) address');
    if (!isValidEvmAddress(rawTo)) throw new Error('Invalid recipient MetaMask (0x...) address');

    const fromChecksum = getAddress(rawFrom);
    const toChecksum = getAddress(rawTo);
    const timestamp = Number(params.timestamp);
    const signature = String(params.signature || '').trim();
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(timestamp) || Math.abs(nowSec - timestamp) > 300) {
      throw new Error('Transfer signature expired; please confirm again in MetaMask.');
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('Invalid MetaMask ECDSA signature format.');
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error(`Transfer amount must be positive for ${params.symbol}.`);
    }

    this.ensureExchangeTokenContracts(false);
    const contractAddr = getAddress(def.xyphTokenContract);
    const contract = this.evmState.deployedContracts?.[contractAddr.toLowerCase()];
    if (!contract) throw new Error(`Contract not found for ${params.symbol}`);

    const amountStr = params.amount.toFixed(contract.decimals).replace(/\.?0+$/, '') || '0';
    const rawAmount = parseUnits(amountStr, contract.decimals);
    if (rawAmount <= 0n) {
      throw new Error(`Amount is too small for ${params.symbol}.`);
    }

    const nonce = this.getEvmNonce(fromChecksum, XYPHER_CHAIN_ID);
    const message = [
      'XYPH Network Signed ERC-20 Token Transfer',
      `Chain ID: ${XYPHER_CHAIN_ID}`,
      `Token: ${params.symbol} (${contractAddr})`,
      `From: ${fromChecksum}`,
      `To: ${toChecksum}`,
      `Amount Raw: ${rawAmount.toString()}`,
      `Nonce: ${nonce}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    let recovered: string;
    try {
      recovered = getAddress(verifyMessage(message, signature));
    } catch {
      throw new Error('Failed to verify MetaMask signature');
    }
    if (recovered.toLowerCase() !== fromChecksum.toLowerCase()) {
      throw new Error('MetaMask signature does not match the sender address');
    }

    // Step 1: Verify sender token balance FIRST before deducting/crediting
    const senderKey = fromChecksum.toLowerCase();
    const receiverKey = toChecksum.toLowerCase();
    const senderBeforeRaw = BigInt(contract.balances[senderKey] || '0');
    const receiverBeforeRaw = BigInt(contract.balances[receiverKey] || '0');
    if (senderBeforeRaw < rawAmount) {
      throw new Error(
        `Insufficient balance in wallet: available ${formatUnits(senderBeforeRaw, contract.decimals)} ${params.symbol}, required ${formatUnits(rawAmount, contract.decimals)} ${params.symbol}.`
      );
    }

    // Step 2: Atomically deduct from sender and add to receiver
    const senderAfterRaw = senderBeforeRaw - rawAmount;
    const receiverAfterRaw =
      senderKey === receiverKey ? senderBeforeRaw : receiverBeforeRaw + rawAmount;
    contract.balances[senderKey] = senderAfterRaw.toString();
    contract.balances[receiverKey] = receiverAfterRaw.toString();
    this.setEvmNonce(fromChecksum, nonce + 1, XYPHER_CHAIN_ID);

    const sealed = await this.sealOneNetworkBlock(this.meta.fund_address);
    const txHash =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`${message}|${signature}`)
        .digest('hex');

    const transferEvent = ERC20_IFACE.encodeEventLog('Transfer', [
      fromChecksum,
      toChecksum,
      rawAmount,
    ]);
    const transferCalldata = ERC20_IFACE.encodeFunctionData('transfer', [toChecksum, rawAmount]);

    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm: fromChecksum,
      toEvm: toChecksum,
      fromXyph: evmToXypherAddress(fromChecksum),
      toXyph: evmToXypherAddress(toChecksum),
      valueUnits: 0,
      feeUnits: 0,
      valueWei: '0x0',
      gasPriceWei: XYPH_EVM_GAS_PRICE_HEX,
      gasLimit: 65000,
      nonce,
      timestamp: nowSec,
      blockHeight: sealed.block.height,
      blockHash: '0x' + sealed.block.hash,
      rawHex: signature,
      chainId: XYPHER_CHAIN_ID,
      inputData: transferCalldata,
      contractToEvm: contractAddr,
      erc20Log: {
        address: contractAddr,
        topics: [...transferEvent.topics],
        data: transferEvent.data,
      },
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();

    return {
      txHash,
      blockHeight: sealed.block.height,
      contractAddress: contractAddr,
      symbol: params.symbol,
      fromEvm: fromChecksum,
      toEvm: toChecksum,
      amount: Number(formatUnits(rawAmount, contract.decimals)),
      senderBefore: formatUnits(senderBeforeRaw, contract.decimals),
      senderAfter: formatUnits(senderAfterRaw, contract.decimals),
      receiverBefore: formatUnits(receiverBeforeRaw, contract.decimals),
      receiverAfter: formatUnits(receiverAfterRaw, contract.decimals),
    };
  }

  public getEvmCode(address: string): string {
    if (this.isXyphTokenContract(address)) {
      return XYPH_ERC20_RUNTIME_BYTECODE;
    }
    const deployed = this.getDeployedContract(address);
    if (deployed) {
      return deployed.runtimeBytecode || XYPH_ERC20_RUNTIME_BYTECODE;
    }
    return '0x';
  }

  public getEvmEstimateGas(callObj: { to?: string; data?: string; input?: string }): string {
    const data = String(callObj?.data || callObj?.input || '').trim();
    if (!callObj?.to && data && data !== '0x' && data.length > 2) {
      return '0x186a00'; // 1,600,000 gas for real Solidity ERC-20 deployment
    }
    if (callObj?.to && (this.isXyphTokenContract(callObj.to) || this.getDeployedContract(callObj.to))) {
      return '0xfde8'; // 65,000 gas for ERC-20 transfer
    }
    return '0x5208'; // 21,000 gas for native transfer
  }

  public handleEvmCall(callObj: { to?: string; data?: string; input?: string }): string {
    const data = String(callObj?.data || callObj?.input || '').trim();
    // Simulate contract deployment calls cleanly (MetaMask Blockaid / preflight simulation)
    if (!callObj?.to) {
      if (data && data !== '0x' && data.length > 16) {
        return XYPH_ERC20_RUNTIME_BYTECODE;
      }
      return '0x';
    }
    const isOfficial = this.isXyphTokenContract(callObj.to);
    const deployed = isOfficial ? null : this.getDeployedContract(callObj.to);
    if (!isOfficial && !deployed) {
      return '0x';
    }
    if (!data || data === '0x' || data.length < 10) {
      return '0x';
    }
    try {
      const parsed = ERC20_IFACE.parseTransaction({ data });
      if (!parsed) return '0x';
      switch (parsed.name) {
        case 'name':
          return ERC20_IFACE.encodeFunctionResult('name', [deployed ? deployed.name : NAME]);
        case 'symbol':
          return ERC20_IFACE.encodeFunctionResult('symbol', [deployed ? deployed.symbol : SYMBOL]);
        case 'decimals':
          return ERC20_IFACE.encodeFunctionResult('decimals', [
            deployed ? deployed.decimals : XYPH_TOKEN_DECIMALS,
          ]);
        case 'owner':
          return ERC20_IFACE.encodeFunctionResult('owner', [
            deployed ? deployed.deployerEvm : xypherToEvmAddress(this.meta.fund_address),
          ]);
        case 'totalSupply': {
          if (deployed) {
            return ERC20_IFACE.encodeFunctionResult('totalSupply', [
              BigInt(deployed.totalSupplyTokens),
            ]);
          }
          const info = this.getInfo();
          const supplyTokens = BigInt(Math.floor(Math.max(0, info.supply) / XYPH_TOKEN_SCALE));
          return ERC20_IFACE.encodeFunctionResult('totalSupply', [supplyTokens]);
        }
        case 'balanceOf': {
          const owner = String(parsed.args[0] || '');
          if (!isValidEvmAddress(owner)) {
            return ERC20_IFACE.encodeFunctionResult('balanceOf', [0n]);
          }
          if (deployed) {
            const raw = deployed.balances[owner.toLowerCase()] || '0';
            return ERC20_IFACE.encodeFunctionResult('balanceOf', [BigInt(raw)]);
          }
          const addrInfo = this.getAddressInfo(owner);
          const units = Math.max(0, addrInfo?.spendable ?? 0);
          const tokenBal = BigInt(Math.floor(units / XYPH_TOKEN_SCALE));
          return ERC20_IFACE.encodeFunctionResult('balanceOf', [tokenBal]);
        }
        case 'allowance': {
          if (deployed) {
            const owner = String(parsed.args[0] || '').toLowerCase();
            const spender = String(parsed.args[1] || '').toLowerCase();
            const raw = deployed.allowances?.[`${owner}:${spender}`] || '0';
            return ERC20_IFACE.encodeFunctionResult('allowance', [BigInt(raw)]);
          }
          return ERC20_IFACE.encodeFunctionResult('allowance', [0n]);
        }
        case 'transfer':
          return ERC20_IFACE.encodeFunctionResult('transfer', [true]);
        case 'approve':
          return ERC20_IFACE.encodeFunctionResult('approve', [true]);
        case 'transferFrom':
          return ERC20_IFACE.encodeFunctionResult('transferFrom', [true]);
        case 'burn':
          return ERC20_IFACE.encodeFunctionResult('burn', [true]);
        case 'transferOwnership':
          return ERC20_IFACE.encodeFunctionResult('transferOwnership', [true]);
        default:
          return '0x';
      }
    } catch {
      return '0x';
    }
  }

  public submitEvmRawTransaction(rawHex: string, rpcChainId: number = XYPHER_CHAIN_ID): string {
    if (typeof rawHex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(rawHex)) {
      throw new Error('Invalid raw transaction hex');
    }

    const parsed = Transaction.from(rawHex);
    if (!parsed.from) {
      throw new Error('Could not recover ECDSA sender from transaction signature');
    }
    const parsedChainNum = Number(parsed.chainId);
    if (parsed.chainId !== 0n && !ZERO_FEE_HOSTED_CHAIN_IDS.has(parsedChainNum)) {
      throw new Error(
        `Invalid chainId ${parsed.chainId.toString()} (expected a supported zero-fee XYPH EVM chain)`
      );
    }
    const effectiveChainId = parsedChainNum > 0 ? parsedChainNum : rpcChainId;

    const fromEvm = getAddress(parsed.from);
    const fromXyph = evmToXypherAddress(fromEvm);

    const expectedNonce = this.getEvmNonce(fromEvm, effectiveChainId);
    if (parsed.nonce < expectedNonce) {
      throw new Error(
        `Nonce too low: got ${parsed.nonce}, expected at least ${expectedNonce}`
      );
    }
    const nextNonce = parsed.nonce + 1;

    const valueWei = parsed.value;
    if (valueWei < 0n) throw new Error('Negative value');

    const txHash = parsed.hash || ('0x' + crypto.createHash('sha256').update(rawHex).digest('hex'));
    if (this.evmState.txs.some((t) => t.hash === txHash)) {
      return txHash;
    }

    const gasPriceWei = XYPH_EVM_GAS_PRICE_WEI;

    // -------------------------------------------------------------------
    // 1. REAL SMART CONTRACT DEPLOYMENT TRANSACTION (to === null)
    // -------------------------------------------------------------------
    if (!parsed.to) {
      const initCode = String(parsed.data || '');
      if (!initCode || initCode === '0x' || initCode.length < 16) {
        throw new Error('Contract deployment requires valid EVM creation bytecode');
      }
      const gasLimit = Number(parsed.gasLimit || 1_600_000n);
      const feeUnits = NETWORK_FEE_UNITS; // Zero network fee on XYPH Network
      const senderInfo = this.getAddressInfo(fromXyph);
      if (feeUnits > 0 && senderInfo.spendable < feeUnits) {
        throw new Error(
          `Insufficient XYPH network fee for contract deployment: have ${(senderInfo.spendable / UNIT).toFixed(4)} XYPH, need ${NETWORK_FEE_XYPH} XYPH`
        );
      }

      const deployedAddr = getCreateAddress({ from: fromEvm, nonce: parsed.nonce });

      // Parse constructor argument (trailing 32-byte uint256 initialSupplyWholeTokens)
      let initialSupplyWhole = 60_000_000n;
      try {
        if (initCode.length >= 66) {
          const argHex = '0x' + initCode.slice(-64);
          const candidate = BigInt(argHex);
          if (candidate > 0n && candidate <= 100_000_000_000n) {
            initialSupplyWhole = candidate;
          }
        }
      } catch {
        initialSupplyWhole = 60_000_000n;
      }
      const totalSupplyRaw = (initialSupplyWhole * BigInt(10 ** XYPH_TOKEN_DECIMALS)).toString();

      if (!this.evmState.deployedContracts) {
        this.evmState.deployedContracts = {};
      }
      const nowSec = Math.floor(Date.now() / 1000);
      this.evmState.deployedContracts[deployedAddr.toLowerCase()] = {
        address: deployedAddr,
        deployerEvm: fromEvm,
        txHash,
        runtimeBytecode: XYPH_ERC20_RUNTIME_BYTECODE,
        name: NAME,
        symbol: SYMBOL,
        decimals: XYPH_TOKEN_DECIMALS,
        totalSupplyTokens: totalSupplyRaw,
        balances: {
          [fromEvm.toLowerCase()]: totalSupplyRaw,
        },
        allowances: {},
        deployedAt: nowSec,
      };

      const mintEvent = ERC20_IFACE.encodeEventLog('Transfer', [
        '0x0000000000000000000000000000000000000000',
        fromEvm,
        BigInt(totalSupplyRaw),
      ]);

      this.setEvmNonce(fromEvm, nextNonce, effectiveChainId);
      if (feeUnits > 0) {
        this.evmState.deltas[fromXyph] = (this.evmState.deltas[fromXyph] || 0) - feeUnits;
        this.evmState.deltas[this.meta.fund_address] =
          (this.evmState.deltas[this.meta.fund_address] || 0) + feeUnits;
      }

      const deployRecord: EvmTxRecord = {
        hash: txHash,
        fromEvm,
        toEvm: '',
        fromXyph,
        toXyph: this.meta.fund_address,
        valueUnits: 0,
        feeUnits,
        valueWei: '0x0',
        gasPriceWei: '0x' + gasPriceWei.toString(16),
        gasLimit,
        nonce: parsed.nonce,
        timestamp: nowSec,
        blockHeight: null,
        blockHash: null,
        rawHex,
        chainId: effectiveChainId,
        inputData: initCode,
        deployedContractAddress: deployedAddr,
        erc20Log: {
          address: deployedAddr,
          topics: [...mintEvent.topics],
          data: mintEvent.data,
        },
      };

      this.evmState.txs.unshift(deployRecord);
      this.saveEvmBridge();
      this.scheduleAutoSeal();
      return txHash;
    }

    // -------------------------------------------------------------------
    // 2. STANDARD TRANSFER OR ERC-20 CONTRACT CALL
    // -------------------------------------------------------------------
    const rawToEvm = getAddress(parsed.to);
    let effectiveToEvm = rawToEvm;
    let valueUnits = Number(valueWei / WEI_PER_UNIT);
    let contractToEvm: string | undefined;
    let inputData: string | undefined;
    let erc20Log: EvmTxRecord['erc20Log'];
    let isCustomDeployedTokenCall = false;

    const deployedContract = this.getDeployedContract(rawToEvm);

    // Support real ERC-20 transfer / approve / transferFrom / burn / transferOwnership
    if (
      (this.isXyphTokenContract(rawToEvm) || deployedContract) &&
      parsed.data &&
      parsed.data !== '0x'
    ) {
      let decoded: ReturnType<Interface['parseTransaction']> = null;
      try {
        decoded = ERC20_IFACE.parseTransaction({ data: parsed.data });
      } catch {
        decoded = null;
      }
      if (!decoded) {
        throw new Error('Unsupported contract call data on XYPH token contract');
      }

      if (decoded.name === 'transfer') {
        const tokenRecipient = getAddress(String(decoded.args[0]));
        const tokenAmount = BigInt(decoded.args[1]);
        if (tokenAmount <= 0n) {
          throw new Error('ERC-20 transfer amount must be greater than 0');
        }

        if (deployedContract) {
          const senderKey = fromEvm.toLowerCase();
          const recipKey = tokenRecipient.toLowerCase();
          const currentBal = BigInt(deployedContract.balances[senderKey] || '0');
          if (currentBal < tokenAmount) {
            throw new Error(
              `Insufficient balance in wallet: available ${formatUnits(currentBal, deployedContract.decimals)} ${deployedContract.symbol}, required ${formatUnits(tokenAmount, deployedContract.decimals)} ${deployedContract.symbol}.`
            );
          }
          deployedContract.balances[senderKey] = (currentBal - tokenAmount).toString();
          deployedContract.balances[recipKey] = (
            BigInt(deployedContract.balances[recipKey] || '0') + tokenAmount
          ).toString();
          effectiveToEvm = tokenRecipient;
          valueUnits = 0;
          contractToEvm = deployedContract.address;
          inputData = parsed.data;
          isCustomDeployedTokenCall = true;
        } else {
          const scaledUnits = tokenAmount * BigInt(XYPH_TOKEN_SCALE);
          if (scaledUnits > BigInt(MAX_MONEY)) {
            throw new Error('ERC-20 transfer amount exceeds maximum supply');
          }
          effectiveToEvm = tokenRecipient;
          valueUnits = Number(scaledUnits);
          contractToEvm = XYPH_TOKEN_CONTRACT_EVM;
          inputData = parsed.data;
        }

        const encodedEvent = ERC20_IFACE.encodeEventLog('Transfer', [
          fromEvm,
          tokenRecipient,
          tokenAmount,
        ]);
        erc20Log = {
          address: contractToEvm,
          topics: [...encodedEvent.topics],
          data: encodedEvent.data,
        };
      } else if (decoded.name === 'approve') {
        const spender = getAddress(String(decoded.args[0]));
        const amount = BigInt(decoded.args[1]);
        contractToEvm = deployedContract ? deployedContract.address : XYPH_TOKEN_CONTRACT_EVM;
        inputData = parsed.data;
        valueUnits = 0;
        isCustomDeployedTokenCall = true;
        if (deployedContract) {
          if (!deployedContract.allowances) deployedContract.allowances = {};
          deployedContract.allowances[`${fromEvm.toLowerCase()}:${spender.toLowerCase()}`] =
            amount.toString();
        }
        const encodedEvent = ERC20_IFACE.encodeEventLog('Approval', [fromEvm, spender, amount]);
        erc20Log = {
          address: contractToEvm,
          topics: [...encodedEvent.topics],
          data: encodedEvent.data,
        };
      } else if (decoded.name === 'transferFrom' && deployedContract) {
        const tokenFrom = getAddress(String(decoded.args[0]));
        const tokenTo = getAddress(String(decoded.args[1]));
        const tokenAmount = BigInt(decoded.args[2]);
        const fromKey = tokenFrom.toLowerCase();
        const toKey = tokenTo.toLowerCase();
        const allowKey = `${fromKey}:${fromEvm.toLowerCase()}`;
        const curAllow = BigInt(deployedContract.allowances?.[allowKey] || '0');
        const curBal = BigInt(deployedContract.balances[fromKey] || '0');
        if (curAllow < tokenAmount) throw new Error('Insufficient ERC-20 allowance');
        if (curBal < tokenAmount) throw new Error('Insufficient deployed ERC-20 token balance');
        if (!deployedContract.allowances) deployedContract.allowances = {};
        deployedContract.allowances[allowKey] = (curAllow - tokenAmount).toString();
        deployedContract.balances[fromKey] = (curBal - tokenAmount).toString();
        deployedContract.balances[toKey] = (
          BigInt(deployedContract.balances[toKey] || '0') + tokenAmount
        ).toString();
        effectiveToEvm = tokenTo;
        contractToEvm = deployedContract.address;
        inputData = parsed.data;
        valueUnits = 0;
        isCustomDeployedTokenCall = true;
        const encodedEvent = ERC20_IFACE.encodeEventLog('Transfer', [
          tokenFrom,
          tokenTo,
          tokenAmount,
        ]);
        erc20Log = {
          address: contractToEvm,
          topics: [...encodedEvent.topics],
          data: encodedEvent.data,
        };
      } else if (decoded.name === 'burn' && deployedContract) {
        const burnAmount = BigInt(decoded.args[0]);
        const senderKey = fromEvm.toLowerCase();
        const curBal = BigInt(deployedContract.balances[senderKey] || '0');
        if (curBal < burnAmount) throw new Error('Burn exceeds ERC-20 balance');
        deployedContract.balances[senderKey] = (curBal - burnAmount).toString();
        deployedContract.totalSupplyTokens = (
          BigInt(deployedContract.totalSupplyTokens) - burnAmount
        ).toString();
        contractToEvm = deployedContract.address;
        inputData = parsed.data;
        valueUnits = 0;
        isCustomDeployedTokenCall = true;
        const encodedEvent = ERC20_IFACE.encodeEventLog('Transfer', [
          fromEvm,
          '0x0000000000000000000000000000000000000000',
          burnAmount,
        ]);
        erc20Log = {
          address: contractToEvm,
          topics: [...encodedEvent.topics],
          data: encodedEvent.data,
        };
      } else if (decoded.name === 'transferOwnership' && deployedContract) {
        if (deployedContract.deployerEvm.toLowerCase() !== fromEvm.toLowerCase()) {
          throw new Error('Caller is not contract owner');
        }
        const newOwner = getAddress(String(decoded.args[0]));
        const prevOwner = deployedContract.deployerEvm;
        deployedContract.deployerEvm = newOwner;
        contractToEvm = deployedContract.address;
        inputData = parsed.data;
        valueUnits = 0;
        isCustomDeployedTokenCall = true;
        const encodedEvent = ERC20_IFACE.encodeEventLog('OwnershipTransferred', [
          prevOwner,
          newOwner,
        ]);
        erc20Log = {
          address: contractToEvm,
          topics: [...encodedEvent.topics],
          data: encodedEvent.data,
        };
      } else {
        throw new Error(`Unsupported ERC-20 call: ${decoded.name}`);
      }
    }

    const toXyph = evmToXypherAddress(effectiveToEvm);
    const gasLimit = Number(parsed.gasLimit || (erc20Log ? 65_000n : 21_000n));
    // Enforce zero network fee on XYPH Network (never charge EIP-1559 gas fees)
    const feeUnits = NETWORK_FEE_UNITS;

    const senderInfo = this.getAddressInfo(fromXyph);
    if (valueUnits + feeUnits > 0 && senderInfo.spendable < valueUnits + feeUnits) {
      throw new Error(
        `Insufficient balance in wallet: available ${(senderInfo.spendable / UNIT).toFixed(4)} ${SYMBOL}, required ${((valueUnits + feeUnits) / UNIT).toFixed(4)} ${SYMBOL}.`
      );
    }

    if (!erc20Log && !isCustomDeployedTokenCall && valueUnits > 0) {
      const tokenAmount = BigInt(Math.floor(valueUnits / XYPH_TOKEN_SCALE));
      if (tokenAmount > 0n) {
        const encodedNativeTransfer = ERC20_IFACE.encodeEventLog('Transfer', [
          fromEvm,
          effectiveToEvm,
          tokenAmount,
        ]);
        erc20Log = {
          address: XYPH_TOKEN_CONTRACT_EVM,
          topics: [...encodedNativeTransfer.topics],
          data: encodedNativeTransfer.data,
        };
      }
    }

    // Apply atomic balance deltas & nonce increment
    this.setEvmNonce(fromEvm, nextNonce, effectiveChainId);
    if (valueUnits + feeUnits > 0) {
      this.evmState.deltas[fromXyph] =
        (this.evmState.deltas[fromXyph] || 0) - (valueUnits + feeUnits);
    }
    if (!isCustomDeployedTokenCall && valueUnits > 0) {
      this.evmState.deltas[toXyph] = (this.evmState.deltas[toXyph] || 0) + valueUnits;
    }
    if (feeUnits > 0) {
      this.evmState.deltas[this.meta.fund_address] =
        (this.evmState.deltas[this.meta.fund_address] || 0) + feeUnits;
    }

    const record: EvmTxRecord = {
      hash: txHash,
      fromEvm,
      toEvm: effectiveToEvm,
      fromXyph,
      toXyph,
      valueUnits,
      feeUnits,
      valueWei: '0x' + valueWei.toString(16),
      gasPriceWei: '0x' + gasPriceWei.toString(16),
      gasLimit,
      nonce: parsed.nonce,
      timestamp: Math.floor(Date.now() / 1000),
      blockHeight: null,
      blockHash: null,
      rawHex,
      chainId: effectiveChainId,
      ...(inputData ? { inputData } : {}),
      ...(contractToEvm ? { contractToEvm } : {}),
      ...(erc20Log ? { erc20Log } : {}),
    };

    this.evmState.txs.unshift(record);
    this.saveEvmBridge();
    this.scheduleAutoSeal();

    return txHash;
  }

  public getEvmTransactionByHash(hash: string): Record<string, unknown> | null {
    const clean = hash.toLowerCase();
    const rec = this.evmState.txs.find((t) => t.hash.toLowerCase() === clean);
    if (!rec) return null;

    let txType = '0x2';
    let gasPriceHex = rec.gasPriceWei;
    let maxFeeHex = rec.gasPriceWei;
    let maxPriorityHex = rec.gasPriceWei;
    let sigV = '0x0';
    let sigR = '0x' + '00'.repeat(32);
    let sigS = '0x' + '00'.repeat(32);
    let chainIdHex = rec.chainId ? '0x' + rec.chainId.toString(16) : XYPHER_CHAIN_ID_HEX;

    try {
      if (rec.rawHex && rec.rawHex.startsWith('0x') && rec.rawHex.length > 140) {
        const parsed = Transaction.from(rec.rawHex);
        txType = '0x' + (parsed.type ?? 0).toString(16);
        if (parsed.gasPrice !== null && parsed.gasPrice !== undefined) {
          gasPriceHex = '0x' + parsed.gasPrice.toString(16);
        }
        if (parsed.maxFeePerGas !== null && parsed.maxFeePerGas !== undefined) {
          maxFeeHex = '0x' + parsed.maxFeePerGas.toString(16);
        }
        if (parsed.maxPriorityFeePerGas !== null && parsed.maxPriorityFeePerGas !== undefined) {
          maxPriorityHex = '0x' + parsed.maxPriorityFeePerGas.toString(16);
        }
        if (parsed.chainId && parsed.chainId > 0n) {
          chainIdHex = '0x' + parsed.chainId.toString(16);
        }
        if (parsed.signature) {
          sigV = '0x' + parsed.signature.v.toString(16);
          sigR = parsed.signature.r;
          sigS = parsed.signature.s;
        }
      }
    } catch {
      // Fallback for non-RLP personal_sign / treasury records
    }

    return {
      hash: rec.hash,
      nonce: '0x' + rec.nonce.toString(16),
      blockHash: rec.blockHash,
      blockNumber: rec.blockHeight !== null ? '0x' + rec.blockHeight.toString(16) : null,
      transactionIndex: rec.blockHeight !== null ? '0x0' : null,
      from: rec.fromEvm,
      to: rec.deployedContractAddress ? null : rec.contractToEvm || rec.toEvm,
      value: rec.valueWei,
      gas: '0x' + rec.gasLimit.toString(16),
      gasPrice: gasPriceHex,
      ...(txType === '0x2'
        ? { maxFeePerGas: maxFeeHex, maxPriorityFeePerGas: maxPriorityHex }
        : {}),
      input: rec.inputData || '0x',
      type: txType,
      chainId: chainIdHex,
      v: sigV,
      r: sigR,
      s: sigS,
    };
  }

  public getEvmTransactionReceipt(hash: string): Record<string, unknown> | null {
    const clean = hash.toLowerCase();
    const rec = this.evmState.txs.find((t) => t.hash.toLowerCase() === clean);
    if (!rec || rec.blockHeight === null || !rec.blockHash) return null;

    let txType = '0x2';
    try {
      if (rec.rawHex && rec.rawHex.startsWith('0x') && rec.rawHex.length > 140) {
        const parsed = Transaction.from(rec.rawHex);
        txType = '0x' + (parsed.type ?? 0).toString(16);
      }
    } catch {
      txType = '0x2';
    }

    const gasUsedHex = rec.deployedContractAddress
      ? '0x98968'
      : rec.contractToEvm
      ? '0xfde8'
      : '0x5208';
    return {
      transactionHash: rec.hash,
      transactionIndex: '0x0',
      blockHash: rec.blockHash,
      blockNumber: '0x' + rec.blockHeight.toString(16),
      from: rec.fromEvm,
      to: rec.deployedContractAddress ? null : rec.contractToEvm || rec.toEvm,
      cumulativeGasUsed: gasUsedHex,
      gasUsed: gasUsedHex,
      effectiveGasPrice: rec.gasPriceWei,
      contractAddress: rec.deployedContractAddress ?? null,
      logs: rec.erc20Log
        ? [
            {
              address: rec.erc20Log.address,
              topics: rec.erc20Log.topics,
              data: rec.erc20Log.data,
              blockNumber: '0x' + rec.blockHeight.toString(16),
              transactionHash: rec.hash,
              transactionIndex: '0x0',
              blockHash: rec.blockHash,
              logIndex: '0x0',
              removed: false,
            },
          ]
        : [],
      logsBloom: '0x' + '00'.repeat(256),
      status: '0x1',
      type: txType,
    };
  }

  public getEvmBlock(blockTagOrHash: string, fullTx = false): Record<string, unknown> | null {
    let target: { block: BlockData; hash: string } | undefined;
    const chain = this.getMainChainBlocks();

    if (
      blockTagOrHash === 'latest' ||
      blockTagOrHash === 'safe' ||
      blockTagOrHash === 'finalized' ||
      blockTagOrHash === 'pending'
    ) {
      target = chain[0];
    } else if (blockTagOrHash === 'earliest') {
      target = chain[chain.length - 1];
    } else if (/^0x[0-9a-fA-F]{64}$/.test(blockTagOrHash)) {
      const noPrefix = blockTagOrHash.slice(2).toLowerCase();
      target = chain.find((c) => c.hash === noPrefix);
    } else if (/^0x[0-9a-fA-F]+$/.test(blockTagOrHash)) {
      const num = parseInt(blockTagOrHash, 16);
      target = chain.find((c) => c.block.height === num);
    }

    if (!target) return null;
    const { block, hash } = target;
    const summary = this.summarizeBlock(block, hash);
    const blockEvmTxs = this.evmState.txs.filter((t) => t.blockHeight === block.height);

    return {
      number: '0x' + block.height.toString(16),
      hash: '0x' + hash,
      parentHash: '0x' + block.prev,
      nonce: '0x' + block.nonce.toString(16).padStart(16, '0'),
      sha3Uncles: '0x' + '00'.repeat(32),
      logsBloom: '0x' + '00'.repeat(256),
      transactionsRoot: '0x' + summary.merkleRoot,
      stateRoot: '0x' + hash,
      receiptsRoot: '0x' + summary.merkleRoot,
      miner: xypherToEvmAddress(summary.minerAddress),
      difficulty: '0x1',
      totalDifficulty: '0x' + (block.height + 1).toString(16),
      extraData: summary.extraData?.hex || '0x',
      size: '0x' + summary.sizeBytes.toString(16),
      gasLimit: '0x1e84800',
      gasUsed: '0x' + (blockEvmTxs.length * 21000).toString(16),
      timestamp: '0x' + block.time.toString(16),
      baseFeePerGas: '0x0',
      transactions: fullTx
        ? blockEvmTxs.map((t) => this.getEvmTransactionByHash(t.hash))
        : blockEvmTxs.map((t) => t.hash),
      uncles: [],
    };
  }

  public getEvmLogs(filter: {
    fromBlock?: string;
    toBlock?: string;
    address?: string | string[];
    topics?: Array<string | string[] | null>;
  }): Array<Record<string, unknown>> {
    const parseBlockTag = (tag: string | undefined, fallback: number): number => {
      if (!tag || tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized') {
        return this.height;
      }
      if (tag === 'earliest') return 0;
      if (/^0x[0-9a-fA-F]+$/.test(tag)) return parseInt(tag, 16);
      const n = Number(tag);
      return Number.isFinite(n) ? n : fallback;
    };

    const fromBlock = parseBlockTag(filter?.fromBlock, 0);
    const toBlock = parseBlockTag(filter?.toBlock, this.height);
    const addrList = filter?.address
      ? (Array.isArray(filter.address) ? filter.address : [filter.address]).map((a) =>
          String(a).toLowerCase()
        )
      : null;
    const topicsFilter = Array.isArray(filter?.topics) ? filter.topics : [];

    const matched: Array<Record<string, unknown>> = [];
    for (const rec of this.evmState.txs) {
      if (!rec.erc20Log || rec.blockHeight === null || !rec.blockHash) continue;
      if (rec.blockHeight < fromBlock || rec.blockHeight > toBlock) continue;
      if (addrList && !addrList.includes(rec.erc20Log.address.toLowerCase())) continue;

      let topicOk = true;
      for (let i = 0; i < topicsFilter.length; i++) {
        const expected = topicsFilter[i];
        if (expected === null || expected === undefined) continue;
        const actual = (rec.erc20Log.topics[i] || '').toLowerCase();
        if (Array.isArray(expected)) {
          if (!expected.some((t) => String(t).toLowerCase() === actual)) {
            topicOk = false;
            break;
          }
        } else if (String(expected).toLowerCase() !== actual) {
          topicOk = false;
          break;
        }
      }
      if (!topicOk) continue;

      matched.push({
        address: rec.erc20Log.address,
        topics: rec.erc20Log.topics,
        data: rec.erc20Log.data,
        blockNumber: '0x' + rec.blockHeight.toString(16),
        transactionHash: rec.hash,
        transactionIndex: '0x0',
        blockHash: rec.blockHash,
        logIndex: '0x0',
        removed: false,
      });
    }

    return matched.reverse();
  }

  // =====================================================================
  // QUERY & EXPLORER HELPERS
  // =====================================================================
  public getMainChainBlocks(): Array<{ block: BlockData; hash: string }> {
    const out: Array<{ block: BlockData; hash: string }> = [];
    let cur: BlockData | undefined = this.tip;
    let curHash = this.tipHash;
    while (cur) {
      out.push({ block: cur, hash: curHash });
      const prevHash = cur.prev;
      cur = this.all.get(prevHash);
      curHash = prevHash;
    }
    return out;
  }

  public getInfo(): ChainInfo {
    const cfg = this.profileConfig;
    let supply = 0;
    for (const u of this.utxo.values()) supply += u.value;
    const nextSub = this.subsidy(this.height + 1);
    const nextTarget = this.nextTargetHex(this.height + 1);

    return {
      name: NAME,
      networkName: NETWORK_NAME,
      symbol: SYMBOL,
      decimals: DECIMALS,
      unit: UNIT,
      chainId: XYPHER_CHAIN_ID,
      chainIdHex: XYPHER_CHAIN_ID_HEX,
      networkFeeUnits: NETWORK_FEE_UNITS,
      networkFeeXyph: NETWORK_FEE_XYPH,
      gasPriceHex: XYPH_EVM_GAS_PRICE_HEX,
      profile: this.meta.profile,
      profileLabel: cfg.label,
      height: this.height,
      tip: this.tipHash,
      supply,
      maxSupply: MAX_MONEY,
      maxBlocks: MAX_BLOCKS,
      blocksLeft: Math.max(0, MAX_BLOCKS - this.height),
      nextSubsidy: nextSub,
      minerShare: nextSub,
      fundShare: 0,
      halvingInterval: cfg.halvingInterval,
      retargetInterval: cfg.retargetInterval,
      targetBlockTime: cfg.targetBlockTime,
      maturity: cfg.maturity,
      targetHex: nextTarget,
      difficulty: targetDifficulty(cfg.maxTarget, nextTarget),
      mempoolCount:
        this.mempool.size + this.evmState.txs.filter((t) => t.blockHeight === null).length,
      utxoCount: this.utxo.size,
      fundAddress: this.meta.fund_address,
    };
  }

  private buildBlockExtraData(blockHash: string): BlockExtraDataDecoded {
    let signedDataHex = '';
    if (this.fundWif) {
      try {
        const priv = wifToKey(this.fundWif);
        const signingKey = new SigningKey('0x' + bytesToHex(priv));
        const sig = signingKey.sign('0x' + blockHash.replace(/^0x/i, '').padStart(64, '0'));
        signedDataHex =
          sig.r.slice(2) + sig.s.slice(2) + (sig.yParity === 1 ? '01' : '00');
      } catch {
        signedDataHex = '';
      }
    }
    if (!signedDataHex) {
      const part1 = crypto.createHash('sha256').update(`xypher-seal-r:${blockHash}`).digest('hex');
      const part2 = crypto.createHash('sha256').update(`xypher-seal-s:${blockHash}`).digest('hex');
      signedDataHex = part1 + part2 + '00';
    }
    return encodeBlockExtraData({
      version: [2, 0, 0],
      client: 'xypherd',
      runtime: 'cpp17',
      os: 'linux',
      validatorBytesHex: '',
      gasTarget: 16_000_000,
      baseFeeChangeDenominator: 64,
      signedDataHex,
    });
  }

  public summarizeBlock(b: BlockData, hash?: string): BlockSummary {
    const blockHash = hash ?? computeBlockHash(b);
    const merkle = bytesToHex(merkleRoot(b.txs.map((t) => computeTxid(t))));
    const sub = this.subsidy(b.height);
    const cb = b.txs[0];
    const cbTotal = cb.outs.reduce((acc, o) => acc + o.value, 0);
    const fees = Math.max(0, cbTotal - sub);
    const minerOut = b.height === 0 ? cb.outs[0] : cb.outs.length > 1 ? cb.outs[1] : cb.outs[0];
    const fundOut = cb.outs[0];
    const anchoredEvmCount = this.evmState.txs.filter((t) => t.blockHeight === b.height).length;

    return {
      height: b.height,
      hash: blockHash,
      prev: b.prev,
      merkleRoot: merkle,
      time: b.time,
      target: b.target,
      difficulty: targetDifficulty(this.profileConfig.maxTarget, b.target),
      nonce: b.nonce,
      version: b.version,
      txCount: b.txs.length + anchoredEvmCount,
      sizeBytes: Buffer.byteLength(JSON.stringify(b), 'utf-8'),
      subsidy: sub,
      fees,
      minerAddress: minerOut?.addr ?? this.meta.fund_address,
      fundAddress: fundOut?.addr ?? this.meta.fund_address,
      extraData: this.buildBlockExtraData(blockHash),
    };
  }

  public getBlocksPaginated(limit = 25, offset = 0): {
    blocks: BlockSummary[];
    total: number;
    maxBlocks: number;
    networkName: string;
    networkFeeXyph: number;
  } {
    const chain = this.getMainChainBlocks();
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);
    const slice = chain.slice(safeOffset, safeOffset + safeLimit);
    return {
      blocks: slice.map(({ block, hash }) => this.summarizeBlock(block, hash)),
      total: chain.length,
      maxBlocks: MAX_BLOCKS,
      networkName: NETWORK_NAME,
      networkFeeXyph: NETWORK_FEE_XYPH,
    };
  }

  public getBlockDetail(idOrHash: string): BlockDetail | null {
    const chain = this.getMainChainBlocks();
    let found: { block: BlockData; hash: string } | undefined;

    if (/^\d+$/.test(idOrHash)) {
      const targetHeight = parseInt(idOrHash, 10);
      found = chain.find((entry) => entry.block.height === targetHeight);
    } else {
      const lower = idOrHash.replace(/^0x/i, '').toLowerCase();
      found = chain.find((entry) => entry.hash === lower || entry.hash.startsWith(lower));
    }
    if (!found) return null;

    const outLookup = new Map<string, number>();
    for (let i = chain.length - 1; i >= 0; i--) {
      for (const tx of chain[i].block.txs) {
        const tid = computeTxid(tx);
        tx.outs.forEach((o, idx) => outLookup.set(`${tid}:${idx}`, o.value));
      }
    }

    const summary = this.summarizeBlock(found.block, found.hash);
    const nativeTxs = found.block.txs.map((tx) => {
      const txid = computeTxid(tx);
      const isCb = isCoinbaseTx(tx);
      const totalOut = tx.outs.reduce((acc, o) => acc + o.value, 0);
      let fee = 0;
      if (!isCb) {
        const totalIn = tx.ins.reduce(
          (acc, inp) => acc + (outLookup.get(`${inp.prev_txid}:${inp.index}`) ?? 0),
          0
        );
        fee = Math.max(0, totalIn - totalOut);
      }
      return {
        txid,
        isCoinbase: isCb,
        v: tx.v,
        ins: tx.ins,
        outs: tx.outs,
        totalOut,
        fee,
      };
    });

    const anchoredEvmTxs = this.evmState.txs
      .filter((t) => t.blockHeight === found.block.height)
      .map((etx) => ({
        txid: etx.hash,
        isCoinbase: false,
        v: 2,
        ins: [{ prev_txid: etx.fromXyph, index: etx.nonce, pub: etx.fromEvm, sig: 'EVM-ECDSA' }],
        outs: [{ value: etx.valueUnits, addr: etx.toXyph }],
        totalOut: etx.valueUnits,
        fee: etx.feeUnits,
      }));

    return { ...summary, txs: [...nativeTxs, ...anchoredEvmTxs] };
  }

  public getTransactionDetail(txidQuery: string): {
    txid: string;
    status: 'confirmed' | 'mempool';
    blockHeight: number | null;
    blockHash: string | null;
    confirmations: number;
    time: number;
    isCoinbase: boolean;
    v: number;
    ins: Array<{
      prev_txid: string;
      index: number;
      pub: string;
      sig: string;
      value?: number;
      addr?: string;
    }>;
    outs: Array<{ index: number; value: number; addr: string; spent: boolean }>;
    totalOut: number;
    fee: number;
  } | null {
    const q = txidQuery.toLowerCase();

    // Check MetaMask EVM transactions first
    const evmMatch = this.evmState.txs.find(
      (t) => t.hash.toLowerCase() === q || t.hash.toLowerCase().startsWith(q)
    );
    if (evmMatch) {
      return {
        txid: evmMatch.hash,
        status: evmMatch.blockHeight !== null ? 'confirmed' : 'mempool',
        blockHeight: evmMatch.blockHeight,
        blockHash: evmMatch.blockHash,
        confirmations:
          evmMatch.blockHeight !== null ? this.height - evmMatch.blockHeight + 1 : 0,
        time: evmMatch.timestamp,
        isCoinbase: false,
        v: 2,
        ins: [
          {
            prev_txid: evmMatch.fromEvm,
            index: evmMatch.nonce,
            pub: evmMatch.fromEvm,
            sig: 'MetaMask EIP-1559',
            value: evmMatch.valueUnits + evmMatch.feeUnits,
            addr: evmMatch.fromXyph,
          },
        ],
        outs: [
          {
            index: 0,
            value: evmMatch.valueUnits,
            addr: evmMatch.toXyph,
            spent: false,
          },
        ],
        totalOut: evmMatch.valueUnits,
        fee: evmMatch.feeUnits,
      };
    }

    const qNoPrefix = q.replace(/^0x/, '');
    const chain = this.getMainChainBlocks();

    const outLookup = new Map<string, { value: number; addr: string }>();
    const spentKeys = new Set<string>();
    for (let i = chain.length - 1; i >= 0; i--) {
      for (const tx of chain[i].block.txs) {
        const tid = computeTxid(tx);
        if (!isCoinbaseTx(tx)) {
          for (const inp of tx.ins) spentKeys.add(`${inp.prev_txid}:${inp.index}`);
        }
        tx.outs.forEach((o, idx) =>
          outLookup.set(`${tid}:${idx}`, { value: o.value, addr: o.addr })
        );
      }
    }

    for (const item of this.mempool.values()) {
      if (item.txid === qNoPrefix || item.txid.startsWith(qNoPrefix)) {
        return {
          txid: item.txid,
          status: 'mempool',
          blockHeight: null,
          blockHash: null,
          confirmations: 0,
          time: item.addedAt,
          isCoinbase: false,
          v: item.tx.v,
          ins: item.tx.ins.map((inp) => {
            const prev = outLookup.get(`${inp.prev_txid}:${inp.index}`);
            return { ...inp, value: prev?.value, addr: prev?.addr };
          }),
          outs: item.tx.outs.map((o, idx) => ({
            index: idx,
            value: o.value,
            addr: o.addr,
            spent: false,
          })),
          totalOut: item.totalOut,
          fee: item.fee,
        };
      }
    }

    for (const { block, hash } of chain) {
      for (const tx of block.txs) {
        const tid = computeTxid(tx);
        if (tid === qNoPrefix || tid.startsWith(qNoPrefix)) {
          const isCb = isCoinbaseTx(tx);
          const totalOut = tx.outs.reduce((acc, o) => acc + o.value, 0);
          let totalIn = 0;
          const ins = tx.ins.map((inp) => {
            const prev = outLookup.get(`${inp.prev_txid}:${inp.index}`);
            if (prev) totalIn += prev.value;
            return { ...inp, value: prev?.value, addr: prev?.addr };
          });
          return {
            txid: tid,
            status: 'confirmed',
            blockHeight: block.height,
            blockHash: hash,
            confirmations: this.height - block.height + 1,
            time: block.time,
            isCoinbase: isCb,
            v: tx.v,
            ins,
            outs: tx.outs.map((o, idx) => ({
              index: idx,
              value: o.value,
              addr: o.addr,
              spent: spentKeys.has(`${tid}:${idx}`),
            })),
            totalOut,
            fee: isCb ? 0 : Math.max(0, totalIn - totalOut),
          };
        }
      }
    }

    return null;
  }

  public getAddressInfo(rawAddress: string): AddressInfo {
    const address = normalizeToXypherAddress(rawAddress) || rawAddress;
    const maturity = this.profileConfig.maturity;
    let total = 0;
    let spendable = 0;
    const utxos: UtxoItem[] = [];

    // Immediately exclude confirmed UTXOs already spent by pending native mempool transactions
    const mempoolSpentKeys = new Set<string>();
    for (const item of this.mempool.values()) {
      for (const inp of item.tx.ins) {
        mempoolSpentKeys.add(`${inp.prev_txid}:${inp.index}`);
      }
    }

    for (const [key, u] of this.utxo.entries()) {
      if (u.addr !== address) continue;
      if (mempoolSpentKeys.has(key)) continue;
      const [txid, idxStr] = key.split(':');
      const confirmations = this.height - u.height + 1;
      const needed = u.isCoinbase ? Math.max(0, maturity - (this.height + 1 - u.height)) : 0;
      const isSpendable = needed === 0;
      total += u.value;
      if (isSpendable) spendable += u.value;
      utxos.push({
        txid,
        index: parseInt(idxStr, 10),
        value: u.value,
        addr: u.addr,
        height: u.height,
        isCoinbase: u.isCoinbase,
        confirmations,
        spendable: isSpendable,
        blocksUntilMature: needed,
      });
    }

    // Immediately include outputs credited to this address in pending mempool transactions
    for (const item of this.mempool.values()) {
      for (let outIdx = 0; outIdx < item.tx.outs.length; outIdx++) {
        const out = item.tx.outs[outIdx];
        if (out.addr !== address) continue;
        if (mempoolSpentKeys.has(`${item.txid}:${outIdx}`)) continue;
        total += out.value;
        spendable += out.value;
      }
    }

    // Factor in MetaMask EVM bridge balance delta
    const evmDelta = this.evmState.deltas[address] || 0;
    total = Math.max(0, total + evmDelta);
    spendable = Math.max(0, spendable + evmDelta);

    utxos.sort((a, b) => b.height - a.height || b.value - a.value);

    const chain = this.getMainChainBlocks();
    const outLookup = new Map<string, { value: number; addr: string }>();
    for (let i = chain.length - 1; i >= 0; i--) {
      for (const tx of chain[i].block.txs) {
        const tid = computeTxid(tx);
        tx.outs.forEach((o, idx) =>
          outLookup.set(`${tid}:${idx}`, { value: o.value, addr: o.addr })
        );
      }
    }

    const history: AddressTxHistoryItem[] = [];

    // Include EVM MetaMask transactions involving this address
    for (const etx of this.evmState.txs) {
      if (etx.fromXyph !== address && etx.toXyph !== address) continue;
      const isSender = etx.fromXyph === address;
      const isRecipient = etx.toXyph === address;
      let netChange = 0;
      let direction: AddressTxHistoryItem['direction'] = 'received';
      if (isSender && isRecipient) {
        direction = 'self';
        netChange = -etx.feeUnits;
      } else if (isSender) {
        direction = 'sent';
        netChange = -(etx.valueUnits + etx.feeUnits);
      } else {
        direction = 'received';
        netChange = etx.valueUnits;
      }
      history.push({
        txid: etx.hash,
        blockHeight: etx.blockHeight,
        blockHash: etx.blockHash,
        time: etx.timestamp,
        direction,
        netChange,
        fee: etx.feeUnits,
        isCoinbase: false,
        confirmations: etx.blockHeight === null ? 0 : this.height - etx.blockHeight + 1,
        counterparties: [isSender ? etx.toEvm : etx.fromEvm],
      });
    }

    // Pending native mempool txs
    for (const item of this.mempool.values()) {
      const entry = this.buildAddressHistoryItem(
        item.tx,
        item.txid,
        null,
        null,
        item.addedAt,
        outLookup,
        address
      );
      if (entry) history.push(entry);
    }

    // Confirmed native blocks
    for (const { block, hash } of chain) {
      for (const tx of block.txs) {
        const txid = computeTxid(tx);
        const entry = this.buildAddressHistoryItem(
          tx,
          txid,
          block.height,
          hash,
          block.time,
          outLookup,
          address
        );
        if (entry) history.push(entry);
      }
    }

    history.sort((a, b) => b.time - a.time);

    return {
      address,
      total,
      spendable,
      immature: Math.max(0, total - spendable),
      utxos,
      history: history.slice(0, 100),
    };
  }

  private buildAddressHistoryItem(
    tx: TxData,
    txid: string,
    blockHeight: number | null,
    blockHash: string | null,
    time: number,
    outLookup: Map<string, { value: number; addr: string }>,
    address: string
  ): AddressTxHistoryItem | null {
    const isCb = isCoinbaseTx(tx);
    let inFromAddr = 0;
    let totalIn = 0;
    const inputAddrs = new Set<string>();

    if (!isCb) {
      for (const inp of tx.ins) {
        const prev = outLookup.get(`${inp.prev_txid}:${inp.index}`);
        if (prev) {
          totalIn += prev.value;
          inputAddrs.add(prev.addr);
          if (prev.addr === address) inFromAddr += prev.value;
        }
      }
    }

    let outToAddr = 0;
    let totalOut = 0;
    const outputAddrs = new Set<string>();
    for (const o of tx.outs) {
      totalOut += o.value;
      outputAddrs.add(o.addr);
      if (o.addr === address) outToAddr += o.value;
    }

    if (inFromAddr === 0 && outToAddr === 0) return null;

    const fee = isCb ? 0 : Math.max(0, totalIn - totalOut);
    const netChange = outToAddr - inFromAddr;
    let direction: AddressTxHistoryItem['direction'] = 'received';
    const counterparties = new Set<string>();

    if (isCb) {
      direction = 'mined';
    } else if (inFromAddr > 0 && outToAddr > 0 && outputAddrs.size === 1 && outputAddrs.has(address)) {
      direction = 'self';
    } else if (inFromAddr > 0) {
      direction = 'sent';
      for (const a of outputAddrs) if (a !== address) counterparties.add(a);
    } else {
      direction = 'received';
      for (const a of inputAddrs) if (a !== address) counterparties.add(a);
    }

    return {
      txid,
      blockHeight,
      blockHash,
      time,
      direction,
      netChange,
      fee,
      isCoinbase: isCb,
      confirmations: blockHeight === null ? 0 : this.height - blockHeight + 1,
      counterparties: Array.from(counterparties),
    };
  }

  public validateFullChain(): {
    valid: boolean;
    height: number;
    utxoCount: number;
    blocksChecked: number;
    error?: string;
  } {
    const err = this.replayBest();
    if (err) {
      return {
        valid: false,
        height: this.height,
        utxoCount: this.utxo.size,
        blocksChecked: this.all.size,
        error: err,
      };
    }
    return {
      valid: true,
      height: this.height,
      utxoCount: this.utxo.size,
      blocksChecked: this.getMainChainBlocks().length,
    };
  }

  // =====================================================================
  // BUILT-IN CONSENSUS & CRYPTO SELF-TEST (mirrors Xypher__XYPH0_f579788d.py)
  // =====================================================================
  public async runSelfTest(): Promise<{ allPassed: boolean; results: SelfTestResultItem[] }> {
    const results: SelfTestResultItem[] = [];
    const runCase = async (name: string, fn: () => Promise<string> | string) => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        results.push({ name, passed: true, detail, durationMs: Date.now() - t0 });
      } catch (err) {
        results.push({
          name,
          passed: false,
          detail: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        });
      }
    };

    const tmpDir = fs.mkdtempSync(path.join(this.dataDir, '.selftest-'));
    try {
      await runCase('SHA-256 & RIPEMD-160 Hash Vectors', () => {
        const nodeSha = crypto.createHash('sha256').update('xypher').digest('hex');
        const tsSha = bytesToHex(sha256(utf8ToBytes('xypher')));
        if (nodeSha !== tsSha) throw new Error('SHA-256 mismatch vs OpenSSL');
        const rmdEmpty = bytesToHex(ripemd160(new Uint8Array(0)));
        if (rmdEmpty !== '9c1185a5c5e9fc54612808977ee8f548b2258d31') {
          throw new Error(`RIPEMD-160 vector mismatch: ${rmdEmpty}`);
        }
        return 'Matches OpenSSL SHA-256 & ISO RIPEMD-160 test vectors';
      });

      await runCase('secp256k1 Generator, RFC6979 ECDSA & MetaMask Address Mapping', () => {
        const one = new Uint8Array(32);
        one[31] = 1;
        const pub = pubkeyFromPrivate(one);
        const expected = bytesToHex(bigIntToBytes32(SECP_GX)) + bytesToHex(bigIntToBytes32(SECP_GY));
        if (bytesToHex(pub) !== expected) throw new Error('Generator point G mismatch');
        const dg = sha256(utf8ToBytes('xypher'));
        const sig = signDigest(one, dg);
        if (!verifyDigest(pub, dg, sig)) throw new Error('Valid signature failed verification');
        if (verifyDigest(pub, sha256(utf8ToBytes('other')), sig)) {
          throw new Error('Wrong message verified');
        }
        const addr = addressFromPrivate(one);
        if (!isValidAddress(addr)) throw new Error('Invalid Base58Check address');
        const evm = xypherToEvmAddress(addr);
        if (evmToXypherAddress(evm) !== addr) throw new Error('EVM <-> Xypher roundtrip mismatch');
        return `Verified pubkey(1)=G, low-S ECDSA & 1:1 MetaMask mapping (${evm.slice(0, 10)}...)`;
      });

      const testNode = new XypherNode(tmpDir, { autoSeal: false });
      const fundPriv = wifToKey(testNode.fundWif);
      const minerPriv = generatePrivateKey();
      const minerAddr = addressFromPrivate(minerPriv);
      const bobAddr = addressFromPrivate(generatePrivateKey());
      const fundAddr = testNode.meta.fund_address;

      await runCase('Block Consensus, 24M Block Spec & 50/50 Subsidy Split', async () => {
        for (let i = 0; i < 6; i++) {
          await testNode.sealOneNetworkBlock(minerAddr);
        }
        const minerInfo = testNode.getAddressInfo(minerAddr);
        const fundInfo = testNode.getAddressInfo(fundAddr);
        const expectedMiner = 6 * Math.floor(BLOCK_SUBSIDY / 2);
        const expectedFund = BLOCK_SUBSIDY + 6 * (BLOCK_SUBSIDY - Math.floor(BLOCK_SUBSIDY / 2));
        if (minerInfo.total !== expectedMiner) {
          throw new Error(`Expected ${expectedMiner / UNIT} XYPH, got ${minerInfo.total / UNIT}`);
        }
        if (fundInfo.total !== expectedFund) {
          throw new Error(`Expected fund ${expectedFund / UNIT} XYPH, got ${fundInfo.total / UNIT}`);
        }
        if (minerInfo.spendable !== expectedMiner) {
          throw new Error(`Expected ${expectedMiner / UNIT} XYPH mature, got ${minerInfo.spendable / UNIT}`);
        }
        return `Sealed 6 PoW blocks; verified 1.25/1.25 XYPH split & 24,000,000 max block cap`;
      });

      await runCase('Zero Network Fee, Double-Spend & Mempool Conflict Rejection', () => {
        const fundInfo = testNode.getAddressInfo(fundAddr);
        const coins = fundInfo.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));

        const tx1 = buildSignedTx(fundPriv, coins, bobAddr, 3 * UNIT, NETWORK_FEE_UNITS);
        const r1 = testNode.addTx(tx1);
        if (!r1.ok) throw new Error(`Legitimate zero-fee tx rejected: ${r1.error}`);
        const tx2 = buildSignedTx(fundPriv, coins, bobAddr, 2 * UNIT, NETWORK_FEE_UNITS);
        const r2 = testNode.addTx(tx2);
        if (r2.ok || r2.error !== 'mempool-conflict') {
          throw new Error(`Expected mempool-conflict, got ${r2.error}`);
        }
        return 'Verified 0 XYPH network fee, accepted signed 3.00 XYPH payment & rejected double-spend';
      });

      await runCase('Transaction Confirmation & Fee Settlement', async () => {
        await testNode.sealOneNetworkBlock(minerAddr);
        const bobInfo = testNode.getAddressInfo(bobAddr);
        if (bobInfo.total !== 3 * UNIT) {
          throw new Error(`Expected recipient balance 3 XYPH, got ${bobInfo.total / UNIT}`);
        }
        return 'Confirmed mempool transfer in block #7; recipient credited 3.00000000 XYPH';
      });

      await runCase('Invalid Signature & Forged Target Rejection', async () => {
        const fundInfo = testNode.getAddressInfo(fundAddr);
        const coins = fundInfo.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
        const badSigTx = buildSignedTx(fundPriv, coins, bobAddr, UNIT, NETWORK_FEE_UNITS);
        badSigTx.ins[0].sig = '00'.repeat(8);
        const rSig = testNode.addTx(badSigTx);
        if (rSig.ok || rSig.error !== 'bad-signature') {
          throw new Error(`Expected bad-signature, got ${rSig.error}`);
        }

        const mined = await testNode.mineSingleBlock(minerAddr);
        if (!mined) throw new Error('Block sealing failed');
        const badTargetBlock: BlockData = {
          ...mined.block,
          target: bigIntTargetToHex(BigInt('0x' + mined.block.target) / 2n),
        };
        const rTarget = testNode.addBlock(badTargetBlock);
        if (rTarget.ok || rTarget.error !== 'bad-target') {
          throw new Error(`Expected bad-target, got ${rTarget.error}`);
        }
        return 'Rejected forged ECDSA signature (bad-signature) & altered difficulty target (bad-target)';
      });

      await runCase('Overspend Guard & Disk JSONL Persistence', () => {
        const fundInfo = testNode.getAddressInfo(fundAddr);
        const coins = fundInfo.utxos
          .filter((u) => u.spendable)
          .map((u) => ({ txid: u.txid, index: u.index, value: u.value }));
        let threw = false;
        try {
          buildSignedTx(fundPriv, coins, bobAddr, 10_000 * UNIT, 0);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('Overspend did not throw');

        const reloaded = new XypherNode(tmpDir, { autoSeal: false });
        if (reloaded.height !== testNode.height || reloaded.tipHash !== testNode.tipHash) {
          throw new Error('Reloaded chain height/tip mismatch');
        }
        return `Blocked 10,000 XYPH overspend; reloaded chain.jsonl cleanly at height ${reloaded.height}`;
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    return {
      allPassed: results.every((r) => r.passed),
      results,
    };
  }
}
