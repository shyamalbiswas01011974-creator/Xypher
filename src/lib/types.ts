export type NetworkProfile = 'private-fast' | 'dev-medium' | 'main-spec';

export interface TxInData {
  prev_txid: string;
  index: number;
  pub: string;
  sig: string;
}

export interface TxOutData {
  value: number;
  addr: string;
}

export interface TxData {
  v: number;
  ins: TxInData[];
  outs: TxOutData[];
}

export interface BlockData {
  version: number;
  height: number;
  prev: string;
  time: number;
  target: string; // Hex string (64 chars) to preserve full 256-bit precision in JSON
  nonce: number;
  txs: TxData[];
}

export interface BlockExtraDataDecoded {
  hex: string;
  extraVanity: string;
  validatorBytes: string;
  gasTarget: number;
  baseFeeChangeDenominator: number;
  signedData: string;
  byteLength: number;
}

export interface BlockSummary {
  height: number;
  hash: string;
  prev: string;
  merkleRoot: string;
  time: number;
  target: string;
  difficulty: number;
  nonce: number;
  version: number;
  txCount: number;
  sizeBytes: number;
  subsidy: number;
  fees: number;
  minerAddress: string;
  fundAddress: string;
  extraData?: BlockExtraDataDecoded;
}

export interface BlockDetail extends BlockSummary {
  txs: Array<{
    txid: string;
    isCoinbase: boolean;
    v: number;
    ins: TxInData[];
    outs: TxOutData[];
    totalOut: number;
    fee: number;
  }>;
}

export interface MempoolTxItem {
  txid: string;
  tx: TxData;
  fee: number;
  totalOut: number;
  addedAt: number;
  sizeBytes: number;
}

export interface UtxoItem {
  txid: string;
  index: number;
  value: number;
  addr: string;
  height: number;
  isCoinbase: boolean;
  confirmations: number;
  spendable: boolean;
  blocksUntilMature: number;
}

export interface AddressTxHistoryItem {
  txid: string;
  blockHeight: number | null; // null if in mempool
  blockHash: string | null;
  time: number;
  direction: 'received' | 'sent' | 'mined' | 'self';
  netChange: number;
  fee: number;
  isCoinbase: boolean;
  confirmations: number;
  counterparties: string[];
}

export interface AddressInfo {
  address: string;
  total: number;
  spendable: number;
  immature: number;
  utxos: UtxoItem[];
  history: AddressTxHistoryItem[];
}

export interface TransferAccountingReceipt {
  txid: string;
  blockHeight: number | null;
  fromAddress: string;
  toAddress: string;
  amountUnits: number;
  feeUnits: number;
  senderBefore: number;
  senderAfter: number;
  receiverBefore: number;
  receiverAfter: number;
  verifiedSufficientBalance: boolean;
}

export interface BalanceVerificationResult {
  sufficient: boolean;
  fromAddress: string;
  toAddress: string | null;
  availableUnits: number;
  requiredUnits: number;
  amountUnits: number;
  feeUnits: number;
  shortfallUnits: number;
  senderAfterUnits: number;
  receiverBeforeUnits: number | null;
  receiverAfterUnits: number | null;
  message: string;
}

export interface ChainInfo {
  name: string;
  networkName?: string;
  symbol: string;
  decimals: number;
  unit: number;
  chainId: number;
  chainIdHex: string;
  networkFeeUnits?: number;
  networkFeeXyph?: number;
  gasPriceHex?: string;
  profile: NetworkProfile;
  profileLabel: string;
  height: number;
  tip: string;
  supply: number;
  maxSupply: number;
  maxBlocks: number;
  blocksLeft: number;
  nextSubsidy: number;
  minerShare: number;
  fundShare: number;
  halvingInterval: number;
  retargetInterval: number;
  targetBlockTime: number;
  maturity: number;
  targetHex: string;
  difficulty: number;
  mempoolCount: number;
  utxoCount: number;
  fundAddress: string;
}

