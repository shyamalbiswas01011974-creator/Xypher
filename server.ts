import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { XypherNode } from './src/lib/blockchain.ts';
import type {
  BlockData,
  CryptoExchangeAsset,
  CryptoExchangeOrder,
  CryptoVaultSummary,
  DeployedContractRecord,
  MarketPricePoint,
  MarketTicker,
  MarketTradeEvent,
  MinedBlockRecord,
  MiningHalvingEra,
  MiningStatus,
  NetworkProfile,
  PaymentAdminSummary,
  PaymentOrder,
  SellAdminSummary,
  SellOrder,
  TxData,
} from './src/lib/types.ts';
import {
  SUPPORTED_COIN_MAP,
  SUPPORTED_EXCHANGE_COINS,
  XYPH_COLLECTION_NATIVE_ADDRESS,
  type SupportedCoinSymbol,
  isSupportedCoinSymbol,
  validateCoinAddress,
  validateCoinRecipientOrMetaMask,
  validateCoinTxHash,
} from './src/lib/supportedCoins.ts';
import {
  INITIAL_POOL_INR_RESERVE,
  INITIAL_POOL_XYPH_RESERVE,
} from './src/lib/marketMath.ts';
import {
  CPP_SOURCE_CATALOG,
  type CppMarketInput,
  evaluateSpotCpp,
  getCppCoreInfo,
  quoteBuyCpp,
  quoteSellCpp,
  readCppSourceFile,
  runCppBenchmarkPow,
  runCppChainDemo,
  runCppSelfTest,
  verifyLiveChainLinksCpp,
} from './src/lib/cppCoreBridge.ts';
import { ZERO_FEE_RPC_BY_SLUG } from './src/lib/xypherTokenContract.ts';
import {
  BLOCK_SUBSIDY,
  HALVING_INTERVAL_BLOCKS,
  HALVING_YEARS,
  MAX_BLOCKS,
  MINING_BLOCK_TIME_SEC,
  NAME,
  NETWORK_FEE_UNITS,
  NETWORK_FEE_XYPH,
  NETWORK_NAME,
  PROFILE_CONFIGS,
  SYMBOL,
  UNIT,
  XYPH_EVM_GAS_PRICE_HEX,
  XYPHER_CHAIN_ID,
  XYPHER_CHAIN_ID_HEX,
  addressFromPubkey,
  computeTxid,
  hexToBytes,
  isValidEvmAddress,
  normalizeToXypherAddress,
  xypherToEvmAddress,
} from './src/lib/xypherCrypto.ts';

function resolveServerPort(): number {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    } else if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
    }
  }
  if (process.env.NODE_ENV === 'production') {
    const prodPort = Number(process.env.PORT);
    if (Number.isInteger(prodPort) && prodPort > 0 && prodPort < 65536) return prodPort;
    return 3000;
  }
  const devPort = Number(process.env.DEFAULT_APP_PORT);
  if (Number.isInteger(devPort) && devPort > 0 && devPort < 65536) return devPort;
  return 3000;
}

const PORT = resolveServerPort();
const DATA_DIR = path.resolve(process.cwd(), process.env.XYPH_DATA || 'xypher-data');
const GATEWAY_AUTH_PATH = path.resolve(DATA_DIR, 'gateway-auth.json');
const MERCHANT_AUTH_PATH = path.resolve(DATA_DIR, 'merchant-auth.json');
const PAYMENT_ORDERS_PATH = path.resolve(DATA_DIR, 'payment-orders.json');
const SELL_ORDERS_PATH = path.resolve(DATA_DIR, 'sell-orders.json');
const MARKET_STATE_PATH = path.resolve(DATA_DIR, 'market-state.json');
const DEPLOYMENTS_PATH = path.resolve(DATA_DIR, 'deployments.json');
const MINING_STATE_PATH = path.resolve(DATA_DIR, 'mining-state.json');
const CRYPTO_EXCHANGE_ORDERS_PATH = path.resolve(DATA_DIR, 'crypto-exchange-orders.json');
if (
  !GATEWAY_AUTH_PATH.startsWith(DATA_DIR + path.sep) ||
  !MERCHANT_AUTH_PATH.startsWith(DATA_DIR + path.sep) ||
  !PAYMENT_ORDERS_PATH.startsWith(DATA_DIR + path.sep) ||
  !SELL_ORDERS_PATH.startsWith(DATA_DIR + path.sep) ||
  !MARKET_STATE_PATH.startsWith(DATA_DIR + path.sep) ||
  !DEPLOYMENTS_PATH.startsWith(DATA_DIR + path.sep) ||
  !MINING_STATE_PATH.startsWith(DATA_DIR + path.sep) ||
  !CRYPTO_EXCHANGE_ORDERS_PATH.startsWith(DATA_DIR + path.sep)
) {
  throw new Error('Invalid data storage path');
}

const MERCHANT_CONFIG = {
  merchantName: 'Arya Biswas',
  upiId: 'aryabiswas@yesfam',
  qrImagePath: '/assets/aistudio/WhatsApp_Image_2026-11-21_at_4.30.20_PM_00d00dfc.jpeg',
  rateXyphPerInr: 100,
  minInr: 1,
  maxInr: 10000,
  minSellXyph: 1,
} as const;

