import { evmToXypherAddress, isValidAddress, isValidEvmAddress } from './xypherCrypto.ts';

export type SupportedCoinSymbol =
  | 'ETH'
  | 'SOL'
  | 'BTC'
  | 'TRX'
  | 'BNB'
  | 'POL'
  | 'MON'
  | 'XLM'
  | 'XYPH';

export interface SupportedCoinDefinition {
  symbol: SupportedCoinSymbol;
  name: string;
  network: string;
  standard: string;
  addressFormatLabel: string;
  collectionAddress: string;
  /** Native Xypher Base58Check mirror for XYPH collection vault */
  collectionXyphAddress?: string;
  /** Canonical ERC-20 contract address on XYPH Network (Chain ID 5790032) for real MetaMask delivery */
  xyphTokenContract?: string;
  /** Standard ERC-20 decimals used on XYPH Network for MetaMask tracking */
  tokenDecimals: number;
  evmChainId?: number;
  evmChainIdHex?: string;
  coingeckoId?: string;
  fallbackUsdPrice: number;
  decimals: number;
  minAmount: number;
  accentColor: string;
  addressPlaceholder: string;
  txHashPlaceholder: string;
  explorerTxPrefix?: string;
  paymentUriScheme?: string;
}

/**
 * Verified collection vault addresses matched strictly to each blockchain's
 * native cryptographic address format:
 * - EVM (0x... 42-char EIP-55): ETH, BNB, POL, MON, XLM (EVM Bridge), XYPH (XYPH Network)
 * - Bitcoin Native SegWit (bc1q... Bech32): BTC
 * - Solana Ed25519 (Base58 44-char): SOL
 * - TRON Base58Check (T... 34-char): TRX
 */
export const EVM_COLLECTION_ADDRESS = '0x41d5D2Ce47a9Bab12676f55a76AAd74F14236c91';
export const BTC_COLLECTION_ADDRESS = 'bc1qxy2zk60w6cmcpekxqfhfjrrs7mspglrmj8pr6s';
export const SOL_COLLECTION_ADDRESS = 'Hmkiz3KxkWcKySbXeJSovJRJarCzEbQe2Chvc3BGyZzQ';
export const TRX_COLLECTION_ADDRESS = 'TLVkcAx9t3B6xKiKuFt138Rsfpgz3jrXEh';
export const XYPH_COLLECTION_NATIVE_ADDRESS = evmToXypherAddress(EVM_COLLECTION_ADDRESS);

