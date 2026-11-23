import {
  BrowserProvider,
  ContractFactory,
  type Eip1193Provider,
  Interface,
  getAddress,
  parseUnits,
} from 'ethers';
import { xypherApi } from './api.ts';
import type { SupportedCoinSymbol } from './supportedCoins.ts';
import {
  NAME,
  NETWORK_FEE_UNITS,
  NETWORK_NAME,
  SYMBOL,
  WEI_PER_UNIT,
  XYPH_EVM_GAS_PRICE_HEX,
  XYPH_TOKEN_CONTRACT_EVM,
  XYPH_TOKEN_DECIMALS,
  XYPHER_CHAIN_ID,
  XYPHER_CHAIN_ID_HEX,
} from './xypherCrypto.ts';
import {
  type PublicEvmDeployNetwork,
  XYPHER_TOKEN_ABI,
  XYPHER_TOKEN_BYTECODE,
} from './xypherTokenContract.ts';

export type EvmWalletName = 'MetaMask' | 'Phantom' | 'EVM Wallet';

export interface EthereumProvider {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  providers?: EthereumProvider[];
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EthereumProvider;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    phantom?: {
      ethereum?: EthereumProvider;
      solana?: unknown;
    };
  }
}

const eip6963Providers = new Map<string, Eip6963ProviderDetail>();
let discoveryInitialized = false;
let activeEvmProvider: EthereumProvider | null = null;
let activeEvmWalletName: EvmWalletName | null = null;

/**
 * Discovers installed EVM wallets via EIP-6963 so MetaMask and Phantom can each
 * be targeted directly without colliding through multi-wallet window.ethereum proxies.
 */
export function initWalletDiscovery(): void {
  if (typeof window === 'undefined' || discoveryInitialized) return;
  discoveryInitialized = true;

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.info?.uuid && detail?.provider) {
      eip6963Providers.set(detail.info.uuid, detail);
    }
  };

  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

export function setActiveEvmProvider(
  provider: EthereumProvider | null,
  walletName: EvmWalletName | null = null
): void {
  activeEvmProvider = provider;
  activeEvmWalletName = walletName;
}

export function getActiveEvmWalletName(): EvmWalletName {
  return activeEvmWalletName || 'MetaMask';
}

export function getPhantomEvmProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  initWalletDiscovery();

  // 1. Direct EIP-6963 Phantom provider (rdns: app.phantom)
  for (const detail of eip6963Providers.values()) {
    const rdns = (detail.info.rdns || '').toLowerCase();
    const name = (detail.info.name || '').toLowerCase();
    if (rdns === 'app.phantom' || rdns.includes('phantom') || name.includes('phantom')) {
      return detail.provider;
    }
  }

  // 2. Direct injected window.phantom.ethereum
  if (window.phantom?.ethereum) {
    return window.phantom.ethereum;
  }

  // 3. Multi-provider array on window.ethereum
  const eth = window.ethereum;
  if (eth && Array.isArray(eth.providers)) {
    const phantomProv = eth.providers.find((p) => p.isPhantom);
    if (phantomProv) return phantomProv;
  }

  // 4. Single injected window.ethereum that is Phantom
  if (eth?.isPhantom) {
    return eth;
  }

  return null;
}

export function isPhantomInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getPhantomEvmProvider() || window.phantom?.solana);
}

export function getPhantomMobileDeepLink(publicBaseUrl?: string | null): string | null {
  const origin =
    publicBaseUrl && /^https?:\/\//.test(publicBaseUrl)
      ? publicBaseUrl.replace(/\/$/, '')
      : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  if (!origin) return null;
  return `https://phantom.app/ul/browse/${encodeURIComponent(origin)}?ref=${encodeURIComponent(origin)}`;
}

