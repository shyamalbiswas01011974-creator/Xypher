import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, Cpu, Pickaxe, Send, Square } from 'lucide-react';
import { xypherApi } from '../lib/api.ts';
import type { AddressInfo, LocalWalletAccount, MiningStatus } from '../lib/types.ts';
import {
  HALVING_INTERVAL_BLOCKS,
  HALVING_YEARS,
  MINING_BLOCK_TIME_SEC,
  SYMBOL,
  evmToXypherAddress,
  formatXYPH,
  truncateHash,
} from '../lib/xypherCrypto.ts';

interface WalletMiningPanelProps {
  wallets: LocalWalletAccount[];
  balances: Record<string, AddressInfo>;
  mmAccount: string | null;
  activeWalletLabel: string;
  onBlockMined: () => Promise<void> | void;
  onQuickSend: (address: string, useMetaMask?: boolean) => void;
  onInspectTx: (txid: string) => void;
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const WalletMiningPanel: React.FC<WalletMiningPanelProps> = ({
  wallets,
  balances,
  mmAccount,
  activeWalletLabel,
  onBlockMined,
  onQuickSend,
  onInspectTx,
}) => {
  const mmXyphAddress = useMemo(() => {
    if (!mmAccount) return null;
    try {
      return evmToXypherAddress(mmAccount);
    } catch {
      return null;
    }
  }, [mmAccount]);

  const payoutOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; isMetaMask: boolean; sendAddress: string }> = [];
    const seen = new Set<string>();
    if (mmAccount && mmXyphAddress) {
      seen.add(mmXyphAddress);
      opts.push({
        value: mmXyphAddress,
        label: `${activeWalletLabel} (${truncateHash(mmXyphAddress, 8, 6)})`,
        isMetaMask: true,
        sendAddress: mmAccount,
      });
    }
    for (const w of wallets) {
      if (seen.has(w.address)) continue;
      seen.add(w.address);
      opts.push({
        value: w.address,
        label: `${w.label} (${truncateHash(w.address, 8, 6)})`,
        isMetaMask: false,
        sendAddress: w.address,
      });
    }
    return opts;
  }, [wallets, mmAccount, mmXyphAddress, activeWalletLabel]);

  const [selectedPayout, setSelectedPayout] = useState<string>(payoutOptions[0]?.value ?? '');
  const [status, setStatus] = useState<MiningStatus | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastCreditedNotice, setLastCreditedNotice] = useState<{
    height: number;
    rewardUnits: number;
    minerAddress: string;
  } | null>(null);
  const prevBlocksMinedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedPayout && payoutOptions[0]?.value) {
      setSelectedPayout(payoutOptions[0].value);
    } else if (
      selectedPayout &&
      payoutOptions.length > 0 &&
      !payoutOptions.some((o) => o.value === selectedPayout)
    ) {
      setSelectedPayout(payoutOptions[0].value);
    }
  }, [payoutOptions, selectedPayout]);

  const fetchStatus = useCallback(async () => {
    try {
      const next = await xypherApi.getMiningStatus();
      setStatus(next);
      setNowMs(Date.now());
      if (next.active && next.minerAddress) {
        setSelectedPayout((cur) => cur || next.minerAddress || '');
      }
      if (
        prevBlocksMinedRef.current !== null &&
        next.blocksMined > prevBlocksMinedRef.current
      ) {
        const newest = next.recentMinedBlocks[0];
        if (newest) {
          setLastCreditedNotice({
            height: newest.height,
            rewardUnits: newest.rewardUnits,
            minerAddress: newest.minerAddress,
          });
        }
        await onBlockMined();
      }
      prevBlocksMinedRef.current = next.blocksMined;
    } catch {
      // Handled gracefully by parent node polling
    }
  }, [onBlockMined]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Poll mining state periodically (faster when active or close to completing a block)
  useEffect(() => {
    const intervalMs = status?.active ? 4000 : 12000;
    const timer = setInterval(() => {
      void fetchStatus();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [fetchStatus, status?.active]);

  // Smooth 1-second local countdown synced to server nextBlockAtMs
  useEffect(() => {
    if (!status?.active || !status.nextBlockAtMs) return;
    const tick = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (status.nextBlockAtMs && current >= status.nextBlockAtMs + 600) {
        void fetchStatus();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [status?.active, status?.nextBlockAtMs, fetchStatus]);

  const handleStartMining = async () => {
    const target = selectedPayout || payoutOptions[0]?.value;
    if (!target) {
      setErrorMsg('Create or connect a wallet first to receive block rewards.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await xypherApi.startMining(target);
      setStatus(res.status);
      setNowMs(Date.now());
      prevBlocksMinedRef.current = res.status.blocksMined;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start mining');
    } finally {
      setBusy(false);
    }
  };

  const handleStopMining = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await xypherApi.stopMining();
      setStatus(res.status);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to stop mining');
    } finally {
      setBusy(false);
    }
  };

  const blockDurationMs = (status?.blockTimeSec ?? MINING_BLOCK_TIME_SEC) * 1000;
  const liveRemainingMs =
    status?.active && status.nextBlockAtMs
      ? Math.max(0, status.nextBlockAtMs - nowMs)
      : status?.remainingMs ?? 0;
  const elapsedPct = status?.active
    ? Math.min(100, Math.max(0, ((blockDurationMs - liveRemainingMs) / blockDurationMs) * 100))
    : 0;

  const activeRewardUnits = status?.currentRewardUnits ?? 1_000_000_000;
  const nextHalvingRewardUnits = status?.nextHalvingRewardUnits ?? 500_000_000;
  const halvingInterval = status?.halvingIntervalBlocks ?? HALVING_INTERVAL_BLOCKS;
  const halvingYears = status?.halvingYears ?? HALVING_YEARS;
  const currentEra = status?.currentEra ?? 1;

  const activePayoutAddr = (status?.active && status.minerAddress) || selectedPayout || payoutOptions[0]?.value || '';
  const activePayoutOpt = payoutOptions.find((o) => o.value === activePayoutAddr) || payoutOptions[0];
  const payoutWalletSpendable = activePayoutAddr ? balances[activePayoutAddr]?.spendable ?? 0 : 0;

  const handleSendFromPayoutWallet = (addrOverride?: string) => {
    const targetAddr = addrOverride || activePayoutAddr;
    if (!targetAddr) return;
    if (mmAccount && mmXyphAddress && targetAddr === mmXyphAddress) {
      onQuickSend(mmAccount, true);
      return;
    }
    onQuickSend(targetAddr, false);
  };

  return (
    <section className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
      {/* Header Row */}
      <div className="px-5 py-4 border-b border-[#222A38] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Pickaxe className="w-4 h-4 text-amber-400 shrink-0" />
            <h2 className="text-base font-semibold text-[#E6EDF3]">
              {SYMBOL} Block Mining
            </h2>
          </div>
          <p className="text-xs text-[#8B98A8] mt-0.5">
            10-minute block mining cycle · {formatXYPH(activeRewardUnits, 4)} {SYMBOL} reward credited directly to your spendable wallet balance · Halves every {halvingYears} years ({halvingInterval.toLocaleString()} blocks)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <select
            aria-label="Mining reward payout wallet"
            value={selectedPayout}
            onChange={(e) => setSelectedPayout(e.target.value)}
            disabled={busy || Boolean(status?.active)}
            className="h-9 px-3 text-xs font-mono text-[#E6EDF3] bg-[#0B0E14] border border-[#2A3446] rounded-md focus:outline-none focus:border-amber-500/60 disabled:opacity-60 max-w-[260px]"
          >
            {payoutOptions.length === 0 ? (
              <option value="">No wallet available</option>
            ) : (
              payoutOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            )}
          </select>

          {activePayoutOpt && (
            <button
              type="button"
              onClick={() => handleSendFromPayoutWallet(activePayoutOpt.value)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6EDF3] bg-[#1B2230] border border-[#2A3446] rounded-md hover:border-amber-500/50 hover:bg-[#232C3D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5 text-amber-400" />
              Send Rewards
            </button>
          )}

          {status?.active ? (
            <button
              type="button"
              onClick={() => void handleStopMining()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-red-200 bg-red-500/15 border border-red-500/40 rounded-md hover:bg-red-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              {busy ? 'Stopping...' : 'Stop Mining'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleStartMining()}
              disabled={busy || payoutOptions.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0B0E14] bg-amber-500 rounded-md hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              <Cpu className="w-3.5 h-3.5" />
              {busy ? 'Starting...' : 'Start Mining'}
            </button>
          )}
        </div>
      </div>

      {lastCreditedNotice && (
        <div className="px-5 py-3 border-b border-[#222A38] bg-emerald-500/10 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Block #{lastCreditedNotice.height.toLocaleString()} mined ·{' '}
              <span className="font-mono font-semibold text-emerald-200">
                +{formatXYPH(lastCreditedNotice.rewardUnits, 4)} {SYMBOL}
              </span>{' '}
              added to wallet{' '}
              <span className="font-mono">{truncateHash(lastCreditedNotice.minerAddress, 8, 6)}</span>{' '}
              and immediately spendable for real on-chain transactions.
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleSendFromPayoutWallet(lastCreditedNotice.minerAddress)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B0E14] bg-emerald-400 rounded hover:bg-emerald-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-3 h-3" />
            Send Now
          </button>
        </div>
      )}

      {(errorMsg || status?.lastError) && (
        <div className="px-5 py-3 border-b border-[#222A38] bg-red-500/10 text-xs text-red-300">
          {errorMsg || status?.lastError}
        </div>
      )}

      {/* 4-Column Mining Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-b border-[#222A38] divide-y sm:divide-y-0 sm:divide-x divide-[#222A38]">
        <div className="p-5">
          <div className="flex items-center justify-between text-xs text-[#8B98A8]">
            <span>Next Block Timer</span>
            <span className={status?.active ? 'text-emerald-400 font-medium' : 'text-[#6B7788]'}>
              {status?.sealingNow ? 'Sealing PoW' : status?.active ? 'Mining Active' : 'Idle'}
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" />
            {status?.active ? formatCountdown(liveRemainingMs) : '10:00'}
          </div>
          <div className="mt-2.5 h-1.5 w-full bg-[#1C2331] rounded overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-[width] duration-500"
              style={{ width: `${status?.active ? Math.max(2, elapsedPct) : 0}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-[#6B7788] font-mono tabular-nums">
            {status?.active && status.minerAddress
              ? `Payout: ${truncateHash(status.minerAddress, 8, 6)}`
              : '10 minutes (600s) per block'}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8]">Current Block Reward</p>
          <p className="mt-1.5 text-2xl font-mono font-semibold text-emerald-400 tabular-nums">
            {formatXYPH(activeRewardUnits, 4)}
            <span className="ml-1.5 text-sm font-normal text-[#8B98A8]">{SYMBOL}</span>
          </p>
          <p className="mt-1.5 text-[11px] text-[#6B7788]">
            Era #{currentEra} · 100% credited to miner wallet
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8]">Next 10-Year Halving</p>
          <p className="mt-1.5 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
            {formatXYPH(nextHalvingRewardUnits, 4)}
            <span className="ml-1.5 text-sm font-normal text-[#8B98A8]">{SYMBOL}</span>
          </p>
          <p className="mt-1.5 text-[11px] text-[#6B7788] font-mono tabular-nums">
            At Block #{(status?.nextHalvingBlock ?? halvingInterval).toLocaleString()} ·{' '}
            {(status?.yearsUntilHalving ?? halvingYears).toFixed(2)} yrs left
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-[#8B98A8]">Mined Rewards &amp; Wallet Balance</p>
          <p className="mt-1.5 text-2xl font-mono font-semibold text-[#E6EDF3] tabular-nums">
            {formatXYPH(status?.totalRewardUnits ?? 0, 4)}
            <span className="ml-1.5 text-sm font-normal text-[#8B98A8]">{SYMBOL}</span>
          </p>
          <p className="mt-1.5 text-[11px] text-emerald-400 font-mono tabular-nums">
            Wallet Spendable: {formatXYPH(payoutWalletSpendable, 4)} {SYMBOL} ·{' '}
            {(status?.blocksMined ?? 0).toLocaleString()} block
            {(status?.blocksMined ?? 0) === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* 2-Column Halving Schedule & Recent Mined Blocks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#222A38]">
        {/* 10-Year Halving Schedule */}
        <div>
          <div className="px-5 py-3.5 border-b border-[#1D2432] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#E6EDF3]">
              10-Year Reward Halving Schedule
            </h3>
            <span className="text-[11px] text-[#6B7788] font-mono tabular-nums">
              525,600 blocks / 10 yrs
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1D2432] text-[#8B98A8]">
                  <th className="py-2.5 px-5 font-medium">Era</th>
                  <th className="py-2.5 px-3 font-medium">Timeline</th>
                  <th className="py-2.5 px-3 font-medium">Blocks</th>
                  <th className="py-2.5 px-5 text-right font-medium">Reward</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2432] font-mono tabular-nums">
                {(status?.halvingSchedule ?? [
                  { era: 1, yearsLabel: 'Years 0–10', startBlock: 0, endBlock: 525599, rewardUnits: 1_000_000_000 },
                  { era: 2, yearsLabel: 'Years 10–20', startBlock: 525600, endBlock: 1051199, rewardUnits: 500_000_000 },
                  { era: 3, yearsLabel: 'Years 20–30', startBlock: 1051200, endBlock: 1576799, rewardUnits: 250_000_000 },
                  { era: 4, yearsLabel: 'Years 30–40', startBlock: 1576800, endBlock: 2102399, rewardUnits: 125_000_000 },
                  { era: 5, yearsLabel: 'Years 40–50', startBlock: 2102400, endBlock: 2627999, rewardUnits: 62_500_000 },
                ]).slice(0, 5).map((row) => {
                  const isCurrent = row.era === currentEra;
                  return (
                    <tr
                      key={row.era}
                      className={isCurrent ? 'bg-[#19202D]' : 'hover:bg-[#161C27]'}
                    >
                      <td className="py-2.5 px-5 text-[#E6EDF3]">
                        Era {row.era}
                        {isCurrent && (
                          <span className="ml-1.5 font-sans text-[11px] text-amber-400">
                            · Active
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[#9AA6B6]">{row.yearsLabel}</td>
                      <td className="py-2.5 px-3 text-[#8B98A8]">
                        {row.startBlock.toLocaleString()}–{row.endBlock.toLocaleString()}
                      </td>
                      <td
                        className={`py-2.5 px-5 text-right font-semibold whitespace-nowrap ${
                          isCurrent ? 'text-emerald-400' : 'text-[#C9D3DF]'
                        }`}
                      >
                        {formatXYPH(row.rewardUnits, 4)} {SYMBOL}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Mined Blocks */}
        <div>
          <div className="px-5 py-3.5 border-b border-[#1D2432] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#E6EDF3]">Recent Mined Blocks</h3>
            <span className="text-[11px] text-[#6B7788] font-mono tabular-nums">
              {status?.recentMinedBlocks.length ?? 0} logged
            </span>
          </div>
          {!status || status.recentMinedBlocks.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8B98A8]">
              {status?.active
                ? `Mining block #${(status.currentHeight + 1).toLocaleString()} — ${formatXYPH(activeRewardUnits, 4)} ${SYMBOL} will be credited automatically when the 10-minute timer completes.`
                : `Select your payout wallet and click Start Mining to earn ${formatXYPH(activeRewardUnits, 4)} ${SYMBOL} every 10 minutes.`}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D2432] text-[#8B98A8]">
                    <th className="py-2.5 px-5 font-medium">Block</th>
                    <th className="py-2.5 px-3 font-medium">Payout Wallet</th>
                    <th className="py-2.5 px-5 text-right font-medium">Reward</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D2432] font-mono tabular-nums">
                  {status.recentMinedBlocks.map((b) => (
                    <tr key={b.hash} className="hover:bg-[#161C27]">
                      <td className="py-2.5 px-5">
                        <button
                          type="button"
                          onClick={() => onInspectTx(b.txid)}
                          className="text-amber-400 hover:underline cursor-pointer"
                        >
                          #{b.height.toLocaleString()}
                        </button>
                        <div className="text-[11px] text-[#6B7788] font-sans">
                          {new Date(b.time * 1000).toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[#C9D3DF]">
                        {truncateHash(b.minerAddress, 8, 6)}
                      </td>
                      <td className="py-2.5 px-5 text-right text-emerald-400 font-semibold whitespace-nowrap">
                        +{formatXYPH(b.rewardUnits, 4)} {SYMBOL}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
