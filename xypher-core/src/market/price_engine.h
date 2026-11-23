// Copyright (c) 2025-2026 Xypher Core Developers
// Real Supply & Demand Price Discovery Engine (Constant-Product AMM + Scarcity + Demand Pressure)

#ifndef XYPHER_MARKET_PRICE_ENGINE_H
#define XYPHER_MARKET_PRICE_ENGINE_H

#include <cstdint>
#include <string>

namespace xypher::market {

struct MarketStateInput {
    double inrReserve = 2500.0;
    double xyphReserve = 250000.0;
    double circulatingSupplyXyph = 20.0;
    double supplyBaselineXyph = 20.0;
    double totalBoughtXyph = 0.0;
    double totalSoldXyph = 0.0;
    double inrPerUsd = 84.0;
};

struct SpotEvaluation {
    double ammSpotInr = 0.01;
    double scarcityMultiplier = 1.0;
    double demandMultiplier = 1.0;
    double supplyDemandIndex = 1.0;
    double spotPriceInr = 0.01;
    double spotPriceUsd = 0.000119;
    double buyPressurePercent = 50.0;
    double marketCapInr = 0.0;
    double marketCapUsd = 0.0;
    std::string marketRegime = "Balanced Equilibrium";
};

struct TradeQuoteResult {
    std::string side; // "buy" or "sell"
    double inputAmount = 0.0;
    double outputAmount = 0.0;
    double spotBeforeInr = 0.01;
    double spotAfterInr = 0.01;
    double spotAfterUsd = 0.000119;
    double executionPriceInr = 0.01;
    double priceImpactPercent = 0.0;
    double newInrReserve = 2500.0;
    double newXyphReserve = 250000.0;
    double newTotalBoughtXyph = 0.0;
    double newTotalSoldXyph = 0.0;
    double scarcityMultiplier = 1.0;
    double demandMultiplier = 1.0;
    std::string marketRegime = "Balanced Equilibrium";
};

class CSupplyDemandEngine {
public:
    static constexpr double MIN_SPOT_INR = 0.0001;
    static constexpr double MIN_RESERVE = 1.0;

    /** Evaluates current live XYPH value from Buy Demand, Sell Pressure & Circulating Supply */
    static SpotEvaluation EvaluateSpot(const MarketStateInput& state);

    /** Quotes a BUY order (INR demand in -> XYPH out; increases demand & reduces pool supply -> price UP) */
    static TradeQuoteResult QuoteBuy(const MarketStateInput& state, double inrIn);

    /** Quotes a SELL order (XYPH supply in -> INR out; increases sell supply & drains demand -> price DOWN) */
    static TradeQuoteResult QuoteSell(const MarketStateInput& state, double xyphIn);
};

} // namespace xypher::market

#endif // XYPHER_MARKET_PRICE_ENGINE_H