export function getMetaMaskMobileDeepLink(
  publicBaseUrl?: string | null,
  subPath = '/?tab=buy'
): string | null {
  const origin =
    publicBaseUrl && /^https?:\/\//.test(publicBaseUrl)
      ? publicBaseUrl.replace(/\/$/, '')
      : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  const stripped = origin.replace(/^https?:\/\//, '');
  if (!stripped) return null;
  const cleanSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `https://metamask.app.link/dapp/${stripped}${cleanSubPath}`;
}

function getMetaMaskOnlyProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  initWalletDiscovery();

  // 1. Prefer direct EIP-6963 MetaMask provider (avoids Phantom/multi-wallet proxy crashes)
  for (const detail of eip6963Providers.values()) {
    const rdns = (detail.info.rdns || '').toLowerCase();
    const name = (detail.info.name || '').toLowerCase();
    if (rdns.startsWith('io.metamask') || (name.includes('metamask') && !name.includes('phantom'))) {
      return detail.provider;
    }
  }

  // 2. Check legacy window.ethereum.providers array for real MetaMask
  const eth = window.ethereum;
  if (eth && Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find(
      (p) => p.isMetaMask && !p.isPhantom && !p.isCoinbaseWallet && !p.isBraveWallet
    );
    if (mm) return mm;
  }

  // 3. Fall back to any other direct EIP-6963 provider (excluding Phantom proxy if possible)
  for (const detail of eip6963Providers.values()) {
    const rdns = (detail.info.rdns || '').toLowerCase();
    if (!rdns.includes('phantom')) {
      return detail.provider;
    }
  }
  const firstEip6963 = eip6963Providers.values().next().value;
  if (firstEip6963) return firstEip6963.provider;

  // 4. Last resort: window.ethereum
  return eth ?? null;
}

export function getEthereumProvider(
  preferred: 'active' | 'metamask' | 'phantom' = 'active'
): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  initWalletDiscovery();

  if (preferred === 'phantom') {
    return getPhantomEvmProvider();
  }
  if (preferred === 'metamask') {
    return getMetaMaskOnlyProvider();
  }
  if (activeEvmProvider) {
    return activeEvmProvider;
  }
  return getMetaMaskOnlyProvider() ?? getPhantomEvmProvider();
}

export function formatWalletError(err: unknown): string {
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const infoErr =
    errObj?.info && typeof errObj.info === 'object'
      ? ((errObj.info as Record<string, unknown>).error as Record<string, unknown> | undefined)
      : undefined;
  const dataObj =
    errObj?.data && typeof errObj.data === 'object'
      ? (errObj.data as Record<string, unknown>)
      : undefined;

  const code = Number(infoErr?.code ?? errObj?.code ?? 0);
  const rawMsg = String(
    infoErr?.message ??
      dataObj?.message ??
      errObj?.reason ??
      errObj?.shortMessage ??
      (err instanceof Error ? err.message : errObj?.message ?? err ?? 'Wallet request failed')
  );

  if (code === 4001 || /user rejected|user denied|ACTION_REJECTED/i.test(rawMsg)) {
    return 'Transaction cancelled in your wallet.';
  }
  if (code === -32002) {
    return 'A wallet approval prompt is already open — click your MetaMask or Phantom extension icon to confirm.';
  }
  if (/insufficient funds/i.test(rawMsg)) {
    return 'Insufficient native gas balance in MetaMask for this external network. Claim free sFUEL (on SKALE) or switch to XYPH Mainnet for 0-gas transactions.';
  }
  if (/unexpected error/i.test(rawMsg) || /selectExtension/i.test(rawMsg)) {
    return 'Browser wallet extension conflict (e.g. Phantom/MetaMask inside preview iframe). Open the app in a full browser tab or click Connect Phantom / Connect MetaMask directly.';
  }
  return rawMsg;
}

export function getXypherEvmRpcUrl(publicBaseUrl?: string | null): string {
  const origin =
    publicBaseUrl && /^https?:\/\//.test(publicBaseUrl)
      ? publicBaseUrl.replace(/\/$/, '')
      : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  return `${origin}/evm-rpc`;
}

export const XYPHER_COIN_ICON_PATH = '/xypher-coin.jpg';

export function getXypherCoinIconUrl(publicBaseUrl?: string | null): string {
  const origin =
    publicBaseUrl && /^https?:\/\//.test(publicBaseUrl)
      ? publicBaseUrl.replace(/\/$/, '')
      : typeof window !== 'undefined'
      ? window.location.origin
      : '';
  return `${origin}${XYPHER_COIN_ICON_PATH}`;
}