export interface LocalWalletAccount {
  id: string;
  label: string;
  address: string;
  evmAddress: string;
  pubHex: string;
  wif: string;
  createdAt: number;
}

export interface SelfTestResultItem {
  name: string;
  passed: boolean;
  detail: string;
  durationMs: number;
}

export interface ActivityEvent {
  id: string;
  time: number;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface PaymentConfig {
  merchantName: string;
  upiId: string;
  qrImagePath: string;
  rateXyphPerInr: number;
  minInr: number;
  maxInr: number;
  minSellXyph: number;
  treasuryXyphAddress: string;
  treasuryEvmAddress: string;
  adminConfigured: boolean;
  adminAuthMode: 'env' | 'claimed' | 'unconfigured';
}

export interface PaymentOrder {
  id: string;
  inrAmount: number;
  xyphAmount: number;
  xyphUnits: number;
  executionPriceInr?: number;
  recipientInput: string;
  recipientXyph: string;
  recipientEvm: string;
  payerName: string;
  utr: string;
  status: 'pending' | 'completed' | 'rejected';
  createdAt: number;
  updatedAt: number;
  txid: string | null;
  blockHeight: number | null;
  rejectionReason: string | null;
}

export interface PaymentAdminSummary {
  totalOrders: number;
  pendingCount: number;
  completedCount: number;
  rejectedCount: number;
  totalInrReceived: number;
  totalXyphDisbursed: number;
}

export interface MarketPricePoint {
  time: number;
  priceInr: number;
  side?: 'launch' | 'buy' | 'sell';
  xyphAmount?: number;
  inrAmount?: number;
}

export interface MarketTradeEvent {
  id: string;
  side: 'buy' | 'sell';
  xyphAmount: number;
  inrAmount: number;
  priceBeforeInr: number;
  executionPriceInr: number;
  priceAfterInr: number;
  priceImpactPercent: number;
  traderLabel: string;
  walletAddress: string;
  txid: string | null;
  time: number;
}

export interface MarketTicker {
  symbol: string;
  name: string;
  priceInr: number;
  priceUsd: number;
  buyPriceInr: number;
  sellPriceInr: number;
  xyphPerInr: number;
  open24hInr: number;
  change24hPercent: number;
  high24hInr: number;
  low24hInr: number;
  volume24hXyph: number;
  volume24hInr: number;
  buyVolume24hXyph: number;
  buyVolume24hInr: number;
  buyCount24h: number;
  sellVolume24hXyph: number;
  sellVolume24hInr: number;
  sellCount24h: number;
  totalBoughtXyph: number;
  totalSoldXyph: number;
  totalBuyTrades: number;
  totalSellTrades: number;
  netFlowXyph: number;
  buyPressurePercent: number;
  uniqueTradersCount: number;
  pendingBuyCount: number;
  pendingBuyInr: number;
  pendingBuyXyph: number;
  poolInrReserve: number;
  poolXyphReserve: number;
  ammSpotInr?: number;
  scarcityMultiplier?: number;
  demandMultiplier?: number;
  supplyDemandIndex?: number;
  supplyBaselineXyph?: number;
  marketRegime?: string;
  pricingEngine?: string;
  lastTradeSide: 'buy' | 'sell' | null;
  lastTradeImpactPercent: number;
  marketCapInr: number;
  circulatingSupplyXyph: number;
  treasuryXyphAddress: string;
  treasuryEvmAddress: string;
  updatedAt: number;
  history: MarketPricePoint[];
  recentTrades: MarketTradeEvent[];
}

export type SellPayoutMethod = 'upi' | 'bank';

export interface SellOrder {
  id: string;
  sellerXyph: string;
  sellerEvm: string;
  xyphAmount: number;
  xyphUnits: number;
  executionPriceInr: number;
  inrPayout: number;
  payoutMethod: SellPayoutMethod;
  upiId: string;
  bankAccountNumber?: string;
  bankAccountMasked?: string;
  bankIfsc?: string;
  bankName?: string;
  accountHolderName?: string;
  sellerName: string;
  depositTxid: string;
  status: 'pending_payout' | 'paid' | 'refunded';
  createdAt: number;
  updatedAt: number;
  payoutUtr: string | null;
  refundTxid: string | null;
  note: string | null;
}

export interface SellAdminSummary {
  totalSellOrders: number;
  pendingPayoutCount: number;
  paidCount: number;
  refundedCount: number;
  totalXyphSold: number;
  totalInrPaidOut: number;
  pendingInrOwed: number;
}

export interface DeployedContractRecord {
  id: string;
  contractAddress: string;
  txHash: string;
  deployerAddress: string;
  chainId: number;
  chainIdHex: string;
  networkName: string;
  explorerUrl: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
  solcVersion: string;
  deployedAt: number;
}

export interface MinedBlockRecord {
  height: number;
  hash: string;
  txid: string;
  minerAddress: string;
  rewardUnits: number;
  hashes: number;
  elapsedMs: number;
  time: number;
  era: number;
}

export interface MiningHalvingEra {
  era: number;
  yearsLabel: string;
  startBlock: number;
  endBlock: number;
  rewardUnits: number;
}

export interface MiningStatus {
  active: boolean;
  minerAddress: string | null;
  minerEvmAddress: string | null;
  startedAtMs: number | null;
  nextBlockAtMs: number | null;
  remainingMs: number;
  blockTimeSec: number;
  halvingYears: number;
  halvingIntervalBlocks: number;
  currentHeight: number;
  currentEra: number;
  currentRewardUnits: number;
  nextHalvingBlock: number;
  nextHalvingRewardUnits: number;
  blocksUntilHalving: number;
  yearsUntilHalving: number;
  blocksMined: number;
  totalRewardUnits: number;
  sealingNow: boolean;
  lastError: string | null;
  recentMinedBlocks: MinedBlockRecord[];
  halvingSchedule: MiningHalvingEra[];
}

export interface CryptoExchangeAsset {
  symbol: import('./supportedCoins.ts').SupportedCoinSymbol;
  name: string;
  network: string;
  standard: string;
  addressFormatLabel: string;
  collectionAddress: string;
  collectionXyphAddress?: string;
  evmChainId?: number;
  evmChainIdHex?: string;
  priceUsd: number;
  priceInr: number;
  xyphPerCoin: number;
  decimals: number;
  minAmount: number;
  accentColor: string;
  addressPlaceholder: string;
  txHashPlaceholder: string;
  explorerTxPrefix?: string;
  paymentUriScheme?: string;
  totalCollectedAmount: number;
  totalCollectedUsd: number;
  collectedTxCount: number;
  priceSource: 'live' | 'reference';
}

export interface CryptoExchangeOrder {
  id: string;
  kind: 'buy_xyph' | 'swap' | 'transfer';
  fromCoin: import('./supportedCoins.ts').SupportedCoinSymbol;
  toCoin: import('./supportedCoins.ts').SupportedCoinSymbol;
  fromAmount: number;
  toAmount: number;
  fromPriceUsd: number;
  toPriceUsd: number;
  usdValue: number;
  inrValue: number;
  collectionAddress: string;
  depositTxHash: string;
  recipientAddress: string;
  recipientXyph?: string | null;
  settlementTxid: string | null;
  settlementBlockHeight: number | null;
  payoutFromAddress?: string | null;
  payoutMethod?: 'onchain_xyph' | 'metamask_evm' | 'phantom_sol' | 'tronlink_trx' | 'external_wallet';
  payoutVerifiedOnChain?: boolean;
  tokenContractAddress?: string | null;
  metamaskDelivered?: boolean;
  status: 'completed' | 'pending_payout';
  createdAt: number;
  updatedAt: number;
  note?: string | null;
}

export interface MetaMaskTokenDelivery {
  txHash: string;
  blockHeight: number;
  contractAddress: string;
  symbol: import('./supportedCoins.ts').SupportedCoinSymbol;
  name: string;
  decimals: number;
  toEvm: string;
  amount: number;
  balanceBefore: string;
  balanceAfter: string;
}

export interface MetaMaskTokenBalanceItem {
  symbol: import('./supportedCoins.ts').SupportedCoinSymbol;
  name: string;
  contractAddress: string;
  decimals: number;
  balanceRaw: string;
  balanceFormatted: string;
  balanceNumeric: number;
}

export interface CryptoVaultSummary {
  totalOrders: number;
  completedOrders: number;
  pendingPayoutOrders: number;
  totalCollectedUsd: number;
  totalXyphDisbursed: number;
  byCoin: Record<string, { amount: number; usd: number; count: number; collectionAddress: string }>;
}

export interface CppCoreSourceEntry {
  id: string;
  relativePath: string;
  title: string;
  role: string;
}

export interface CppCoreStatus {
  info: {
    available: boolean;
    binaryPath: string;
    engine: string;
    architecture: string;
    cppStandard: string;
    compiler: string;
    networkName: string;
    symbol: string;
    chainId: number;
    coinUnits: number;
    targetBlockTimeSec: number;
    initialSubsidyXyph: number;
    halvingIntervalBlocks: number;
    halvingYears: number;
    minNetworkFeeXyph: number;
    maxBlocks: number;
    maxMoneyXyph: number;
  };
  spot: {
    engine: string;
    ammSpotInr: number;
    scarcityMultiplier: number;
    demandMultiplier: number;
    supplyDemandIndex: number;
    spotPriceInr: number;
    spotPriceUsd: number;
    buyPressurePercent: number;
    marketCapInr: number;
    marketCapUsd: number;
    marketRegime: string;
  };
  liveInputs: {
    inrReserve: number;
    xyphReserve: number;
    circulatingSupplyXyph: number;
    supplyBaselineXyph: number;
    totalBoughtXyph: number;
    totalSoldXyph: number;
  };
  sourceFiles: CppCoreSourceEntry[];
}

export interface CppCoreQuoteResponse {
  engine: string;
  side: 'buy' | 'sell';
  inputAmount: number;
  outputAmount: number;
  spotBeforeInr: number;
  spotAfterInr: number;
  spotAfterUsd: number;
  executionPriceInr: number;
  priceImpactPercent: number;
  newInrReserve: number;
  newXyphReserve: number;
  newTotalBoughtXyph: number;
  newTotalSoldXyph: number;
  scarcityMultiplier: number;
  demandMultiplier: number;
  marketRegime: string;
}

export interface CppCoreSelfTestResponse {
  engine: string;
  allPassed: boolean;
  durationMs: number;
  tests: Array<{ name: string; passed: boolean; detail: string }>;
}

export interface CppCoreBenchmarkResponse {
  engine: string;
  iterations: number;
  durationMs: number;
  hashesPerSec: number;
  sampleHash: string;
}

export interface CppBlockLinkAudit {
  height: number;
  hash: string;
  hashLength: number;
  prevHash: string;
  prevHashLength: number;
  expectedPrevHash: string;
  merkleRoot: string;
  timestamp: number;
  nonce: number;
  txCount: number;
  isGenesis: boolean;
  genesisPrevAllZeros: boolean;
  hashValid64: boolean;
  prevHashValid64: boolean;
  linkValid: boolean;
  merkleValid: boolean;
  powValid: boolean;
  blockValid: boolean;
  error: string;
}

export interface CppChainVerificationReport {
  engine: string;
  mode: string;
  valid: boolean;
  hashHexLength: number;
  genesisPrevHash: string;
  blockCount: number;
  validLinks: number;
  brokenLinks: number;
  firstBrokenHeight: number;
  tamperedHeight: number;
  totalLiveBlocks?: number;
  tipHeight?: number;
  blocks: CppBlockLinkAudit[];
}



