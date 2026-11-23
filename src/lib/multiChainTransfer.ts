import { getAddress, parseEther } from 'ethers';
import type { EthereumProvider } from './metamask.ts';
import { sendSolTransfer } from './solanaWallet.ts';
import type { SupportedCoinSymbol } from './supportedCoins.ts';
import { validateCoinAddress } from './supportedCoins.ts';

interface EvmChainMetadata {
  chainId: number;
  chainIdHex: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

export const EVM_TRANSFER_NETWORKS: Partial<Record<SupportedCoinSymbol, EvmChainMetadata>> = {
  ETH: {
    chainId: 1,
    chainIdHex: '0x1',
    chainName: 'Ethereum Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    blockExplorerUrls: ['https://etherscan.io'],
  },
  BNB: {
    chainId: 56,
    chainIdHex: '0x38',
    chainName: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-dataseed.binance.org'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
  POL: {
    chainId: 137,
    chainIdHex: '0x89',
    chainName: 'Polygon PoS',
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  MON: {
    chainId: 143,
    chainIdHex: '0x8f',
    chainName: 'Monad Mainnet',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: ['https://rpc.monad.xyz'],
  },
};

export function isDirectEvmCoin(symbol: SupportedCoinSymbol): boolean {
  return Boolean(EVM_TRANSFER_NETWORKS[symbol]);
}

/**
 * Switches MetaMask or Phantom EVM to the exact target blockchain (auto-adding chain metadata if missing)
 * and broadcasts a REAL native transfer (`eth_sendTransaction`) to ANY EVM destination wallet.
 */
export async function sendRealEvmTransfer(params: {
  symbol: SupportedCoinSymbol;
  toAddress: string;
  amount: number;
  fromEvm: string;
  provider: EthereumProvider;
}): Promise<string> {
  const net = EVM_TRANSFER_NETWORKS[params.symbol];
  if (!net) {
    throw new Error(`${params.symbol} does not use MetaMask/EVM native transfer.`);
  }
  if (!validateCoinAddress(params.symbol, params.toAddress)) {
    throw new Error(`Enter a valid ${net.chainName} (0x...) destination wallet address.`);
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error(`Enter a positive ${params.symbol} transfer amount.`);
  }

  let activeFrom = params.fromEvm.trim();
  try {
    const accounts = (await params.provider.request({ method: 'eth_requestAccounts' })) as string[];
    if (Array.isArray(accounts) && accounts[0]) {
      activeFrom = accounts[0];
    }
  } catch (accErr: unknown) {
    const code =
      accErr && typeof accErr === 'object' && 'code' in accErr
        ? Number((accErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) throw accErr;
  }

  const fromChecksum = getAddress(activeFrom);
  const toChecksum = getAddress(params.toAddress.trim());

  // Switch or add the exact chain in MetaMask / Phantom
  try {
    const currentChain = String(await params.provider.request({ method: 'eth_chainId' })).toLowerCase();
    if (currentChain !== net.chainIdHex.toLowerCase()) {
      await params.provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: net.chainIdHex }],
      });
    }
  } catch (switchErr: unknown) {
    const code =
      switchErr && typeof switchErr === 'object' && 'code' in switchErr
        ? Number((switchErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) throw switchErr;

    // Chain not added in wallet yet -> add it with verified public RPC
    if (net.chainId !== 1) {
      await params.provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: net.chainIdHex,
            chainName: net.chainName,
            nativeCurrency: net.nativeCurrency,
            rpcUrls: net.rpcUrls,
            blockExplorerUrls: net.blockExplorerUrls,
          },
        ],
      });
    }
  }

  // Confirm wallet is actually on the requested chain before sending
  const activeChain = String(await params.provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (activeChain !== net.chainIdHex.toLowerCase()) {
    throw new Error(
      `Please approve switching your wallet to ${net.chainName} (Chain ID ${net.chainId}) before sending ${params.symbol}.`
    );
  }

  // Exact decimal -> Wei BigInt conversion using ethers.parseEther
  const amountFixed = params.amount.toFixed(18).replace(/\.?0+$/, '') || '0';
  const weiValue = parseEther(amountFixed);
  if (weiValue <= 0n) {
    throw new Error(`Amount is too small to broadcast on ${net.chainName}.`);
  }

  // Pre-flight native balance check to prevent MetaMask "Transaction failed" errors
  try {
    const balHex = String(
      await params.provider.request({
        method: 'eth_getBalance',
        params: [fromChecksum, 'latest'],
      })
    );
    const balWei = BigInt(balHex || '0x0');
    if (balWei < weiValue) {
      throw new Error(
        `Insufficient ${params.symbol} balance in MetaMask on ${net.chainName}. You are trying to send ${amountFixed} ${params.symbol}, plus network gas.`
      );
    }
  } catch (balErr: unknown) {
    if (balErr instanceof Error && balErr.message.startsWith('Insufficient ')) {
      throw balErr;
    }
  }

  const txHash = (await params.provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: fromChecksum,
        to: toChecksum,
        value: '0x' + weiValue.toString(16),
      },
    ],
  })) as string;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(`Wallet did not return a valid ${net.chainName} transaction hash.`);
  }

  return txHash;
}