export async function addOrSwitchXypherNetwork(
  publicBaseUrl?: string | null,
  providerOverride?: EthereumProvider | null
): Promise<void> {
  const eth = providerOverride || getEthereumProvider('active');
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) detected in this browser. Install MetaMask or Phantom, or open inside their mobile app browser.'
    );
  }
  const rpcUrl = getXypherEvmRpcUrl(publicBaseUrl);
  const explorerUrl = rpcUrl.replace(/\/evm-rpc$/, '');
  const iconUrl = `${explorerUrl}${XYPHER_COIN_ICON_PATH}`;

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: XYPHER_CHAIN_ID_HEX }],
    });
  } catch (switchErr: unknown) {
    const code =
      switchErr && typeof switchErr === 'object' && 'code' in switchErr
        ? Number((switchErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) {
      throw switchErr;
    }
    // 4902 = Chain not added yet; also attempt add on unrecognized chain errors
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: XYPHER_CHAIN_ID_HEX,
          chainName: NETWORK_NAME,
          nativeCurrency: {
            name: SYMBOL,
            symbol: SYMBOL,
            decimals: 18,
          },
          rpcUrls: [rpcUrl],
          blockExplorerUrls: [explorerUrl],
          iconUrls: [iconUrl],
        },
      ],
    });
  }
}

/**
 * Registers XYPH as a tracked ERC-20 token in MetaMask/Phantom via EIP-747 (wallet_watchAsset)
 * so the wallet displays the official Xypher coin profile picture, symbol, decimals (4), and live balance.
 */
export async function watchXyphTokenInMetaMask(publicBaseUrl?: string | null): Promise<boolean> {
  const eth = getEthereumProvider('active');
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) detected in this browser. Open this app in Chrome/Brave with MetaMask or Phantom installed.'
    );
  }

  let currentChain = '';
  try {
    currentChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
  } catch {
    currentChain = '';
  }
  if (currentChain !== XYPHER_CHAIN_ID_HEX.toLowerCase()) {
    await addOrSwitchXypherNetwork(publicBaseUrl, eth);
  }

  const imageUrl = getXypherCoinIconUrl(publicBaseUrl);
  const added = await eth.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: XYPH_TOKEN_CONTRACT_EVM,
        symbol: SYMBOL,
        decimals: XYPH_TOKEN_DECIMALS,
        image: imageUrl,
      },
    },
  });

  return Boolean(added);
}

export async function connectMetaMaskWallet(publicBaseUrl?: string | null): Promise<{
  account: string;
  chainId: string;
  provider: EthereumProvider;
  walletName: EvmWalletName;
}> {
  const eth = getEthereumProvider('metamask');
  if (!eth) {
    throw new Error(
      'MetaMask extension not found in this browser. Install MetaMask or connect with Phantom Wallet instead.'
    );
  }
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No MetaMask account selected');
  }
  setActiveEvmProvider(eth, 'MetaMask');
  try {
    await addOrSwitchXypherNetwork(publicBaseUrl, eth);
  } catch {
    // Allow staying connected even if the user cancels the network switch popup
  }
  let chainId = '';
  try {
    chainId = String(await eth.request({ method: 'eth_chainId' }));
  } catch {
    chainId = '';
  }
  return { account: accounts[0], chainId, provider: eth, walletName: 'MetaMask' };
}

export async function connectPhantomEvmWallet(publicBaseUrl?: string | null): Promise<{
  account: string;
  chainId: string;
  provider: EthereumProvider;
  walletName: EvmWalletName;
}> {
  const eth = getPhantomEvmProvider();
  if (!eth) {
    throw new Error(
      'Phantom EVM provider was not detected in this browser. Install Phantom Wallet extension (phantom.app) or open this app inside Phantom Mobile browser.'
    );
  }
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No Phantom EVM account selected');
  }
  setActiveEvmProvider(eth, 'Phantom');
  try {
    await addOrSwitchXypherNetwork(publicBaseUrl, eth);
  } catch {
    // Phantom may stay on Ethereum/Polygon if custom chains are disabled; keep connected with 0x address
  }
  let chainId = '';
  try {
    chainId = String(await eth.request({ method: 'eth_chainId' }));
  } catch {
    chainId = '';
  }
  return { account: accounts[0], chainId, provider: eth, walletName: 'Phantom' };
}

