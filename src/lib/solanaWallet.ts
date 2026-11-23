import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';

type StandardWallet = ReturnType<ReturnType<typeof getWallets>['get']>[number];
type StandardWalletAccount = StandardWallet['accounts'][number];

export type SolanaChainId = 'solana:mainnet' | 'solana:devnet';

export interface SolanaClusterConfig {
  id: 'mainnet' | 'devnet';
  name: string;
  chain: SolanaChainId;
  rpcUrl: string;
  explorerUrl: string;
  explorerQuery: string;
}

export const SOLANA_CLUSTERS: Record<'mainnet' | 'devnet', SolanaClusterConfig> = {
  mainnet: {
    id: 'mainnet',
    name: 'Solana Mainnet',
    chain: 'solana:mainnet',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://solscan.io',
    explorerQuery: '',
  },
  devnet: {
    id: 'devnet',
    name: 'Solana Devnet',
    chain: 'solana:devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    explorerUrl: 'https://solscan.io',
    explorerQuery: '?cluster=devnet',
  },
};

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

interface StandardConnectFeature {
  connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardWalletAccount[] }>;
}

interface StandardDisconnectFeature {
  disconnect: () => Promise<void>;
}

interface SolanaSignAndSendTransactionFeature {
  signAndSendTransaction: (
    ...inputs: Array<{
      account: StandardWalletAccount;
      transaction: Uint8Array;
      chain: SolanaChainId;
      options?: {
        commitment?: 'processed' | 'confirmed' | 'finalized';
        skipPreflight?: boolean;
      };
    }>
  ) => Promise<readonly { signature: Uint8Array }[]>;
}

export interface PhantomSolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58: () => string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58: () => string } }>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (
    tx: VersionedTransaction,
    options?: { skipPreflight?: boolean; preflightCommitment?: string }
  ) => Promise<{ signature: string }>;
}

export interface DetectedSolanaWallet {
  id: string;
  name: string;
  icon: string;
  wallet: StandardWallet | null;
  injectedPhantom?: PhantomSolanaProvider;
  chains: readonly string[];
}

export interface ConnectedSolanaSession {
  walletName: string;
  walletIcon: string;
  address: string;
  cluster: SolanaClusterConfig;
}

let currentCluster: SolanaClusterConfig = SOLANA_CLUSTERS.mainnet;
let connection = new Connection(currentCluster.rpcUrl, 'confirmed');
let wallet: StandardWallet | null = null;
let account: StandardWalletAccount | null = null;
let injectedPhantom: PhantomSolanaProvider | null = null;
let injectedPhantomAddress: string | null = null;
let CHAIN: SolanaChainId = currentCluster.chain;

export function getInjectedPhantomSolanaProvider(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    phantom?: { solana?: PhantomSolanaProvider };
    solana?: PhantomSolanaProvider;
  };
  if (win.phantom?.solana?.isPhantom) {
    return win.phantom.solana;
  }
  if (win.solana?.isPhantom) {
    return win.solana;
  }
  return null;
}

function isSolanaStandardWallet(w: StandardWallet): boolean {
  const features = w.features as Record<string, unknown>;
  const hasConnect = Boolean(features['standard:connect']);
  const hasSignAndSend = Boolean(features['solana:signAndSendTransaction']);
  const supportsSolanaChain = w.chains.some((c: string) => c.startsWith('solana:'));
  return hasConnect && hasSignAndSend && supportsSolanaChain;
}

export function discoverSolanaWallets(): DetectedSolanaWallet[] {
  if (typeof window === 'undefined') return [];
  const seen = new Set<string>();
  const out: DetectedSolanaWallet[] = [];

  try {
    const registry = getWallets();
    const list = registry.get().filter(isSolanaStandardWallet);
    for (const w of list) {
      const key = w.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: key,
        name: w.name,
        icon: w.icon,
        wallet: w,
        chains: w.chains,
      });
    }
  } catch {
    // Ignore Wallet Standard registry errors and fall back to injected Phantom
  }

  const phantomDirect = getInjectedPhantomSolanaProvider();
  if (phantomDirect && !seen.has('phantom')) {
    seen.add('phantom');
    out.unshift({
      id: 'phantom',
      name: 'Phantom',
      icon: '',
      wallet: null,
      injectedPhantom: phantomDirect,
      chains: ['solana:mainnet', 'solana:devnet'],
    });
  }

  return out;
}

