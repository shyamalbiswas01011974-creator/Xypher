import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { MarketTicker } from '../lib/types.ts';
import { SYMBOL, truncateHash } from '../lib/xypherCrypto.ts';

interface LiveMarketPanelProps {
  marketTicker: MarketTicker | null;
  streamConnected: boolean;
  onInspectTx: (txid: string) => void;
}

export const LiveMarketPanel: React.FC<LiveMarketPanelProps> = ({
  marketTicker,
  streamConnected,
  onInspectTx,
}) => {
  const [tradeFilter, setTradeFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const isUp = (marketTicker?.change24hPercent ?? 0) >= 0;
  const buyPct = marketTicker?.buyPressurePercent ?? 50;
  const sellPct = Number((100 - buyPct).toFixed(1));
  const netFlow = marketTicker?.netFlowXyph ?? 0;

  const filteredTrades = useMemo(() => {
    const list = marketTicker?.recentTrades || [];
    if (tradeFilter === 'all') return list;
    return list.filter((t) => t.side === tradeFilter);
  }, [marketTicker, tradeFilter]);

  // Real trade-driven SVG chart geometry
  const chartModel = useMemo(() => {
    const rawPts = marketTicker?.history || [];
    if (rawPts.length === 0) return null;

    // If only the single launch point exists, mirror it across the x-axis as a flat launch baseline
    const pts =
      rawPts.length === 1
        ? [rawPts[0], { ...rawPts[0], time: marketTicker?.updatedAt ?? rawPts[0].time }]
        : rawPts;

    const width = 760;
    const height = 148;
    const padX = 10;
    const padY = 16;
    const prices = pts.map((p) => p.priceInr);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const span = Math.max(maxP - minP, minP * 0.02, 0.0002);
    const floorP = minP - span * 0.15;
    const ceilP = maxP + span * 0.15;
    const totalSpan = ceilP - floorP;

    const coords = pts.map((p, idx) => {
      const x = padX + (idx / Math.max(1, pts.length - 1)) * (width - padX * 2);
      const y = height - padY - ((p.priceInr - floorP) / totalSpan) * (height - padY * 2);
      return { x, y, point: p };
    });

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(
      1
    )} ${height} Z`;

    const openPrice = marketTicker?.open24hInr ?? pts[0].priceInr;
    const openY =
      height -
      padY -
      ((Math.min(ceilP, Math.max(floorP, openPrice)) - floorP) / totalSpan) * (height - padY * 2);

    return {
      width,
      height,
      coords,
      linePath,
      areaPath,
      minP,
      maxP,
      openY,
      hasRealTrades: rawPts.length > 1,
    };
  }, [marketTicker]);

  const activePoint =
    chartModel && hoveredIdx !== null && chartModel.coords[hoveredIdx]
      ? chartModel.coords[hoveredIdx]
      : null;

  return (
    <div className="space-y-6">
      {/* Real Trade-Driven Price Chart & Buy/Sell Pressure Panel */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#222A38]">
          {/* Left: Real AMM Trade Price Chart */}
          <div className="lg:col-span-7 p-5 bg-[#0E131C] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#C9D3DF]">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-medium">Real Buy / Sell Price Curve</span>
                <span className="text-[#4B5668]">·</span>
                <span className="font-mono text-[11px] text-[#8B98A8]">
                  {streamConnected ? 'Live Stream Active' : 'Syncing Market'}
                </span>
              </div>
              {activePoint ? (
                <div className="font-mono text-[11px] tabular-nums flex items-center gap-2">
                  <span className="text-[#E6EDF3] font-semibold">
                    ₹{activePoint.point.priceInr.toFixed(5)}
                  </span>
                  {activePoint.point.side === 'buy' ? (
                    <span className="text-emerald-400">
                      BUY +{activePoint.point.xyphAmount?.toLocaleString()} {SYMBOL}
                    </span>
                  ) : activePoint.point.side === 'sell' ? (
                    <span className="text-red-400">
                      SELL -{activePoint.point.xyphAmount?.toLocaleString()} {SYMBOL}
                    </span>
                  ) : (
                    <span className="text-[#8B98A8]">Launch Peg</span>
                  )}
                </div>
              ) : (
                <span className="font-mono text-[11px] text-[#6B7788] tabular-nums">
                  {chartModel
                    ? `Range: ₹${chartModel.minP.toFixed(5)} – ₹${chartModel.maxP.toFixed(5)}`
                    : 'Loading feed...'}
                </span>
              )}
            </div>

            {chartModel ? (
              <div className="relative">
                <svg
                  viewBox={`0 0 ${chartModel.width} ${chartModel.height}`}
                  className="w-full h-36 overflow-visible"
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <defs>
                    <linearGradient id="xyphRealTradeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={isUp ? '#34d399' : '#f87171'}
                        stopOpacity="0.24"
                      />
                      <stop
                        offset="100%"
                        stopColor={isUp ? '#34d399' : '#f87171'}
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>

                  <line
                    x1="0"
                    x2={chartModel.width}
                    y1={chartModel.openY}
                    y2={chartModel.openY}
                    stroke="#2A3446"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />

                  <path d={chartModel.areaPath} fill="url(#xyphRealTradeGrad)" />
                  <path
                    d={chartModel.linePath}
                    fill="none"
                    stroke={isUp ? '#34d399' : '#f87171'}
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />

                  {chartModel.coords.map((c, idx) => {
                    const isBuyNode = c.point.side === 'buy';
                    const isSellNode = c.point.side === 'sell';
                    const isHovered = hoveredIdx === idx;
                    const fill = isBuyNode
                      ? '#34d399'
                      : isSellNode
                      ? '#f87171'
                      : '#9AA6B6';
                    return (
                      <g
                        key={`${c.point.time}-${idx}`}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredIdx(idx)}
                      >
                        <circle cx={c.x} cy={c.y} r="10" fill="transparent" />
                        {(isBuyNode || isSellNode || idx === chartModel.coords.length - 1) && (
                          <circle
                            cx={c.x}
                            cy={c.y}
                            r={isHovered ? 5 : 3.5}
                            fill={fill}
                            stroke="#0E131C"
                            strokeWidth="1.5"
                          />
                        )}
                      </g>
                    );
                  })}
                </svg>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7788]">
                  <span>
                    {chartModel.hasRealTrades
                      ? 'C++17 Core: High demand + low supply raises price (↑); high supply + selling lowers price (↓).'
                      : 'C++17 Core Supply-Demand Engine active: price rises on Buys & low supply, drops on Sells & expanding supply.'}
                  </span>
                  <span className="font-mono tabular-nums text-[#8B98A8]">
                    Pool: ₹{(marketTicker?.poolInrReserve ?? 2500).toLocaleString()} /{' '}
                    {(marketTicker?.poolXyphReserve ?? 250000).toLocaleString()} {SYMBOL}
                  </span>
                </div>

                <div className="mt-2.5 pt-2.5 border-t border-[#1D2432] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                  <span className="text-[#C9D3DF]">
                    {marketTicker?.marketRegime || 'Supply-Demand Equilibrium'}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[#8B98A8]">
                    <span>
                      Scarcity:{' '}
                      <strong
                        className={
                          (marketTicker?.scarcityMultiplier ?? 1) > 1
                            ? 'text-emerald-400'
                            : (marketTicker?.scarcityMultiplier ?? 1) < 1
                            ? 'text-red-400'
                            : 'text-[#E6EDF3]'
                        }
                      >
                        {(marketTicker?.scarcityMultiplier ?? 1).toFixed(3)}x
                      </strong>
                    </span>
                    <span>
                      Demand:{' '}
                      <strong
                        className={
                          (marketTicker?.demandMultiplier ?? 1) > 1
                            ? 'text-emerald-400'
                            : (marketTicker?.demandMultiplier ?? 1) < 1
                            ? 'text-red-400'
                            : 'text-[#E6EDF3]'
                        }
                      >
                        {(marketTicker?.demandMultiplier ?? 1).toFixed(3)}x
                      </strong>
                    </span>
                    <span className="text-amber-400">xypherd C++17</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-36 flex items-center justify-center text-xs text-[#6B7788]">
                Connecting to real-time market stream...
              </div>
            )}
          </div>

          {/* Right: Live Buy vs Sell Pressure & Volume Breakdown */}
          <div className="lg:col-span-5 p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#E6EDF3]">Live Buy vs Sell Pressure</span>
                <span className="font-mono text-[11px] text-[#8B98A8] tabular-nums">
                  {marketTicker?.uniqueTradersCount ?? 0} active{' '}
                  {(marketTicker?.uniqueTradersCount ?? 0) === 1 ? 'trader' : 'traders'}
                </span>
              </div>

              {/* Buy / Sell Split Ratio Bar */}
              <div className="h-2.5 w-full rounded bg-[#1E2533] overflow-hidden flex">
                <div
                  className="h-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.max(2, Math.min(98, buyPct))}%` }}
                />
                <div
                  className="h-full bg-red-400 transition-all duration-300"
                  style={{ width: `${Math.max(2, Math.min(98, sellPct))}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                <span className="text-emerald-400 inline-flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Buyers {buyPct.toFixed(1)}%
                </span>
                <span className="text-red-400 inline-flex items-center gap-1">
                  Sellers {sellPct.toFixed(1)}%
                  <TrendingDown className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>

            {/* Bought vs Sold Real Totals */}
            <div className="grid grid-cols-2 border border-[#1E2533] rounded-md bg-[#0B0E14] divide-x divide-y divide-[#1E2533] text-xs">
              <div className="p-3">
                <div className="text-[#8B98A8]">24h People Bought</div>
                <div className="mt-1 font-mono font-semibold text-emerald-400 tabular-nums">
                  +{(marketTicker?.buyVolume24hXyph ?? 0).toLocaleString()} {SYMBOL}
                </div>
                <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
                  ₹{(marketTicker?.buyVolume24hInr ?? 0).toFixed(2)} ·{' '}
                  {marketTicker?.buyCount24h ?? 0} buys
                </div>
              </div>
              <div className="p-3">
                <div className="text-[#8B98A8]">24h People Sold</div>
                <div className="mt-1 font-mono font-semibold text-red-400 tabular-nums">
                  -{(marketTicker?.sellVolume24hXyph ?? 0).toLocaleString()} {SYMBOL}
                </div>
                <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
                  ₹{(marketTicker?.sellVolume24hInr ?? 0).toFixed(2)} ·{' '}
                  {marketTicker?.sellCount24h ?? 0} sells
                </div>
              </div>
              <div className="p-3">
                <div className="text-[#8B98A8]">Net Market Flow</div>
                <div
                  className={`mt-1 font-mono font-semibold tabular-nums ${
                    netFlow > 0
                      ? 'text-emerald-400'
                      : netFlow < 0
                      ? 'text-red-400'
                      : 'text-[#E6EDF3]'
                  }`}
                >
                  {netFlow > 0 ? '+' : ''}
                  {netFlow.toLocaleString()} {SYMBOL}
                </div>
                <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
                  {(marketTicker?.totalBuyTrades ?? 0) + (marketTicker?.totalSellTrades ?? 0)} settled trades
                </div>
              </div>
              <div className="p-3">
                <div className="text-[#8B98A8]">Pending Buy Queue</div>
                <div className="mt-1 font-mono font-semibold text-amber-400 tabular-nums">
                  ₹{(marketTicker?.pendingBuyInr ?? 0).toFixed(2)}
                </div>
                <div className="text-[11px] font-mono text-[#6B7788] tabular-nums">
                  {marketTicker?.pendingBuyCount ?? 0} pending ·{' '}
                  {(marketTicker?.pendingBuyXyph ?? 0).toLocaleString()} {SYMBOL}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Live Market Trade Tape (Real Buys & Sells Moving the Price) */}
      <div className="border border-[#222A38] rounded-lg bg-[#121721] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#222A38] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#E6EDF3]">
              Live Market Activity (Real Buys &amp; Sells)
            </h3>
            <p className="text-xs text-[#8B98A8] mt-0.5">
              Every verified buy raises the live {SYMBOL} price and every on-chain sell lowers it in real time via constant-product AMM liquidity.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 bg-[#0B0E14] border border-[#1E2533] rounded-md text-xs shrink-0 self-start sm:self-auto">
            {(['all', 'buy', 'sell'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setTradeFilter(tab)}
                className={`px-2.5 py-1 rounded capitalize cursor-pointer whitespace-nowrap transition-colors ${
                  tradeFilter === tab
                    ? tab === 'buy'
                      ? 'bg-[#1D2534] text-emerald-400 font-medium'
                      : tab === 'sell'
                      ? 'bg-[#1D2534] text-red-400 font-medium'
                      : 'bg-[#1D2534] text-[#E6EDF3] font-medium'
                    : 'text-[#8B98A8] hover:text-[#E6EDF3]'
                }`}
              >
                {tab === 'all' ? 'All Trades' : tab === 'buy' ? 'Buys ↑' : 'Sells ↓'}
              </button>
            ))}
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <div className="p-8 text-center space-y-1.5">
            <p className="text-xs font-medium text-[#C9D3DF]">
              No settled {tradeFilter === 'all' ? 'market trades' : `${tradeFilter} trades`} recorded yet
            </p>
            <p className="text-xs text-[#6B7788] max-w-lg mx-auto">
              The live price is currently at its launch peg (₹{(marketTicker?.priceInr ?? 0.01).toFixed(5)}/{SYMBOL}).
              As soon as anyone completes a Buy order (price moves UP) or executes an on-chain Sell order (price moves DOWN), it appears here instantaneously for all users.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#222A38] text-[#8B98A8]">
                  <th className="py-2.5 px-5">Side</th>
                  <th className="py-2.5 px-4 text-right">Amount ({SYMBOL})</th>
                  <th className="py-2.5 px-4 text-right">Value (INR)</th>
                  <th className="py-2.5 px-4 text-right">Price Move</th>
                  <th className="py-2.5 px-4">Trader / Wallet</th>
                  <th className="py-2.5 px-5 text-right">Time / Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D2432]">
                {filteredTrades.slice(0, 20).map((t) => {
                  const isBuy = t.side === 'buy';
                  return (
                    <tr key={t.id} className="hover:bg-[#161C27]">
                      <td className="py-3 px-5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-mono font-semibold ${
                            isBuy ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isBuy ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          )}
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-[#E6EDF3] tabular-nums whitespace-nowrap">
                        {isBuy ? '+' : '-'}
                        {t.xyphAmount.toLocaleString()} {SYMBOL}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#C9D3DF] tabular-nums whitespace-nowrap">
                        ₹{t.inrAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className={isBuy ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                          {t.priceImpactPercent >= 0 ? '+' : ''}
                          {t.priceImpactPercent.toFixed(2)}%
                        </div>
                        <div className="text-[11px] text-[#6B7788]">
                          ₹{t.priceBeforeInr.toFixed(5)} → ₹{t.priceAfterInr.toFixed(5)}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="text-[#E6EDF3]">{t.traderLabel}</div>
                        <div className="font-mono text-[11px] text-[#6B7788]">
                          {truncateHash(t.walletAddress, 8, 6)}
                        </div>
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="font-mono text-[11px] text-[#8B98A8] tabular-nums">
                          {new Date(t.time * 1000).toLocaleTimeString()}
                        </div>
                        {t.txid && (
                          <button
                            type="button"
                            onClick={() => onInspectTx(t.txid!)}
                            className="font-mono text-[11px] text-amber-400 hover:underline cursor-pointer"
                          >
                            Tx {truncateHash(t.txid, 6, 4)}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