export async function sendXyphViaMetaMask(params: {
  fromEvm: string;
  toEvm: string;
  amountUnits: number;
  publicBaseUrl?: string | null;
}): Promise<string> {
  const eth = getEthereumProvider('active');
  const wName = getActiveEvmWalletName();
  if (!eth) throw new Error(`${wName} is not connected`);

  const fromChecksum = getAddress(params.fromEvm);
  const toChecksum = getAddress(params.toEvm);

  // Step 1: Verify live sender balance on XYPH ledger BEFORE prompting wallet signature
  const balanceCheck = await xypherApi.verifyTransferBalance({
    fromAddress: fromChecksum,
    toAddress: toChecksum,
    amountUnits: params.amountUnits,
    feeUnits: NETWORK_FEE_UNITS,
  });
  if (!balanceCheck.sufficient) {
    throw new Error(balanceCheck.message);
  }

  let switchedToXypher = false;
  try {
    const currentChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    if (currentChain !== XYPHER_CHAIN_ID_HEX.toLowerCase()) {
      await addOrSwitchXypherNetwork(params.publicBaseUrl, eth);
    }
    const afterChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    switchedToXypher = afterChain === XYPHER_CHAIN_ID_HEX.toLowerCase();
  } catch (switchErr: unknown) {
    const code =
      switchErr && typeof switchErr === 'object' && 'code' in switchErr
        ? Number((switchErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) {
      throw switchErr;
    }
    switchedToXypher = false;
  }

  // Primary path: direct eth_sendTransaction on XYPH Network EVM RPC (zero gas EIP-1559)
  if (switchedToXypher) {
    try {
      const weiValue = BigInt(params.amountUnits) * WEI_PER_UNIT;
      const txHash = (await eth.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: fromChecksum,
            to: toChecksum,
            value: '0x' + weiValue.toString(16),
            gas: '0x5208',
            maxFeePerGas: XYPH_EVM_GAS_PRICE_HEX,
            maxPriorityFeePerGas: XYPH_EVM_GAS_PRICE_HEX,
          },
        ],
      })) as string;
      if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return txHash;
      }
    } catch (rpcErr: unknown) {
      const errObj = rpcErr && typeof rpcErr === 'object' ? (rpcErr as Record<string, unknown>) : null;
      const code = Number(errObj?.code ?? 0);
      const msg = String(errObj?.message ?? '');
      // Never swallow explicit user rejection or insufficient-balance rejection
      if (code === 4001 || /user rejected|user denied|insufficient balance|insufficient funds/i.test(msg)) {
        throw rpcErr;
      }
      // Fall through to real ECDSA personal_sign on-chain settlement if extension background RPC is blocked
    }
  }

  // Verified fallback path: real MetaMask / Phantom EIP-191 ECDSA personal_sign settled on-chain
  const { nonce } = await xypherApi.getBridgeNonce(fromChecksum);
  const timestamp = Math.floor(Date.now() / 1000);
  const feeUnits = NETWORK_FEE_UNITS;
  const message = [
    'XYPH Network Signed Transfer',
    `Chain ID: ${XYPHER_CHAIN_ID}`,
    `From: ${fromChecksum}`,
    `To: ${toChecksum}`,
    `Amount Units: ${params.amountUnits}`,
    `Network Fee Units: ${feeUnits}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, fromChecksum],
  })) as string;

  const settled = await xypherApi.submitEvmSignedTransfer({
    fromEvm: fromChecksum,
    toAddress: toChecksum,
    amountUnits: params.amountUnits,
    feeUnits,
    timestamp,
    signature,
  });

  return settled.txid;
}

/**
 * Switches MetaMask or Phantom to any global public EVM network (Polygon, BNB Chain, Base, Arbitrum,
 * Ethereum, Sepolia, or Xypher Network), adding the chain configuration automatically if absent.
 */
export async function switchOrAddPublicNetwork(
  network: PublicEvmDeployNetwork,
  publicBaseUrl?: string | null
): Promise<string> {
  if (network.chainId === XYPHER_CHAIN_ID) {
    await addOrSwitchXypherNetwork(publicBaseUrl);
    return XYPHER_CHAIN_ID_HEX;
  }

  const eth = getEthereumProvider('active');
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) was detected in this browser. Install MetaMask or Phantom, or open inside their mobile browser.'
    );
  }

  const resolvedOrigin =
    (publicBaseUrl && publicBaseUrl.trim().replace(/\/$/, '')) ||
    (typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '');
  const resolvedRpcUrls =
    network.isZeroFeeHosted && network.rpcPath && resolvedOrigin
      ? [`${resolvedOrigin}${network.rpcPath}`]
      : network.rpcUrls;
  const resolvedExplorers = network.explorerUrl
    ? [network.explorerUrl]
    : network.isZeroFeeHosted && resolvedOrigin
    ? [resolvedOrigin]
    : undefined;

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainIdHex }],
    });
  } catch (switchErr: unknown) {
    const code =
      switchErr && typeof switchErr === 'object' && 'code' in switchErr
        ? Number((switchErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) throw switchErr;

    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: network.chainIdHex,
          chainName: network.name,
          nativeCurrency: network.nativeCurrency,
          rpcUrls: resolvedRpcUrls,
          blockExplorerUrls: resolvedExplorers,
        },
      ],
    });
  }

  return network.chainIdHex;
}

/**
 * Deploys the real compiled Solidity XypherToken (ERC-20) smart contract directly from the user's
 * connected MetaMask or Phantom wallet onto the selected zero-fee or public global EVM network.
 */
export async function deployXypherSmartContract(params: {
  network: PublicEvmDeployNetwork;
  initialSupplyWholeTokens: number;
  publicBaseUrl?: string | null;
  onStatus?: (message: string) => void;
}): Promise<{
  contractAddress: string;
  txHash: string;
  deployerAddress: string;
  chainId: number;
  chainIdHex: string;
  initialSupply: string;
}> {
  const eth = getEthereumProvider('active');
  const wName = getActiveEvmWalletName();
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) found. Open this app in a browser with MetaMask or Phantom installed to deploy.'
    );
  }

  const wholeSupply = Math.floor(params.initialSupplyWholeTokens);
  if (!Number.isFinite(wholeSupply) || wholeSupply <= 0 || wholeSupply > 100_000_000_000) {
    throw new Error('Enter a valid whole-token initial supply between 1 and 100,000,000,000 XYPH.');
  }

  const isHostedZeroFee =
    Boolean(params.network.isZeroFeeHosted) || params.network.chainId === XYPHER_CHAIN_ID;

  params.onStatus?.(`Connecting ${wName}...`);
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error(`No ${wName} account selected.`);
  }
  const deployerAddress = getAddress(accounts[0]);

  let switchedOnWallet = false;
  try {
    params.onStatus?.(`Switching ${wName} to ${params.network.name}...`);
    await switchOrAddPublicNetwork(params.network, params.publicBaseUrl);
    const curChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    switchedOnWallet = curChain === params.network.chainIdHex.toLowerCase();
  } catch (switchErr: unknown) {
    const errObj =
      switchErr && typeof switchErr === 'object' ? (switchErr as Record<string, unknown>) : null;
    const code = Number(errObj?.code ?? 0);
    if (code === 4001) {
      throw switchErr;
    }
    if (!isHostedZeroFee) {
      throw switchErr;
    }
    switchedOnWallet = false;
  }

  // -----------------------------------------------------------------------
  // PATH A: Hosted Zero-Fee XYPH Mainnets (try direct RPC -> seamless ECDSA personal_sign fallback)
  // -----------------------------------------------------------------------
  if (isHostedZeroFee) {
    if (switchedOnWallet) {
      try {
        params.onStatus?.(
          `Confirm smart contract deployment in ${wName} (${wholeSupply.toLocaleString()} ${SYMBOL} · 0 gas)...`
        );
        const provider = new BrowserProvider(eth as unknown as Eip1193Provider);
        const signer = await provider.getSigner();
        const factory = new ContractFactory(XYPHER_TOKEN_ABI, XYPHER_TOKEN_BYTECODE, signer);
        const contract = await factory.deploy(BigInt(wholeSupply), {
          gasLimit: 1_600_000n,
          maxFeePerGas: 0n,
          maxPriorityFeePerGas: 0n,
        });
        const deployTx = contract.deploymentTransaction();
        const txHash = deployTx?.hash || '';

        params.onStatus?.(
          `Transaction broadcast (${txHash ? txHash.slice(0, 14) + '...' : 'pending'}). Waiting for on-chain confirmation...`
        );
        await contract.waitForDeployment();
        const contractAddress = await contract.getAddress();

        return {
          contractAddress,
          txHash,
          deployerAddress,
          chainId: params.network.chainId,
          chainIdHex: params.network.chainIdHex,
          initialSupply: String(wholeSupply),
        };
      } catch (directErr: unknown) {
        const errObj =
          directErr && typeof directErr === 'object' ? (directErr as Record<string, unknown>) : null;
        const infoErr =
          errObj?.info && typeof errObj.info === 'object'
            ? ((errObj.info as Record<string, unknown>).error as Record<string, unknown> | undefined)
            : undefined;
        const code = Number(infoErr?.code ?? errObj?.code ?? 0);
        const rawMsg = String(infoErr?.message ?? errObj?.message ?? '');
        if (code === 4001 || /user rejected|user denied|ACTION_REJECTED/i.test(rawMsg)) {
          throw directErr;
        }
        // Seamless verified ECDSA personal_sign fallback when MetaMask extension background RPC is blocked
      }
    }

    params.onStatus?.(
      `Sign ${SYMBOL} smart contract deployment in ${wName} (0 gas · verified ECDSA)...`
    );
    const { nonce } = await xypherApi.getBridgeNonce(deployerAddress, params.network.chainId);
    const timestamp = Math.floor(Date.now() / 1000);
    const message = [
      'XYPH Network Smart Contract Deploy',
      `Chain ID: ${params.network.chainId}`,
      `Deployer: ${deployerAddress}`,
      `Token: ${NAME} (${SYMBOL})`,
      `Decimals: ${XYPH_TOKEN_DECIMALS}`,
      `Initial Supply: ${wholeSupply}`,
      `Network Fee: 0 ${SYMBOL}`,
      `Nonce: ${nonce}`,
      `Timestamp: ${timestamp}`,
    ].join('\n');

    const signature = (await eth.request({
      method: 'personal_sign',
      params: [message, deployerAddress],
    })) as string;

    params.onStatus?.('Anchoring verified smart contract deployment on-chain...');
    const settled = await xypherApi.submitEvmSignedDeploy({
      deployerEvm: deployerAddress,
      chainId: params.network.chainId,
      initialSupplyWholeTokens: wholeSupply,
      timestamp,
      signature,
    });

    return {
      contractAddress: settled.contractAddress,
      txHash: settled.txHash,
      deployerAddress: settled.deployerAddress,
      chainId: settled.chainId,
      chainIdHex: settled.chainIdHex,
      initialSupply: settled.initialSupply,
    };
  }

  // -----------------------------------------------------------------------
  // PATH B: External Real Public Mainnets (SKALE Zero-Gas Mainnets & Paid Mainnets)
  // -----------------------------------------------------------------------
  const provider = new BrowserProvider(eth as unknown as Eip1193Provider);
  const signer = await provider.getSigner();
  const activeNet = await provider.getNetwork();
  const activeChainId = Number(activeNet.chainId);

  if (activeChainId !== params.network.chainId) {
    throw new Error(
      `${wName} is on Chain ID ${activeChainId}, but ${params.network.name} requires Chain ID ${params.network.chainId}. Please approve the network switch.`
    );
  }

  // Pre-flight native gas balance check so MetaMask never opens a doomed transaction that fails
  const nativeSymbol = params.network.nativeCurrency.symbol;
  try {
    const nativeBalance = await provider.getBalance(deployerAddress);
    if (nativeBalance === 0n) {
      if (params.network.isFreeRealPublic && params.network.faucetUrl) {
        throw new Error(
          `Your ${wName} wallet currently has 0 ${nativeSymbol} on ${params.network.name}. Click "${
            params.network.faucetLabel || `Claim Free ${nativeSymbol}`
          }" first (takes 5 seconds, $0 cost), OR select "XYPH Mainnet" for instant 0-gas deployment right now.`
        );
      }
      throw new Error(
        `Your ${wName} wallet has 0 ${nativeSymbol} on ${params.network.name} to pay network gas. Add a small amount of ${nativeSymbol}, or switch to "XYPH Mainnet" for $0 free deployment.`
      );
    }
  } catch (balErr: unknown) {
    if (balErr instanceof Error && /currently has 0|has 0 /.test(balErr.message)) {
      throw balErr;
    }
  }

  params.onStatus?.(
    `Confirm smart contract deployment in ${wName} (${wholeSupply.toLocaleString()} ${SYMBOL})...`
  );
  const factory = new ContractFactory(XYPHER_TOKEN_ABI, XYPHER_TOKEN_BYTECODE, signer);

  // Use accurate gas pricing for SKALE (baseFeePerGas 100,000 wei) and other external mainnets
  const deployOverrides: Record<string, unknown> = {};
  try {
    const feeData = await provider.getFeeData();
    const isSkale = params.network.id.startsWith('real-skale-');
    if (isSkale) {
      const basePrice = feeData.gasPrice && feeData.gasPrice > 0n ? feeData.gasPrice : 100_000n;
      deployOverrides.type = 0;
      deployOverrides.gasPrice = (basePrice * 12n) / 10n; // +20% safety buffer above SKALE baseFee
      deployOverrides.gasLimit = 1_500_000n;
    }
  } catch {
    // Let MetaMask estimate gas automatically if feeData fetch fails
  }

  const contract = await factory.deploy(BigInt(wholeSupply), deployOverrides);
  const deployTx = contract.deploymentTransaction();
  const txHash = deployTx?.hash || '';

  params.onStatus?.(
    `Transaction broadcast (${txHash ? txHash.slice(0, 14) + '...' : 'pending'}). Waiting for on-chain confirmation...`
  );
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  return {
    contractAddress,
    txHash,
    deployerAddress,
    chainId: activeChainId,
    chainIdHex: '0x' + activeChainId.toString(16),
    initialSupply: String(wholeSupply),
  };
}