export const SUPPORTED_EXCHANGE_COINS: SupportedCoinDefinition[] = [
  {
    symbol: 'ETH',
    name: 'Ethereum',
    network: 'Ethereum Mainnet',
    standard: 'ERC-20 / Native EVM',
    addressFormatLabel: 'EVM 0x Address',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000001',
    tokenDecimals: 18,
    evmChainId: 1,
    evmChainIdHex: '0x1',
    coingeckoId: 'ethereum',
    fallbackUsdPrice: 3120,
    decimals: 6,
    minAmount: 0.0005,
    accentColor: '#627EEA',
    addressPlaceholder: '0x...',
    txHashPlaceholder: '0x... (64-hex Ethereum tx hash)',
    explorerTxPrefix: 'https://etherscan.io/tx/',
    paymentUriScheme: 'ethereum',
  },
  {
    symbol: 'SOL',
    name: 'Solana',
    network: 'Solana Mainnet',
    standard: 'SPL / Native SOL',
    addressFormatLabel: 'Solana Base58 or MetaMask 0x',
    collectionAddress: SOL_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000002',
    tokenDecimals: 9,
    coingeckoId: 'solana',
    fallbackUsdPrice: 185,
    decimals: 5,
    minAmount: 0.01,
    accentColor: '#14F195',
    addressPlaceholder: '0x... (MetaMask) or Solana Base58 address',
    txHashPlaceholder: 'Solana transaction signature (Base58)',
    explorerTxPrefix: 'https://solscan.io/tx/',
    paymentUriScheme: 'solana',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    network: 'Bitcoin Mainnet',
    standard: 'Native SegWit / XYPH ERC-20',
    addressFormatLabel: 'Bitcoin bc1q or MetaMask 0x',
    collectionAddress: BTC_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000003',
    tokenDecimals: 8,
    coingeckoId: 'bitcoin',
    fallbackUsdPrice: 92500,
    decimals: 8,
    minAmount: 0.00002,
    accentColor: '#F7931A',
    addressPlaceholder: '0x... (MetaMask) or bc1q... Bitcoin address',
    txHashPlaceholder: '64-character Bitcoin txid',
    explorerTxPrefix: 'https://mempool.space/tx/',
    paymentUriScheme: 'bitcoin',
  },
  {
    symbol: 'TRX',
    name: 'Tron',
    network: 'TRON Mainnet',
    standard: 'TRC-20 / XYPH ERC-20',
    addressFormatLabel: 'TRON T-Address or MetaMask 0x',
    collectionAddress: TRX_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000004',
    tokenDecimals: 6,
    coingeckoId: 'tron',
    fallbackUsdPrice: 0.24,
    decimals: 4,
    minAmount: 5,
    accentColor: '#EF0027',
    addressPlaceholder: '0x... (MetaMask) or T... TRON address',
    txHashPlaceholder: '64-character TRON transaction hash',
    explorerTxPrefix: 'https://tronscan.org/#/transaction/',
  },
  {
    symbol: 'BNB',
    name: 'BNB',
    network: 'BNB Smart Chain',
    standard: 'BEP-20 / Native BNB',
    addressFormatLabel: 'EVM 0x Address (BSC)',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000005',
    tokenDecimals: 18,
    evmChainId: 56,
    evmChainIdHex: '0x38',
    coingeckoId: 'binancecoin',
    fallbackUsdPrice: 640,
    decimals: 5,
    minAmount: 0.002,
    accentColor: '#F3BA2F',
    addressPlaceholder: '0x... (BNB Smart Chain / MetaMask address)',
    txHashPlaceholder: '0x... (64-hex BSC tx hash)',
    explorerTxPrefix: 'https://bscscan.com/tx/',
  },
  {
    symbol: 'POL',
    name: 'Polygon',
    network: 'Polygon PoS',
    standard: 'Native POL (EVM)',
    addressFormatLabel: 'EVM 0x Address (Polygon)',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000006',
    tokenDecimals: 18,
    evmChainId: 137,
    evmChainIdHex: '0x89',
    coingeckoId: 'polygon-ecosystem-token',
    fallbackUsdPrice: 0.42,
    decimals: 4,
    minAmount: 2,
    accentColor: '#8247E5',
    addressPlaceholder: '0x... (Polygon PoS / MetaMask address)',
    txHashPlaceholder: '0x... (64-hex PolygonScan tx hash)',
    explorerTxPrefix: 'https://polygonscan.com/tx/',
  },
  {
    symbol: 'MON',
    name: 'Monad',
    network: 'Monad Network',
    standard: 'Native MON (EVM)',
    addressFormatLabel: 'EVM 0x Address (Monad)',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000007',
    tokenDecimals: 18,
    evmChainId: 143,
    evmChainIdHex: '0x8f',
    coingeckoId: 'monad',
    fallbackUsdPrice: 1.85,
    decimals: 4,
    minAmount: 0.5,
    accentColor: '#836EF9',
    addressPlaceholder: '0x... (Monad / MetaMask address)',
    txHashPlaceholder: '0x... (64-hex Monad tx hash)',
  },
  {
    symbol: 'XLM',
    name: 'Stellar',
    network: 'Stellar / Wrapped XLM (EVM)',
    standard: 'Wrapped XLM EVM / Stellar',
    addressFormatLabel: 'EVM 0x or Stellar G-Address',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    xyphTokenContract: '0x5859500000000000000000000000000000000008',
    tokenDecimals: 7,
    coingeckoId: 'stellar',
    fallbackUsdPrice: 0.36,
    decimals: 4,
    minAmount: 3,
    accentColor: '#38BDF8',
    addressPlaceholder: '0x... (MetaMask) or G... Stellar address',
    txHashPlaceholder: '64-hex Stellar or 0x... EVM tx hash',
    explorerTxPrefix: 'https://stellarchain.io/transactions/',
  },
  {
    symbol: 'XYPH',
    name: 'Xypher',
    network: 'XYPH Network',
    standard: 'Native XYPH (Chain ID 5790032)',
    addressFormatLabel: 'XYPH 0x & Native Base58',
    collectionAddress: EVM_COLLECTION_ADDRESS,
    collectionXyphAddress: XYPH_COLLECTION_NATIVE_ADDRESS,
    tokenDecimals: 8,
    evmChainId: 5790032,
    evmChainIdHex: '0x585950',
    fallbackUsdPrice: 0.000119,
    decimals: 4,
    minAmount: 10,
    accentColor: '#F59E0B',
    addressPlaceholder: '0x... or Xypher Base58Check address',
    txHashPlaceholder: '0x... or 64-hex XYPH txid',
  },
];

