// Copyright (c) 2025-2026 Xypher Core Developers
// Distributed under the MIT software license.
// Modeled after Bitcoin Core src/consensus/consensus.h & src/consensus/params.h

#ifndef XYPHER_CONSENSUS_PARAMS_H
#define XYPHER_CONSENSUS_PARAMS_H

#include <cstdint>
#include <string>

namespace xypher::consensus {

/** Base unit conversion: 1 XYPH = 100,000,000 base units (8 decimals, matching satoshis) */
static constexpr int64_t COIN = 100'000'000LL;

/** Network identification */
static constexpr const char* NETWORK_NAME = "XYPH Network";
static constexpr const char* COIN_SYMBOL = "XYPH";
static constexpr uint64_t EVM_CHAIN_ID = 5790032ULL; // 0x585950 ("XYP")

/** Block & Mining Consensus Rules */
static constexpr uint64_t MAX_BLOCKS = 24'000'000ULL;
static constexpr int64_t TARGET_BLOCK_TIME_SECONDS = 600LL; // 10 minutes per block
static constexpr int64_t HALVING_YEARS = 10LL;
static constexpr int64_t HALVING_INTERVAL_BLOCKS = 525'600LL; // 10y * 365d * 24h * 6 blocks/h
static constexpr int64_t INITIAL_BLOCK_SUBSIDY = 10LL * COIN; // 10 XYPH per mined block
static constexpr int64_t MAX_MONEY = HALVING_INTERVAL_BLOCKS * INITIAL_BLOCK_SUBSIDY * 2LL; // 10,512,000 XYPH
static constexpr int64_t MIN_NETWORK_FEE = 0LL; // Zero network fee (0 XYPH)
static constexpr uint32_t MAX_BLOCK_SERIALIZED_SIZE = 1'000'000U;
static constexpr int32_t COINBASE_MATURITY = 1;

/** Address / Key encoding versions */
static constexpr uint8_t PUBKEY_ADDRESS_PREFIX = 0x58; // 'X' Base58Check
static constexpr uint8_t SECRET_KEY_PREFIX = 0xA8;     // WIF

struct Params {
    std::string networkName = NETWORK_NAME;
    uint64_t chainId = EVM_CHAIN_ID;
    int64_t nPowTargetSpacing = TARGET_BLOCK_TIME_SECONDS;
    int64_t nSubsidyHalvingInterval = HALVING_INTERVAL_BLOCKS;
    int64_t nInitialSubsidy = INITIAL_BLOCK_SUBSIDY;
    int64_t nMinRelayTxFee = MIN_NETWORK_FEE;
    int64_t nMaxMoney = MAX_MONEY;
    uint64_t nMaxBlocks = MAX_BLOCKS;
    int32_t nCoinbaseMaturity = COINBASE_MATURITY;
};

/** Exact Bitcoin-Core-style geometric halving schedule (every 525,600 blocks / 10 years) */
inline int64_t GetBlockSubsidy(int64_t nHeight, const Params& params = Params{}) {
    if (nHeight <= 0 || static_cast<uint64_t>(nHeight) > params.nMaxBlocks) {
        return 0;
    }
    const int64_t halvings = (nHeight - 1) / params.nSubsidyHalvingInterval;
    if (halvings >= 64) {
        return 0;
    }
    return params.nInitialSubsidy >> halvings;
}

inline bool MoneyRange(int64_t nValue) {
    return (nValue >= 0 && nValue <= MAX_MONEY);
}

} // namespace xypher::consensus

#endif // XYPHER_CONSENSUS_PARAMS_H