/**
 * Broadcasts a REAL Solana Mainnet native SOL transfer via connected Phantom / Wallet Standard provider.
 */
export async function sendRealSolanaTransfer(params: {
  toAddress: string;
  amount: number;
}): Promise<string> {
  if (!validateCoinAddress('SOL', params.toAddress)) {
    throw new Error('Enter a valid Solana Base58 destination wallet address.');
  }
  return sendSolTransfer({
    recipientAddress: params.toAddress.trim(),
    amountSol: params.amount,
  });
}

interface InjectedTronWeb {
  ready?: boolean;
  defaultAddress?: { base58?: string };
  trx?: {
    sendTransaction: (
      to: string,
      amountSun: number
    ) => Promise<{ result?: boolean; txid?: string; transaction?: { txID?: string }; message?: string }>;
  };
}

interface InjectedTronLink {
  request?: (args: { method: string }) => Promise<{ code?: number; message?: string } | unknown>;
  tronWeb?: InjectedTronWeb;
}

export function isTronLinkAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { tronWeb?: InjectedTronWeb; tronLink?: InjectedTronLink };
  return Boolean(win.tronLink || win.tronWeb);
}

/**
 * Broadcasts a REAL TRON Mainnet TRX transfer via TronLink or compatible TRON browser wallet.
 */
export async function sendRealTronTransfer(params: {
  toAddress: string;
  amount: number;
}): Promise<{ txid: string; senderAddress: string }> {
  if (typeof window === 'undefined') {
    throw new Error('TRON browser wallet is only available in the browser.');
  }
  if (!validateCoinAddress('TRX', params.toAddress)) {
    throw new Error('Enter a valid TRON (T...) destination wallet address.');
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error('Enter a positive TRX transfer amount.');
  }

  const win = window as unknown as { tronWeb?: InjectedTronWeb; tronLink?: InjectedTronLink };
  if (win.tronLink?.request) {
    await win.tronLink.request({ method: 'tron_requestAccounts' });
  }

  const tronWeb = win.tronLink?.tronWeb || win.tronWeb;
  if (!tronWeb?.trx || !tronWeb.defaultAddress?.base58) {
    throw new Error(
      'No TRON wallet (TronLink / OKX / Trust Wallet) was detected. Unlock TronLink or scan the TRON transfer QR in your mobile wallet.'
    );
  }

  const amountSun = Math.round(params.amount * 1_000_000);
  if (amountSun <= 0) {
    throw new Error('TRX amount must be at least 0.000001 TRX (1 SUN).');
  }

  const res = await tronWeb.trx.sendTransaction(params.toAddress.trim(), amountSun);
  const txid = res?.txid || res?.transaction?.txID;
  if (!txid || !/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error(res?.message || 'TRON wallet did not return a confirmed transaction hash.');
  }

  return { txid, senderAddress: tronWeb.defaultAddress.base58 };
}

/**
 * Builds a standards-compliant wallet payment/transfer URI (BIP-21, EIP-681, Solana Pay, SEP-0007)
 * so users can launch ANY external mobile/desktop/hardware wallet pre-filled with the exact destination and amount.
 */
export function buildWalletTransferUri(
  symbol: SupportedCoinSymbol,
  toAddress: string,
  amount: number
): string {
  const addr = toAddress.trim();
  if (!addr || !validateCoinAddress(symbol, addr)) return '';
  const hasAmt = Number.isFinite(amount) && amount > 0;
  const cleanAmt = hasAmt ? amount.toFixed(8).replace(/\.?0+$/, '') : '';

  switch (symbol) {
    case 'BTC':
      return hasAmt ? `bitcoin:${addr}?amount=${cleanAmt}` : `bitcoin:${addr}`;
    case 'XLM':
      if (addr.startsWith('G')) {
        return hasAmt
          ? `web+stellar:pay?destination=${encodeURIComponent(addr)}&amount=${encodeURIComponent(cleanAmt)}`
          : `web+stellar:pay?destination=${encodeURIComponent(addr)}`;
      }
      return addr;
    case 'SOL':
      return hasAmt ? `solana:${addr}?amount=${cleanAmt}` : `solana:${addr}`;
    case 'ETH':
    case 'BNB':
    case 'POL':
    case 'MON': {
      const net = EVM_TRANSFER_NETWORKS[symbol];
      if (!net) return addr;
      if (!hasAmt) return `ethereum:${addr}@${net.chainId}`;
      try {
        const wei = parseEther(amount.toFixed(18).replace(/\.?0+$/, '') || '0');
        return `ethereum:${addr}@${net.chainId}?value=${wei.toString()}`;
      } catch {
        return `ethereum:${addr}@${net.chainId}`;
      }
    }
    case 'XYPH':
      return hasAmt ? `xypher:${addr}?amount=${cleanAmt}` : `xypher:${addr}`;
    case 'TRX':
    default:
      return addr;
  }
}