export function isPhantomSolanaAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const list = discoverSolanaWallets();
  return (
    list.some((w) => w.name.toLowerCase().includes('phantom')) ||
    Boolean(getInjectedPhantomSolanaProvider())
  );
}

export function subscribeSolanaWallets(
  onChange: (wallets: DetectedSolanaWallet[]) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const registry = getWallets();
  const emit = () => onChange(discoverSolanaWallets());
  const offRegister = registry.on('register', emit);
  const offUnregister = registry.on('unregister', emit);
  emit();
  return () => {
    offRegister();
    offUnregister();
  };
}

export function getSolanaCluster(): SolanaClusterConfig {
  return currentCluster;
}

export function setSolanaCluster(clusterId: 'mainnet' | 'devnet'): SolanaClusterConfig {
  currentCluster = SOLANA_CLUSTERS[clusterId] || SOLANA_CLUSTERS.mainnet;
  CHAIN = currentCluster.chain;
  connection = new Connection(currentCluster.rpcUrl, 'confirmed');
  return currentCluster;
}

export function getSolanaConnection(): Connection {
  return connection;
}

export function getConnectedSolanaSession(): ConnectedSolanaSession | null {
  if (wallet && account) {
    return {
      walletName: wallet.name,
      walletIcon: wallet.icon,
      address: account.address,
      cluster: currentCluster,
    };
  }
  if (injectedPhantom && injectedPhantomAddress) {
    return {
      walletName: 'Phantom',
      walletIcon: '',
      address: injectedPhantomAddress,
      cluster: currentCluster,
    };
  }
  return null;
}

export async function connectSolanaWallet(
  targetWallet: StandardWallet
): Promise<ConnectedSolanaSession> {
  const connectFeature = (
    targetWallet.features as Record<string, unknown>
  )['standard:connect'] as StandardConnectFeature | undefined;

  if (!connectFeature) {
    throw new Error(`${targetWallet.name} does not expose Wallet Standard connect.`);
  }

  const res = await connectFeature.connect();
  const solAccount =
    res.accounts.find((a) => a.chains.some((c: string) => c.startsWith('solana:'))) ||
    res.accounts[0];

  if (!solAccount) {
    throw new Error(`No Solana account returned by ${targetWallet.name}.`);
  }

  wallet = targetWallet;
  account = solAccount;
  injectedPhantom = null;
  injectedPhantomAddress = null;

  return {
    walletName: targetWallet.name,
    walletIcon: targetWallet.icon,
    address: solAccount.address,
    cluster: currentCluster,
  };
}

export async function connectPhantomSolanaWallet(): Promise<ConnectedSolanaSession> {
  // 1. Prefer Wallet Standard Phantom so solana:signAndSendTransaction is used directly
  const discovered = discoverSolanaWallets();
  const stdPhantom = discovered.find(
    (w) => w.wallet && w.name.toLowerCase().includes('phantom')
  );
  if (stdPhantom?.wallet) {
    return connectSolanaWallet(stdPhantom.wallet);
  }

  // 2. Fall back to injected window.phantom.solana
  const provider = getInjectedPhantomSolanaProvider();
  if (!provider) {
    throw new Error(
      'Phantom Wallet extension was not detected in this browser. Install Phantom from phantom.app or open this app inside the Phantom Mobile browser.'
    );
  }

  const res = await provider.connect();
  const address = res?.publicKey?.toBase58?.() || provider.publicKey?.toBase58?.();
  if (!address) {
    throw new Error('Phantom did not return a Solana public address.');
  }

  wallet = null;
  account = null;
  injectedPhantom = provider;
  injectedPhantomAddress = address;

  return {
    walletName: 'Phantom',
    walletIcon: '',
    address,
    cluster: currentCluster,
  };
}