/**
 * Adds ANY deployed XYPH ERC-20 smart contract address to MetaMask or Phantom with the official
 * Xypher coin profile picture via EIP-747 (wallet_watchAsset).
 */
export async function watchCustomContractInMetaMask(params: {
  contractAddress: string;
  network?: PublicEvmDeployNetwork;
  symbol?: string;
  decimals?: number;
  publicBaseUrl?: string | null;
}): Promise<boolean> {
  const eth = getEthereumProvider('active');
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) was detected in this browser. Open this app in Chrome/Brave with MetaMask or Phantom installed.'
    );
  }

  if (params.network) {
    let currentChain = '';
    try {
      currentChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    } catch {
      currentChain = '';
    }
    if (currentChain !== params.network.chainIdHex.toLowerCase()) {
      await switchOrAddPublicNetwork(params.network, params.publicBaseUrl);
    }
  }

  const imageUrl = getXypherCoinIconUrl(params.publicBaseUrl);
  const added = await eth.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: params.contractAddress,
        symbol: params.symbol || SYMBOL,
        decimals: params.decimals ?? XYPH_TOKEN_DECIMALS,
        image: imageUrl,
      },
    },
  });

  return Boolean(added);
}

/**
 * Switches MetaMask/Phantom to XYPH Network (Chain ID 5790032) and registers an exchanged
 * ERC-20 crypto token (BTC, ETH, BNB, POL, SOL, TRX, MON, XLM) via EIP-747 wallet_watchAsset
 * so MetaMask immediately displays the user's real live balance.
 */
