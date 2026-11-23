// Copyright (c) 2025-2026 Xypher Core Developers
// Real Supply & Demand Price Discovery Engine:
//   - High Buy Demand + Low Supply  => Price INCREASES
//   - High Supply + Low Buy Demand  => Price DECREASES
//   - Zero simulated drift: strictly driven by real buys, real sells, and real circulating supply.

#include "market/price_engine.h"

#include <algorithm>
#include <cmath>

namespace xypher::market {

namespace {

double RoundTo(double value, int decimals) {
    const double factor = std::pow(10.0, decimals);
    return std::round(value * factor) / factor;
}

std::string ClassifyRegime(double scarcity, double demand, double buyPressurePct) {
    const double combined = scarcity * demand;
    if (combined >= 1.15 || buyPressurePct >= 62.0) {
        return "High Demand · Scarce Supply (Bullish ↑)";
    }
    if (combined <= 0.88 || buyPressurePct <= 38.0) {
        return "High Supply · Low Demand (Bearish ↓)";
    }
    if (combined > 1.01) {
        return "Rising Demand (Upward ↑)";
    }
    if (combined < 0.99) {
        return "Expanding Supply (Downward ↓)";
    }
    return "Supply-Demand Equilibrium";
}

} // namespace

SpotEvaluation CSupplyDemandEngine::EvaluateSpot(const MarketStateInput& state) {
    const double safeInrRes = std::max(MIN_RESERVE, state.inrReserve);
    const double safeXyphRes = std::max(MIN_RESERVE, state.xyphReserve);
    const double safeCirc = std::max(1.0, state.circulatingSupplyXyph);
    const double safeBase = std::max(1.0, state.supplyBaselineXyph);
    const double safeBought = std::max(0.0, state.totalBoughtXyph);
    const double safeSold = std::max(0.0, state.totalSoldXyph);
    const double safeInrPerUsd = std::max(1.0, state.inrPerUsd);

    // 1. Constant-product AMM base spot price (x * y = k)
    const double ammSpotInr = safeInrRes / safeXyphRes;

    // 2. Circulating Supply Scarcity Factor:
    //    Low circulating supply relative to baseline -> multiplier > 1.0 (price UP)
    //    High circulating supply relative to baseline -> multiplier < 1.0 (price DOWN)
    const double supplyRatio = safeBase / safeCirc;
    const double scarcityMultiplier = std::clamp(std::pow(supplyRatio, 0.35), 0.25, 4.0);

    // 3. Net Buy Demand vs. Sell Pressure Factor:
    //    More people buying than selling -> demandMultiplier > 1.0 (price UP)
    //    More people selling than buying -> demandMultiplier < 1.0 (price DOWN)
    const double netDemandXyph = safeBought - safeSold;
    const double marketDepthXyph = std::max(1000.0, safeXyphRes + safeCirc * 0.25);
    const double demandExponent = std::clamp((netDemandXyph / marketDepthXyph) * 0.65, -1.5, 2.0);
    const double demandMultiplier = std::exp(demandExponent);

    const double supplyDemandIndex = scarcityMultiplier * demandMultiplier;
    const double spotPriceInr = std::max(MIN_SPOT_INR, ammSpotInr * supplyDemandIndex);
    const double spotPriceUsd = spotPriceInr / safeInrPerUsd;

    const double totalFlow = safeBought + safeSold;
    const double buyPressurePercent = totalFlow > 0.0 ? (safeBought / totalFlow) * 100.0 : 50.0;

    SpotEvaluation out;
    out.ammSpotInr = RoundTo(ammSpotInr, 6);
    out.scarcityMultiplier = RoundTo(scarcityMultiplier, 4);
    out.demandMultiplier = RoundTo(demandMultiplier, 4);
    out.supplyDemandIndex = RoundTo(supplyDemandIndex, 4);
    out.spotPriceInr = RoundTo(spotPriceInr, 6);
    out.spotPriceUsd = RoundTo(spotPriceUsd, 6);
    out.buyPressurePercent = RoundTo(buyPressurePercent, 1);
    out.marketCapInr = RoundTo(safeCirc * spotPriceInr, 2);
    out.marketCapUsd = RoundTo(safeCirc * spotPriceUsd, 2);
    out.marketRegime = ClassifyRegime(scarcityMultiplier, demandMultiplier, buyPressurePercent);
    return out;
}

TradeQuoteResult CSupplyDemandEngine::QuoteBuy(const MarketStateInput& state, double inrIn) {
    const double safeIn = std::max(0.0, inrIn);
    const double safeInrRes = std::max(MIN_RESERVE, state.inrReserve);
    const double safeXyphRes = std::max(MIN_RESERVE, state.xyphReserve);

    const SpotEvaluation before = EvaluateSpot(state);

    // Constant-product liquidity pool: x * y = k
    const double k = safeInrRes * safeXyphRes;
    const double newInrReserve = safeInrRes + safeIn;
    const double rawNewXyphReserve = std::max(MIN_RESERVE, k / newInrReserve);
    const double rawXyphOut = std::max(0.0, safeXyphRes - rawNewXyphReserve);

    // Adjust output inversely with scarcity/demand multiplier so users pay the real supply-demand price
    const double effectiveMultiplier = std::max(0.1, before.supplyDemandIndex);
    const double xyphOut = std::max(0.0, rawXyphOut / effectiveMultiplier);
    const double finalXyphReserve = std::max(MIN_RESERVE, safeXyphRes - std::min(xyphOut, safeXyphRes - MIN_RESERVE));

    MarketStateInput afterState = state;
    afterState.inrReserve = newInrReserve;
    afterState.xyphReserve = finalXyphReserve;
    afterState.totalBoughtXyph = std::max(0.0, state.totalBoughtXyph) + xyphOut;

    const SpotEvaluation after = EvaluateSpot(afterState);
    const double execPrice = xyphOut > 0.0 ? safeIn / xyphOut : before.spotPriceInr;
    const double impactPct =
        before.spotPriceInr > 0.0
            ? ((after.spotPriceInr - before.spotPriceInr) / before.spotPriceInr) * 100.0
            : 0.0;

    TradeQuoteResult res;
    res.side = "buy";
    res.inputAmount = RoundTo(safeIn, 2);
    res.outputAmount = RoundTo(xyphOut, 4);
    res.spotBeforeInr = before.spotPriceInr;
    res.spotAfterInr = after.spotPriceInr;
    res.spotAfterUsd = after.spotPriceUsd;
    res.executionPriceInr = RoundTo(execPrice, 6);
    res.priceImpactPercent = RoundTo(impactPct, 2);
    res.newInrReserve = RoundTo(newInrReserve, 4);
    res.newXyphReserve = RoundTo(finalXyphReserve, 4);
    res.newTotalBoughtXyph = RoundTo(afterState.totalBoughtXyph, 4);
    res.newTotalSoldXyph = RoundTo(afterState.totalSoldXyph, 4);
    res.scarcityMultiplier = after.scarcityMultiplier;
    res.demandMultiplier = after.demandMultiplier;
    res.marketRegime = after.marketRegime;
    return res;
}

TradeQuoteResult CSupplyDemandEngine::QuoteSell(const MarketStateInput& state, double xyphIn) {
    const double safeIn = std::max(0.0, xyphIn);
    const double safeInrRes = std::max(MIN_RESERVE, state.inrReserve);
    const double safeXyphRes = std::max(MIN_RESERVE, state.xyphReserve);

    const SpotEvaluation before = EvaluateSpot(state);

    // Constant-product liquidity pool: x * y = k
    const double k = safeInrRes * safeXyphRes;
    const double newXyphReserve = safeXyphRes + safeIn;
    const double rawNewInrReserve = std::max(MIN_RESERVE, k / newXyphReserve);
    const double rawInrOut = std::max(0.0, safeInrRes - rawNewInrReserve);

    // Scale payout by current supply-demand index (capped at pool INR liquidity)
    const double desiredInrOut = rawInrOut * std::max(0.1, before.supplyDemandIndex);
    const double inrOut = std::min(desiredInrOut, std::max(0.0, safeInrRes - MIN_RESERVE));
    const double finalInrReserve = std::max(MIN_RESERVE, safeInrRes - inrOut);

    MarketStateInput afterState = state;
    afterState.inrReserve = finalInrReserve;
    afterState.xyphReserve = newXyphReserve;
    afterState.totalSoldXyph = std::max(0.0, state.totalSoldXyph) + safeIn;

    const SpotEvaluation after = EvaluateSpot(afterState);
    const double execPrice = safeIn > 0.0 ? inrOut / safeIn : before.spotPriceInr;
    const double impactPct =
        before.spotPriceInr > 0.0
            ? ((after.spotPriceInr - before.spotPriceInr) / before.spotPriceInr) * 100.0
            : 0.0;

    TradeQuoteResult res;
    res.side = "sell";
    res.inputAmount = RoundTo(safeIn, 4);
    res.outputAmount = RoundTo(inrOut, 2);
    res.spotBeforeInr = before.spotPriceInr;
    res.spotAfterInr = after.spotPriceInr;
    res.spotAfterUsd = after.spotPriceUsd;
    res.executionPriceInr = RoundTo(execPrice, 6);
    res.priceImpactPercent = RoundTo(impactPct, 2);
    res.newInrReserve = RoundTo(finalInrReserve, 4);
    res.newXyphReserve = RoundTo(newXyphReserve, 4);
    res.newTotalBoughtXyph = RoundTo(afterState.totalBoughtXyph, 4);
    res.newTotalSoldXyph = RoundTo(afterState.totalSoldXyph, 4);
    res.scarcityMultiplier = after.scarcityMultiplier;
    res.demandMultiplier = after.demandMultiplier;
    res.marketRegime = after.marketRegime;
    return res;
}

} // namespace xypher::market