export async function disconnectSolanaWallet(): Promise<void> {
  if (wallet) {
    try {
      const disconnectFeature = (
        wallet.features as Record<string, unknown>
      )['standard:disconnect'] as StandardDisconnectFeature | undefined;
      if (disconnectFeature) {
        await disconnectFeature.disconnect();
      }
    } catch {
      // Clear local session regardless of provider disconnect errors
    }
  }
  if (injectedPhantom) {
    try {
      await injectedPhantom.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
  wallet = null;
  account = null;
  injectedPhantom = null;
  injectedPhantomAddress = null;
}

export async function fetchSolanaBalance(address: string): Promise<{
  lamports: number;
  sol: number;
}> {
  const pubkey = new PublicKey(address);
  const rawLamports = await connection.getBalance(pubkey, 'confirmed');
  const lamports = Number(rawLamports);
  return {
    lamports,
    sol: lamports / LAMPORTS_PER_SOL,
  };
}

function getActiveSolanaAddress(): string | null {
  if (account?.address) return account.address;
  if (injectedPhantomAddress) return injectedPhantomAddress;
  return null;
}

/**
 * Signs, broadcasts, and confirms a serialized Solana transaction via Wallet Standard
 * (`solana:signAndSendTransaction`), or injected Phantom Solana provider as fallback,
 * returning the confirmed base58 signature.
 */
export async function signAndSendTransaction(
  transactionBytes: Uint8Array
): Promise<string> {
  if (account && wallet) {
    const feature = (
      wallet.features as Record<string, unknown>
    )['solana:signAndSendTransaction'] as SolanaSignAndSendTransactionFeature | undefined;

    if (!feature) {
      throw new Error('Transaction sending is unavailable.');
    }

    const results = await feature.signAndSendTransaction({
      account,
      transaction: transactionBytes,
      chain: CHAIN,
    });

    if (!results || !results[0]?.signature) {
      throw new Error('Wallet did not return a transaction signature.');
    }

    const signature = bs58.encode(results[0].signature);
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');

    if (confirmation.value.err) {
      throw new Error('Transaction failed on the network.');
    }

    return signature;
  }

  if (injectedPhantom && injectedPhantomAddress) {
    const tx = VersionedTransaction.deserialize(transactionBytes);
    const { signature } = await injectedPhantom.signAndSendTransaction(tx, {
      preflightCommitment: 'confirmed',
    });
    if (!signature) {
      throw new Error('Phantom did not return a transaction signature.');
    }
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) {
      throw new Error('Transaction failed on the network.');
    }
    return signature;
  }

  throw new Error('Connect your wallet first.');
}

/**
 * Builds a VersionedTransaction for a real SOL transfer and executes it through
 * `signAndSendTransaction(transactionBytes)`.
 */
export async function sendSolTransfer(params: {
  recipientAddress: string;
  amountSol: number;
}): Promise<string> {
  const activeAddress = getActiveSolanaAddress();
  if (!activeAddress) {
    throw new Error('Connect your wallet first.');
  }

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(params.recipientAddress.trim());
  } catch {
    throw new Error('Enter a valid Solana recipient public address.');
  }

  const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Enter a valid SOL amount greater than 0.');
  }

  const payerKey = new PublicKey(activeAddress);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const transferIx = SystemProgram.transfer({
    fromPubkey: payerKey,
    toPubkey: recipientPubkey,
    lamports,
  });

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [transferIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  const transactionBytes = tx.serialize();

  return signAndSendTransaction(transactionBytes);
}

/**
 * Broadcasts a real signed Solana Memo transaction anchoring a Xypher wallet address
 * on Solana via `signAndSendTransaction(transactionBytes)`.
 */
export async function sendXypherSolanaLinkTx(xypherAddress: string): Promise<string> {
  const activeAddress = getActiveSolanaAddress();
  if (!activeAddress) {
    throw new Error('Connect your wallet first.');
  }
  const cleanAddr = xypherAddress.trim();
  if (!cleanAddr) {
    throw new Error('Provide a Xypher, MetaMask, or Phantom address to link on-chain.');
  }

  const payerKey = new PublicKey(activeAddress);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const memoBytes = new TextEncoder().encode(`XYPHER-LINK:${cleanAddr}`);

  const memoIx = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: payerKey, isSigner: true, isWritable: true }],
    data: Buffer.from(memoBytes),
  });

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: [memoIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  const transactionBytes = tx.serialize();

  return signAndSendTransaction(transactionBytes);
}
