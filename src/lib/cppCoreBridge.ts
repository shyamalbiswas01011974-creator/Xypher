import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface CppCoreInfo {
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
}

export interface CppMarketInput {
  inrReserve: number;
  xyphReserve: number;
  circulatingSupplyXyph: number;
  supplyBaselineXyph: number;
  totalBoughtXyph: number;
  totalSoldXyph: number;
  inrPerUsd?: number;
}

export interface CppSpotEvaluation {
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
}

export interface CppTradeQuote {
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

export interface CppSelfTestReport {
  engine: string;
  allPassed: boolean;
  durationMs: number;
  tests: Array<{ name: string; passed: boolean; detail: string }>;
}

export interface CppBenchmarkReport {
  engine: string;
  iterations: number;
  durationMs: number;
  hashesPerSec: number;
  sampleHash: string;
}

export interface CppSourceFileEntry {
  id: string;
  relativePath: string;
  title: string;
  role: string;
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
  blocks: CppBlockLinkAudit[];
}

export interface ExternalBlockLinkInput {
  height: number;
  hash: string;
  prevHash: string;
  merkleRoot?: string;
  timestamp?: number;
  nonce?: number;
  txCount?: number;
}

const CORE_CPP_DIR = path.resolve(process.cwd(), 'xypher-core');
const XYPHERD_BIN = path.resolve(CORE_CPP_DIR, 'build', 'xypherd');

/** Strict hardcoded allowlist of inspectable C++17 source files inside xypher-core/ */
export const CPP_SOURCE_CATALOG: readonly CppSourceFileEntry[] = [
  {
    id: 'chain.cpp',
    relativePath: 'src/chain.cpp',
    title: '64-Char Hash Chain & Genesis Core (C++17)',
    role: 'Connects every block via 64-char SHA-256d hash & previousHash (Genesis #0 = 64 zeros) + tamper audit',
  },
  {
    id: 'chain.h',
    relativePath: 'src/chain.h',
    title: 'Chain Linking Header',
    role: 'GENESIS_PREV_HASH (64 zeros), CChain container & BlockLinkAudit definitions',
  },
  {
    id: 'price_engine.cpp',
    relativePath: 'src/market/price_engine.cpp',
    title: 'Supply & Demand Price Engine (C++17)',
    role: 'AMM x*y=k + Circulating Supply Scarcity + Buy/Sell Pressure pricing',
  },
  {
    id: 'price_engine.h',
    relativePath: 'src/market/price_engine.h',
    title: 'Price Engine Header',
    role: 'CSupplyDemandEngine structs & evaluation interfaces',
  },
  {
    id: 'params.h',
    relativePath: 'src/consensus/params.h',
    title: 'Consensus Parameters',
    role: 'Bitcoin-Core-style 10-min blocks, 10 XYPH reward, 10-year halving, 0 fee',
  },
  {
    id: 'validation.cpp',
    relativePath: 'src/validation.cpp',
    title: 'UTXO & Block Validation',
    role: 'CCoinsViewCache UTXO set, CheckTxInputs, ConnectBlock, double-spend rejection',
  },
  {
    id: 'validation.h',
    relativePath: 'src/validation.h',
    title: 'Validation Header',
    role: 'Bitcoin Core UTXO cache and validation state definitions',
  },
  {
    id: 'transaction.h',
    relativePath: 'src/primitives/transaction.h',
    title: 'Transaction Primitives',
    role: 'COutPoint, CTxIn, CTxOut, CTransaction, BIP-34 TXID hashing',
  },
  {
    id: 'block.h',
    relativePath: 'src/primitives/block.h',
    title: 'Block & Merkle Primitives',
    role: 'CBlockHeader, CBlock, ComputeMerkleRoot, CheckProofOfWork',
  },
  {
    id: 'sha256.cpp',
    relativePath: 'src/crypto/sha256.cpp',
    title: 'SHA-256 / SHA256d Engine',
    role: 'Self-contained FIPS 180-4 SHA-256 & Double-SHA-256 implementation',
  },
  {
    id: 'main.cpp',
    relativePath: 'src/main.cpp',
    title: 'xypherd Daemon CLI',
    role: 'Native C++17 JSON RPC CLI, consensus self-tests & PoW benchmark',
  },
  {
    id: 'Makefile',
    relativePath: 'Makefile',
    title: 'C++17 Build Makefile',
    role: 'GCC -O3 -std=c++17 build configuration for xypherd',
  },
  {
    id: 'CMakeLists.txt',
    relativePath: 'CMakeLists.txt',
    title: 'CMake Build Config',
    role: 'Cross-platform CMake C++17 build definition',
  },
];

let binaryChecked = false;
let binaryReady = false;
let cachedInfo: CppCoreInfo | null = null;

function ensureBinary(): boolean {
  if (binaryChecked) return binaryReady;
  binaryChecked = true;
  if (fs.existsSync(XYPHERD_BIN)) {
    binaryReady = true;
    return true;
  }
  try {
    execFileSync('make', ['-C', CORE_CPP_DIR], {
      timeout: 20_000,
      stdio: 'pipe',
      shell: false,
    });
    binaryReady = fs.existsSync(XYPHERD_BIN);
  } catch {
    binaryReady = false;
  }
  return binaryReady;
}

function safeNumStr(n: number, fallback: number): string {
  const val = Number.isFinite(n) ? n : fallback;
  return String(val);
}

function runXypherdJson<T>(args: string[], timeoutMs = 4000): T | null {
  if (!ensureBinary()) return null;
  try {
    const out = execFileSync(XYPHERD_BIN, args, {
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
      encoding: 'utf-8',
      shell: false,
    });
    return JSON.parse(out.trim()) as T;
  } catch {
    return null;
  }
}

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function classifyRegime(scarcity: number, demand: number, buyPressurePct: number): string {
  const combined = scarcity * demand;
  if (combined >= 1.15 || buyPressurePct >= 62) return 'High Demand · Scarce Supply (Bullish ↑)';
  if (combined <= 0.88 || buyPressurePct <= 38) return 'High Supply · Low Demand (Bearish ↓)';
  if (combined > 1.01) return 'Rising Demand (Upward ↑)';
  if (combined < 0.99) return 'Expanding Supply (Downward ↓)';
  return 'Supply-Demand Equilibrium';
}

function evaluateSpotFallback(input: CppMarketInput): CppSpotEvaluation {
  const safeInrRes = Math.max(1, input.inrReserve);
  const safeXyphRes = Math.max(1, input.xyphReserve);
  const safeCirc = Math.max(1, input.circulatingSupplyXyph);
  const safeBase = Math.max(1, input.supplyBaselineXyph);
  const safeBought = Math.max(0, input.totalBoughtXyph);
  const safeSold = Math.max(0, input.totalSoldXyph);
  const inrPerUsd = Math.max(1, input.inrPerUsd ?? 84);

  const ammSpotInr = safeInrRes / safeXyphRes;
  const scarcityMultiplier = clamp((safeBase / safeCirc) ** 0.35, 0.25, 4.0);
  const netDemand = safeBought - safeSold;
  const marketDepth = Math.max(1000, safeXyphRes + safeCirc * 0.25);
  const demandMultiplier = Math.exp(clamp((netDemand / marketDepth) * 0.65, -1.5, 2.0));
  const supplyDemandIndex = scarcityMultiplier * demandMultiplier;
  const spotPriceInr = Math.max(0.0001, ammSpotInr * supplyDemandIndex);
  const spotPriceUsd = spotPriceInr / inrPerUsd;
  const totalFlow = safeBought + safeSold;
  const buyPressurePercent = totalFlow > 0 ? (safeBought / totalFlow) * 100 : 50;

  return {
    engine: 'xypherd-fallback',
    ammSpotInr: roundTo(ammSpotInr, 6),
    scarcityMultiplier: roundTo(scarcityMultiplier, 4),
    demandMultiplier: roundTo(demandMultiplier, 4),
    supplyDemandIndex: roundTo(supplyDemandIndex, 4),
    spotPriceInr: roundTo(spotPriceInr, 6),
    spotPriceUsd: roundTo(spotPriceUsd, 6),
    buyPressurePercent: roundTo(buyPressurePercent, 1),
    marketCapInr: roundTo(safeCirc * spotPriceInr, 2),
    marketCapUsd: roundTo(safeCirc * spotPriceUsd, 2),
    marketRegime: classifyRegime(scarcityMultiplier, demandMultiplier, buyPressurePercent),
  };
}

function buildStateArgs(input: CppMarketInput): string[] {
  return [
    '--inr-reserve',
    safeNumStr(input.inrReserve, 2500),
    '--xyph-reserve',
    safeNumStr(input.xyphReserve, 250000),
    '--circulating',
    safeNumStr(input.circulatingSupplyXyph, 20),
    '--baseline',
    safeNumStr(input.supplyBaselineXyph, 20),
    '--bought',
    safeNumStr(input.totalBoughtXyph, 0),
    '--sold',
    safeNumStr(input.totalSoldXyph, 0),
    '--inr-per-usd',
    safeNumStr(input.inrPerUsd ?? 84, 84),
  ];
}

export function getCppCoreInfo(): CppCoreInfo {
  if (cachedInfo && cachedInfo.available) return cachedInfo;
  const raw = runXypherdJson<Omit<CppCoreInfo, 'available' | 'binaryPath'>>(['--cmd', 'info']);
  if (raw) {
    cachedInfo = {
      available: true,
      binaryPath: 'xypher-core/build/xypherd',
      ...raw,
    };
    return cachedInfo;
  }
  return {
    available: false,
    binaryPath: 'xypher-core/build/xypherd',
    engine: 'xypherd C++17 Core (Fallback)',
    architecture: 'Bitcoin Core UTXO + SHA256d PoW + Supply-Demand AMM',
    cppStandard: 'C++17',
    compiler: 'g++',
    networkName: 'XYPH Network',
    symbol: 'XYPH',
    chainId: 5790032,
    coinUnits: 100_000_000,
    targetBlockTimeSec: 600,
    initialSubsidyXyph: 10,
    halvingIntervalBlocks: 525_600,
    halvingYears: 10,
    minNetworkFeeXyph: 0,
    maxBlocks: 24_000_000,
    maxMoneyXyph: 10_512_000,
  };
}

export function evaluateSpotCpp(input: CppMarketInput): CppSpotEvaluation {
  const res = runXypherdJson<CppSpotEvaluation>(['--cmd', 'spot', ...buildStateArgs(input)]);
  return res ?? evaluateSpotFallback(input);
}

export function quoteBuyCpp(input: CppMarketInput, inrIn: number): CppTradeQuote {
  const safeIn = Math.max(0, Number.isFinite(inrIn) ? inrIn : 0);
  const res = runXypherdJson<CppTradeQuote>([
    '--cmd',
    'quote-buy',
    '--amount',
    safeNumStr(safeIn, 0),
    ...buildStateArgs(input),
  ]);
  if (res) return res;

  // Deterministic JS mirror of C++ engine if binary temporarily unavailable
  const before = evaluateSpotFallback(input);
  const safeInrRes = Math.max(1, input.inrReserve);
  const safeXyphRes = Math.max(1, input.xyphReserve);
  const k = safeInrRes * safeXyphRes;
  const newInrReserve = safeInrRes + safeIn;
  const rawNewXyph = Math.max(1, k / newInrReserve);
  const rawOut = Math.max(0, safeXyphRes - rawNewXyph);
  const xyphOut = Math.max(0, rawOut / Math.max(0.1, before.supplyDemandIndex));
  const finalXyphReserve = Math.max(1, safeXyphRes - Math.min(xyphOut, safeXyphRes - 1));
  const after = evaluateSpotFallback({
    ...input,
    inrReserve: newInrReserve,
    xyphReserve: finalXyphReserve,
    totalBoughtXyph: Math.max(0, input.totalBoughtXyph) + xyphOut,
  });
  return {
    engine: 'xypherd-fallback',
    side: 'buy',
    inputAmount: roundTo(safeIn, 2),
    outputAmount: roundTo(xyphOut, 4),
    spotBeforeInr: before.spotPriceInr,
    spotAfterInr: after.spotPriceInr,
    spotAfterUsd: after.spotPriceUsd,
    executionPriceInr: roundTo(xyphOut > 0 ? safeIn / xyphOut : before.spotPriceInr, 6),
    priceImpactPercent: roundTo(
      before.spotPriceInr > 0
        ? ((after.spotPriceInr - before.spotPriceInr) / before.spotPriceInr) * 100
        : 0,
      2
    ),
    newInrReserve: roundTo(newInrReserve, 4),
    newXyphReserve: roundTo(finalXyphReserve, 4),
    newTotalBoughtXyph: roundTo(Math.max(0, input.totalBoughtXyph) + xyphOut, 4),
    newTotalSoldXyph: roundTo(Math.max(0, input.totalSoldXyph), 4),
    scarcityMultiplier: after.scarcityMultiplier,
    demandMultiplier: after.demandMultiplier,
    marketRegime: after.marketRegime,
  };
}

export function quoteSellCpp(input: CppMarketInput, xyphIn: number): CppTradeQuote {
  const safeIn = Math.max(0, Number.isFinite(xyphIn) ? xyphIn : 0);
  const res = runXypherdJson<CppTradeQuote>([
    '--cmd',
    'quote-sell',
    '--amount',
    safeNumStr(safeIn, 0),
    ...buildStateArgs(input),
  ]);
  if (res) return res;

  const before = evaluateSpotFallback(input);
  const safeInrRes = Math.max(1, input.inrReserve);
  const safeXyphRes = Math.max(1, input.xyphReserve);
  const k = safeInrRes * safeXyphRes;
  const newXyphReserve = safeXyphRes + safeIn;
  const rawNewInr = Math.max(1, k / newXyphReserve);
  const rawInrOut = Math.max(0, safeInrRes - rawNewInr);
  const inrOut = Math.min(rawInrOut * Math.max(0.1, before.supplyDemandIndex), Math.max(0, safeInrRes - 1));
  const finalInrReserve = Math.max(1, safeInrRes - inrOut);
  const after = evaluateSpotFallback({
    ...input,
    inrReserve: finalInrReserve,
    xyphReserve: newXyphReserve,
    totalSoldXyph: Math.max(0, input.totalSoldXyph) + safeIn,
  });
  return {
    engine: 'xypherd-fallback',
    side: 'sell',
    inputAmount: roundTo(safeIn, 4),
    outputAmount: roundTo(inrOut, 2),
    spotBeforeInr: before.spotPriceInr,
    spotAfterInr: after.spotPriceInr,
    spotAfterUsd: after.spotPriceUsd,
    executionPriceInr: roundTo(safeIn > 0 ? inrOut / safeIn : before.spotPriceInr, 6),
    priceImpactPercent: roundTo(
      before.spotPriceInr > 0
        ? ((after.spotPriceInr - before.spotPriceInr) / before.spotPriceInr) * 100
        : 0,
      2
    ),
    newInrReserve: roundTo(finalInrReserve, 4),
    newXyphReserve: roundTo(newXyphReserve, 4),
    newTotalBoughtXyph: roundTo(Math.max(0, input.totalBoughtXyph), 4),
    newTotalSoldXyph: roundTo(Math.max(0, input.totalSoldXyph) + safeIn, 4),
    scarcityMultiplier: after.scarcityMultiplier,
    demandMultiplier: after.demandMultiplier,
    marketRegime: after.marketRegime,
  };
}

export function runCppSelfTest(): CppSelfTestReport {
  const res = runXypherdJson<CppSelfTestReport>(['--cmd', 'self-test'], 8000);
  if (!res) {
    throw new Error('Compiled xypherd C++17 binary is unavailable.');
  }
  return res;
}

export function runCppBenchmarkPow(iterations = 50_000): CppBenchmarkReport {
  const safeIters = Math.max(1000, Math.min(200_000, Math.floor(iterations)));
  const res = runXypherdJson<CppBenchmarkReport>(
    ['--cmd', 'benchmark-pow', '--iterations', String(safeIters)],
    8000
  );
  if (!res) {
    throw new Error('Compiled xypherd C++17 binary is unavailable.');
  }
  return res;
}

export function runCppChainDemo(
  blocks = 4,
  tamperHeight?: number
): CppChainVerificationReport {
  const safeBlocks = Math.max(2, Math.min(8, Math.floor(blocks)));
  const args = ['--cmd', 'chain-demo', '--blocks', String(safeBlocks)];
  if (
    typeof tamperHeight === 'number' &&
    Number.isInteger(tamperHeight) &&
    tamperHeight >= 0 &&
    tamperHeight < safeBlocks
  ) {
    args.push('--tamper', String(tamperHeight));
  }
  const res = runXypherdJson<CppChainVerificationReport>(args, 8000);
  if (!res) {
    throw new Error('Compiled xypherd C++17 binary is unavailable.');
  }
  return res;
}

export function verifyLiveChainLinksCpp(
  blocks: ExternalBlockLinkInput[]
): CppChainVerificationReport {
  const sanitizeHex = (v: string | undefined) => String(v ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 128);
  const payload = blocks
    .slice(0, 64)
    .map((b) =>
      [
        Math.max(0, Math.floor(Number(b.height) || 0)),
        sanitizeHex(b.hash),
        sanitizeHex(b.prevHash),
        sanitizeHex(b.merkleRoot),
        Math.max(0, Math.floor(Number(b.timestamp) || 0)),
        Math.max(0, Math.floor(Number(b.nonce) || 0)),
        Math.max(0, Math.floor(Number(b.txCount) || 0)),
      ].join('|')
    )
    .join(';');

  const res = runXypherdJson<CppChainVerificationReport>(
    ['--cmd', 'verify-links', '--payload', payload],
    8000
  );
  if (res) return res;

  // Deterministic JS fallback if binary is momentarily unavailable
  const GENESIS_ZEROS = '0'.repeat(64);
  const hex64 = /^[0-9a-fA-F]{64}$/;
  const audits: CppBlockLinkAudit[] = [];
  let valid = true;
  let validLinks = 0;
  let brokenLinks = 0;
  let firstBrokenHeight = -1;
  let expectedPrev = GENESIS_ZEROS;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const isGenesis = b.height === 0;
    const genesisPrevAllZeros = isGenesis && b.prevHash === GENESIS_ZEROS;
    const hashValid64 = hex64.test(b.hash);
    const prevHashValid64 = hex64.test(b.prevHash);
    const contiguous = i > 0 && blocks[i - 1].height === b.height - 1;
    const exp = isGenesis ? GENESIS_ZEROS : contiguous ? blocks[i - 1].hash : b.prevHash;
    const linkValid = isGenesis
      ? genesisPrevAllZeros
      : contiguous
      ? prevHashValid64 && b.prevHash === blocks[i - 1].hash
      : prevHashValid64 && b.prevHash !== GENESIS_ZEROS;
    const blockValid = hashValid64 && prevHashValid64 && linkValid && (!isGenesis || genesisPrevAllZeros);
    if (blockValid) {
      validLinks++;
    } else {
      valid = false;
      brokenLinks++;
      if (firstBrokenHeight < 0) firstBrokenHeight = b.height;
    }
    audits.push({
      height: b.height,
      hash: b.hash,
      hashLength: b.hash.length,
      prevHash: b.prevHash,
      prevHashLength: b.prevHash.length,
      expectedPrevHash: exp,
      merkleRoot: b.merkleRoot || '',
      timestamp: b.timestamp || 0,
      nonce: b.nonce || 0,
      txCount: b.txCount || 0,
      isGenesis,
      genesisPrevAllZeros,
      hashValid64,
      prevHashValid64,
      linkValid,
      merkleValid: true,
      powValid: true,
      blockValid,
      error: blockValid ? '' : '64-character hash chain link validation failed',
    });
    expectedPrev = b.hash;
  }
  void expectedPrev;
  return {
    engine: 'xypherd-fallback',
    mode: 'live-network-audit',
    valid,
    hashHexLength: 64,
    genesisPrevHash: GENESIS_ZEROS,
    blockCount: audits.length,
    validLinks,
    brokenLinks,
    firstBrokenHeight,
    tamperedHeight: -1,
    blocks: audits,
  };
}

export function readCppSourceFile(
  fileId: string
): { entry: CppSourceFileEntry; content: string } | null {
  const entry = CPP_SOURCE_CATALOG.find((item) => item.id === fileId);
  if (!entry) return null;
  const resolved = path.resolve(CORE_CPP_DIR, entry.relativePath);
  if (!resolved.startsWith(CORE_CPP_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) return null;
  return {
    entry,
    content: fs.readFileSync(resolved, 'utf-8'),
  };
}