export const SUPPORTED_COIN_MAP: Record<SupportedCoinSymbol, SupportedCoinDefinition> =
  SUPPORTED_EXCHANGE_COINS.reduce(
    (acc, coin) => {
      acc[coin.symbol] = coin;
      return acc;
    },
    {} as Record<SupportedCoinSymbol, SupportedCoinDefinition>
  );

export const EXTERNAL_PAYMENT_COINS: SupportedCoinDefinition[] = SUPPORTED_EXCHANGE_COINS.filter(
  (c) => c.symbol !== 'XYPH'
);

export function isSupportedCoinSymbol(val: string): val is SupportedCoinSymbol {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_COIN_MAP, val.toUpperCase());
}

export function validateCoinAddress(symbol: SupportedCoinSymbol, raw: string): boolean {
  const addr = raw.trim();
  if (!addr) return false;
  switch (symbol) {
    case 'ETH':
    case 'BNB':
    case 'POL':
    case 'MON':
      return isValidEvmAddress(addr);
    case 'XYPH':
      return isValidEvmAddress(addr) || isValidAddress(addr);
    case 'BTC':
      return (
        /^bc1[ac-hj-np-z02-9]{25,62}$/i.test(addr) ||
        /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr)
      );
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    case 'TRX':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
    case 'XLM':
      return /^G[A-Z2-7]{55}$/.test(addr) || isValidEvmAddress(addr);
    default:
      return false;
  }
}

export function validateCoinRecipientOrMetaMask(symbol: SupportedCoinSymbol, raw: string): boolean {
  const addr = raw.trim();
  if (!addr) return false;
  return validateCoinAddress(symbol, addr) || isValidEvmAddress(addr);
}

export function validateCoinTxHash(symbol: SupportedCoinSymbol, raw: string): boolean {
  const hash = raw.trim();
  if (!hash) return false;
  switch (symbol) {
    case 'ETH':
    case 'BNB':
    case 'POL':
    case 'MON':
      return /^0x[0-9a-fA-F]{64}$/.test(hash);
    case 'BTC':
    case 'TRX':
      return /^[0-9a-fA-F]{64}$/.test(hash);
    case 'SOL':
      return /^[1-9A-HJ-NP-Za-km-z]{43,90}$/.test(hash);
    case 'XLM':
      return /^[0-9a-fA-F]{64}$/.test(hash) || /^0x[0-9a-fA-F]{64}$/.test(hash);
    case 'XYPH':
      return /^(0x)?[0-9a-fA-F]{64}$/.test(hash);
    default:
      return false;
  }
}

export function formatCoinAmount(amount: number, symbol: SupportedCoinSymbol): string {
  const def = SUPPORTED_COIN_MAP[symbol];
  if (!Number.isFinite(amount)) return '0';
  const maxDec = def ? def.decimals : 4;
  if (amount >= 1000) {
    return amount.toLocaleString(undefined, { maximumFractionDigits: Math.min(2, maxDec) });
  }
  if (amount >= 1) {
    return amount.toLocaleString(undefined, { maximumFractionDigits: Math.min(4, maxDec) });
  }
  return amount.toFixed(Math.min(6, maxDec)).replace(/\.?0+$/, '') || '0';
}