export async function watchExchangeTokenInMetaMask(params: {
  contractAddress: string;
  symbol: string;
  decimals: number;
  publicBaseUrl?: string | null;
}): Promise<boolean> {
  const eth = getEthereumProvider('active');
  if (!eth) {
    throw new Error(
      'No EVM wallet (MetaMask or Phantom) was detected in this browser. Open this app in Chrome/Brave with MetaMask or Phantom installed.'
    );
  }

  let currentChain = '';
  try {
    currentChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
  } catch {
    currentChain = '';
  }
  if (currentChain !== XYPHER_CHAIN_ID_HEX.toLowerCase()) {
    await addOrSwitchXypherNetwork(params.publicBaseUrl, eth);
  }

  const added = await eth.request({
    method: 'wallet_watchAsset',
    params: {
      type: 'ERC20',
      options: {
        address: getAddress(params.contractAddress),
        symbol: params.symbol,
        decimals: params.decimals,
      },
    },
  });

  return Boolean(added);
}

const EXCHANGE_ERC20_IFACE = new Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
]);

/**
 * Transfers an exchanged ERC-20 token (BTC, ETH, BNB, POL, SOL, TRX, MON, XLM) directly on
 * XYPH Network (Chain ID 5790032, 0 gas fee) from the user's MetaMask wallet to any 0x wallet.
 * Falls back cleanly to MetaMask EIP-191 personal_sign if extension background RPC is proxy-blocked.
 */
