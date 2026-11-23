// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/validation.h & src/coins.h

#ifndef XYPHER_VALIDATION_H
#define XYPHER_VALIDATION_H

#include "consensus/params.h"
#include "primitives/block.h"
#include "primitives/transaction.h"

#include <cstdint>
#include <string>
#include <unordered_map>

namespace xypher::validation {

struct Coin {
    primitives::CTxOut out;
    int64_t nHeight = 0;
    bool fCoinBase = false;
};

struct ValidationState {
    bool valid = true;
    std::string rejectReason;

    bool Invalid(const std::string& reason) {
        valid = false;
        rejectReason = reason;
        return false;
    }
};

/** In-memory UTXO set (like Bitcoin Core CCoinsViewCache) */
class CCoinsViewCache {
public:
    bool HaveCoin(const primitives::COutPoint& outpoint) const;
    const Coin* AccessCoin(const primitives::COutPoint& outpoint) const;
    void AddCoin(const primitives::COutPoint& outpoint, Coin coin);
    bool SpendCoin(const primitives::COutPoint& outpoint);
    int64_t GetBalance(const std::string& address) const;
    int64_t GetTotalSupply() const;
    size_t Size() const { return cache_.size(); }

private:
    std::unordered_map<std::string, Coin> cache_;
};

bool CheckTransaction(const primitives::CTransaction& tx, ValidationState& state);

bool CheckTxInputs(
    const primitives::CTransaction& tx,
    const CCoinsViewCache& view,
    int64_t nSpendHeight,
    int64_t& txfee,
    const consensus::Params& params,
    ValidationState& state
);

bool ConnectBlock(
    const primitives::CBlock& block,
    CCoinsViewCache& view,
    const consensus::Params& params,
    ValidationState& state
);

} // namespace xypher::validation

#endif // XYPHER_VALIDATION_H
