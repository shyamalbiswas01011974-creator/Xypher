import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Cpu,
  Gauge,
  Link2,
  Play,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import type {
  CppChainVerificationReport,
  CppCoreBenchmarkResponse,
  CppCoreQuoteResponse,
  CppCoreSelfTestResponse,
  CppCoreStatus,
  MarketTicker,
} from '../lib/types.ts';
import { SYMBOL } from '../lib/xypherCrypto.ts';

interface CoreCppViewProps {
  marketTicker: MarketTicker | null;
  onLog: (level: 'info' | 'success' | 'warn' | 'error', msg: string) => void;
}

export const CoreCppView: React.FC<CoreCppViewProps> = ({ marketTicker, onLog }) => {
  const [status, setStatus] = useState<CppCoreStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Interactive C++17 Supply & Demand Simulator State
  const [simSide, setSimSide] = useState<'buy' | 'sell'>('buy');
  const [simAmount, setSimAmount] = useState<string>('1500');
  const [simSupply, setSimSupply] = useState<string>('');
  const [simBought, setSimBought] = useState<string>('');
  const [simSold, setSimSold] = useState<string>('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteResult, setQuoteResult] = useState<CppCoreQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Native C++17 Self-Test & PoW Benchmark State
  const [testRunning, setTestRunning] = useState(false);
  const [selfTest, setSelfTest] = useState<CppCoreSelfTestResponse | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchmark, setBenchmark] = useState<CppCoreBenchmarkResponse | null>(null);

  // 64-Char Hash Chain Link Verifier & Tamper Lab State
  const [chainTab, setChainTab] = useState<'live' | 'lab'>('live');
  const [liveChainReport, setLiveChainReport] = useState<CppChainVerificationReport | null>(null);
  const [liveChainLoading, setLiveChainLoading] = useState(false);
  const [labChainReport, setLabChainReport] = useState<CppChainVerificationReport | null>(null);
  const [labChainLoading, setLabChainLoading] = useState(false);
  const [labBlockCount, setLabBlockCount] = useState<number>(4);
  const [copiedHashKey, setCopiedHashKey] = useState<string | null>(null);

  // C++17 Source Inspector State
  const [selectedFileId, setSelectedFileId] = useState<string>('chain.cpp');
  const [sourceCode, setSourceCode] = useState<string>('');
  const [sourceMeta, setSourceMeta] = useState<{ title: string; relativePath: string; role: string } | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);

  const loadLiveChainAudit = useCallback(async () => {
    setLiveChainLoading(true);
    try {
      const report = await xypherApi.getCppVerifiedLiveChain();
      setLiveChainReport(report);
    } catch (err) {
      onLog('error', err instanceof Error ? err.message : 'Failed to audit live blockchain links.');
    } finally {
      setLiveChainLoading(false);
    }
  }, [onLog]);

  const runLabChain = useCallback(
    async (blocksCount: number, tamperHeight?: number) => {
      setLabChainLoading(true);
      try {
        const report = await xypherApi.runCppChainDemo(blocksCount, tamperHeight);
        setLabChainReport(report);
        if (tamperHeight !== undefined) {
          onLog(
            'warn',
            `C++17 Tamper Lab: Mutated Block #${tamperHeight} — detected ${report.brokenLinks} broken 64-char hash chain link(s).`
          );
        } else {
          onLog(
            'success',
            `C++17 Chain Lab: Mined & verified ${report.blockCount} linked blocks from 64-zero Genesis #0.`
          );
        }
      } catch (err) {
        onLog('error', err instanceof Error ? err.message : 'C++17 chain demo failed.');
      } finally {
        setLabChainLoading(false);
      }
    },
    [onLog]
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await xypherApi.getCppCoreStatus();
      setStatus(data);
      setSimSupply((prev) => (prev === '' ? String(data.liveInputs.circulatingSupplyXyph) : prev));
      setSimBought((prev) => (prev === '' ? String(data.liveInputs.totalBoughtXyph) : prev));
      setSimSold((prev) => (prev === '' ? String(data.liveInputs.totalSoldXyph) : prev));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load C++17 Core status.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSourceFile = useCallback(async (fileId: string) => {
    setSelectedFileId(fileId);
    setSourceLoading(true);
    try {
      const res = await xypherApi.getCppCoreSource(fileId);
      setSourceMeta({
        title: res.entry.title,
        relativePath: res.entry.relativePath,
        role: res.entry.role,
      });
      setSourceCode(res.content);
    } catch {
      setSourceCode('// Failed to load C++17 source file.');
    } finally {
      setSourceLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadLiveChainAudit();
    void runLabChain(4);
    void loadSourceFile('chain.cpp');
  }, [loadStatus, loadLiveChainAudit, runLabChain, loadSourceFile]);

  const copyHashValue = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedHashKey(key);
    setTimeout(() => setCopiedHashKey((cur) => (cur === key ? null : cur)), 1500);
  };

  const runCppQuote = async (overrides?: {
    side?: 'buy' | 'sell';
    amount?: number;
    circulatingSupplyXyph?: number;
    totalBoughtXyph?: number;
    totalSoldXyph?: number;
  }) => {
    setQuoteError(null);
    const side = overrides?.side ?? simSide;
    const amount = overrides?.amount ?? Number(simAmount);
    const circ = overrides?.circulatingSupplyXyph ?? Number(simSupply);
    const bought = overrides?.totalBoughtXyph ?? Number(simBought);
    const sold = overrides?.totalSoldXyph ?? Number(simSold);

    if (!Number.isFinite(amount) || amount <= 0) {
      setQuoteError('Enter a valid positive amount to evaluate in the C++17 engine.');
      return;
    }

    setQuoteLoading(true);
    try {
      const res = await xypherApi.quoteCppSupplyDemand({
        side,
        amount,
        ...(Number.isFinite(circ) && circ >= 1 ? { circulatingSupplyXyph: circ } : {}),
        ...(Number.isFinite(bought) && bought >= 0 ? { totalBoughtXyph: bought } : {}),
        ...(Number.isFinite(sold) && sold >= 0 ? { totalSoldXyph: sold } : {}),
      });
      setQuoteResult(res);
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message : 'C++17 valuation failed.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const applyPresetHighDemandLowSupply = () => {
    const base = Math.max(10, status?.liveInputs.supplyBaselineXyph ?? 20);
    const lowSupply = Math.max(1, Number((base * 0.4).toFixed(2)));
    setSimSide('buy');
    setSimAmount('2500');
    setSimSupply(String(lowSupply));
    setSimBought('120000');
    setSimSold('5000');
    void runCppQuote({
      side: 'buy',
      amount: 2500,
      circulatingSupplyXyph: lowSupply,
      totalBoughtXyph: 120000,
      totalSoldXyph: 5000,
    });
  };

  const applyPresetHighSupplyLowDemand = () => {
    const base = Math.max(10, status?.liveInputs.supplyBaselineXyph ?? 20);
    const highSupply = Number((base * 4.0).toFixed(2));
    setSimSide('sell');
    setSimAmount('75000');
    setSimSupply(String(highSupply));
    setSimBought('2000');
    setSimSold('140000');
    void runCppQuote({
      side: 'sell',
      amount: 75000,
      circulatingSupplyXyph: highSupply,
      totalBoughtXyph: 2000,
      totalSoldXyph: 140000,
    });
  };

  const applyPresetLiveState = () => {
    if (!status) return;
    setSimSide('buy');
    setSimAmount('500');
    setSimSupply(String(status.liveInputs.circulatingSupplyXyph));
    setSimBought(String(status.liveInputs.totalBoughtXyph));
    setSimSold(String(status.liveInputs.totalSoldXyph));
    void runCppQuote({
      side: 'buy',
      amount: 500,
      circulatingSupplyXyph: status.liveInputs.circulatingSupplyXyph,
      totalBoughtXyph: status.liveInputs.totalBoughtXyph,
      totalSoldXyph: status.liveInputs.totalSoldXyph,
    });
  };

  const handleRunSelfTest = async () => {
    setTestRunning(true);
    try {
      const report = await xypherApi.runCppCoreSelfTest();
      setSelfTest(report);
      onLog(
        report.allPassed ? 'success' : 'error',
        `C++17 xypherd self-test ${report.allPassed ? 'PASSED' : 'FAILED'} (${report.tests.length} checks in ${report.durationMs}ms)`
      );
    } catch (err) {
      onLog('error', err instanceof Error ? err.message : 'C++17 self-test failed.');
    } finally {
      setTestRunning(false);
    }
  };

  const handleRunBenchmark = async () => {
    setBenchRunning(true);
    try {
      const report = await xypherApi.runCppCoreBenchmark(50000);
      setBenchmark(report);
      onLog(
        'success',
        `C++17 SHA256d PoW benchmark: ${report.hashesPerSec.toLocaleString()} H/s (${report.durationMs}ms)`
      );
    } catch (err) {
      onLog('error', err instanceof Error ? err.message : 'C++17 benchmark failed.');
    } finally {
      setBenchRunning(false);
    }
  };

  const handleCopySource = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode);
    setCopiedSource(true);
    setTimeout(() => setCopiedSource(false), 1600);
  };

  const liveSpotInr = marketTicker?.priceInr ?? status?.spot.spotPriceInr ?? 0.01;
  const liveSpotUsd = marketTicker?.priceUsd ?? status?.spot.spotPriceUsd ?? 0.000119;
  const scarcityMult = marketTicker?.scarcityMultiplier ?? status?.spot.scarcityMultiplier ?? 1;
  const demandMult = marketTicker?.demandMultiplier ?? status?.spot.demandMultiplier ?? 1;
  const ammSpotInr = marketTicker?.ammSpotInr ?? status?.spot.ammSpotInr ?? 0.01;
  const regime = marketTicker?.marketRegime ?? status?.spot.marketRegime ?? 'Supply-Demand Equilibrium';

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <h2 className="text-base font-semibold text-[#E6EDF3]">
                Xypher Core C++17 (<span className="font-mono text-amber-400">xypherd</span>) · Bitcoin-Core Architecture
              </h2>
            </div>
            <p className="text-xs text-[#8B98A8] mt-1">
              Compiled native C++17 consensus &amp; Supply-Demand valuation engine powering live {SYMBOL} pricing:
              when demand is high &amp; supply is scarce, price increases; when supply is high &amp; demand is low, price decreases.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadStatus()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh Core
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
            {errorMsg}
          </div>
        )}

        {/* Live Supply-Demand Valuation Formula Strip */}
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14]">
              <div className="text-[11px] text-[#8B98A8]">Live {SYMBOL} Market Price (C++17)</div>
              <div className="mt-1 text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                ₹{liveSpotInr.toFixed(6)}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                ${liveSpotUsd.toFixed(6)} USD · {regime}
              </div>
            </div>

            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14]">
              <div className="text-[11px] text-[#8B98A8]">AMM Liquidity Spot (x · y = k)</div>
              <div className="mt-1 text-lg font-mono font-semibold text-[#E6EDF3] tabular-nums">
                ₹{ammSpotInr.toFixed(6)}
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                ₹{(status?.liveInputs.inrReserve ?? 2500).toLocaleString()} /{' '}
                {(status?.liveInputs.xyphReserve ?? 250000).toLocaleString()} {SYMBOL}
              </div>
            </div>

            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14]">
              <div className="text-[11px] text-[#8B98A8]">Supply Scarcity Multiplier</div>
              <div
                className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                  scarcityMult > 1 ? 'text-emerald-400' : scarcityMult < 1 ? 'text-red-400' : 'text-[#E6EDF3]'
                }`}
              >
                {scarcityMult.toFixed(4)}x
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                Supply: {(status?.liveInputs.circulatingSupplyXyph ?? 0).toLocaleString()} {SYMBOL}
              </div>
            </div>

            <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14]">
              <div className="text-[11px] text-[#8B98A8]">Buy / Sell Demand Multiplier</div>
              <div
                className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                  demandMult > 1 ? 'text-emerald-400' : demandMult < 1 ? 'text-red-400' : 'text-[#E6EDF3]'
                }`}
              >
                {demandMult.toFixed(4)}x
              </div>
              <div className="mt-0.5 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                Bought {(status?.liveInputs.totalBoughtXyph ?? 0).toLocaleString()} · Sold{' '}
                {(status?.liveInputs.totalSoldXyph ?? 0).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Transparent Economic Formula & Native Binary Metadata */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
            <div className="lg:col-span-7 p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] space-y-2">
              <div className="font-semibold text-[#E6EDF3]">
                Real-Time Supply &amp; Demand Law (Executed in Native C++17)
              </div>
              <div className="font-mono text-[11px] text-amber-300 bg-[#121721] px-3 py-2 rounded border border-[#1E2533] overflow-x-auto">
                Price = (INR_Reserve / XYPH_Reserve) × (BaselineSupply / CirculatingSupply)^0.35 × exp(NetDemand / Depth × 0.65)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-[11px]">
                <div className="p-2.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-emerald-300 flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>High Demand + Low Supply:</strong> Buyers drain XYPH liquidity &amp; raise net demand → scarcity &amp; demand multipliers exceed 1.0x → <strong>Price Increases</strong>.
                  </span>
                </div>
                <div className="p-2.5 rounded border border-red-500/20 bg-red-500/5 text-red-300 flex items-start gap-2">
                  <TrendingDown className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>High Supply + Low Demand:</strong> Sellers flood XYPH supply or new coins enter without buyers → multipliers fall below 1.0x → <strong>Price Decreases</strong>.
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] space-y-2">
              <div className="font-semibold text-[#E6EDF3]">Compiled Bitcoin-Core-Style Consensus Specs</div>
              <dl className="space-y-1.5 text-[11px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-[#8B98A8]">Binary / Compiler</dt>
                  <dd className="font-mono text-[#E6EDF3]">
                    {status?.info.available ? `xypherd · GCC ${status.info.compiler} (${status.info.cppStandard})` : 'Initializing...'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#8B98A8]">Block Time / Reward</dt>
                  <dd className="font-mono text-[#E6EDF3]">
                    {(status?.info.targetBlockTimeSec ?? 600) / 60} min · {status?.info.initialSubsidyXyph ?? 10} {SYMBOL}/block
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#8B98A8]">Halving Schedule</dt>
                  <dd className="font-mono text-[#E6EDF3]">
                    Every {status?.info.halvingYears ?? 10} yrs ({(status?.info.halvingIntervalBlocks ?? 525600).toLocaleString()} blocks)
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#8B98A8]">Network Fee / Cap</dt>
                  <dd className="font-mono text-emerald-400">
                    {status?.info.minNetworkFeeXyph ?? 0} {SYMBOL} · {(status?.info.maxMoneyXyph ?? 10512000).toLocaleString()} {SYMBOL} cap
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Cryptographic 64-Character Hash Chain Core */}
      {(() => {
        const activeChain = chainTab === 'live' ? liveChainReport : labChainReport;
        const activeChainLoading = chainTab === 'live' ? liveChainLoading : labChainLoading;
        return (
          <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#222A38] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-[#E6EDF3]">
                    Blockchain Network Core · 64-Character Hash Chain
                  </h3>
                </div>
                <p className="text-xs text-[#8B98A8] mt-1">
                  Every block connects to the previous block through a 64-character SHA-256d hash and previous hash.
                  The first block (Genesis #0) always starts with 64 zeros as its previous hash.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] rounded-md border border-[#1E2533]">
                  <button
                    type="button"
                    onClick={() => setChainTab('live')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      chainTab === 'live'
                        ? 'bg-[#1D2534] text-[#E6EDF3]'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    Live XYPH Network Chain
                  </button>
                  <button
                    type="button"
                    onClick={() => setChainTab('lab')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      chainTab === 'lab'
                        ? 'bg-[#1D2534] text-[#E6EDF3]'
                        : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                    }`}
                  >
                    C++17 Chain &amp; Tamper Lab
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* Chain Integrity Summary Bar & Controls */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1D2432] text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {activeChain ? (
                    <>
                      <span
                        className={`inline-flex items-center gap-1.5 font-semibold ${
                          activeChain.valid ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {activeChain.valid ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {activeChain.valid
                          ? `Chain Verified (${activeChain.validLinks}/${activeChain.blockCount} blocks linked)`
                          : `Chain Link Broken at Block #${activeChain.firstBrokenHeight} (${activeChain.brokenLinks} invalid)`}
                      </span>
                      <span className="text-[#364154]" aria-hidden="true">·</span>
                      <span className="font-mono text-[#9AA6B6] tabular-nums">
                        Hash Length: {activeChain.hashHexLength} hex chars
                      </span>
                      <span className="text-[#364154]" aria-hidden="true">·</span>
                      <span className="font-mono text-[#9AA6B6] tabular-nums">
                        Genesis #0 PrevHash: 64 zeros
                      </span>
                      {chainTab === 'live' && activeChain.totalLiveBlocks !== undefined && (
                        <>
                          <span className="text-[#364154]" aria-hidden="true">·</span>
                          <span className="font-mono text-[#8B98A8] tabular-nums">
                            Live Ledger Height: #{activeChain.tipHeight?.toLocaleString() ?? 0} ({activeChain.totalLiveBlocks.toLocaleString()} blocks)
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-[#8B98A8]">Auditing 64-character hash chain in C++17...</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {chainTab === 'live' ? (
                    <button
                      type="button"
                      onClick={() => void loadLiveChainAudit()}
                      disabled={liveChainLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${liveChainLoading ? 'animate-spin' : ''}`} />
                      Re-Verify in C++17
                    </button>
                  ) : (
                    <>
                      <div className="inline-flex items-center gap-1.5 text-xs text-[#8B98A8]">
                        <label htmlFor="cpp-chain-blocks">Blocks:</label>
                        <select
                          id="cpp-chain-blocks"
                          value={labBlockCount}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setLabBlockCount(next);
                            void runLabChain(next);
                          }}
                          className="bg-[#0B0E14] border border-[#2A3446] rounded px-2 py-1 text-xs font-mono text-[#E6EDF3]"
                        >
                          {[3, 4, 5, 6].map((n) => (
                            <option key={n} value={n}>
                              {n} Blocks
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => void runLabChain(labBlockCount)}
                        disabled={labChainLoading}
                        className="px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded-md hover:bg-emerald-300 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        Mine Valid Chain
                      </button>
                      <button
                        type="button"
                        onClick={() => void runLabChain(labBlockCount, 1)}
                        disabled={labChainLoading}
                        className="px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        Tamper Block #1
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Linked Block Chain Visualization */}
              {activeChainLoading && !activeChain ? (
                <div className="py-10 text-center text-xs text-[#8B98A8]">
                  Executing C++17 64-character hash chain verification...
                </div>
              ) : activeChain && activeChain.blocks.length > 0 ? (
                <div className="space-y-0">
                  {activeChain.blocks.map((blk, idx) => {
                    const prevBlk = idx > 0 ? activeChain.blocks[idx - 1] : null;
                    const isGap = prevBlk !== null && blk.height !== prevBlk.height + 1;
                    const linkBroken = !blk.linkValid || !blk.blockValid;
                    return (
                      <React.Fragment key={`${chainTab}-${blk.height}-${idx}`}>
                        {prevBlk && (
                          <div className="flex flex-col items-center py-2">
                            {isGap ? (
                              <div className="text-[11px] font-mono text-[#6B7788] py-1">
                                ⋯ {(blk.height - prevBlk.height - 1).toLocaleString()} intermediate verified blocks linked by 64-char hashes ⋯
                              </div>
                            ) : (
                              <div
                                className={`flex items-center gap-2 text-[11px] font-mono ${
                                  blk.linkValid ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                <ArrowDown className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {blk.linkValid
                                    ? `Connected: Block #${prevBlk.height} Hash (64 chars) === Block #${blk.height} Previous Hash (64 chars)`
                                    : `BROKEN LINK: Block #${blk.height} Previous Hash does not match Block #${prevBlk.height} Hash`}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        <div
                          className={`rounded-md border bg-[#0B0E14] p-4 space-y-3 ${
                            linkBroken
                              ? 'border-red-500/50'
                              : blk.isGenesis
                              ? 'border-amber-500/40'
                              : 'border-[#1E2533]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-amber-400 tabular-nums">
                                Block #{blk.height.toLocaleString()}
                              </span>
                              <span className="text-[#364154]" aria-hidden="true">·</span>
                              <span className="text-[#C9D3DF] font-medium">
                                {blk.isGenesis ? 'First Block (Genesis Origin)' : `Linked Child of Block #${blk.height - 1}`}
                              </span>
                              {activeChain.tamperedHeight === blk.height && (
                                <>
                                  <span className="text-[#364154]" aria-hidden="true">·</span>
                                  <span className="font-semibold text-red-400">TAMPERED PAYLOAD</span>
                                </>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#8B98A8] tabular-nums">
                              <span>Nonce {blk.nonce.toLocaleString()}</span>
                              <span className="text-[#364154]" aria-hidden="true">·</span>
                              <span>{blk.txCount} TX{blk.txCount === 1 ? '' : 's'}</span>
                              <span className="text-[#364154]" aria-hidden="true">·</span>
                              <span className={blk.blockValid ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                                {blk.blockValid ? 'Valid 64-Char Link' : 'Invalid / Broken'}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 text-[11px]">
                            {/* Previous Hash Row */}
                            <div className="p-2.5 rounded border border-[#1B2230] bg-[#10151F] space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[#8B98A8] font-medium">
                                  Previous Hash{' '}
                                  <span className="font-mono text-[#6B7788]">({blk.prevHashLength} chars)</span>
                                  {blk.isGenesis && blk.genesisPrevAllZeros && (
                                    <span className="ml-2 text-amber-400 font-medium">
                                      — 64 Zeros (Genesis First Block)
                                    </span>
                                  )}
                                  {!blk.isGenesis && blk.linkValid && (
                                    <span className="ml-2 text-emerald-400 font-medium">
                                      — Matches Block #{blk.height - 1} Hash
                                    </span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyHashValue(blk.prevHash, `prev-${chainTab}-${blk.height}`)}
                                  className="inline-flex items-center gap-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
                                >
                                  {copiedHashKey === `prev-${chainTab}-${blk.height}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span>{copiedHashKey === `prev-${chainTab}-${blk.height}` ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <div
                                className={`font-mono break-all leading-relaxed ${
                                  blk.isGenesis
                                    ? 'text-amber-300'
                                    : blk.linkValid
                                    ? 'text-[#C9D3DF]'
                                    : 'text-red-300'
                                }`}
                              >
                                {blk.prevHash}
                              </div>
                            </div>

                            {/* Block Hash Row */}
                            <div className="p-2.5 rounded border border-[#1B2230] bg-[#10151F] space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-[#8B98A8] font-medium">
                                  Block Hash (SHA-256d){' '}
                                  <span className="font-mono text-[#6B7788]">({blk.hashLength} chars)</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => copyHashValue(blk.hash, `hash-${chainTab}-${blk.height}`)}
                                  className="inline-flex items-center gap-1 text-[#8B98A8] hover:text-[#E6EDF3] cursor-pointer"
                                >
                                  {copiedHashKey === `hash-${chainTab}-${blk.height}` ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                  <span>{copiedHashKey === `hash-${chainTab}-${blk.height}` ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                              <div
                                className={`font-mono break-all leading-relaxed ${
                                  blk.blockValid ? 'text-emerald-300' : 'text-red-300'
                                }`}
                              >
                                {blk.hash}
                              </div>
                            </div>
                          </div>

                          {blk.error && (
                            <div className="p-2.5 rounded border border-red-500/30 bg-red-500/10 text-[11px] text-red-300 space-y-1">
                              <div className="font-semibold">{blk.error}</div>
                              {!blk.linkValid && (
                                <div className="font-mono text-[10px] text-red-200/90 break-all">
                                  Expected Previous Hash: {blk.expectedPrevHash}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-[#6B7788]">
                  No blocks loaded yet.
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Interactive C++17 Supply & Demand Price Simulator */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Interactive C++17 Supply &amp; Demand Price Calculator
            </h3>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Executes the compiled native <span className="font-mono text-[#E6EDF3]">xypherd</span> binary live (read-only simulation — does not modify real user balances).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={applyPresetHighDemandLowSupply}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-md hover:bg-emerald-500/20 cursor-pointer"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Test High Demand + Low Supply
            </button>
            <button
              type="button"
              onClick={applyPresetHighSupplyLowDemand}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 cursor-pointer"
            >
              <TrendingDown className="w-3.5 h-3.5" />
              Test High Supply + Low Demand
            </button>
            <button
              type="button"
              onClick={applyPresetLiveState}
              className="px-3 py-1.5 text-xs font-medium text-[#C9D3DF] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer"
            >
              Live State
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">Order Action</label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-md border border-[#2A3446] bg-[#0B0E14]">
                <button
                  type="button"
                  onClick={() => setSimSide('buy')}
                  className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                    simSide === 'buy'
                      ? 'bg-emerald-500 text-[#0B0E14]'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  BUY ↑
                </button>
                <button
                  type="button"
                  onClick={() => setSimSide('sell')}
                  className={`py-1.5 text-xs font-semibold rounded cursor-pointer ${
                    simSide === 'sell'
                      ? 'bg-red-500 text-[#0B0E14]'
                      : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                  }`}
                >
                  SELL ↓
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                {simSide === 'buy' ? 'Buy Demand (INR ₹)' : `Sell Pressure (${SYMBOL})`}
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={simAmount}
                onChange={(e) => setSimAmount(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                Circulating Supply ({SYMBOL})
              </label>
              <input
                type="number"
                min="1"
                step="any"
                value={simSupply}
                onChange={(e) => setSimSupply(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                Total Bought ({SYMBOL})
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={simBought}
                onChange={(e) => setSimBought(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#9AA6B6] mb-1.5">
                Total Sold ({SYMBOL})
              </label>
              <input
                type="number"
                min="0"
                step="any"
                value={simSold}
                onChange={(e) => setSimSold(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-[#0B0E14] border border-[#2A3446] rounded-md text-[#E6EDF3] focus:outline-none focus:border-amber-500 tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-[#8B98A8]">
              Click Evaluate to run the exact C++17 <span className="font-mono text-[#E6EDF3]">CSupplyDemandEngine</span> calculation.
            </span>
            <button
              type="button"
              onClick={() => void runCppQuote()}
              disabled={quoteLoading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {quoteLoading ? 'Evaluating in C++17...' : 'Evaluate Price in C++17'}
            </button>
          </div>

          {quoteError && (
            <div className="p-3 rounded-md border border-red-500/30 bg-red-500/10 text-xs text-red-300">
              {quoteError}
            </div>
          )}

          {quoteResult && (
            <div className="p-4 rounded-md border border-[#222A38] bg-[#0B0E14] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-[#8B98A8]">Price Move (C++17 Output)</div>
                <div
                  className={`mt-1 font-mono text-sm font-semibold tabular-nums ${
                    quoteResult.priceImpactPercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  ₹{quoteResult.spotBeforeInr.toFixed(6)} → ₹{quoteResult.spotAfterInr.toFixed(6)}
                </div>
                <div className="text-[11px] font-mono text-[#8B98A8] tabular-nums">
                  Impact: {quoteResult.priceImpactPercent >= 0 ? '+' : ''}
                  {quoteResult.priceImpactPercent.toFixed(2)}% (${quoteResult.spotAfterUsd.toFixed(6)} USD)
                </div>
              </div>

              <div>
                <div className="text-[#8B98A8]">Order Fill</div>
                <div className="mt-1 font-mono text-sm font-semibold text-[#E6EDF3] tabular-nums">
                  {quoteResult.side === 'buy'
                    ? `+${quoteResult.outputAmount.toLocaleString()} ${SYMBOL}`
                    : `₹${quoteResult.outputAmount.toFixed(2)} INR`}
                </div>
                <div className="text-[11px] font-mono text-[#8B98A8] tabular-nums">
                  Avg Exec: ₹{quoteResult.executionPriceInr.toFixed(6)}/{SYMBOL}
                </div>
              </div>

              <div>
                <div className="text-[#8B98A8]">Post-Trade Multipliers</div>
                <div className="mt-1 font-mono text-sm font-semibold text-amber-400 tabular-nums">
                  Scarcity {quoteResult.scarcityMultiplier.toFixed(3)}x · Demand{' '}
                  {quoteResult.demandMultiplier.toFixed(3)}x
                </div>
                <div className="text-[11px] font-mono text-[#8B98A8]">
                  Engine: {quoteResult.engine}
                </div>
              </div>

              <div>
                <div className="text-[#8B98A8]">Market Regime</div>
                <div className="mt-1 font-semibold text-[#E6EDF3]">{quoteResult.marketRegime}</div>
                <div className="text-[11px] font-mono text-[#8B98A8] tabular-nums">
                  New Pool: ₹{quoteResult.newInrReserve.toLocaleString()} /{' '}
                  {quoteResult.newXyphReserve.toLocaleString()} {SYMBOL}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Native C++17 Consensus Self-Test & SHA256d PoW Benchmark */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  C++17 Consensus &amp; Economics Self-Test
                </h3>
              </div>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Verifies SHA256d, UTXO ConnectBlock, double-spend blocking, 10-year halving &amp; supply-demand pricing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRunSelfTest()}
              disabled={testRunning}
              className="px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded-md hover:bg-emerald-300 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {testRunning ? 'Running...' : 'Run C++ Self-Test'}
            </button>
          </div>
          <div className="p-5 flex-1">
            {selfTest ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-[#1D2432]">
                  <span
                    className={`font-semibold ${
                      selfTest.allPassed ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {selfTest.allPassed
                      ? `ALL ${selfTest.tests.length} C++17 CORE CHECKS PASSED`
                      : 'TEST FAILURE DETECTED'}
                  </span>
                  <span className="font-mono text-[#8B98A8] tabular-nums">
                    {selfTest.durationMs.toFixed(2)} ms
                  </span>
                </div>
                {selfTest.tests.map((t) => (
                  <div
                    key={t.name}
                    className="p-3 rounded-md border border-[#1E2533] bg-[#0B0E14] flex items-start gap-2.5 text-xs"
                  >
                    {t.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-[#E6EDF3]">{t.name}</div>
                      <div className="text-[11px] font-mono text-[#8B98A8] mt-0.5 break-words">
                        {t.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full min-h-[140px] flex items-center justify-center text-xs text-[#6B7788] text-center">
                Click &ldquo;Run C++ Self-Test&rdquo; to execute the compiled Bitcoin-Core-style C++17 verification suite live on the server.
              </div>
            )}
          </div>
        </div>

        <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#222A38] flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-[#E6EDF3]">
                  Native C++17 SHA256d PoW Benchmark
                </h3>
              </div>
              <p className="text-xs text-[#8B98A8] mt-0.5">
                Measures raw Double-SHA-256 Proof-of-Work throughput of the compiled <span className="font-mono text-[#E6EDF3]">xypherd</span> binary.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRunBenchmark()}
              disabled={benchRunning}
              className="px-3.5 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {benchRunning ? 'Hashing...' : 'Benchmark PoW'}
            </button>
          </div>
          <div className="p-5 flex-1 flex flex-col justify-center">
            {benchmark ? (
              <div className="space-y-4">
                <div className="p-4 rounded-md border border-[#1E2533] bg-[#0B0E14] text-center">
                  <div className="text-xs text-[#8B98A8]">Compiled C++17 SHA256d Hash Rate</div>
                  <div className="mt-1 text-2xl font-mono font-bold text-amber-400 tabular-nums">
                    {benchmark.hashesPerSec.toLocaleString()} H/s
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-[#8B98A8] tabular-nums">
                    {benchmark.iterations.toLocaleString()} double-SHA256 hashes in{' '}
                    {benchmark.durationMs.toFixed(2)} ms
                  </div>
                </div>
                <div className="p-3 rounded-md border border-[#1E2533] bg-[#0B0E14] text-[11px] font-mono">
                  <div className="text-[#8B98A8]">Last Computed Block Hash Sample</div>
                  <div className="text-[#E6EDF3] break-all mt-1">{benchmark.sampleHash}</div>
                </div>
              </div>
            ) : (
              <div className="min-h-[140px] flex items-center justify-center text-xs text-[#6B7788] text-center">
                Click &ldquo;Benchmark PoW&rdquo; to run 50,000 native C++17 Double-SHA-256 hashes on this server.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bitcoin-Core-Style C++17 Source Code Inspector */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-[#E6EDF3]">
                Xypher Core C++17 Source Code (<span className="font-mono text-[#9AA6B6]">xypher-core/</span>)
              </h3>
            </div>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Inspect or copy every C++17 consensus, UTXO validation, SHA-256d, and Supply-Demand engine source file.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopySource}
            disabled={!sourceCode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:bg-[#232C3D] cursor-pointer disabled:opacity-50 self-start sm:self-auto"
          >
            {copiedSource ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copiedSource ? 'Copied Source' : 'Copy File'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#222A38]">
          <div className="lg:col-span-4 p-3 bg-[#0E131C] space-y-1 max-h-[460px] overflow-y-auto">
            {(status?.sourceFiles || []).map((f) => {
              const active = f.id === selectedFileId;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => void loadSourceFile(f.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? 'border-amber-500/60 bg-amber-500/10'
                      : 'border-transparent hover:bg-[#161C27]'
                  }`}
                >
                  <div className="font-mono text-xs font-semibold text-[#E6EDF3] truncate">
                    {f.relativePath}
                  </div>
                  <div className="text-[11px] text-[#8B98A8] mt-0.5 leading-snug">{f.role}</div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-8 bg-[#0B0E14] flex flex-col">
            {sourceMeta && (
              <div className="px-4 py-2.5 border-b border-[#1D2432] flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-amber-400">{sourceMeta.relativePath}</span>
                <span className="text-[#8B98A8] truncate">{sourceMeta.title}</span>
              </div>
            )}
            <pre className="p-4 text-[11px] leading-relaxed font-mono text-[#C9D3DF] overflow-auto max-h-[420px] whitespace-pre">
              {sourceLoading ? '// Loading C++17 source...' : sourceCode}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