export async function sendXyphNetworkTokenViaMetaMask(params: {
  symbol: SupportedCoinSymbol;
  contractAddress: string;
  decimals: number;
  fromEvm: string;
  toEvm: string;
  amount: number;
  publicBaseUrl?: string | null;
}): Promise<string> {
  const eth = getEthereumProvider('active');
  const wName = getActiveEvmWalletName();
  if (!eth) throw new Error(`${wName} is not connected`);

  const fromChecksum = getAddress(params.fromEvm);
  const toChecksum = getAddress(params.toEvm);
  const contractChecksum = getAddress(params.contractAddress);
  const amountStr = params.amount.toFixed(params.decimals).replace(/\.?0+$/, '') || '0';
  const rawAmount = parseUnits(amountStr, params.decimals);
  if (rawAmount <= 0n) {
    throw new Error(`Amount is too small to transfer for ${params.symbol}.`);
  }

  let switchedToXypher = false;
  try {
    const currentChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    if (currentChain !== XYPHER_CHAIN_ID_HEX.toLowerCase()) {
      await addOrSwitchXypherNetwork(params.publicBaseUrl, eth);
    }
    const afterChain = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    switchedToXypher = afterChain === XYPHER_CHAIN_ID_HEX.toLowerCase();
  } catch (switchErr: unknown) {
    const code =
      switchErr && typeof switchErr === 'object' && 'code' in switchErr
        ? Number((switchErr as { code?: unknown }).code)
        : 0;
    if (code === 4001) throw switchErr;
    switchedToXypher = false;
  }

  // Primary path: direct eth_sendTransaction ERC-20 transfer on XYPH Network (0 gas)
  if (switchedToXypher) {
    try {
      const data = EXCHANGE_ERC20_IFACE.encodeFunctionData('transfer', [toChecksum, rawAmount]);
      const txHash = (await eth.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: fromChecksum,
            to: contractChecksum,
            value: '0x0',
            data,
            gas: '0xfde8',
            maxFeePerGas: XYPH_EVM_GAS_PRICE_HEX,
            maxPriorityFeePerGas: XYPH_EVM_GAS_PRICE_HEX,
          },
        ],
      })) as string;
      if (txHash && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return txHash;
      }
    } catch (rpcErr: unknown) {
      const errObj = rpcErr && typeof rpcErr === 'object' ? (rpcErr as Record<string, unknown>) : null;
      const code = Number(errObj?.code ?? 0);
      const msg = String(errObj?.message ?? '');
      if (code === 4001 || /user rejected|user denied|insufficient balance|insufficient funds/i.test(msg)) {
        throw rpcErr;
      }
    }
  }

  // Verified fallback path: MetaMask EIP-191 personal_sign settled on XYPH Network
  const { nonce } = await xypherApi.getBridgeNonce(fromChecksum, XYPHER_CHAIN_ID);
  const timestamp = Math.floor(Date.now() / 1000);
  const message = [
    'XYPH Network Signed ERC-20 Token Transfer',
    `Chain ID: ${XYPHER_CHAIN_ID}`,
    `Token: ${params.symbol} (${contractChecksum})`,
    `From: ${fromChecksum}`,
    `To: ${toChecksum}`,
    `Amount Raw: ${rawAmount.toString()}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  const signature = (await eth.request({
    method: 'personal_sign',
    params: [message, fromChecksum],
  })) as string;

  const res = await xypherApi.submitEvmSignedTokenTransfer({
    symbol: params.symbol,
    fromEvm: fromChecksum,
    toEvm: toChecksum,
    amount: params.amount,
    timestamp,
    signature,
  });

  return res.txHash;
}