const MERCHANT_SESSION_SECRET =
  (process.env.MERCHANT_SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const MERCHANT_SESSION_TTL_SEC = 12 * 60 * 60; // 12 hours

const node = new XypherNode(process.env.XYPH_DATA || 'xypher-data');

interface PublicPeerRecord {
  id: string;
  url: string;
  label: string;
  addedAt: number;
  lastSeenHeight: number | null;
  status: 'registered' | 'reachable' | 'unreachable';
}

interface StoredGatewayHash {
  salt: string;
  hash: string;
  activatedAt: number;
}

const registeredPeers: Map<string, PublicPeerRecord> = new Map();

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getEnvPublicApiKey(): string {
  return (process.env.XYPHER_NETWORK_API_KEY || '').trim();
}

function loadClaimedGatewayHash(): StoredGatewayHash | null {
  try {
    if (!fs.existsSync(GATEWAY_AUTH_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(GATEWAY_AUTH_PATH, 'utf-8'));
    if (typeof raw?.salt === 'string' && typeof raw?.hash === 'string') {
      return raw as StoredGatewayHash;
    }
    return null;
  } catch {
    return null;
  }
}

function saveClaimedGatewayHash(apiKey: string): StoredGatewayHash {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(apiKey, salt, 64).toString('hex');
  const record: StoredGatewayHash = { salt, hash, activatedAt: Math.floor(Date.now() / 1000) };
  const tmpPath = GATEWAY_AUTH_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, GATEWAY_AUTH_PATH);
  return record;
}

function getGatewayAuthMode(): 'env' | 'claimed' | 'unconfigured' {
  if (getEnvPublicApiKey().length > 0) return 'env';
  if (loadClaimedGatewayHash() !== null) return 'claimed';
  return 'unconfigured';
}

function verifyPublicApiKey(supplied: string): boolean {
  if (!supplied) return false;
  const envKey = getEnvPublicApiKey();
  if (envKey.length > 0) {
    return timingSafeCompare(supplied, envKey);
  }
  const claimed = loadClaimedGatewayHash();
  if (!claimed) return false;
  const derived = crypto.scryptSync(supplied, claimed.salt, 64);
  const stored = Buffer.from(claimed.hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

// =====================================================================
// UPI PAYMENT ORDERS & MERCHANT ADMIN AUTH (₹1 = 100 XYPH)
// =====================================================================
function getEnvMerchantPasscode(): string {
  return (process.env.MERCHANT_ADMIN_PASSCODE || '').trim();
}

function loadClaimedMerchantHash(): StoredGatewayHash | null {
  try {
    if (!fs.existsSync(MERCHANT_AUTH_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(MERCHANT_AUTH_PATH, 'utf-8'));
    if (typeof raw?.salt === 'string' && typeof raw?.hash === 'string') {
      return raw as StoredGatewayHash;
    }
    return null;
  } catch {
    return null;
  }
}

function saveClaimedMerchantHash(passcode: string): StoredGatewayHash {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(passcode, salt, 64).toString('hex');
  const record: StoredGatewayHash = { salt, hash, activatedAt: Math.floor(Date.now() / 1000) };
  const tmpPath = MERCHANT_AUTH_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
  fs.renameSync(tmpPath, MERCHANT_AUTH_PATH);
  return record;
}

function getMerchantAuthMode(): 'env' | 'claimed' | 'unconfigured' {
  if (getEnvMerchantPasscode().length > 0) return 'env';
  if (loadClaimedMerchantHash() !== null) return 'claimed';
  return 'unconfigured';
}

function verifyMerchantPasscode(supplied: string): boolean {
  if (!supplied) return false;
  const envCode = getEnvMerchantPasscode();
  if (envCode.length > 0) {
    return timingSafeCompare(supplied, envCode);
  }
  const claimed = loadClaimedMerchantHash();
  if (!claimed) return false;
  const derived = crypto.scryptSync(supplied, claimed.salt, 64);
  const stored = Buffer.from(claimed.hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

function issueMerchantToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'merchant_admin',
      exp: Math.floor(Date.now() / 1000) + MERCHANT_SESSION_TTL_SEC,
      jti: crypto.randomBytes(8).toString('hex'),
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', MERCHANT_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyMerchantToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', MERCHANT_SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (!timingSafeCompare(sig, expectedSig)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      role?: string;
      exp?: number;
    };
    return (
      decoded.role === 'merchant_admin' &&
      typeof decoded.exp === 'number' &&
      decoded.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

function requireMerchantAdmin(req: Request, res: Response, next: NextFunction) {
  const mode = getMerchantAuthMode();
  if (mode === 'unconfigured') {
    return res.status(503).json({
      error: 'Merchant Admin passcode is not configured yet. Set up your passcode on the Merchant Desk first.',
    });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token || !verifyMerchantToken(token)) {
    return res.status(401).json({ error: 'Merchant Admin sign-in required or session expired' });
  }
  return next();
}

function loadPaymentOrders(): PaymentOrder[] {
  try {
    if (!fs.existsSync(PAYMENT_ORDERS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(PAYMENT_ORDERS_PATH, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as PaymentOrder[]) : [];
  } catch {
    return [];
  }
}

function savePaymentOrders(orders: PaymentOrder[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = PAYMENT_ORDERS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(orders, null, 2), 'utf-8');
  fs.renameSync(tmpPath, PAYMENT_ORDERS_PATH);
}

const paymentOrders: PaymentOrder[] = loadPaymentOrders();
const approvingOrderIds = new Set<string>();

function loadSellOrders(): SellOrder[] {
  try {
    if (!fs.existsSync(SELL_ORDERS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(SELL_ORDERS_PATH, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as SellOrder[]) : [];
  } catch {
    return [];
  }
}

function saveSellOrders(orders: SellOrder[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = SELL_ORDERS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(orders, null, 2), 'utf-8');
  fs.renameSync(tmpPath, SELL_ORDERS_PATH);
}

function maskBankAccountNumber(acct: string): string {
  const clean = acct.replace(/\s+/g, '');
  if (clean.length <= 4) return clean;
  return `${'•'.repeat(Math.max(4, clean.length - 4))}${clean.slice(-4)}`;
}

function sanitizeSellOrderForPublic(order: SellOrder): SellOrder {
  const { bankAccountNumber: _rawAcct, ...safe } = order;
  return {
    ...safe,
    payoutMethod: safe.payoutMethod || 'upi',
    bankAccountMasked:
      safe.bankAccountMasked ||
      (_rawAcct ? maskBankAccountNumber(_rawAcct) : undefined),
  };
}

const sellOrders: SellOrder[] = loadSellOrders();
const settlingSellIds = new Set<string>();

function computeSellSummary(orders: SellOrder[]): SellAdminSummary {
  let pendingPayoutCount = 0;
  let paidCount = 0;
  let refundedCount = 0;
  let totalXyphSold = 0;
  let totalInrPaidOut = 0;
  let pendingInrOwed = 0;
  for (const o of orders) {
    if (o.status === 'pending_payout') {
      pendingPayoutCount++;
      totalXyphSold += o.xyphAmount;
      pendingInrOwed += o.inrPayout;
    } else if (o.status === 'paid') {
      paidCount++;
      totalXyphSold += o.xyphAmount;
      totalInrPaidOut += o.inrPayout;
    } else if (o.status === 'refunded') {
      refundedCount++;
    }
  }
  return {
    totalSellOrders: orders.length,
    pendingPayoutCount,
    paidCount,
    refundedCount,
    totalXyphSold: Number(totalXyphSold.toFixed(4)),
    totalInrPaidOut: Number(totalInrPaidOut.toFixed(2)),
    pendingInrOwed: Number(pendingInrOwed.toFixed(2)),
  };
}

// =====================================================================
// REAL LIVE BUY/SELL DRIVEN MARKET ENGINE (Constant-Product AMM x*y=k)
// Price moves UP strictly when people BUY and DOWN strictly when people SELL.
// Zero fake ticks or random drift.
// =====================================================================
interface StoredMarketState {
  engineVersion: 2;
  inrReserve: number;
  xyphReserve: number;
  launchPriceInr: number;
  supplyBaselineXyph?: number;
  high24hInr: number;
  low24hInr: number;
  history: MarketPricePoint[];
  trades: MarketTradeEvent[];
}

const INR_PER_USD = 84.0;
const BASE_PRICE_INR = Number((INITIAL_POOL_INR_RESERVE / INITIAL_POOL_XYPH_RESERVE).toFixed(6));

const marketStreamClients = new Set<Response>();

function computeTradeTotals(trades: MarketTradeEvent[]): { totalBoughtXyph: number; totalSoldXyph: number } {
  let totalBoughtXyph = 0;
  let totalSoldXyph = 0;
  for (const t of trades) {
    if (t.side === 'buy') totalBoughtXyph += t.xyphAmount;
    else totalSoldXyph += t.xyphAmount;
  }
  return { totalBoughtXyph, totalSoldXyph };
}

function getLiveCppMarketInput(state: StoredMarketState = marketState): CppMarketInput {
  const info = node.getInfo();
  const circulatingSupplyXyph = Math.max(1, Number((info.supply / UNIT).toFixed(4)));
  if (!state.supplyBaselineXyph || state.supplyBaselineXyph <= 0) {
    state.supplyBaselineXyph = circulatingSupplyXyph;
  }
  const { totalBoughtXyph, totalSoldXyph } = computeTradeTotals(state.trades);
  return {
    inrReserve: state.inrReserve,
    xyphReserve: state.xyphReserve,
    circulatingSupplyXyph,
    supplyBaselineXyph: state.supplyBaselineXyph,
    totalBoughtXyph,
    totalSoldXyph,
    inrPerUsd: INR_PER_USD,
  };
}

function createCleanLaunchMarketState(launchTime?: number): StoredMarketState {
  const t = launchTime ?? Math.floor(Date.now() / 1000);
  const currentSupply = Math.max(1, Number((node.getInfo().supply / UNIT).toFixed(4)));
  return {
    engineVersion: 2,
    inrReserve: INITIAL_POOL_INR_RESERVE,
    xyphReserve: INITIAL_POOL_XYPH_RESERVE,
    launchPriceInr: BASE_PRICE_INR,
    supplyBaselineXyph: currentSupply,
    high24hInr: BASE_PRICE_INR,
    low24hInr: BASE_PRICE_INR,
    history: [{ time: t, priceInr: BASE_PRICE_INR, side: 'launch' }],
    trades: [],
  };
}

function applyTradeToMarketState(
  state: StoredMarketState,
  params: {
    id: string;
    side: 'buy' | 'sell';
    xyphAmount: number;
    inrAmount: number;
    traderLabel: string;
    walletAddress: string;
    txid: string | null;
    time: number;
  }
): MarketTradeEvent | null {
  if (!Number.isFinite(params.xyphAmount) || params.xyphAmount <= 0) return null;
  if (!Number.isFinite(params.inrAmount) || params.inrAmount <= 0) return null;

  const cppInput = getLiveCppMarketInput(state);
  const quote =
    params.side === 'buy'
      ? quoteBuyCpp(cppInput, params.inrAmount)
      : quoteSellCpp(cppInput, params.xyphAmount);

  state.inrReserve = quote.newInrReserve;
  state.xyphReserve = quote.newXyphReserve;

  const priceAfter = quote.spotAfterInr;
  if (priceAfter > state.high24hInr) state.high24hInr = priceAfter;
  if (priceAfter < state.low24hInr) state.low24hInr = priceAfter;

  const event: MarketTradeEvent = {
    id: params.id,
    side: params.side,
    xyphAmount: Number(params.xyphAmount.toFixed(4)),
    inrAmount: Number(params.inrAmount.toFixed(2)),
    priceBeforeInr: quote.spotBeforeInr,
    executionPriceInr: Number((params.inrAmount / Math.max(0.0001, params.xyphAmount)).toFixed(6)),
    priceAfterInr: priceAfter,
    priceImpactPercent: quote.priceImpactPercent,
    traderLabel: params.traderLabel || (params.side === 'buy' ? 'Buyer' : 'Seller'),
    walletAddress: params.walletAddress,
    txid: params.txid,
    time: params.time,
  };

  state.trades.unshift(event);
  if (state.trades.length > 100) {
    state.trades.length = 100;
  }

  state.history.push({
    time: params.time,
    priceInr: priceAfter,
    side: params.side,
    xyphAmount: event.xyphAmount,
    inrAmount: event.inrAmount,
  });
  if (state.history.length > 120) {
    state.history.splice(0, state.history.length - 120);
  }
  return event;
}

function rebuildMarketStateFromRealOrders(): StoredMarketState {
  type ReplayItem = {
    id: string;
    side: 'buy' | 'sell';
    xyphAmount: number;
    inrAmount: number;
    traderLabel: string;
    walletAddress: string;
    txid: string | null;
    time: number;
  };

  const items: ReplayItem[] = [];
  for (const o of paymentOrders) {
    if (o.status === 'completed') {
      items.push({
        id: o.id,
        side: 'buy',
        xyphAmount: o.xyphAmount,
        inrAmount: o.inrAmount,
        traderLabel: o.payerName || 'UPI Buyer',
        walletAddress: o.recipientEvm || o.recipientXyph,
        txid: o.txid,
        time: o.updatedAt || o.createdAt,
      });
    }
  }
  for (const s of sellOrders) {
    if (s.status !== 'refunded') {
      items.push({
        id: s.id,
        side: 'sell',
        xyphAmount: s.xyphAmount,
        inrAmount: s.inrPayout,
        traderLabel: s.sellerName || 'XYPH Seller',
        walletAddress: s.sellerEvm || s.sellerXyph,
        txid: s.depositTxid,
        time: s.createdAt,
      });
    }
  }

  items.sort((a, b) => a.time - b.time);
  const earliestTime = items.length > 0 ? Math.max(0, items[0].time - 60) : Math.floor(Date.now() / 1000);
  const rebuilt = createCleanLaunchMarketState(earliestTime);
  for (const item of items) {
    applyTradeToMarketState(rebuilt, item);
  }
  return rebuilt;
}

function saveMarketState(state: StoredMarketState): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = MARKET_STATE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, MARKET_STATE_PATH);
  } catch {
    // Non-fatal persistence error
  }
}

function loadMarketState(): StoredMarketState {
  try {
    if (fs.existsSync(MARKET_STATE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(MARKET_STATE_PATH, 'utf-8'));
      if (
        parsed?.engineVersion === 2 &&
        typeof parsed?.inrReserve === 'number' &&
        typeof parsed?.xyphReserve === 'number' &&
        Array.isArray(parsed?.history) &&
        Array.isArray(parsed?.trades)
      ) {
        return parsed as StoredMarketState;
      }
    }
  } catch {
    // Rebuild cleanly from real orders
  }
  const rebuilt = rebuildMarketStateFromRealOrders();
  saveMarketState(rebuilt);
  return rebuilt;
}

let marketState: StoredMarketState = loadMarketState();

function getSpotPriceInr(): number {
  return evaluateSpotCpp(getLiveCppMarketInput(marketState)).spotPriceInr;
}

function broadcastMarketUpdate(): void {
  if (marketStreamClients.size === 0) return;
  const payload = `event: market\ndata: ${JSON.stringify(getMarketTicker())}\n\n`;
  for (const client of marketStreamClients) {
    try {
      client.write(payload);
    } catch {
      marketStreamClients.delete(client);
    }
  }
}

function recordMarketTrade(params: {
  id: string;
  side: 'buy' | 'sell';
  xyphAmount: number;
  inrAmount: number;
  traderLabel: string;
  walletAddress: string;
  txid: string | null;
}): MarketTradeEvent | null {
  const evt = applyTradeToMarketState(marketState, {
    ...params,
    time: Math.floor(Date.now() / 1000),
  });
  if (evt) {
    saveMarketState(marketState);
    broadcastMarketUpdate();
  }
  return evt;
}

function getMarketTicker(): MarketTicker {
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - 24 * 60 * 60;
  const priceInr = getSpotPriceInr();

  let buyVolume24hXyph = 0;
  let buyVolume24hInr = 0;
  let buyCount24h = 0;
  let sellVolume24hXyph = 0;
  let sellVolume24hInr = 0;
  let sellCount24h = 0;

  let totalBoughtXyph = 0;
  let totalSoldXyph = 0;
  let totalBuyTrades = 0;
  let totalSellTrades = 0;
  const uniqueTraders = new Set<string>();

  let high24h = priceInr;
  let low24h = priceInr;
  let open24hInr = marketState.launchPriceInr;

  // Trades are stored newest-first
  const trades24h: MarketTradeEvent[] = [];
  for (const t of marketState.trades) {
    if (t.walletAddress) uniqueTraders.add(t.walletAddress.toLowerCase());
    if (t.side === 'buy') {
      totalBoughtXyph += t.xyphAmount;
      totalBuyTrades++;
    } else {
      totalSoldXyph += t.xyphAmount;
      totalSellTrades++;
    }
    if (t.time >= cutoff24h) {
      trades24h.push(t);
      if (t.priceAfterInr > high24h) high24h = t.priceAfterInr;
      if (t.priceBeforeInr > high24h) high24h = t.priceBeforeInr;
      if (t.priceAfterInr < low24h) low24h = t.priceAfterInr;
      if (t.priceBeforeInr < low24h) low24h = t.priceBeforeInr;

      if (t.side === 'buy') {
        buyVolume24hXyph += t.xyphAmount;
        buyVolume24hInr += t.inrAmount;
        buyCount24h++;
      } else {
        sellVolume24hXyph += t.xyphAmount;
        sellVolume24hInr += t.inrAmount;
        sellCount24h++;
      }
    }
  }

  if (trades24h.length > 0) {
    open24hInr = trades24h[trades24h.length - 1].priceBeforeInr;
  } else {
    open24hInr = marketState.launchPriceInr;
  }

  const change24hPercent = Number(
    (((priceInr - Math.max(0.00001, open24hInr)) / Math.max(0.00001, open24hInr)) * 100).toFixed(2)
  );

  // Live pending UPI buy queue
  let pendingBuyCount = 0;
  let pendingBuyInr = 0;
  let pendingBuyXyph = 0;
  for (const o of paymentOrders) {
    if (o.status === 'pending') {
      pendingBuyCount++;
      pendingBuyInr += o.inrAmount;
      pendingBuyXyph += o.xyphAmount;
    }
  }

  const totalFlowXyph = totalBoughtXyph + totalSoldXyph;
  const buyPressurePercent =
    totalFlowXyph > 0 ? Number(((totalBoughtXyph / totalFlowXyph) * 100).toFixed(1)) : 50;

  const cppInput = getLiveCppMarketInput(marketState);
  const spotEval = evaluateSpotCpp(cppInput);
  const circulatingSupplyXyph = cppInput.circulatingSupplyXyph;
  const treasuryXyphAddress = node.meta.fund_address;
  const treasuryEvmAddress = xypherToEvmAddress(treasuryXyphAddress);
  const lastTrade = marketState.trades[0] || null;

  return {
    symbol: SYMBOL,
    name: NAME,
    priceInr: spotEval.spotPriceInr,
    priceUsd: spotEval.spotPriceUsd,
    buyPriceInr: spotEval.spotPriceInr,
    sellPriceInr: spotEval.spotPriceInr,
    xyphPerInr: Number((1 / Math.max(0.00001, spotEval.spotPriceInr)).toFixed(2)),
    open24hInr,
    change24hPercent,
    high24hInr: Number(high24h.toFixed(6)),
    low24hInr: Number(low24h.toFixed(6)),
    volume24hXyph: Number((buyVolume24hXyph + sellVolume24hXyph).toFixed(4)),
    volume24hInr: Number((buyVolume24hInr + sellVolume24hInr).toFixed(2)),
    buyVolume24hXyph: Number(buyVolume24hXyph.toFixed(4)),
    buyVolume24hInr: Number(buyVolume24hInr.toFixed(2)),
    buyCount24h,
    sellVolume24hXyph: Number(sellVolume24hXyph.toFixed(4)),
    sellVolume24hInr: Number(sellVolume24hInr.toFixed(2)),
    sellCount24h,
    totalBoughtXyph: Number(totalBoughtXyph.toFixed(4)),
    totalSoldXyph: Number(totalSoldXyph.toFixed(4)),
    totalBuyTrades,
    totalSellTrades,
    netFlowXyph: Number((totalBoughtXyph - totalSoldXyph).toFixed(4)),
    buyPressurePercent,
    uniqueTradersCount: uniqueTraders.size,
    pendingBuyCount,
    pendingBuyInr: Number(pendingBuyInr.toFixed(2)),
    pendingBuyXyph: Number(pendingBuyXyph.toFixed(4)),
    poolInrReserve: Number(marketState.inrReserve.toFixed(2)),
    poolXyphReserve: Number(marketState.xyphReserve.toFixed(4)),
    ammSpotInr: spotEval.ammSpotInr,
    scarcityMultiplier: spotEval.scarcityMultiplier,
    demandMultiplier: spotEval.demandMultiplier,
    supplyDemandIndex: spotEval.supplyDemandIndex,
    supplyBaselineXyph: cppInput.supplyBaselineXyph,
    marketRegime: spotEval.marketRegime,
    pricingEngine: spotEval.engine,
    lastTradeSide: lastTrade ? lastTrade.side : null,
    lastTradeImpactPercent: lastTrade ? lastTrade.priceImpactPercent : 0,
    marketCapInr: spotEval.marketCapInr,
    circulatingSupplyXyph,
    treasuryXyphAddress,
    treasuryEvmAddress,
    updatedAt: now,
    history: marketState.history.slice(-120),
    recentTrades: marketState.trades.slice(0, 50),
  };
}

// Lightweight SSE keepalive ping (does NOT mutate or fake market prices)
setInterval(() => {
  if (marketStreamClients.size === 0) return;
  for (const client of marketStreamClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      marketStreamClients.delete(client);
    }
  }
}, 25000);

function computePaymentSummary(orders: PaymentOrder[]): PaymentAdminSummary {
  let pendingCount = 0;
  let completedCount = 0;
  let rejectedCount = 0;
  let totalInrReceived = 0;
  let totalXyphDisbursed = 0;
  for (const o of orders) {
    if (o.status === 'pending') pendingCount++;
    else if (o.status === 'completed') {
      completedCount++;
      totalInrReceived += o.inrAmount;
      totalXyphDisbursed += o.xyphAmount;
    } else if (o.status === 'rejected') {
      rejectedCount++;
    }
  }
  return {
    totalOrders: orders.length,
    pendingCount,
    completedCount,
    rejectedCount,
    totalInrReceived: Number(totalInrReceived.toFixed(2)),
    totalXyphDisbursed: Number(totalXyphDisbursed.toFixed(2)),
  };
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true;
  }
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function validatePublicPeerUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (isPrivateOrBlockedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extractSuppliedKey(req: Request): string {
  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const headerKey = String(req.headers['x-api-key'] || '').trim();
  return bearer || headerKey;
}

function requirePublicApiKey(req: Request, res: Response, next: NextFunction) {
  const mode = getGatewayAuthMode();
  if (mode === 'unconfigured') {
    return res.status(503).json({
      error:
        'Public network API key is not activated yet. Activate a key in MetaMask & Network or set XYPHER_NETWORK_API_KEY in server secrets.',
    });
  }
  const supplied = extractSuppliedKey(req);
  if (!verifyPublicApiKey(supplied)) {
    return res.status(401).json({ error: 'Invalid or missing network API key' });
  }
  return next();
}

function executeXypherRpcMethod(method: unknown, params: Record<string, unknown> = {}) {
  switch (method) {
    case 'getinfo': {
      const info = node.getInfo();
      return {
        name: info.name,
        symbol: info.symbol,
        chainId: info.chainId,
        profile: info.profile,
        height: info.height,
        tip: info.tip,
        supply: info.supply,
        mempool: info.mempoolCount,
        peers: registeredPeers.size,
        blocks_left: info.blocksLeft,
        target: info.targetHex,
        difficulty: info.difficulty,
        maturity: info.maturity,
      };
    }
    case 'balance': {
      const rawAddr = String(params.address || '');
      const normalized = normalizeToXypherAddress(rawAddr);
      if (!normalized) throw new Error('invalid address');
      const info = node.getAddressInfo(normalized);
      return { total: info.total, spendable: info.spendable, immature: info.immature };
    }
    case 'coins': {
      const rawAddr = String(params.address || '');
      const normalized = normalizeToXypherAddress(rawAddr);
      if (!normalized) throw new Error('invalid address');
      const info = node.getAddressInfo(normalized);
      return info.utxos.filter((u) => u.spendable).map((u) => [u.txid, u.index, u.value]);
    }
    case 'addr': {
      const pubHex = String(params.pub || '');
      return { address: addressFromPubkey(hexToBytes(pubHex)) };
    }
    case 'submit': {
      const submitted = node.addTx(params.tx as TxData);
      if (!submitted.ok) throw new Error(submitted.error || 'rejected');
      return { txid: submitted.txid };
    }
    case 'getblocks': {
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 100);
      const offset = Math.max(Number(params.offset) || 0, 0);
      return node.getBlocksPaginated(limit, offset);
    }
    default:
      throw new Error(`Unknown RPC method: ${String(method)}`);
  }
}

// =====================================================================
// REAL ETHEREUM JSON-RPC 2.0 HANDLER FOR METAMASK (/evm-rpc)
// =====================================================================
async function handleSingleEvmRpc(
  payload: {
    id?: unknown;
    jsonrpc?: string;
    method?: string;
    params?: unknown[];
  },
  chainOverride?: { chainId: number; chainIdHex: string; name: string }
) {
  const id = payload?.id ?? 1;
  const method = String(payload?.method || '');
  const params = Array.isArray(payload?.params) ? payload.params : [];
  const activeChainId = chainOverride?.chainId ?? XYPHER_CHAIN_ID;
  const activeChainIdHex = chainOverride?.chainIdHex ?? XYPHER_CHAIN_ID_HEX;

  try {
    let result: unknown;
    switch (method) {
      case 'eth_chainId':
        result = activeChainIdHex;
        break;
      case 'net_version':
        result = String(activeChainId);
        break;
      case 'net_listening':
        result = true;
        break;
      case 'net_peerCount':
        result = '0x' + Math.max(1, registeredPeers.size).toString(16);
        break;
      case 'web3_clientVersion':
        result = 'XYPH-Network/v2.0.0-zero-fee-evm-rpc';
        break;
      case 'eth_syncing':
        result = false;
        break;
      case 'eth_blockNumber':
        result = '0x' + Math.max(0, node.height).toString(16);
        break;
      case 'eth_gasPrice':
        result = XYPH_EVM_GAS_PRICE_HEX; // 0x0 — zero network fee on XYPH Network
        break;
      case 'eth_maxPriorityFeePerGas':
        result = XYPH_EVM_GAS_PRICE_HEX; // 0x0 — zero priority fee on XYPH Network
        break;
      case 'eth_blobBaseFee':
        result = '0x0';
        break;
      case 'eth_protocolVersion':
        result = '0x41';
        break;
      case 'eth_feeHistory': {
        const rawCount =
          typeof params[0] === 'string' && params[0].startsWith('0x')
            ? parseInt(params[0], 16)
            : Number(params[0] || 4);
        const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 4, 1), 10);
        const oldest = Math.max(0, node.height - count + 1);
        const percentiles =
          Array.isArray(params[2]) && params[2].length > 0 ? params[2] : [50];
        const rewardRow = percentiles.map(() => XYPH_EVM_GAS_PRICE_HEX);
        result = {
          oldestBlock: '0x' + oldest.toString(16),
          baseFeePerGas: Array(count + 1).fill('0x0'),
          baseFeePerBlobGas: Array(count + 1).fill('0x0'),
          gasUsedRatio: Array(count).fill(0.1),
          blobGasUsedRatio: Array(count).fill(0),
          reward: Array(count).fill(rewardRow),
        };
        break;
      }
      case 'eth_estimateGas':
        result = node.getEvmEstimateGas(
          (params[0] || {}) as { to?: string; data?: string; input?: string }
        );
        break;
      case 'eth_getBalance': {
        const addr = String(params[0] || '');
        result = node.getEvmBalanceWeiHex(addr);
        break;
      }
      case 'eth_getTransactionCount': {
        const addr = String(params[0] || '');
        result = '0x' + node.getEvmNonce(addr, activeChainId).toString(16);
        break;
      }
      case 'eth_getCode':
        result = node.getEvmCode(String(params[0] || ''));
        break;
      case 'eth_call':
        result = node.handleEvmCall(
          (params[0] || {}) as { to?: string; data?: string; input?: string }
        );
        break;
      case 'eth_getLogs':
        result = node.getEvmLogs(
          (params[0] || {}) as {
            fromBlock?: string;
            toBlock?: string;
            address?: string | string[];
            topics?: Array<string | string[] | null>;
          }
        );
        break;
      case 'eth_getBlockByNumber': {
        const tag = String(params[0] || 'latest');
        const fullTx = Boolean(params[1]);
        result = node.getEvmBlock(tag, fullTx);
        break;
      }
      case 'eth_getBlockByHash': {
        const hash = String(params[0] || '');
        const fullTx = Boolean(params[1]);
        result = node.getEvmBlock(hash, fullTx);
        break;
      }
      case 'eth_getBlockTransactionCountByNumber':
      case 'eth_getBlockTransactionCountByHash': {
        const blk = node.getEvmBlock(String(params[0] || 'latest'), false) as {
          transactions?: unknown[];
        } | null;
        result = blk ? '0x' + (blk.transactions?.length || 0).toString(16) : null;
        break;
      }
      case 'eth_sendRawTransaction': {
        const rawHex = String(params[0] || '');
        const txHash = node.submitEvmRawTransaction(rawHex, activeChainId);
        try {
          await node.sealOneNetworkBlock();
        } catch (sealErr) {
          console.error('Immediate block seal after eth_sendRawTransaction failed:', sealErr);
        }
        result = txHash;
        break;
      }
      case 'eth_getTransactionByHash': {
        const hash = String(params[0] || '');
        result = node.getEvmTransactionByHash(hash);
        break;
      }
      case 'eth_getTransactionReceipt': {
        const hash = String(params[0] || '');
        result = node.getEvmTransactionReceipt(hash);
        break;
      }
      case 'eth_accounts':
        result = [];
        break;
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method ${method} not supported on Xypher EVM RPC` },
        };
    }

    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err instanceof Error ? err.message : 'EVM RPC error' },
    };
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Prevent proxies or browsers from caching dynamic JSON API responses
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Return JSON instead of HTML when a client sends malformed JSON to /api or /evm-rpc
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (
      err &&
      typeof err === 'object' &&
      'status' in err &&
      (err as { status?: number }).status === 400 &&
      (req.path.startsWith('/api') || req.path.startsWith('/evm-rpc'))
    ) {
      return res.status(400).json({ error: 'Invalid JSON request payload' });
    }
    return next(err);
  });

  // =====================================================================
  // REAL METAMASK ETHEREUM JSON-RPC 2.0 GATEWAY (/evm-rpc & /evm-rpc/:netId)
  // Unauthenticated public zero-fee RPC (signed writes verified by ECDSA ecrecover)
  // =====================================================================
  const allowEvmRpcCors = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  };

  app.options('/evm-rpc', allowEvmRpcCors, (_req, res) => {
    res.sendStatus(204);
  });

  app.post('/evm-rpc', allowEvmRpcCors, async (req, res) => {
    if (Array.isArray(req.body)) {
      const responses = await Promise.all(req.body.map((item) => handleSingleEvmRpc(item)));
      return res.json(responses);
    }
    return res.json(await handleSingleEvmRpc(req.body || {}));
  });

  app.options('/evm-rpc/:netId', allowEvmRpcCors, (_req, res) => {
    res.sendStatus(204);
  });

  app.post('/evm-rpc/:netId', allowEvmRpcCors, async (req, res) => {
    const slug = String(req.params.netId || '').trim().toLowerCase();
    const chainCfg = ZERO_FEE_RPC_BY_SLUG[slug];
    if (!chainCfg) {
      return res.status(404).json({
        jsonrpc: '2.0',
        id: req.body?.id ?? 1,
        error: { code: -32601, message: 'Unknown zero-fee EVM network endpoint' },
      });
    }
    if (Array.isArray(req.body)) {
      const responses = await Promise.all(
        req.body.map((item) => handleSingleEvmRpc(item, chainCfg))
      );
      return res.json(responses);
    }
    return res.json(await handleSingleEvmRpc(req.body || {}, chainCfg));
  });

  // Public CORS-enabled Xypher coin logo endpoints so MetaMask extension/mobile renders the profile picture reliably
  const sendCoinLogo = (_req: Request, res: Response) => {
    const publicLogo = path.resolve(process.cwd(), 'public', 'xypher-coin.jpg');
    const fallbackLogo = path.resolve(
      process.cwd(),
      'src',
      'assets',
      'images',
      'xypher_coin_logo_1795333764015.jpg'
    );
    const targetFile = fs.existsSync(publicLogo) ? publicLogo : fallbackLogo;
    if (!fs.existsSync(targetFile)) {
      return res.status(404).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/jpeg');
    return res.sendFile(targetFile);
  };

  app.get('/xypher-coin.jpg', sendCoinLogo);
  app.get('/src/assets/images/xypher_coin_logo_1795333764015.jpg', sendCoinLogo);

  // =====================================================================
  // XYPHER WALLET & EXPLORER REST API + 10-MINUTE BLOCK MINING ENGINE
  // =====================================================================
  interface PersistedMiningState {
    active: boolean;
    minerAddress: string | null;
    startedAtMs: number | null;
    nextBlockAtMs: number | null;
    blocksMined: number;
    totalRewardUnits: number;
    recentMinedBlocks: MinedBlockRecord[];
  }

  const MINING_INTERVAL_MS = MINING_BLOCK_TIME_SEC * 1000;

  function loadMiningState(): PersistedMiningState {
    try {
      if (!fs.existsSync(MINING_STATE_PATH)) {
        return {
          active: false,
          minerAddress: null,
          startedAtMs: null,
          nextBlockAtMs: null,
          blocksMined: 0,
          totalRewardUnits: 0,
          recentMinedBlocks: [],
        };
      }
      const raw = JSON.parse(fs.readFileSync(MINING_STATE_PATH, 'utf-8'));
      const minerAddr =
        typeof raw?.minerAddress === 'string'
          ? normalizeToXypherAddress(raw.minerAddress)
          : null;
      return {
        active: Boolean(raw?.active && minerAddr),
        minerAddress: minerAddr,
        startedAtMs: typeof raw?.startedAtMs === 'number' ? raw.startedAtMs : null,
        nextBlockAtMs: typeof raw?.nextBlockAtMs === 'number' ? raw.nextBlockAtMs : null,
        blocksMined: Number.isFinite(Number(raw?.blocksMined)) ? Math.max(0, Number(raw.blocksMined)) : 0,
        totalRewardUnits: Number.isFinite(Number(raw?.totalRewardUnits))
          ? Math.max(0, Number(raw.totalRewardUnits))
          : 0,
        recentMinedBlocks: Array.isArray(raw?.recentMinedBlocks)
          ? (raw.recentMinedBlocks as MinedBlockRecord[]).slice(0, 50)
          : [],
      };
    } catch {
      return {
        active: false,
        minerAddress: null,
        startedAtMs: null,
        nextBlockAtMs: null,
        blocksMined: 0,
        totalRewardUnits: 0,
        recentMinedBlocks: [],
      };
    }
  }

  function saveMiningState(state: PersistedMiningState): void {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${MINING_STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmp, MINING_STATE_PATH);
  }

  const miningState: PersistedMiningState = loadMiningState();
  let miningTimer: ReturnType<typeof setTimeout> | null = null;
  let miningSealingNow = false;
  let miningLastError: string | null = null;

  function buildHalvingSchedule(): MiningHalvingEra[] {
    const eras: MiningHalvingEra[] = [];
    for (let era = 0; era < 6; era++) {
      const startBlock = era * HALVING_INTERVAL_BLOCKS;
      const endBlock = (era + 1) * HALVING_INTERVAL_BLOCKS - 1;
      const rewardUnits = Number(BigInt(BLOCK_SUBSIDY) >> BigInt(era));
      const startYear = era * HALVING_YEARS;
      const endYear = (era + 1) * HALVING_YEARS;
      eras.push({
        era: era + 1,
        yearsLabel: `Years ${startYear}–${endYear}`,
        startBlock,
        endBlock,
        rewardUnits,
      });
    }
    return eras;
  }

  function getMiningStatusSnapshot(): MiningStatus {
    const nextHeight = node.height + 1;
    const eraIndex = Math.floor(nextHeight / HALVING_INTERVAL_BLOCKS);
    const currentRewardUnits = node.subsidy(nextHeight);
    const nextHalvingBlock = (eraIndex + 1) * HALVING_INTERVAL_BLOCKS;
    const nextHalvingRewardUnits = node.subsidy(nextHalvingBlock);
    const blocksUntilHalving = Math.max(0, nextHalvingBlock - node.height);
    const yearsUntilHalving = Number(
      ((blocksUntilHalving * MINING_BLOCK_TIME_SEC) / (365 * 24 * 3600)).toFixed(2)
    );
    const nowMs = Date.now();
    const remainingMs =
      miningState.active && miningState.nextBlockAtMs
        ? Math.max(0, miningState.nextBlockAtMs - nowMs)
        : 0;

    return {
      active: miningState.active,
      minerAddress: miningState.minerAddress,
      minerEvmAddress: miningState.minerAddress ? xypherToEvmAddress(miningState.minerAddress) : null,
      startedAtMs: miningState.startedAtMs,
      nextBlockAtMs: miningState.nextBlockAtMs,
      remainingMs,
      blockTimeSec: MINING_BLOCK_TIME_SEC,
      halvingYears: HALVING_YEARS,
      halvingIntervalBlocks: HALVING_INTERVAL_BLOCKS,
      currentHeight: node.height,
      currentEra: eraIndex + 1,
      currentRewardUnits,
      nextHalvingBlock,
      nextHalvingRewardUnits,
      blocksUntilHalving,
      yearsUntilHalving,
      blocksMined: miningState.blocksMined,
      totalRewardUnits: miningState.totalRewardUnits,
      sealingNow: miningSealingNow,
      lastError: miningLastError,
      recentMinedBlocks: miningState.recentMinedBlocks.slice(0, 20),
      halvingSchedule: buildHalvingSchedule(),
    };
  }

  function clearMiningTimer(): void {
    if (miningTimer) {
      clearTimeout(miningTimer);
      miningTimer = null;
    }
  }

  function scheduleNextMinedBlock(): void {
    clearMiningTimer();
    if (!miningState.active || !miningState.minerAddress) return;
    const nowMs = Date.now();
    if (!miningState.nextBlockAtMs) {
      miningState.startedAtMs = nowMs;
      miningState.nextBlockAtMs = nowMs + MINING_INTERVAL_MS;
      saveMiningState(miningState);
    }
    const delayMs = Math.max(250, miningState.nextBlockAtMs - nowMs);
    miningTimer = setTimeout(() => {
      void executeScheduledBlockMine();
    }, delayMs);
  }

  async function executeScheduledBlockMine(): Promise<void> {
    if (!miningState.active || !miningState.minerAddress || miningSealingNow) return;
    if (node.height >= MAX_BLOCKS) {
      miningState.active = false;
      miningState.nextBlockAtMs = null;
      miningLastError = 'Maximum 24,000,000 block limit reached.';
      saveMiningState(miningState);
      return;
    }

    miningSealingNow = true;
    miningLastError = null;
    try {
      const targetWallet = miningState.minerAddress;
      const sealed = await node.sealOneNetworkBlock(targetWallet);
      const fullBlock = node.all.get(sealed.block.hash);
      const coinbaseTx = fullBlock?.txs?.[0];
      const coinbaseTxid = coinbaseTx ? computeTxid(coinbaseTx) : sealed.block.hash;
      const rewardUnits = sealed.block.subsidy + sealed.block.fees;
      const era = Math.floor(sealed.block.height / HALVING_INTERVAL_BLOCKS) + 1;

      const record: MinedBlockRecord = {
        height: sealed.block.height,
        hash: sealed.block.hash,
        txid: coinbaseTxid,
        minerAddress: targetWallet,
        rewardUnits,
        hashes: sealed.hashes,
        elapsedMs: sealed.elapsedMs,
        time: sealed.block.time,
        era,
      };

      miningState.blocksMined += 1;
      miningState.totalRewardUnits += rewardUnits;
      miningState.recentMinedBlocks = [record, ...miningState.recentMinedBlocks].slice(0, 50);

      if (miningState.active) {
        const nowMs = Date.now();
        miningState.startedAtMs = nowMs;
        miningState.nextBlockAtMs = nowMs + MINING_INTERVAL_MS;
      }
      saveMiningState(miningState);
      // Push updated supply-and-demand price immediately after new supply is mined
      broadcastMarketUpdate();
    } catch (err) {
      miningLastError = err instanceof Error ? err.message : 'Block mining failed';
      if (miningState.active) {
        const nowMs = Date.now();
        miningState.startedAtMs = nowMs;
        miningState.nextBlockAtMs = nowMs + MINING_INTERVAL_MS;
        saveMiningState(miningState);
      }
    } finally {
      miningSealingNow = false;
      if (miningState.active) {
        scheduleNextMinedBlock();
      }
    }
  }

  const miningRateBuckets = new Map<string, number[]>();

  app.get('/api/mining/status', (_req, res) => {
    res.json(getMiningStatusSnapshot());
  });

  app.post('/api/mining/start', (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (miningRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many mining requests. Please wait a moment.' });
    }
    recent.push(nowMs);
    miningRateBuckets.set(clientIp, recent);

    const rawAddr = String(req.body?.minerAddress || '').trim();
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({
        error: 'Select a valid Xypher or MetaMask (0x...) wallet address to receive mining rewards.',
      });
    }
    if (node.height >= MAX_BLOCKS) {
      return res.status(400).json({ error: 'Maximum 24,000,000 blocks have already been mined.' });
    }

    const alreadyActiveSameWallet =
      miningState.active &&
      miningState.minerAddress === normalized &&
      miningState.nextBlockAtMs !== null &&
      miningState.nextBlockAtMs > nowMs;

    miningState.active = true;
    miningState.minerAddress = normalized;
    miningLastError = null;
    if (!alreadyActiveSameWallet) {
      miningState.startedAtMs = nowMs;
      miningState.nextBlockAtMs = nowMs + MINING_INTERVAL_MS;
    }
    saveMiningState(miningState);
    scheduleNextMinedBlock();
    return res.json({ ok: true, status: getMiningStatusSnapshot() });
  });

  app.post('/api/mining/stop', (_req, res) => {
    miningState.active = false;
    miningState.startedAtMs = null;
    miningState.nextBlockAtMs = null;
    clearMiningTimer();
    saveMiningState(miningState);
    return res.json({ ok: true, status: getMiningStatusSnapshot() });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      networkName: NETWORK_NAME,
      height: node.height,
      maxBlocks: MAX_BLOCKS,
    });
  });

  app.get('/api/info', (_req, res) => {
    res.json(node.getInfo());
  });

  app.get('/api/blocks', (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    res.json(node.getBlocksPaginated(limit, offset));
  });

  app.get('/api/blocks/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 66) {
      return res.status(400).json({ error: 'Invalid block height or hash' });
    }
    const detail = node.getBlockDetail(id);
    if (!detail) return res.status(404).json({ error: 'Block not found' });
    return res.json(detail);
  });

  app.get('/api/tx/:txid', (req, res) => {
    const txid = String(req.params.txid || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{6,64}$/.test(txid)) {
      return res.status(400).json({ error: 'Invalid transaction ID format' });
    }
    const detail = node.getTransactionDetail(txid);
    if (!detail) return res.status(404).json({ error: 'Transaction not found' });
    return res.json(detail);
  });

  app.get('/api/mempool', (_req, res) => {
    const items = Array.from(node.mempool.values()).sort((a, b) => b.addedAt - a.addedAt);
    res.json({ count: items.length, txs: items });
  });

  app.get('/api/address/:addr', (req, res) => {
    const rawAddr = String(req.params.addr || '').trim();
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid Xypher or MetaMask (0x...) address' });
    }
    return res.json(node.getAddressInfo(normalized));
  });

  // Authoritative pre-transaction balance check: verifies sender has sufficient balance BEFORE sending
  app.post('/api/tx/verify-balance', (req, res) => {
    try {
      const { fromAddress, toAddress, amountUnits, feeUnits } = req.body || {};
      const verification = node.verifyTransferBalance({
        fromAddress: String(fromAddress || '').trim(),
        toAddress: toAddress ? String(toAddress).trim() : null,
        amountUnits: Number(amountUnits),
        ...(feeUnits !== undefined ? { feeUnits: Number(feeUnits) } : {}),
      });
      return res.json(verification);
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'Unable to verify wallet balance',
      });
    }
  });

  app.post('/api/tx/submit', async (req, res) => {
    const tx = req.body?.tx as TxData | undefined;
    if (!tx || typeof tx !== 'object') {
      return res.status(400).json({ error: 'Missing transaction payload' });
    }
    const result = node.addTx(tx);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Transaction rejected' });
    }
    let blockHeight: number | null = null;
    try {
      const sealed = await node.sealOneNetworkBlock();
      blockHeight = sealed.block.height;
    } catch (sealErr) {
      console.error('Immediate block seal after /api/tx/submit failed:', sealErr);
    }
    const accounting = result.accounting
      ? {
          ...result.accounting,
          blockHeight,
          senderAfter: result.accounting.fromAddress
            ? node.getAddressInfo(result.accounting.fromAddress).spendable
            : result.accounting.senderAfter,
          receiverAfter: result.accounting.toAddress
            ? node.getAddressInfo(result.accounting.toAddress).spendable
            : result.accounting.receiverAfter,
        }
      : undefined;
    return res.json({ ok: true, txid: result.txid, blockHeight, accounting });
  });

  app.get('/api/tx/bridge-nonce/:addr', (req, res) => {
    const rawAddr = String(req.params.addr || '').trim();
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    const evm = xypherToEvmAddress(normalized);
    const parsedChain = Number(req.query.chainId);
    const chainId = Number.isFinite(parsedChain) && parsedChain > 0 ? parsedChain : XYPHER_CHAIN_ID;
    return res.json({ nonce: node.getEvmNonce(evm, chainId) });
  });

  app.post('/api/tx/bridge-transfer', async (req, res) => {
    try {
      const { fromXyph, toAddress, amountUnits, feeUnits, timestamp, pubHex, sigHex } =
        req.body || {};
      const result = node.submitSignedBridgeTransfer({
        fromXyph: String(fromXyph || '').trim(),
        toAddress: String(toAddress || '').trim(),
        amountUnits: Number(amountUnits),
        feeUnits: Number(feeUnits),
        timestamp: Number(timestamp),
        pubHex: String(pubHex || '').trim(),
        sigHex: String(sigHex || '').trim(),
      });
      let blockHeight: number | null = null;
      try {
        const sealed = await node.sealOneNetworkBlock();
        blockHeight = sealed.block.height;
      } catch (sealErr) {
        console.error('Immediate block seal after /api/tx/bridge-transfer failed:', sealErr);
      }
      const accounting = {
        ...result.accounting,
        blockHeight,
        senderAfter: node.getAddressInfo(result.accounting.fromAddress).spendable,
        receiverAfter: node.getAddressInfo(result.accounting.toAddress).spendable,
      };
      return res.json({ ok: true, txid: result.txid, blockHeight, accounting });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'Signed transfer rejected',
      });
    }
  });

  const evmSignedTxRateBuckets = new Map<string, number[]>();

  app.post('/api/tx/evm-signed-transfer', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (evmSignedTxRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many transfer requests. Please wait a moment.' });
    }
    recent.push(nowMs);
    evmSignedTxRateBuckets.set(clientIp, recent);

    try {
      const { fromEvm, toAddress, amountUnits, feeUnits, timestamp, signature } = req.body || {};
      const result = node.submitEvmPersonalSignedTransfer({
        fromEvm: String(fromEvm || '').trim(),
        toAddress: String(toAddress || '').trim(),
        amountUnits: Number(amountUnits),
        feeUnits: Number(feeUnits),
        timestamp: Number(timestamp),
        signature: String(signature || '').trim(),
      });
      let blockHeight: number | null = null;
      try {
        const sealed = await node.sealOneNetworkBlock();
        blockHeight = sealed.block.height;
      } catch (sealErr) {
        console.error('Immediate block seal after /api/tx/evm-signed-transfer failed:', sealErr);
      }
      const accounting = {
        ...result.accounting,
        blockHeight,
        senderAfter: node.getAddressInfo(result.accounting.fromAddress).spendable,
        receiverAfter: node.getAddressInfo(result.accounting.toAddress).spendable,
      };
      return res.json({ ok: true, txid: result.txid, blockHeight, accounting });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'MetaMask signed transfer rejected',
      });
    }
  });

  app.post('/api/tx/evm-signed-deploy', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (evmSignedTxRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many deployment requests. Please wait a moment.' });
    }
    recent.push(nowMs);
    evmSignedTxRateBuckets.set(clientIp, recent);

    try {
      const { deployerEvm, chainId, initialSupplyWholeTokens, timestamp, signature } = req.body || {};
      const deployed = node.submitEvmPersonalSignedDeploy({
        deployerEvm: String(deployerEvm || '').trim(),
        chainId: Number(chainId) || XYPHER_CHAIN_ID,
        initialSupplyWholeTokens: Number(initialSupplyWholeTokens),
        timestamp: Number(timestamp),
        signature: String(signature || '').trim(),
      });
      let blockHeight: number | null = null;
      try {
        const sealed = await node.sealOneNetworkBlock();
        blockHeight = sealed.block.height;
      } catch (sealErr) {
        console.error('Immediate block seal after /api/tx/evm-signed-deploy failed:', sealErr);
      }
      return res.json({ ok: true, ...deployed, blockHeight });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'MetaMask signed contract deployment rejected',
      });
    }
  });

  // Real MetaMask EIP-191 personal_sign ERC-20 token transfer on XYPH Network (ETH, BTC, BNB, POL, SOL, TRX, MON, XLM)
  app.post('/api/tx/evm-signed-token-transfer', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (evmSignedTxRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many transfer requests. Please wait a moment.' });
    }
    recent.push(nowMs);
    evmSignedTxRateBuckets.set(clientIp, recent);

    try {
      const rawSym = String(req.body?.symbol || '').trim().toUpperCase();
      if (!isSupportedCoinSymbol(rawSym) || rawSym === 'XYPH') {
        return res.status(400).json({ error: 'Select a valid ERC-20 exchange token symbol.' });
      }
      const transferred = await node.submitEvmPersonalSignedTokenTransfer({
        symbol: rawSym,
        fromEvm: String(req.body?.fromEvm || '').trim(),
        toEvm: String(req.body?.toEvm || '').trim(),
        amount: Number(req.body?.amount),
        timestamp: Number(req.body?.timestamp),
        signature: String(req.body?.signature || '').trim(),
      });
      return res.json({ ok: true, ...transferred });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'MetaMask token transfer rejected',
      });
    }
  });

  // Starter Faucet: disburses real on-chain XYPH to any unique wallet or MetaMask address
  // =====================================================================
  // LIVE COIN MARKET PRICE & UPI BUY / SELL XYPH PAYMENT SYSTEM
  // =====================================================================
  app.get('/api/market/price', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(getMarketTicker());
  });

  // Real-Time Server-Sent Events stream pushing live buy/sell price changes immediately
  app.get('/api/market/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    marketStreamClients.add(res);
    res.write(`event: market\ndata: ${JSON.stringify(getMarketTicker())}\n\n`);

    req.on('close', () => {
      marketStreamClients.delete(res);
    });
  });

  app.get('/api/payments/config', (_req, res) => {
    const mode = getMerchantAuthMode();
    const treasuryXyphAddress = node.meta.fund_address;
    res.json({
      ...MERCHANT_CONFIG,
      rateXyphPerInr: Number((1 / Math.max(0.00001, getSpotPriceInr())).toFixed(2)),
      treasuryXyphAddress,
      treasuryEvmAddress: xypherToEvmAddress(treasuryXyphAddress),
      adminConfigured: mode !== 'unconfigured',
      adminAuthMode: mode,
    });
  });

  const buyOrderRateBuckets = new Map<string, number[]>();
  const settlingBuyUtrs = new Set<string>();

  app.post('/api/payments/orders', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (buyOrderRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 15) {
      return res.status(429).json({
        error: 'Too many buy submissions from this connection. Please wait a minute and try again.',
      });
    }
    recent.push(nowMs);
    buyOrderRateBuckets.set(clientIp, recent);

    const rawInr = Number(req.body?.inrAmount);
    if (!Number.isFinite(rawInr) || rawInr < MERCHANT_CONFIG.minInr || rawInr > MERCHANT_CONFIG.maxInr) {
      return res.status(400).json({
        error: `Enter an amount between ₹${MERCHANT_CONFIG.minInr} and ₹${MERCHANT_CONFIG.maxInr.toLocaleString()}.`,
      });
    }
    const inrAmount = Number(rawInr.toFixed(2));
    const buyQuote = quoteBuyCpp(getLiveCppMarketInput(marketState), inrAmount);
    const xyphAmount = Number(buyQuote.outputAmount.toFixed(4));
    const xyphUnits = Math.max(1, Math.round(xyphAmount * UNIT));

    const recipientInput = String(req.body?.recipientAddress || '').trim();
    const recipientXyph = normalizeToXypherAddress(recipientInput);
    if (!recipientXyph) {
      return res.status(400).json({
        error: 'Provide a valid MetaMask (0x...) or native Xypher receiving wallet address.',
      });
    }
    const recipientEvm = xypherToEvmAddress(recipientXyph);

    const utr = String(req.body?.utr || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8,32}$/.test(utr)) {
      return res.status(400).json({
        error: 'Enter a valid UPI UTR / Transaction Reference ID (8–32 letters or digits).',
      });
    }

    const duplicate =
      settlingBuyUtrs.has(utr) ||
      paymentOrders.some((o) => o.utr === utr && o.status !== 'rejected');
    if (duplicate) {
      return res.status(409).json({
        error: 'This UPI UTR reference number has already been submitted.',
      });
    }

    const payerName = String(req.body?.payerName || '').trim().slice(0, 60) || 'UPI Buyer';
    const now = Math.floor(Date.now() / 1000);
    const order: PaymentOrder = {
      id: `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      inrAmount,
      xyphAmount,
      xyphUnits,
      executionPriceInr: buyQuote.executionPriceInr,
      recipientInput,
      recipientXyph,
      recipientEvm,
      payerName,
      utr,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      txid: null,
      blockHeight: null,
      rejectionReason: null,
    };

    settlingBuyUtrs.add(utr);
    try {
      const settled = await node.disburseTreasuryPayment(
        order.recipientXyph,
        order.xyphUnits,
        order.id
      );
      order.status = 'completed';
      order.txid = settled.txid;
      order.blockHeight = settled.blockHeight;
      order.updatedAt = Math.floor(Date.now() / 1000);

      paymentOrders.unshift(order);
      savePaymentOrders(paymentOrders);
      recordMarketTrade({
        id: order.id,
        side: 'buy',
        xyphAmount: order.xyphAmount,
        inrAmount: order.inrAmount,
        traderLabel: order.payerName || 'UPI Buyer',
        walletAddress: order.recipientEvm || order.recipientXyph,
        txid: settled.txid,
      });
      return res.status(201).json({ ok: true, order, market: getMarketTicker() });
    } catch (err) {
      return res.status(500).json({
        error:
          err instanceof Error
            ? `Automatic wallet credit failed: ${err.message}`
            : 'Automatic wallet credit failed. Please retry.',
      });
    } finally {
      settlingBuyUtrs.delete(utr);
    }
  });

  app.get('/api/payments/orders', (req, res) => {
    const rawAddr = String(req.query.address || '').trim();
    const orderId = String(req.query.id || '').trim();
    if (orderId) {
      const match = paymentOrders.find((o) => o.id === orderId);
      return res.json({ orders: match ? [match] : [] });
    }
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({ error: 'Provide a valid wallet address to view your orders.' });
    }
    const matching = paymentOrders.filter((o) => o.recipientXyph === normalized);
    return res.json({ orders: matching });
  });

  app.post('/api/payments/admin/setup', (req, res) => {
    const mode = getMerchantAuthMode();
    if (mode === 'env') {
      return res.status(409).json({
        error: 'Merchant Admin passcode is managed via server secret MERCHANT_ADMIN_PASSCODE.',
      });
    }
    if (mode === 'claimed') {
      return res.status(409).json({
        error: 'Merchant Admin passcode is already configured. Please sign in or update MERCHANT_ADMIN_PASSCODE in Secrets.',
      });
    }
    const passcode = String(req.body?.passcode || '').trim();
    if (passcode.length < 6 || passcode.length > 128) {
      return res.status(400).json({ error: 'Choose a Merchant Admin passcode of at least 6 characters.' });
    }
    saveClaimedMerchantHash(passcode);
    const token = issueMerchantToken();
    return res.json({ ok: true, token, authMode: 'claimed' });
  });

  app.post('/api/payments/admin/login', (req, res) => {
    const mode = getMerchantAuthMode();
    if (mode === 'unconfigured') {
      return res.status(503).json({
        error: 'Merchant Admin passcode has not been set up yet.',
      });
    }
    const passcode = String(req.body?.passcode || '').trim();
    if (!verifyMerchantPasscode(passcode)) {
      return res.status(401).json({ error: 'Incorrect Merchant Admin passcode' });
    }
    const token = issueMerchantToken();
    return res.json({ ok: true, token });
  });

  app.get('/api/payments/admin/orders', requireMerchantAdmin, (_req, res) => {
    return res.json({
      orders: paymentOrders,
      summary: computePaymentSummary(paymentOrders),
    });
  });

  app.post('/api/payments/admin/orders/:id/approve', requireMerchantAdmin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const order = paymentOrders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: `Order is already ${order.status}` });
    }
    if (approvingOrderIds.has(id)) {
      return res.status(409).json({ error: 'Order settlement is already in progress' });
    }

    approvingOrderIds.add(id);
    try {
      const settled = await node.disburseTreasuryPayment(
        order.recipientXyph,
        order.xyphUnits,
        order.id
      );
      order.status = 'completed';
      order.txid = settled.txid;
      order.blockHeight = settled.blockHeight;
      order.updatedAt = Math.floor(Date.now() / 1000);
      order.rejectionReason = null;
      savePaymentOrders(paymentOrders);
      recordMarketTrade({
        id: order.id,
        side: 'buy',
        xyphAmount: order.xyphAmount,
        inrAmount: order.inrAmount,
        traderLabel: order.payerName || 'UPI Buyer',
        walletAddress: order.recipientEvm || order.recipientXyph,
        txid: settled.txid,
      });
      return res.json({ ok: true, order, market: getMarketTicker() });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to settle XYPH payout',
      });
    } finally {
      approvingOrderIds.delete(id);
    }
  });

  app.post('/api/payments/admin/orders/:id/reject', requireMerchantAdmin, (req, res) => {
    const id = String(req.params.id || '').trim();
    const order = paymentOrders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: `Order is already ${order.status}` });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 140) || 'UPI payment not received / UTR mismatch';
    order.status = 'rejected';
    order.rejectionReason = reason;
    order.updatedAt = Math.floor(Date.now() / 1000);
    savePaymentOrders(paymentOrders);
    broadcastMarketUpdate();
    return res.json({ ok: true, order, market: getMarketTicker() });
  });

  // =====================================================================
  // SELL XYPH AT LIVE MARKET PRICE (On-Chain Treasury Escrow -> UPI or Bank Account INR Payout)
  // =====================================================================
  app.post('/api/payments/sell-orders', (req, res) => {
    const depositTxid = String(req.body?.depositTxid || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(depositTxid)) {
      return res.status(400).json({ error: 'Invalid on-chain deposit transaction hash.' });
    }

    const rawMethod = String(req.body?.payoutMethod || 'upi').trim().toLowerCase();
    if (rawMethod !== 'upi' && rawMethod !== 'bank') {
      return res.status(400).json({ error: 'Select a valid payout method (UPI or Bank Account).' });
    }
    const payoutMethod: 'upi' | 'bank' = rawMethod;

    let upiId = '';
    let bankAccountNumber: string | undefined;
    let bankAccountMasked: string | undefined;
    let bankIfsc: string | undefined;
    let bankName: string | undefined;
    let accountHolderName: string | undefined;

    if (payoutMethod === 'upi') {
      upiId = String(req.body?.upiId || '').trim();
      if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,32}$/.test(upiId)) {
        return res.status(400).json({
          error: 'Enter a valid UPI ID (e.g. yourname@okaxis, phone@ybl, or name@yesfam).',
        });
      }
    } else {
      const cleanAcct = String(req.body?.bankAccountNumber || '').replace(/\s+/g, '');
      const cleanIfsc = String(req.body?.bankIfsc || '').trim().toUpperCase();
      const cleanBankName = String(req.body?.bankName || '').trim().slice(0, 80);
      const cleanHolder = String(req.body?.accountHolderName || req.body?.sellerName || '')
        .trim()
        .slice(0, 80);

      if (!/^\d{9,18}$/.test(cleanAcct)) {
        return res.status(400).json({
          error: 'Enter a valid Bank Account Number (9 to 18 digits).',
        });
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
        return res.status(400).json({
          error: 'Enter a valid 11-character Indian IFSC code (e.g. SBIN0001234, HDFC0000123).',
        });
      }
      if (!/^[a-zA-Z0-9 .&'()-]{2,80}$/.test(cleanBankName)) {
        return res.status(400).json({
          error: 'Enter a valid Bank Name (2 to 80 characters).',
        });
      }
      if (!/^[a-zA-Z0-9 .'-]{2,80}$/.test(cleanHolder)) {
        return res.status(400).json({
          error: 'Enter the Bank Account Holder Name (2 to 80 characters).',
        });
      }

      bankAccountNumber = cleanAcct;
      bankAccountMasked = maskBankAccountNumber(cleanAcct);
      bankIfsc = cleanIfsc;
      bankName = cleanBankName;
      accountHolderName = cleanHolder;
    }

    const normalizedTxKey = depositTxid.toLowerCase();
    const alreadyUsed = sellOrders.some(
      (o) => o.depositTxid.toLowerCase() === normalizedTxKey && o.status !== 'refunded'
    );
    if (alreadyUsed) {
      return res.status(409).json({
        error: 'This on-chain XYPH transfer has already been claimed by a sell order.',
      });
    }

    // Verify the exact on-chain transfer directly from the node ledger/mempool
    const txDetail = node.getTransactionDetail(depositTxid);
    if (!txDetail) {
      return res.status(404).json({
        error: 'On-chain XYPH deposit transaction was not found on this node.',
      });
    }

    const treasuryAddr = node.meta.fund_address;
    const treasuryReceivedUnits = txDetail.outs
      .filter((o) => o.addr === treasuryAddr)
      .reduce((acc, o) => acc + o.value, 0);

    if (treasuryReceivedUnits < MERCHANT_CONFIG.minSellXyph * UNIT) {
      return res.status(400).json({
        error: `Transfer must send at least ${MERCHANT_CONFIG.minSellXyph} ${SYMBOL} to the official XYPH Network Treasury address.`,
      });
    }

    const senderXyph = txDetail.ins.find((inp) => inp.addr)?.addr || '';
    if (!senderXyph || !normalizeToXypherAddress(senderXyph)) {
      return res.status(400).json({
        error: 'Could not determine verified sender wallet from the on-chain transaction.',
      });
    }
    const senderEvm = xypherToEvmAddress(senderXyph);
    const xyphAmount = Number((treasuryReceivedUnits / UNIT).toFixed(4));

    // Lock authoritative server-side C++17 Supply-Demand live sell price & payout
    const sellQuote = quoteSellCpp(getLiveCppMarketInput(marketState), xyphAmount);
    const executionPriceInr = sellQuote.executionPriceInr;
    const inrPayout = sellQuote.outputAmount;
    const sellerName =
      accountHolderName ||
      String(req.body?.sellerName || '').trim().slice(0, 60) ||
      'XYPH Seller';
    const now = Math.floor(Date.now() / 1000);

    const sellOrder: SellOrder = {
      id: `SELL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      sellerXyph: senderXyph,
      sellerEvm: senderEvm,
      xyphAmount,
      xyphUnits: treasuryReceivedUnits,
      executionPriceInr,
      inrPayout,
      payoutMethod,
      upiId,
      ...(bankAccountNumber ? { bankAccountNumber } : {}),
      ...(bankAccountMasked ? { bankAccountMasked } : {}),
      ...(bankIfsc ? { bankIfsc } : {}),
      ...(bankName ? { bankName } : {}),
      ...(accountHolderName ? { accountHolderName } : {}),
      sellerName,
      depositTxid: txDetail.txid,
      status: 'pending_payout',
      createdAt: now,
      updatedAt: now,
      payoutUtr: null,
      refundTxid: null,
      note: null,
    };

    sellOrders.unshift(sellOrder);
    saveSellOrders(sellOrders);
    recordMarketTrade({
      id: sellOrder.id,
      side: 'sell',
      xyphAmount,
      inrAmount: inrPayout,
      traderLabel: sellerName,
      walletAddress: senderEvm || senderXyph,
      txid: txDetail.txid,
    });

    return res.status(201).json({
      ok: true,
      order: sanitizeSellOrderForPublic(sellOrder),
      market: getMarketTicker(),
    });
  });

  app.get('/api/payments/sell-orders', (req, res) => {
    const rawAddr = String(req.query.address || '').trim();
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({ error: 'Provide a valid wallet address to view sell orders.' });
    }
    const matching = sellOrders
      .filter((o) => o.sellerXyph === normalized)
      .map(sanitizeSellOrderForPublic);
    return res.json({ orders: matching });
  });

  app.get('/api/payments/admin/sell-orders', requireMerchantAdmin, (_req, res) => {
    return res.json({
      orders: sellOrders.map((o) => ({ ...o, payoutMethod: o.payoutMethod || 'upi' })),
      summary: computeSellSummary(sellOrders),
    });
  });

  app.post('/api/payments/admin/sell-orders/:id/payout', requireMerchantAdmin, (req, res) => {
    const id = String(req.params.id || '').trim();
    const order = sellOrders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: 'Sell order not found' });
    if (order.status !== 'pending_payout') {
      return res.status(409).json({ error: `Sell order is already ${order.status}` });
    }
    const payoutUtr = String(req.body?.payoutUtr || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6,32}$/.test(payoutUtr)) {
      return res.status(400).json({
        error: 'Enter the UPI / Bank IMPS-NEFT UTR Reference ID (6–32 letters or digits) to confirm INR payout.',
      });
    }
    order.status = 'paid';
    order.payoutUtr = payoutUtr;
    order.updatedAt = Math.floor(Date.now() / 1000);
    saveSellOrders(sellOrders);
    return res.json({ ok: true, order });
  });

  app.post('/api/payments/admin/sell-orders/:id/refund', requireMerchantAdmin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const order = sellOrders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ error: 'Sell order not found' });
    if (order.status !== 'pending_payout') {
      return res.status(409).json({ error: `Sell order is already ${order.status}` });
    }
    if (settlingSellIds.has(id)) {
      return res.status(409).json({ error: 'Refund settlement is already in progress' });
    }

    settlingSellIds.add(id);
    try {
      const refunded = await node.disburseTreasuryPayment(
        order.sellerXyph,
        order.xyphUnits,
        `REFUND-${order.id}`
      );
      order.status = 'refunded';
      order.refundTxid = refunded.txid;
      order.note =
        String(req.body?.reason || '').trim().slice(0, 140) || 'Refunded XYPH back to seller wallet';
      order.updatedAt = Math.floor(Date.now() / 1000);
      saveSellOrders(sellOrders);
      marketState = rebuildMarketStateFromRealOrders();
      saveMarketState(marketState);
      broadcastMarketUpdate();
      return res.json({ ok: true, order, market: getMarketTicker() });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to refund XYPH on-chain',
      });
    } finally {
      settlingSellIds.delete(id);
    }
  });

  // =====================================================================
  // MULTI-CRYPTO EXCHANGE & BUY XYPH WITH CRYPTO (COLLECTION VAULTS)
  // =====================================================================
  const loadCryptoExchangeOrders = (): CryptoExchangeOrder[] => {
    try {
      if (!fs.existsSync(CRYPTO_EXCHANGE_ORDERS_PATH)) return [];
      const raw = JSON.parse(fs.readFileSync(CRYPTO_EXCHANGE_ORDERS_PATH, 'utf-8'));
      return Array.isArray(raw) ? (raw as CryptoExchangeOrder[]) : [];
    } catch {
      return [];
    }
  };

  const saveCryptoExchangeOrders = (orders: CryptoExchangeOrder[]): void => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = CRYPTO_EXCHANGE_ORDERS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2), 'utf-8');
    fs.renameSync(tmp, CRYPTO_EXCHANGE_ORDERS_PATH);
  };

  const cryptoExchangeOrders: CryptoExchangeOrder[] = loadCryptoExchangeOrders();
  const settlingCryptoTxHashes = new Set<string>();
  const cryptoExchangeRateBuckets = new Map<string, number[]>();

  // Cached live USD reference prices from fixed CoinGecko endpoint (90s TTL, safe fallback)
  let liveCoinPricesCache: {
    fetchedAt: number;
    pricesUsd: Partial<Record<SupportedCoinSymbol, number>>;
  } = { fetchedAt: 0, pricesUsd: {} };

  const COINGECKO_SIMPLE_PRICE_URL =
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,bitcoin,tron,binancecoin,polygon-ecosystem-token,monad,stellar&vs_currencies=usd';

  async function refreshLiveCoinPrices(): Promise<void> {
    if (Date.now() - liveCoinPricesCache.fetchedAt < 90_000) return;
    liveCoinPricesCache.fetchedAt = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(COINGECKO_SIMPLE_PRICE_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);
      if (!resp.ok) return;
      const data = (await resp.json()) as Record<string, { usd?: number }>;
      const updated: Partial<Record<SupportedCoinSymbol, number>> = {};
      for (const coin of SUPPORTED_EXCHANGE_COINS) {
        if (!coin.coingeckoId) continue;
        const usd = data?.[coin.coingeckoId]?.usd;
        if (typeof usd === 'number' && Number.isFinite(usd) && usd > 0) {
          updated[coin.symbol] = usd;
        }
      }
      if (Object.keys(updated).length > 0) {
        liveCoinPricesCache = { fetchedAt: Date.now(), pricesUsd: updated };
      }
    } catch {
      // Keep cached or fallback reference prices if offline
    }
  }

  function getCoinUsdPrice(symbol: SupportedCoinSymbol): { priceUsd: number; source: 'live' | 'reference' } {
    if (symbol === 'XYPH') {
      const ticker = getMarketTicker();
      return {
        priceUsd: Math.max(0.000001, ticker.priceInr / INR_PER_USD),
        source: 'live',
      };
    }
    const cached = liveCoinPricesCache.pricesUsd[symbol];
    if (typeof cached === 'number' && Number.isFinite(cached) && cached > 0) {
      return { priceUsd: cached, source: 'live' };
    }
    return {
      priceUsd: SUPPORTED_COIN_MAP[symbol].fallbackUsdPrice,
      source: 'reference',
    };
  }

  function computeCryptoVaultSummary(): CryptoVaultSummary {
    const byCoin: CryptoVaultSummary['byCoin'] = {};
    for (const coin of SUPPORTED_EXCHANGE_COINS) {
      byCoin[coin.symbol] = {
        amount: 0,
        usd: 0,
        count: 0,
        collectionAddress: coin.collectionAddress,
      };
    }
    let completedOrders = 0;
    let pendingPayoutOrders = 0;
    let totalCollectedUsd = 0;
    let totalXyphDisbursed = 0;

    for (const o of cryptoExchangeOrders) {
      if (o.status === 'completed') completedOrders++;
      else pendingPayoutOrders++;
      if (o.kind === 'transfer') {
        continue;
      }
      totalCollectedUsd += o.usdValue;
      if (o.toCoin === 'XYPH' && o.status === 'completed') {
        totalXyphDisbursed += o.toAmount;
      }
      const bucket = byCoin[o.fromCoin];
      if (bucket) {
        bucket.amount = Number((bucket.amount + o.fromAmount).toFixed(8));
        bucket.usd = Number((bucket.usd + o.usdValue).toFixed(2));
        bucket.count += 1;
      }
    }

    return {
      totalOrders: cryptoExchangeOrders.length,
      completedOrders,
      pendingPayoutOrders,
      totalCollectedUsd: Number(totalCollectedUsd.toFixed(2)),
      totalXyphDisbursed: Number(totalXyphDisbursed.toFixed(4)),
      byCoin,
    };
  }

  function buildExchangeAssets(): CryptoExchangeAsset[] {
    const ticker = getMarketTicker();
    const xyphPriceUsd = Math.max(0.000001, ticker.priceInr / INR_PER_USD);
    const summary = computeCryptoVaultSummary();

    return SUPPORTED_EXCHANGE_COINS.map((coin) => {
      const { priceUsd, source } = getCoinUsdPrice(coin.symbol);
      const priceInr = Number((priceUsd * INR_PER_USD).toFixed(6));
      const xyphPerCoin = coin.symbol === 'XYPH' ? 1 : Number((priceUsd / xyphPriceUsd).toFixed(4));
      const vault = summary.byCoin[coin.symbol];
      return {
        symbol: coin.symbol,
        name: coin.name,
        network: coin.network,
        standard: coin.standard,
        addressFormatLabel: coin.addressFormatLabel,
        collectionAddress: coin.collectionAddress,
        ...(coin.collectionXyphAddress ? { collectionXyphAddress: coin.collectionXyphAddress } : {}),
        ...(coin.evmChainId ? { evmChainId: coin.evmChainId } : {}),
        ...(coin.evmChainIdHex ? { evmChainIdHex: coin.evmChainIdHex } : {}),
        priceUsd,
        priceInr,
        xyphPerCoin,
        decimals: coin.decimals,
        minAmount: coin.minAmount,
        accentColor: coin.accentColor,
        addressPlaceholder: coin.addressPlaceholder,
        txHashPlaceholder: coin.txHashPlaceholder,
        ...(coin.explorerTxPrefix ? { explorerTxPrefix: coin.explorerTxPrefix } : {}),
        ...(coin.paymentUriScheme ? { paymentUriScheme: coin.paymentUriScheme } : {}),
        totalCollectedAmount: vault?.amount ?? 0,
        totalCollectedUsd: vault?.usd ?? 0,
        collectedTxCount: vault?.count ?? 0,
        priceSource: source,
      };
    });
  }

  app.get('/api/exchange/assets', async (_req, res) => {
    await refreshLiveCoinPrices();
    const ticker = getMarketTicker();
    const assets = buildExchangeAssets();
    const summary = computeCryptoVaultSummary();
    return res.json({
      assets,
      summary,
      usdToInr: INR_PER_USD,
      xyphPriceInr: ticker.priceInr,
      xyphPriceUsd: Number((ticker.priceInr / INR_PER_USD).toFixed(6)),
      updatedAt: Math.floor(Date.now() / 1000),
    });
  });

  app.get('/api/exchange/orders', (req, res) => {
    const rawAddr = String(req.query.address || '').trim().toLowerCase();
    const rawCoin = String(req.query.coin || '').trim().toUpperCase();
    const normalizedXyph = rawAddr ? normalizeToXypherAddress(rawAddr)?.toLowerCase() : null;

    let list = cryptoExchangeOrders;
    if (rawCoin && isSupportedCoinSymbol(rawCoin)) {
      list = list.filter((o) => o.fromCoin === rawCoin || o.toCoin === rawCoin);
    }
    if (rawAddr) {
      list = list.filter(
        (o) =>
          o.recipientAddress.toLowerCase() === rawAddr ||
          (o.recipientXyph && o.recipientXyph.toLowerCase() === (normalizedXyph || rawAddr)) ||
          o.collectionAddress.toLowerCase() === rawAddr
      );
    }
    return res.json({
      orders: list.slice(0, 100),
      summary: computeCryptoVaultSummary(),
    });
  });

  app.post('/api/exchange/buy-xyph', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cryptoExchangeRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 15) {
      return res.status(429).json({ error: 'Too many crypto buy requests. Please wait a minute.' });
    }
    recent.push(nowMs);
    cryptoExchangeRateBuckets.set(clientIp, recent);

    await refreshLiveCoinPrices();

    const rawCoin = String(req.body?.payCoin || '').trim().toUpperCase();
    if (!isSupportedCoinSymbol(rawCoin) || rawCoin === 'XYPH') {
      return res.status(400).json({
        error: 'Select a valid supported payment coin (ETH, SOL, BTC, TRX, BNB, POL, MON, or XLM).',
      });
    }
    const payCoin: SupportedCoinSymbol = rawCoin;
    const coinDef = SUPPORTED_COIN_MAP[payCoin];

    const payAmount = Number(req.body?.payAmount);
    if (!Number.isFinite(payAmount) || payAmount < coinDef.minAmount || payAmount > 10_000_000) {
      return res.status(400).json({
        error: `Enter a valid ${payCoin} amount (minimum ${coinDef.minAmount} ${payCoin}).`,
      });
    }

    const depositTxHash = String(req.body?.depositTxHash || '').trim();
    if (!validateCoinTxHash(payCoin, depositTxHash)) {
      return res.status(400).json({
        error: `Enter a valid ${coinDef.name} (${payCoin}) transaction hash for your payment to ${coinDef.collectionAddress}.`,
      });
    }

    const recipientInput = String(req.body?.recipientAddress || '').trim();
    const recipientXyph = normalizeToXypherAddress(recipientInput);
    if (!recipientXyph) {
      return res.status(400).json({
        error: 'Provide a valid MetaMask (0x...) or native Xypher wallet address to receive XYPH.',
      });
    }

    const txKey = `${payCoin}:${depositTxHash.toLowerCase()}`;
    const duplicate =
      settlingCryptoTxHashes.has(txKey) ||
      cryptoExchangeOrders.some(
        (o) => o.fromCoin === payCoin && o.depositTxHash.toLowerCase() === depositTxHash.toLowerCase()
      );
    if (duplicate) {
      return res.status(409).json({
        error: `This ${payCoin} transaction hash has already been credited.`,
      });
    }

    const { priceUsd: coinPriceUsd } = getCoinUsdPrice(payCoin);
    const usdValue = Number((payAmount * coinPriceUsd).toFixed(4));
    const inrValue = Number((usdValue * INR_PER_USD).toFixed(2));
    if (inrValue < 1) {
      return res.status(400).json({
        error: `Minimum purchase equivalent is ₹1 (~$0.012 USD). Increase your ${payCoin} amount.`,
      });
    }

    const buyQuote = quoteBuyCpp(getLiveCppMarketInput(marketState), inrValue);
    const xyphAmount = Number(buyQuote.outputAmount.toFixed(4));
    const xyphUnits = Math.max(1, Math.round(xyphAmount * UNIT));
    const payerLabel =
      String(req.body?.payerLabel || '').trim().slice(0, 60) || `${coinDef.name} Buyer`;
    const now = Math.floor(Date.now() / 1000);

    const order: CryptoExchangeOrder = {
      id: `CBX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      kind: 'buy_xyph',
      fromCoin: payCoin,
      toCoin: 'XYPH',
      fromAmount: payAmount,
      toAmount: xyphAmount,
      fromPriceUsd: coinPriceUsd,
      toPriceUsd: Number((buyQuote.executionPriceInr / INR_PER_USD).toFixed(6)),
      usdValue,
      inrValue,
      collectionAddress: coinDef.collectionAddress,
      depositTxHash,
      recipientAddress: recipientInput,
      recipientXyph,
      settlementTxid: null,
      settlementBlockHeight: null,
      status: 'pending_payout',
      createdAt: now,
      updatedAt: now,
      note: `Collected ${payAmount} ${payCoin} in ${coinDef.collectionAddress}`,
    };

    settlingCryptoTxHashes.add(txKey);
    try {
      const settled = await node.disburseTreasuryPayment(recipientXyph, xyphUnits, order.id);
      order.status = 'completed';
      order.settlementTxid = settled.txid;
      order.settlementBlockHeight = settled.blockHeight;
      order.updatedAt = Math.floor(Date.now() / 1000);

      cryptoExchangeOrders.unshift(order);
      saveCryptoExchangeOrders(cryptoExchangeOrders);

      recordMarketTrade({
        id: order.id,
        side: 'buy',
        xyphAmount: order.toAmount,
        inrAmount: order.inrValue,
        traderLabel: `${payerLabel} (${payCoin})`,
        walletAddress: xypherToEvmAddress(recipientXyph),
        txid: settled.txid,
      });

      return res.status(201).json({
        ok: true,
        order,
        market: getMarketTicker(),
        summary: computeCryptoVaultSummary(),
      });
    } catch (err) {
      return res.status(500).json({
        error:
          err instanceof Error
            ? `Failed to credit XYPH automatically: ${err.message}`
            : 'Failed to credit XYPH automatically.',
      });
    } finally {
      settlingCryptoTxHashes.delete(txKey);
    }
  });

  app.post('/api/exchange/swap', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cryptoExchangeRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 15) {
      return res.status(429).json({ error: 'Too many exchange requests. Please wait a minute.' });
    }
    recent.push(nowMs);
    cryptoExchangeRateBuckets.set(clientIp, recent);

    await refreshLiveCoinPrices();

    const rawFrom = String(req.body?.fromCoin || '').trim().toUpperCase();
    const rawTo = String(req.body?.toCoin || '').trim().toUpperCase();
    if (!isSupportedCoinSymbol(rawFrom) || !isSupportedCoinSymbol(rawTo)) {
      return res.status(400).json({ error: 'Select valid supported coins to exchange.' });
    }
    if (rawFrom === rawTo) {
      return res.status(400).json({ error: 'Source coin and destination coin must be different.' });
    }

    const fromCoin: SupportedCoinSymbol = rawFrom;
    const toCoin: SupportedCoinSymbol = rawTo;
    const fromDef = SUPPORTED_COIN_MAP[fromCoin];
    const toDef = SUPPORTED_COIN_MAP[toCoin];

    const recipientAddress = String(req.body?.recipientAddress || '').trim();
    if (!validateCoinRecipientOrMetaMask(toCoin, recipientAddress)) {
      return res.status(400).json({
        error: `Enter a valid ${toDef.name} (${toCoin}) or MetaMask (0x...) receiving wallet address (${toDef.addressPlaceholder}).`,
      });
    }

    const depositTxHash = String(req.body?.depositTxHash || '').trim();
    if (!validateCoinTxHash(fromCoin, depositTxHash)) {
      return res.status(400).json({
        error: `Enter a valid ${fromDef.name} (${fromCoin}) deposit transaction hash.`,
      });
    }

    const txKey = `${fromCoin}:${depositTxHash.toLowerCase()}`;
    const alreadyClaimed =
      settlingCryptoTxHashes.has(txKey) ||
      cryptoExchangeOrders.some(
        (o) => o.fromCoin === fromCoin && o.depositTxHash.toLowerCase() === depositTxHash.toLowerCase()
      ) ||
      (fromCoin === 'XYPH' &&
        sellOrders.some(
          (o) => o.depositTxid.toLowerCase() === depositTxHash.toLowerCase() && o.status !== 'refunded'
        ));
    if (alreadyClaimed) {
      return res.status(409).json({
        error: 'This deposit transaction hash has already been claimed by an exchange order.',
      });
    }

    let verifiedFromAmount = Number(req.body?.fromAmount);

    // If swapping FROM XYPH, verify the real on-chain XYPH deposit into the XYPH Collection Vault!
    if (fromCoin === 'XYPH') {
      const txDetail = node.getTransactionDetail(depositTxHash);
      if (!txDetail) {
        return res.status(404).json({
          error: 'On-chain XYPH deposit transaction was not found on XYPH Network.',
        });
      }
      const validVaultTargets = new Set([
        XYPH_COLLECTION_NATIVE_ADDRESS,
        node.meta.fund_address,
      ]);
      const receivedUnits = txDetail.outs
        .filter((o) => validVaultTargets.has(o.addr))
        .reduce((acc, o) => acc + o.value, 0);
      if (receivedUnits <= 0) {
        return res.status(400).json({
          error: `Transaction did not send XYPH to the verified XYPH collection vault (${fromDef.collectionAddress}).`,
        });
      }
      verifiedFromAmount = Number((receivedUnits / UNIT).toFixed(4));
      if (verifiedFromAmount < fromDef.minAmount) {
        return res.status(400).json({
          error: `Minimum XYPH swap amount is ${fromDef.minAmount} XYPH.`,
        });
      }
    } else if (!Number.isFinite(verifiedFromAmount) || verifiedFromAmount < fromDef.minAmount) {
      return res.status(400).json({
        error: `Enter a valid ${fromCoin} amount (minimum ${fromDef.minAmount} ${fromCoin}).`,
      });
    }

    const { priceUsd: fromPriceUsd } = getCoinUsdPrice(fromCoin);
    const { priceUsd: toPriceUsd } = getCoinUsdPrice(toCoin);
    const usdValue = Number((verifiedFromAmount * fromPriceUsd).toFixed(4));
    const inrValue = Number((usdValue * INR_PER_USD).toFixed(2));

    let toAmount = 0;
    let marketUpdated = false;
    let settlementTxid: string | null = null;
    let settlementBlockHeight: number | null = null;
    let status: CryptoExchangeOrder['status'] = 'pending_payout';
    let recipientXyph: string | null = null;

    settlingCryptoTxHashes.add(txKey);
    try {
      if (toCoin === 'XYPH') {
        recipientXyph = normalizeToXypherAddress(recipientAddress);
        if (!recipientXyph) {
          return res.status(400).json({ error: 'Invalid Xypher receiving wallet address.' });
        }
        const quote = quoteBuyCpp(getLiveCppMarketInput(marketState), Math.max(0.01, inrValue));
        toAmount = Number(quote.outputAmount.toFixed(4));
        const xyphUnits = Math.max(1, Math.round(toAmount * UNIT));
        const orderId = `SWP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const settled = await node.disburseTreasuryPayment(recipientXyph, xyphUnits, orderId);
        settlementTxid = settled.txid;
        settlementBlockHeight = settled.blockHeight;
        status = 'completed';

        const now = Math.floor(Date.now() / 1000);
        const order: CryptoExchangeOrder = {
          id: orderId,
          kind: 'swap',
          fromCoin,
          toCoin,
          fromAmount: verifiedFromAmount,
          toAmount,
          fromPriceUsd,
          toPriceUsd: Number((quote.executionPriceInr / INR_PER_USD).toFixed(6)),
          usdValue,
          inrValue,
          collectionAddress: fromDef.collectionAddress,
          depositTxHash,
          recipientAddress,
          recipientXyph,
          settlementTxid,
          settlementBlockHeight,
          status,
          createdAt: now,
          updatedAt: now,
          note: `Swapped ${verifiedFromAmount} ${fromCoin} → ${toAmount} XYPH`,
        };
        cryptoExchangeOrders.unshift(order);
        saveCryptoExchangeOrders(cryptoExchangeOrders);
        recordMarketTrade({
          id: order.id,
          side: 'buy',
          xyphAmount: order.toAmount,
          inrAmount: order.inrValue,
          traderLabel: `Swap (${fromCoin} → XYPH)`,
          walletAddress: xypherToEvmAddress(recipientXyph),
          txid: settled.txid,
        });
        return res.status(201).json({
          ok: true,
          order,
          market: getMarketTicker(),
          summary: computeCryptoVaultSummary(),
        });
      }

      // From XYPH -> external crypto OR external -> external
      if (fromCoin === 'XYPH') {
        const sellQuote = quoteSellCpp(getLiveCppMarketInput(marketState), verifiedFromAmount);
        const sellUsd = sellQuote.outputAmount / INR_PER_USD;
        toAmount = Number((sellUsd / toPriceUsd).toFixed(Math.min(8, toDef.decimals + 2)));
        if (toAmount <= 0 && sellUsd > 0) toAmount = 1e-8;
        marketUpdated = true;
      } else {
        toAmount = Number((usdValue / toPriceUsd).toFixed(Math.min(8, toDef.decimals + 2)));
        if (toAmount <= 0 && usdValue > 0) toAmount = 1e-8;
      }

      const now = Math.floor(Date.now() / 1000);
      const orderId = `SWP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      // When the recipient is a MetaMask (0x...) address, deliver REAL on-chain ERC-20 tokens immediately on XYPH Network!
      let tokenDelivery: import('./src/lib/types.ts').MetaMaskTokenDelivery | undefined;
      if (isValidEvmAddress(recipientAddress) && toDef.xyphTokenContract) {
        tokenDelivery = await node.creditExchangeTokenToMetaMask({
          symbol: toCoin,
          toEvm: recipientAddress,
          amount: toAmount,
          orderId,
        });
      }

      const order: CryptoExchangeOrder = {
        id: orderId,
        kind: 'swap',
        fromCoin,
        toCoin,
        fromAmount: verifiedFromAmount,
        toAmount,
        fromPriceUsd,
        toPriceUsd,
        usdValue,
        inrValue,
        collectionAddress: fromDef.collectionAddress,
        depositTxHash,
        recipientAddress: tokenDelivery ? tokenDelivery.toEvm : recipientAddress,
        recipientXyph: tokenDelivery ? normalizeToXypherAddress(tokenDelivery.toEvm) : null,
        settlementTxid: tokenDelivery ? tokenDelivery.txHash : null,
        settlementBlockHeight: tokenDelivery ? tokenDelivery.blockHeight : null,
        payoutFromAddress: tokenDelivery ? fromDef.collectionAddress : null,
        payoutMethod: tokenDelivery ? 'metamask_evm' : undefined,
        payoutVerifiedOnChain: Boolean(tokenDelivery),
        tokenContractAddress: tokenDelivery ? tokenDelivery.contractAddress : null,
        metamaskDelivered: Boolean(tokenDelivery),
        status: tokenDelivery ? 'completed' : 'pending_payout',
        createdAt: now,
        updatedAt: now,
        note: tokenDelivery
          ? `Delivered ${toAmount} ${toCoin} on-chain to MetaMask ${tokenDelivery.toEvm} (Contract ${tokenDelivery.contractAddress})`
          : `Collected ${verifiedFromAmount} ${fromCoin} in ${fromDef.collectionAddress} · Payout ${toAmount} ${toCoin} to ${recipientAddress}`,
      };
      cryptoExchangeOrders.unshift(order);
      saveCryptoExchangeOrders(cryptoExchangeOrders);

      if (marketUpdated) {
        recordMarketTrade({
          id: order.id,
          side: 'sell',
          xyphAmount: verifiedFromAmount,
          inrAmount: inrValue,
          traderLabel: `Swap (XYPH → ${toCoin})`,
          walletAddress: fromDef.collectionAddress,
          txid: depositTxHash,
        });
      }

      return res.status(201).json({
        ok: true,
        order,
        ...(tokenDelivery ? { tokenDelivery } : {}),
        ...(marketUpdated ? { market: getMarketTicker() } : {}),
        summary: computeCryptoVaultSummary(),
      });
    } catch (err) {
      return res.status(500).json({
        error:
          err instanceof Error ? `Crypto exchange failed: ${err.message}` : 'Crypto exchange failed.',
      });
    } finally {
      settlingCryptoTxHashes.delete(txKey);
    }
  });

  /**
   * Verifies a transaction hash against hardcoded official public blockchain RPC / explorer APIs
   * (strictly allowlisted hosts; never accepts user-supplied URLs).
   */
  async function verifyPublicChainTx(
    coin: SupportedCoinSymbol,
    txHash: string
  ): Promise<{ verified: boolean }> {
    const clean = txHash.trim();
    if (coin === 'XYPH') {
      return { verified: Boolean(node.getTransactionDetail(clean)) };
    }
    try {
      if (coin === 'ETH' || coin === 'BNB' || coin === 'POL') {
        const rpcMap: Record<'ETH' | 'BNB' | 'POL', string> = {
          ETH: 'https://ethereum-rpc.publicnode.com',
          BNB: 'https://bsc-rpc.publicnode.com',
          POL: 'https://polygon-bor-rpc.publicnode.com',
        };
        const resp = await fetch(rpcMap[coin], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getTransactionByHash',
            params: [clean],
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return { verified: false };
        const data = (await resp.json()) as { result?: { hash?: string } | null };
        return { verified: Boolean(data?.result?.hash) };
      }
      if (coin === 'SOL') {
        const resp = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getSignatureStatuses',
            params: [[clean], { searchTransactionHistory: true }],
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return { verified: false };
        const data = (await resp.json()) as {
          result?: { value?: Array<{ err?: unknown } | null> };
        };
        const statusItem = data?.result?.value?.[0];
        return { verified: Boolean(statusItem && statusItem.err === null) };
      }
      if (coin === 'BTC') {
        const resp = await fetch(`https://mempool.space/api/tx/${encodeURIComponent(clean)}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return { verified: false };
        const data = (await resp.json()) as { txid?: string };
        return { verified: Boolean(data?.txid) };
      }
      if (coin === 'TRX') {
        const resp = await fetch('https://api.trongrid.io/wallet/gettransactionbyid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: clean }),
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok) return { verified: false };
        const data = (await resp.json()) as { txID?: string };
        return { verified: Boolean(data?.txID) };
      }
      if (coin === 'XLM') {
        const resp = await fetch(
          `https://horizon.stellar.org/transactions/${encodeURIComponent(clean)}`,
          { signal: AbortSignal.timeout(4000) }
        );
        if (!resp.ok) return { verified: false };
        const data = (await resp.json()) as { id?: string; successful?: boolean };
        return { verified: Boolean(data?.id && data?.successful !== false) };
      }
    } catch {
      return { verified: false };
    }
    return { verified: false };
  }

  const ALLOWED_PAYOUT_METHODS = new Set<
    NonNullable<CryptoExchangeOrder['payoutMethod']>
  >(['onchain_xyph', 'metamask_evm', 'phantom_sol', 'tronlink_trx', 'external_wallet']);

  // Settle a pending exchange swap order with a REAL on-chain transfer hash to the recipient wallet
  app.post('/api/exchange/orders/:id/settle-payout', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cryptoExchangeRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many payout settlement requests. Please wait a minute.' });
    }
    recent.push(nowMs);
    cryptoExchangeRateBuckets.set(clientIp, recent);

    const orderId = String(req.params.id || '').trim();
    const order = cryptoExchangeOrders.find((o) => o.id === orderId);
    if (!order) {
      return res.status(404).json({ error: 'Exchange order not found.' });
    }
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'This exchange order has already been transferred and completed.' });
    }

    const payoutTxHash = String(req.body?.payoutTxHash || '').trim();
    const toDef = SUPPORTED_COIN_MAP[order.toCoin];
    const overrideRecipient = String(req.body?.recipientAddress || '').trim();
    const targetRecipient = overrideRecipient || order.recipientAddress;

    if (!validateCoinRecipientOrMetaMask(order.toCoin, targetRecipient)) {
      return res.status(400).json({
        error: `Enter a valid ${toDef.name} (${order.toCoin}) or MetaMask (0x...) destination wallet address (${toDef.addressPlaceholder}).`,
      });
    }

    let verified = false;
    let finalSettlementRef = '';
    let settlementBlockHeight: number | null = order.settlementBlockHeight ?? null;
    let payoutAccounting: import('./src/lib/types.ts').TransferAccountingReceipt | undefined;
    let tokenDelivery: import('./src/lib/types.ts').MetaMaskTokenDelivery | undefined;

    if (payoutTxHash) {
      if (!validateCoinTxHash(order.toCoin, payoutTxHash)) {
        return res.status(400).json({
          error: `Enter a valid ${toDef.name} (${order.toCoin}) transaction hash (${toDef.txHashPlaceholder}).`,
        });
      }

      const duplicateHash = cryptoExchangeOrders.some(
        (o) =>
          o.id !== order.id &&
          ((o.settlementTxid && o.settlementTxid.toLowerCase() === payoutTxHash.toLowerCase()) ||
            (o.fromCoin === order.toCoin && o.depositTxHash.toLowerCase() === payoutTxHash.toLowerCase()))
      );
      if (duplicateHash) {
        return res.status(409).json({
          error: 'This transaction hash is already linked to another exchange order.',
        });
      }

      const check = await verifyPublicChainTx(order.toCoin, payoutTxHash);
      verified = check.verified;
      if (order.toCoin === 'XYPH' && !verified) {
        return res.status(400).json({
          error: 'On-chain XYPH payout transaction was not found on XYPH Network.',
        });
      }
      finalSettlementRef = payoutTxHash;
    } else if (order.toCoin === 'XYPH') {
      // Wallet-address-only XYPH payout: disburse real on-chain XYPH to the recipient wallet
      const recipientXyph = normalizeToXypherAddress(targetRecipient);
      if (!recipientXyph) {
        return res.status(400).json({ error: 'Enter a valid XYPH or MetaMask (0x...) wallet address.' });
      }
      const payoutUnits = Math.round(order.toAmount * UNIT);
      if (!Number.isInteger(payoutUnits) || payoutUnits <= 0) {
        return res.status(400).json({ error: 'Invalid XYPH payout amount.' });
      }
      const senderAddr = node.meta.fund_address;
      const senderBefore = node.getAddressInfo(senderAddr).spendable;
      const receiverBefore = node.getAddressInfo(recipientXyph).spendable;
      const disbursed = await node.disburseTreasuryPayment(recipientXyph, payoutUnits, order.id);
      const senderAfter = node.getAddressInfo(senderAddr).spendable;
      const receiverAfter = node.getAddressInfo(recipientXyph).spendable;
      finalSettlementRef = disbursed.txid;
      settlementBlockHeight = disbursed.blockHeight;
      verified = true;
      payoutAccounting = {
        txid: disbursed.txid,
        blockHeight: disbursed.blockHeight,
        fromAddress: senderAddr,
        toAddress: recipientXyph,
        amountUnits: payoutUnits,
        feeUnits: NETWORK_FEE_UNITS,
        senderBefore,
        senderAfter,
        receiverBefore,
        receiverAfter,
        verifiedSufficientBalance: true,
      };
    } else if (isValidEvmAddress(targetRecipient) && toDef.xyphTokenContract) {
      // Real on-chain ERC-20 token transfer into user's MetaMask (0x...) wallet on XYPH Network!
      tokenDelivery = await node.creditExchangeTokenToMetaMask({
        symbol: order.toCoin,
        toEvm: targetRecipient,
        amount: order.toAmount,
        orderId: order.id,
      });
      finalSettlementRef = tokenDelivery.txHash;
      settlementBlockHeight = tokenDelivery.blockHeight;
      verified = true;
    } else {
      // Wallet-address-only payout confirmation for non-EVM native addresses
      const refDigest = crypto
        .createHash('sha256')
        .update(`${order.id}:${targetRecipient}:${Date.now()}`)
        .digest('hex')
        .slice(0, 16)
        .toUpperCase();
      finalSettlementRef = `WALLET-${order.toCoin}-${refDigest}`;
    }

    const rawMethod = String(
      req.body?.payoutMethod ||
        (tokenDelivery
          ? 'metamask_evm'
          : order.toCoin === 'XYPH' && !payoutTxHash
          ? 'onchain_xyph'
          : 'external_wallet')
    );
    const payoutMethod: CryptoExchangeOrder['payoutMethod'] = ALLOWED_PAYOUT_METHODS.has(
      rawMethod as NonNullable<CryptoExchangeOrder['payoutMethod']>
    )
      ? (rawMethod as NonNullable<CryptoExchangeOrder['payoutMethod']>)
      : 'external_wallet';
    const senderAddress =
      String(req.body?.senderAddress || '').trim().slice(0, 120) ||
      (tokenDelivery
        ? toDef.collectionAddress
        : order.toCoin === 'XYPH' && !payoutTxHash
        ? node.meta.fund_address
        : null);

    order.recipientAddress = tokenDelivery ? tokenDelivery.toEvm : targetRecipient;
    if (order.toCoin === 'XYPH' || tokenDelivery) {
      order.recipientXyph = normalizeToXypherAddress(order.recipientAddress);
    }

    order.status = 'completed';
    order.settlementTxid = finalSettlementRef;
    order.settlementBlockHeight = settlementBlockHeight;
    order.payoutFromAddress = senderAddress;
    order.payoutMethod = payoutMethod;
    order.payoutVerifiedOnChain = verified;
    if (tokenDelivery) {
      order.tokenContractAddress = tokenDelivery.contractAddress;
      order.metamaskDelivered = true;
    }
    order.updatedAt = Math.floor(Date.now() / 1000);
    order.note = tokenDelivery
      ? `Delivered ${order.toAmount} ${order.toCoin} on-chain to MetaMask ${tokenDelivery.toEvm} (Contract ${tokenDelivery.contractAddress})`
      : payoutTxHash
      ? `Transferred ${order.toAmount} ${order.toCoin} to ${order.recipientAddress} (Tx ${payoutTxHash.slice(0, 14)}...)`
      : order.toCoin === 'XYPH'
      ? `Credited ${order.toAmount} ${order.toCoin} on-chain to ${order.recipientAddress} (Tx ${finalSettlementRef.slice(0, 14)}...)`
      : `Wallet address verified for ${order.toAmount} ${order.toCoin} payout to ${order.recipientAddress}`;
    saveCryptoExchangeOrders(cryptoExchangeOrders);

    return res.json({
      ok: true,
      order,
      verifiedOnChain: verified,
      ...(payoutAccounting ? { accounting: payoutAccounting } : {}),
      ...(tokenDelivery ? { tokenDelivery } : {}),
      summary: computeCryptoVaultSummary(),
    });
  });

  // Live MetaMask ERC-20 exchanged crypto balances on XYPH Network (Chain ID 5790032)
  app.get('/api/exchange/metamask-tokens/:evmAddr', (req, res) => {
    const raw = String(req.params.evmAddr || '').trim();
    if (!isValidEvmAddress(raw)) {
      return res.status(400).json({ error: 'Invalid MetaMask (0x...) wallet address.' });
    }
    const tokens = node.getMetaMaskExchangeTokenBalances(raw);
    return res.json({
      evmAddress: raw,
      chainId: XYPHER_CHAIN_ID,
      chainIdHex: XYPHER_CHAIN_ID_HEX,
      tokens,
    });
  });

  // Deliver / claim any uncredited exchange order directly on-chain into a MetaMask (0x...) wallet
  app.post('/api/exchange/orders/:id/claim-metamask', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cryptoExchangeRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many MetaMask transfer requests. Please wait a minute.' });
    }
    recent.push(nowMs);
    cryptoExchangeRateBuckets.set(clientIp, recent);

    const orderId = String(req.params.id || '').trim();
    const order = cryptoExchangeOrders.find((o) => o.id === orderId);
    if (!order) {
      return res.status(404).json({ error: 'Exchange order not found.' });
    }
    if (order.metamaskDelivered || (order.status === 'completed' && order.payoutVerifiedOnChain)) {
      return res.status(409).json({
        error: 'This exchange order has already been delivered on-chain to a wallet.',
      });
    }

    const metamaskAddress = String(req.body?.metamaskAddress || '').trim();
    if (!isValidEvmAddress(metamaskAddress)) {
      return res.status(400).json({
        error: 'Connect MetaMask or enter a valid MetaMask (0x...) wallet address.',
      });
    }

    try {
      if (order.toCoin === 'XYPH') {
        const recipientXyph = normalizeToXypherAddress(metamaskAddress);
        if (!recipientXyph) {
          return res.status(400).json({ error: 'Invalid MetaMask address.' });
        }
        const payoutUnits = Math.max(1, Math.round(order.toAmount * UNIT));
        const senderAddr = node.meta.fund_address;
        const senderBefore = node.getAddressInfo(senderAddr).spendable;
        const receiverBefore = node.getAddressInfo(recipientXyph).spendable;
        const disbursed = await node.disburseTreasuryPayment(recipientXyph, payoutUnits, order.id);
        const senderAfter = node.getAddressInfo(senderAddr).spendable;
        const receiverAfter = node.getAddressInfo(recipientXyph).spendable;

        order.recipientAddress = metamaskAddress;
        order.recipientXyph = recipientXyph;
        order.settlementTxid = disbursed.txid;
        order.settlementBlockHeight = disbursed.blockHeight;
        order.payoutFromAddress = senderAddr;
        order.payoutMethod = 'metamask_evm';
        order.payoutVerifiedOnChain = true;
        order.metamaskDelivered = true;
        order.status = 'completed';
        order.updatedAt = Math.floor(Date.now() / 1000);
        order.note = `Credited ${order.toAmount} XYPH on-chain to MetaMask ${metamaskAddress}`;
        saveCryptoExchangeOrders(cryptoExchangeOrders);

        return res.json({
          ok: true,
          order,
          accounting: {
            txid: disbursed.txid,
            blockHeight: disbursed.blockHeight,
            fromAddress: senderAddr,
            toAddress: recipientXyph,
            amountUnits: payoutUnits,
            feeUnits: NETWORK_FEE_UNITS,
            senderBefore,
            senderAfter,
            receiverBefore,
            receiverAfter,
            verifiedSufficientBalance: true,
          },
          summary: computeCryptoVaultSummary(),
        });
      }

      const tokenDelivery = await node.creditExchangeTokenToMetaMask({
        symbol: order.toCoin,
        toEvm: metamaskAddress,
        amount: order.toAmount,
        orderId: order.id,
      });

      order.recipientAddress = tokenDelivery.toEvm;
      order.recipientXyph = normalizeToXypherAddress(tokenDelivery.toEvm);
      order.settlementTxid = tokenDelivery.txHash;
      order.settlementBlockHeight = tokenDelivery.blockHeight;
      order.payoutFromAddress = SUPPORTED_COIN_MAP[order.toCoin].collectionAddress;
      order.payoutMethod = 'metamask_evm';
      order.payoutVerifiedOnChain = true;
      order.tokenContractAddress = tokenDelivery.contractAddress;
      order.metamaskDelivered = true;
      order.status = 'completed';
      order.updatedAt = Math.floor(Date.now() / 1000);
      order.note = `Delivered ${order.toAmount} ${order.toCoin} on-chain to MetaMask ${tokenDelivery.toEvm} (Contract ${tokenDelivery.contractAddress})`;
      saveCryptoExchangeOrders(cryptoExchangeOrders);

      return res.json({
        ok: true,
        order,
        tokenDelivery,
        summary: computeCryptoVaultSummary(),
      });
    } catch (err) {
      return res.status(400).json({
        error: err instanceof Error ? err.message : 'MetaMask on-chain token delivery failed.',
      });
    }
  });

  // Record a REAL direct wallet-to-wallet crypto transfer across any of the 9 supported coins
  app.post('/api/exchange/transfer', async (req, res) => {
    const clientIp = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cryptoExchangeRateBuckets.get(clientIp) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= 20) {
      return res.status(429).json({ error: 'Too many transfer requests. Please wait a minute.' });
    }
    recent.push(nowMs);
    cryptoExchangeRateBuckets.set(clientIp, recent);

    await refreshLiveCoinPrices();

    const rawCoin = String(req.body?.coin || '').trim().toUpperCase();
    if (!isSupportedCoinSymbol(rawCoin)) {
      return res.status(400).json({ error: 'Select a valid supported cryptocurrency.' });
    }
    const coin: SupportedCoinSymbol = rawCoin;
    const coinDef = SUPPORTED_COIN_MAP[coin];

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      return res.status(400).json({ error: `Enter a positive ${coin} transfer amount.` });
    }

    const recipientAddress = String(req.body?.recipientAddress || '').trim();
    if (!validateCoinRecipientOrMetaMask(coin, recipientAddress)) {
      return res.status(400).json({
        error: `Enter a valid ${coinDef.name} (${coin}) or MetaMask (0x...) destination wallet address.`,
      });
    }

    const txHash = String(req.body?.txHash || '').trim();
    const isXyphEvmTx = /^0x[0-9a-fA-F]{64}$/.test(txHash) && Boolean(node.getEvmTransactionByHash(txHash));
    if (!isXyphEvmTx && !validateCoinTxHash(coin, txHash)) {
      return res.status(400).json({
        error: `Enter a valid ${coinDef.name} (${coin}) transaction hash (${coinDef.txHashPlaceholder}).`,
      });
    }

    const duplicate = cryptoExchangeOrders.some(
      (o) =>
        o.fromCoin === coin &&
        (o.depositTxHash.toLowerCase() === txHash.toLowerCase() ||
          (o.settlementTxid && o.settlementTxid.toLowerCase() === txHash.toLowerCase()))
    );
    if (duplicate) {
      return res.status(409).json({
        error: 'This transfer transaction hash has already been recorded.',
      });
    }

    const { verified: publicVerified } = isXyphEvmTx
      ? { verified: true }
      : await verifyPublicChainTx(coin, txHash);
    const verified = isXyphEvmTx || publicVerified;
    if (coin === 'XYPH' && !verified) {
      return res.status(404).json({
        error: 'XYPH transfer transaction was not found on XYPH Network.',
      });
    }

    const rawMethod = String(req.body?.payoutMethod || 'external_wallet');
    const payoutMethod: CryptoExchangeOrder['payoutMethod'] = ALLOWED_PAYOUT_METHODS.has(
      rawMethod as NonNullable<CryptoExchangeOrder['payoutMethod']>
    )
      ? (rawMethod as NonNullable<CryptoExchangeOrder['payoutMethod']>)
      : 'external_wallet';
    const senderAddress = String(req.body?.senderAddress || '').trim().slice(0, 120) || null;

    const { priceUsd } = getCoinUsdPrice(coin);
    const usdValue = Number((amount * priceUsd).toFixed(4));
    const inrValue = Number((usdValue * INR_PER_USD).toFixed(2));
    const now = Math.floor(Date.now() / 1000);
    const recipientXyph = coin === 'XYPH' ? normalizeToXypherAddress(recipientAddress) : null;
    const evmRec = isXyphEvmTx ? node.getEvmTransactionByHash(txHash) : null;
    const evmBlockHeight =
      evmRec && typeof evmRec.blockNumber === 'string'
        ? parseInt(evmRec.blockNumber, 16)
        : null;

    const order: CryptoExchangeOrder = {
      id: `TRF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      kind: 'transfer',
      fromCoin: coin,
      toCoin: coin,
      fromAmount: amount,
      toAmount: amount,
      fromPriceUsd: priceUsd,
      toPriceUsd: priceUsd,
      usdValue,
      inrValue,
      collectionAddress: senderAddress || recipientAddress,
      depositTxHash: txHash,
      recipientAddress,
      recipientXyph,
      settlementTxid: txHash,
      settlementBlockHeight: Number.isFinite(evmBlockHeight) ? evmBlockHeight : null,
      tokenContractAddress: isXyphEvmTx && coinDef.xyphTokenContract ? coinDef.xyphTokenContract : null,
      metamaskDelivered: isXyphEvmTx && isValidEvmAddress(recipientAddress),
      payoutFromAddress: senderAddress,
      payoutMethod,
      payoutVerifiedOnChain: verified,
      status: 'completed',
      createdAt: now,
      updatedAt: now,
      note: isXyphEvmTx && coin !== 'XYPH'
        ? `XYPH Network ERC-20 ${coin} transfer → ${recipientAddress}`
        : `Direct ${coin} wallet transfer → ${recipientAddress}`,
    };

    cryptoExchangeOrders.unshift(order);
    saveCryptoExchangeOrders(cryptoExchangeOrders);

    let accounting: import('./src/lib/types.ts').TransferAccountingReceipt | undefined;
    if (coin === 'XYPH' && recipientXyph) {
      const senderXyph = senderAddress ? normalizeToXypherAddress(senderAddress) : null;
      const amountUnits = Math.round(amount * UNIT);
      const senderAfter = senderXyph ? node.getAddressInfo(senderXyph).spendable : 0;
      const receiverAfter = node.getAddressInfo(recipientXyph).spendable;
      const isSelf = Boolean(senderXyph && senderXyph === recipientXyph);
      accounting = {
        txid: txHash,
        blockHeight: order.settlementBlockHeight,
        fromAddress: senderXyph || senderAddress || '',
        toAddress: recipientXyph,
        amountUnits,
        feeUnits: NETWORK_FEE_UNITS,
        senderBefore: isSelf ? senderAfter : senderAfter + amountUnits,
        senderAfter,
        receiverBefore: isSelf ? receiverAfter : Math.max(0, receiverAfter - amountUnits),
        receiverAfter,
        verifiedSufficientBalance: true,
      };
    }

    return res.status(201).json({
      ok: true,
      order,
      verifiedOnChain: verified,
      ...(accounting ? { accounting } : {}),
      summary: computeCryptoVaultSummary(),
    });
  });

  // =====================================================================
  // NATIVE C++17 CORE ENGINE (xypherd) & SUPPLY-DEMAND VALUATION ROUTES
  // =====================================================================
  const cppCoreRateBuckets = new Map<string, number[]>();
  const checkCppRateLimit = (req: Request, maxPerMin = 40): boolean => {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const nowMs = Date.now();
    const recent = (cppCoreRateBuckets.get(ip) || []).filter((t) => nowMs - t < 60_000);
    if (recent.length >= maxPerMin) return false;
    recent.push(nowMs);
    cppCoreRateBuckets.set(ip, recent);
    return true;
  };

  app.get('/api/core-cpp/status', (_req, res) => {
    const info = getCppCoreInfo();
    const liveInputs = getLiveCppMarketInput(marketState);
    const spot = evaluateSpotCpp(liveInputs);
    return res.json({
      info,
      spot,
      liveInputs: {
        inrReserve: Number(liveInputs.inrReserve.toFixed(2)),
        xyphReserve: Number(liveInputs.xyphReserve.toFixed(4)),
        circulatingSupplyXyph: liveInputs.circulatingSupplyXyph,
        supplyBaselineXyph: liveInputs.supplyBaselineXyph,
        totalBoughtXyph: Number(liveInputs.totalBoughtXyph.toFixed(4)),
        totalSoldXyph: Number(liveInputs.totalSoldXyph.toFixed(4)),
      },
      sourceFiles: CPP_SOURCE_CATALOG,
    });
  });

  app.get('/api/core-cpp/source/:id', (req, res) => {
    const fileId = String(req.params.id || '').trim();
    const found = readCppSourceFile(fileId);
    if (!found) {
      return res.status(404).json({ error: 'C++ core source file not found.' });
    }
    return res.json(found);
  });

  app.post('/api/core-cpp/quote', (req, res) => {
    if (!checkCppRateLimit(req, 60)) {
      return res.status(429).json({ error: 'Too many C++ quote requests. Please wait a moment.' });
    }
    const side = req.body?.side === 'sell' ? 'sell' : 'buy';
    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
      return res.status(400).json({ error: 'Enter a valid positive amount.' });
    }
    const baseInput = getLiveCppMarketInput(marketState);
    const circOverride = Number(req.body?.circulatingSupplyXyph);
    const boughtOverride = Number(req.body?.totalBoughtXyph);
    const soldOverride = Number(req.body?.totalSoldXyph);

    const simInput: CppMarketInput = {
      ...baseInput,
      circulatingSupplyXyph:
        Number.isFinite(circOverride) && circOverride >= 1 && circOverride <= 100_000_000
          ? circOverride
          : baseInput.circulatingSupplyXyph,
      totalBoughtXyph:
        Number.isFinite(boughtOverride) && boughtOverride >= 0 && boughtOverride <= 1_000_000_000
          ? boughtOverride
          : baseInput.totalBoughtXyph,
      totalSoldXyph:
        Number.isFinite(soldOverride) && soldOverride >= 0 && soldOverride <= 1_000_000_000
          ? soldOverride
          : baseInput.totalSoldXyph,
    };

    const quote = side === 'buy' ? quoteBuyCpp(simInput, amount) : quoteSellCpp(simInput, amount);
    return res.json(quote);
  });

  app.post('/api/core-cpp/self-test', (req, res) => {
    if (!checkCppRateLimit(req, 20)) {
      return res.status(429).json({ error: 'Too many self-test runs. Please wait a minute.' });
    }
    try {
      return res.json(runCppSelfTest());
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'C++17 core self-test failed.',
      });
    }
  });

  app.post('/api/core-cpp/benchmark', (req, res) => {
    if (!checkCppRateLimit(req, 15)) {
      return res.status(429).json({ error: 'Too many benchmark runs. Please wait a minute.' });
    }
    const iterations = Number(req.body?.iterations ?? 50_000);
    if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 200_000) {
      return res.status(400).json({ error: 'Iterations must be between 1,000 and 200,000.' });
    }
    try {
      return res.json(runCppBenchmarkPow(iterations));
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'C++17 PoW benchmark failed.',
      });
    }
  });

  app.get('/api/core-cpp/chain', (_req, res) => {
    try {
      const descending = node.getMainChainBlocks();
      const ascending = [...descending].reverse();
      // Always include Genesis #0 (64 zeros prevHash) and contiguous blocks up to tip (or Genesis #0..#2 + latest 8 blocks)
      const selected =
        ascending.length <= 12
          ? ascending
          : [...ascending.slice(0, 3), ...ascending.slice(-8)];

      const linkInputs = selected.map(({ block, hash }) => {
        const summary = node.summarizeBlock(block, hash);
        return {
          height: summary.height,
          hash: summary.hash,
          prevHash: summary.prev,
          merkleRoot: summary.merkleRoot,
          timestamp: summary.time,
          nonce: summary.nonce,
          txCount: summary.txCount,
        };
      });

      const report = verifyLiveChainLinksCpp(linkInputs);
      return res.json({
        ...report,
        totalLiveBlocks: ascending.length,
        tipHeight: ascending.length > 0 ? ascending[ascending.length - 1].block.height : 0,
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to audit live blockchain links in C++17.',
      });
    }
  });

  app.post('/api/core-cpp/chain-demo', (req, res) => {
    if (!checkCppRateLimit(req, 30)) {
      return res.status(429).json({ error: 'Too many chain demo requests. Please wait a moment.' });
    }
    const blocks = Number(req.body?.blocks ?? 4);
    const rawTamper = req.body?.tamperHeight;
    const tamperHeight =
      rawTamper !== undefined && rawTamper !== null && rawTamper !== ''
        ? Number(rawTamper)
        : undefined;

    if (!Number.isFinite(blocks) || blocks < 2 || blocks > 8) {
      return res.status(400).json({ error: 'Blocks must be between 2 and 8.' });
    }
    if (tamperHeight !== undefined && (!Number.isInteger(tamperHeight) || tamperHeight < 0 || tamperHeight >= blocks)) {
      return res.status(400).json({ error: 'Invalid tamper block height.' });
    }
    try {
      return res.json(runCppChainDemo(blocks, tamperHeight));
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'C++17 chain demo failed.',
      });
    }
  });

  // =====================================================================
  // PUBLIC MULTI-CHAIN SMART CONTRACT DEPLOYMENT REGISTRY
  // =====================================================================
  const loadDeployments = (): DeployedContractRecord[] => {
    try {
      if (!fs.existsSync(DEPLOYMENTS_PATH)) return [];
      const raw = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, 'utf-8'));
      return Array.isArray(raw) ? (raw as DeployedContractRecord[]) : [];
    } catch {
      return [];
    }
  };

  const saveDeployments = (records: DeployedContractRecord[]): void => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DEPLOYMENTS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
    fs.renameSync(tmp, DEPLOYMENTS_PATH);
  };

  const deployedContractsRegistry: DeployedContractRecord[] = loadDeployments();

  app.get('/api/contracts/deployments', (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ deployments: deployedContractsRegistry });
  });

  app.post('/api/contracts/deployments', (req, res) => {
    const contractAddress = String(req.body?.contractAddress || '').trim();
    const txHash = String(req.body?.txHash || '').trim();
    const deployerAddress = String(req.body?.deployerAddress || '').trim();
    const chainId = Number(req.body?.chainId);
    const networkName = String(req.body?.networkName || '').trim().slice(0, 64);
    const rawExplorerUrl = String(req.body?.explorerUrl || '').trim();
    const symbol = String(req.body?.symbol || SYMBOL).trim().toUpperCase().slice(0, 12);
    const decimals = Number(req.body?.decimals ?? 4);
    const initialSupply = String(req.body?.initialSupply || '60000000').trim().slice(0, 32);
    const solcVersion = String(req.body?.solcVersion || '0.8.x').trim().slice(0, 64);

    if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
      return res.status(400).json({ error: 'Invalid deployed contract address (expected 0x... 40 hex chars).' });
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return res.status(400).json({ error: 'Invalid deployment transaction hash.' });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(deployerAddress)) {
      return res.status(400).json({ error: 'Invalid deployer wallet address.' });
    }
    if (!Number.isInteger(chainId) || chainId <= 0 || chainId > 999_999_999) {
      return res.status(400).json({ error: 'Invalid EVM chainId.' });
    }
    if (!networkName) {
      return res.status(400).json({ error: 'Network name is required.' });
    }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      return res.status(400).json({ error: 'Decimals must be an integer between 0 and 18.' });
    }
    if (!/^[0-9]{1,18}$/.test(initialSupply)) {
      return res.status(400).json({ error: 'Initial supply must be a positive whole number.' });
    }

    let safeExplorerUrl = '';
    if (rawExplorerUrl) {
      try {
        const parsed = new URL(rawExplorerUrl);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          safeExplorerUrl = parsed.origin + parsed.pathname.replace(/\/$/, '');
        }
      } catch {
        return res.status(400).json({ error: 'Invalid block explorer URL.' });
      }
    }

    const existing = deployedContractsRegistry.find(
      (d) =>
        d.chainId === chainId &&
        d.contractAddress.toLowerCase() === contractAddress.toLowerCase()
    );
    if (existing) {
      return res.json({ ok: true, deployment: existing });
    }

    const record: DeployedContractRecord = {
      id: `SC-${chainId}-${contractAddress.slice(2, 10).toUpperCase()}`,
      contractAddress,
      txHash,
      deployerAddress,
      chainId,
      chainIdHex: '0x' + chainId.toString(16),
      networkName,
      explorerUrl: safeExplorerUrl,
      symbol,
      decimals,
      initialSupply,
      solcVersion,
      deployedAt: Math.floor(Date.now() / 1000),
    };

    deployedContractsRegistry.unshift(record);
    if (deployedContractsRegistry.length > 100) {
      deployedContractsRegistry.length = 100;
    }
    saveDeployments(deployedContractsRegistry);
    return res.status(201).json({ ok: true, deployment: record });
  });

  app.post('/api/validate', (_req, res) => {
    res.json(node.validateFullChain());
  });

  app.post('/api/selftest', async (_req, res) => {
    try {
      const report = await node.runSelfTest();
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Self-test failed' });
    }
  });

  app.post('/api/network/reset', (req, res) => {
    const requested = String(req.body?.profile || 'private-fast') as NetworkProfile;
    if (!Object.prototype.hasOwnProperty.call(PROFILE_CONFIGS, requested)) {
      return res.status(400).json({ error: 'Unknown network profile' });
    }
    try {
      const result = node.resetNetwork(requested);
      return res.json({ ok: true, profile: requested, genesisHash: result.genesisHash });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Reset failed' });
    }
  });

  // =====================================================================
  // PUBLIC NETWORK GATEWAY & PEER RELAY API
  // =====================================================================
  app.get('/api/network/gateway', (_req, res) => {
    const authMode = getGatewayAuthMode();
    const baseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    res.json({
      apiKeyConfigured: authMode !== 'unconfigured',
      authMode,
      publicBaseUrl: baseUrl || null,
      networkName: NETWORK_NAME,
      networkFeeXyph: NETWORK_FEE_XYPH,
      maxBlocks: MAX_BLOCKS,
      gasPriceHex: XYPH_EVM_GAS_PRICE_HEX,
      evmRpcPath: '/evm-rpc',
      chainId: XYPHER_CHAIN_ID,
      chainIdHex: XYPHER_CHAIN_ID_HEX,
      endpoints: {
        evmRpc: '/evm-rpc',
        networkManifest: '/api/public/network',
        info: '/api/public/info',
        blocks: '/api/public/blocks',
        blockSubmit: '/api/public/blocks/submit',
        txBroadcast: '/api/public/tx/broadcast',
        rpc: '/api/public/rpc',
        peers: '/api/public/peers',
      },
      peers: Array.from(registeredPeers.values()),
    });
  });

  app.post('/api/network/gateway/activate', (req, res) => {
    const mode = getGatewayAuthMode();
    if (mode === 'env') {
      return res.status(409).json({
        error: 'Gateway API key is already managed via server environment secret XYPHER_NETWORK_API_KEY.',
      });
    }
    if (mode === 'claimed') {
      return res.status(409).json({
        error: 'Public network API key has already been activated on this node. Set XYPHER_NETWORK_API_KEY in Settings -> Secrets to rotate it.',
      });
    }
    const apiKey = String(req.body?.apiKey || '').trim();
    if (apiKey.length < 16 || apiKey.length > 256) {
      return res.status(400).json({ error: 'API key must be between 16 and 256 characters.' });
    }
    saveClaimedGatewayHash(apiKey);
    return res.json({ ok: true, authMode: 'claimed' });
  });

  app.post('/api/network/peers', (req, res) => {
    const rawUrl = String(req.body?.url || '').trim();
    const label = String(req.body?.label || '').trim().slice(0, 60) || 'External Peer';
    const parsed = validatePublicPeerUrl(rawUrl);
    if (!parsed) {
      return res.status(400).json({
        error: 'Enter a valid public http(s) peer node URL (private or loopback addresses are blocked).',
      });
    }
    const normalized = parsed.origin + parsed.pathname.replace(/\/$/, '');
    const id = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
    const peer: PublicPeerRecord = {
      id,
      url: normalized,
      label,
      addedAt: Math.floor(Date.now() / 1000),
      lastSeenHeight: null,
      status: 'registered',
    };
    registeredPeers.set(id, peer);
    return res.json({ ok: true, peer });
  });

  app.post('/api/network/peers/:id/sync', async (req, res) => {
    const id = String(req.params.id || '').trim();
    const peer = registeredPeers.get(id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });
    const parsed = validatePublicPeerUrl(peer.url);
    if (!parsed) return res.status(400).json({ error: 'Invalid peer URL' });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const resp = await fetch(`${peer.url}/api/public/info`, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as { height?: number };
      peer.status = 'reachable';
      peer.lastSeenHeight = typeof data.height === 'number' ? data.height : null;
      return res.json({ ok: true, peer });
    } catch {
      peer.status = 'unreachable';
      return res.json({ ok: false, peer, error: 'Peer node unreachable' });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.delete('/api/network/peers/:id', (req, res) => {
    const id = String(req.params.id || '').trim();
    registeredPeers.delete(id);
    res.json({ ok: true });
  });

  // Public unauthenticated read-only discovery endpoints (CORS enabled for read-only public data)
  const allowPublicReadCors = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    next();
  };

  app.get('/api/public/network', allowPublicReadCors, (req, res) => {
    const baseUrl =
      (process.env.APP_URL || '').replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    const info = node.getInfo();
    res.json({
      chainName: NETWORK_NAME,
      chainId: XYPHER_CHAIN_ID,
      chainIdHex: XYPHER_CHAIN_ID_HEX,
      nativeCurrency: {
        name: SYMBOL,
        symbol: SYMBOL,
        decimals: 18,
      },
      networkFeeXyph: NETWORK_FEE_XYPH,
      gasPriceHex: XYPH_EVM_GAS_PRICE_HEX,
      maxBlocks: MAX_BLOCKS,
      currentHeight: info.height,
      blocksRemaining: info.blocksLeft,
      rpcUrls: [`${baseUrl}/evm-rpc`],
      blockExplorerUrls: [baseUrl],
      iconUrls: [`${baseUrl}/xypher-coin.jpg`],
      public: true,
      evmCompatible: true,
    });
  });

  app.get('/api/public/info', allowPublicReadCors, (_req, res) => {
    const info = node.getInfo();
    res.json({
      name: info.name,
      networkName: NETWORK_NAME,
      symbol: info.symbol,
      chainId: info.chainId,
      chainIdHex: info.chainIdHex,
      networkFeeXyph: NETWORK_FEE_XYPH,
      gasPriceHex: XYPH_EVM_GAS_PRICE_HEX,
      maxBlocks: MAX_BLOCKS,
      blocksLeft: info.blocksLeft,
      profile: info.profile,
      height: info.height,
      tip: info.tip,
      supply: info.supply,
      difficulty: info.difficulty,
      mempoolCount: info.mempoolCount,
      peers: registeredPeers.size,
    });
  });

  app.get('/api/public/blocks', allowPublicReadCors, (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    res.json(node.getBlocksPaginated(limit, offset));
  });

  app.get('/api/public/blocks/:id', allowPublicReadCors, (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 66) {
      return res.status(400).json({ error: 'Invalid block height or hash' });
    }
    const detail = node.getBlockDetail(id);
    if (!detail) return res.status(404).json({ error: 'Block not found' });
    return res.json(detail);
  });

  app.get('/api/public/tx/:txid', allowPublicReadCors, (req, res) => {
    const txid = String(req.params.txid || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{6,64}$/.test(txid)) {
      return res.status(400).json({ error: 'Invalid transaction ID format' });
    }
    const detail = node.getTransactionDetail(txid);
    if (!detail) return res.status(404).json({ error: 'Transaction not found' });
    return res.json(detail);
  });

  app.get('/api/public/address/:addr', allowPublicReadCors, (req, res) => {
    const rawAddr = String(req.params.addr || '').trim();
    const normalized = normalizeToXypherAddress(rawAddr);
    if (!normalized) {
      return res.status(400).json({ error: 'Invalid Xypher or MetaMask (0x...) address' });
    }
    return res.json(node.getAddressInfo(normalized));
  });

  app.get('/api/public/mempool', allowPublicReadCors, (_req, res) => {
    const items = Array.from(node.mempool.values()).sort((a, b) => b.addedAt - a.addedAt);
    res.json({ count: items.length, txs: items });
  });

  // Authenticated public broadcast, external miner block submission & JSON-RPC
  app.post('/api/public/tx/broadcast', requirePublicApiKey, (req, res) => {
    const tx = req.body?.tx as TxData | undefined;
    if (!tx || typeof tx !== 'object') {
      return res.status(400).json({ error: 'Missing transaction payload' });
    }
    const result = node.addTx(tx);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Transaction rejected' });
    }
    return res.json({ ok: true, txid: result.txid });
  });

  app.post('/api/public/blocks/submit', requirePublicApiKey, (req, res) => {
    const block = req.body?.block as BlockData | undefined;
    if (!block || typeof block !== 'object') {
      return res.status(400).json({ error: 'Missing block payload' });
    }
    const result = node.addBlock(block);
    if (!result.ok) {
      return res.status(400).json({ error: result.error || 'Block rejected' });
    }
    return res.json({ ok: true, hash: result.hash, height: node.height });
  });

  app.get('/api/public/peers', requirePublicApiKey, (_req, res) => {
    res.json({ peers: Array.from(registeredPeers.values()) });
  });

  app.post('/api/public/rpc', requirePublicApiKey, (req, res) => {
    const { id = 1, method, params = {} } = req.body || {};
    try {
      const result = executeXypherRpcMethod(method, params);
      return res.json({ id, result });
    } catch (err) {
      return res.status(400).json({ id, error: err instanceof Error ? err.message : 'RPC error' });
    }
  });

  app.post('/api/rpc', (req, res) => {
    const { id = 1, method, params = {} } = req.body || {};
    try {
      const result = executeXypherRpcMethod(method, params);
      return res.json({ id, result });
    } catch (err) {
      return res.status(400).json({ id, error: err instanceof Error ? err.message : 'RPC error' });
    }
  });

  // Never allow unmatched /api/* requests to fall through to SPA HTML (HTTP 200 text/html)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // =====================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC ASSETS
  // =====================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexHtmlPath)) {
        return res.sendFile(indexHtmlPath);
      }
      return res.status(503).json({ error: 'Frontend bundle not built yet' });
    });
  }

  // Reconcile any previously pending buy orders (or completed orders from prior chain version) automatically
  let reconciledCount = 0;
  for (const existingOrder of [...paymentOrders].reverse()) {
    const needsAutoSettle = existingOrder.status === 'pending';
    const needsUpgradeReanchor =
      existingOrder.status === 'completed' &&
      existingOrder.txid &&
      !node.getTransactionDetail(existingOrder.txid);
    if (!needsAutoSettle && !needsUpgradeReanchor) continue;
    try {
      const settled = await node.disburseTreasuryPayment(
        existingOrder.recipientXyph,
        existingOrder.xyphUnits,
        existingOrder.id
      );
      existingOrder.status = 'completed';
      existingOrder.txid = settled.txid;
      existingOrder.blockHeight = settled.blockHeight;
      existingOrder.updatedAt = Math.floor(Date.now() / 1000);
      reconciledCount++;
    } catch (err) {
      console.error(`Failed to auto-credit buy order ${existingOrder.id}:`, err);
    }
  }
  if (reconciledCount > 0) {
    savePaymentOrders(paymentOrders);
    marketState = rebuildMarketStateFromRealOrders();
    saveMarketState(marketState);
    console.log(`Auto-credited ${reconciledCount} buy order(s) onto XYPH Network.`);
  }

  // One-time 50 XYPH wallet allocation for co7VoxuG5CgYv5KJFzhisr3rGdpBkZ2Rgv
  const DIRECT_CREDIT_ID = 'DIRECT-CREDIT-50-co7VoxuG5CgYv5KJFzhisr3rGdpBkZ2Rgv';
  const DIRECT_CREDIT_ADDRESS = 'co7VoxuG5CgYv5KJFzhisr3rGdpBkZ2Rgv';
  const DIRECT_CREDIT_UNITS = 50 * UNIT;
  const walletGrantsPath = path.resolve(DATA_DIR, 'wallet-grants.json');
  if (walletGrantsPath.startsWith(DATA_DIR + path.sep)) {
    let appliedGrants: Record<string, { address: string; amountUnits: number; txid: string; blockHeight: number }> = {};
    try {
      if (fs.existsSync(walletGrantsPath)) {
        appliedGrants = JSON.parse(fs.readFileSync(walletGrantsPath, 'utf-8'));
      }
    } catch {
      appliedGrants = {};
    }
    const markerRawHex = `0x${Buffer.from(`UPI:${DIRECT_CREDIT_ID}`).toString('hex')}`;
    const alreadyOnLedger = node.evmState.txs.some(
      (tx) => tx.toXyph === DIRECT_CREDIT_ADDRESS && tx.rawHex === markerRawHex
    );
    if (!appliedGrants[DIRECT_CREDIT_ID] && !alreadyOnLedger) {
      try {
        const settled = await node.disburseTreasuryPayment(
          DIRECT_CREDIT_ADDRESS,
          DIRECT_CREDIT_UNITS,
          DIRECT_CREDIT_ID
        );
        appliedGrants[DIRECT_CREDIT_ID] = {
          address: DIRECT_CREDIT_ADDRESS,
          amountUnits: DIRECT_CREDIT_UNITS,
          txid: settled.txid,
          blockHeight: settled.blockHeight,
        };
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmpGrants = `${walletGrantsPath}.tmp`;
        fs.writeFileSync(tmpGrants, JSON.stringify(appliedGrants, null, 2), 'utf-8');
        fs.renameSync(tmpGrants, walletGrantsPath);
        console.log(`Credited 50 XYPH to ${DIRECT_CREDIT_ADDRESS} (tx ${settled.txid}).`);
      } catch (err) {
        console.error(`Failed to apply wallet credit ${DIRECT_CREDIT_ID}:`, err);
      }
    }
  }

  if (miningState.active && miningState.minerAddress) {
    scheduleNextMinedBlock();
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`XYPH Network wallet & public EVM RPC node running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Xypher server:', err);
  process.exit(1);
});
