// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/validation.cpp

#include "validation.h"

#include <unordered_set>

namespace xypher::validation {

bool CCoinsViewCache::HaveCoin(const primitives::COutPoint& outpoint) const {
    return cache_.find(outpoint.Key()) != cache_.end();
}

const Coin* CCoinsViewCache::AccessCoin(const primitives::COutPoint& outpoint) const {
    auto it = cache_.find(outpoint.Key());
    if (it == cache_.end()) return nullptr;
    return &it->second;
}

void CCoinsViewCache::AddCoin(const primitives::COutPoint& outpoint, Coin coin) {
    cache_[outpoint.Key()] = std::move(coin);
}

bool CCoinsViewCache::SpendCoin(const primitives::COutPoint& outpoint) {
    return cache_.erase(outpoint.Key()) > 0;
}

int64_t CCoinsViewCache::GetBalance(const std::string& address) const {
    int64_t sum = 0;
    for (const auto& kv : cache_) {
        if (kv.second.out.address == address) {
            sum += kv.second.out.nValue;
        }
    }
    return sum;
}

int64_t CCoinsViewCache::GetTotalSupply() const {
    int64_t sum = 0;
    for (const auto& kv : cache_) {
        sum += kv.second.out.nValue;
    }
    return sum;
}

bool CheckTransaction(const primitives::CTransaction& tx, ValidationState& state) {
    if (tx.vin.empty()) return state.Invalid("bad-txns-vin-empty");
    if (tx.vout.empty()) return state.Invalid("bad-txns-vout-empty");

    int64_t valueOut = 0;
    for (const auto& out : tx.vout) {
        if (out.nValue < 0) return state.Invalid("bad-txns-vout-negative");
        if (!consensus::MoneyRange(out.nValue)) return state.Invalid("bad-txns-vout-toolarge");
        valueOut += out.nValue;
        if (!consensus::MoneyRange(valueOut)) return state.Invalid("bad-txns-txouttotal-toolarge");
        if (out.address.empty()) return state.Invalid("bad-txns-empty-address");
    }

    std::unordered_set<std::string> seenInputs;
    for (const auto& in : tx.vin) {
        if (!tx.IsCoinBase()) {
            const std::string k = in.prevout.Key();
            if (!seenInputs.insert(k).second) {
                return state.Invalid("bad-txns-inputs-duplicate");
            }
        }
    }
    return true;
}

bool CheckTxInputs(
    const primitives::CTransaction& tx,
    const CCoinsViewCache& view,
    int64_t nSpendHeight,
    int64_t& txfee,
    const consensus::Params& params,
    ValidationState& state
) {
    if (tx.IsCoinBase()) {
        txfee = 0;
        return true;
    }

    int64_t valueIn = 0;
    for (const auto& in : tx.vin) {
        const Coin* coin = view.AccessCoin(in.prevout);
        if (!coin) {
            return state.Invalid("bad-txns-inputs-missingorspent");
        }
        if (coin->fCoinBase && (nSpendHeight - coin->nHeight) < params.nCoinbaseMaturity) {
            return state.Invalid("bad-txns-premature-spend-of-coinbase");
        }
        valueIn += coin->out.nValue;
        if (!consensus::MoneyRange(valueIn)) {
            return state.Invalid("bad-txns-inputvalues-outofrange");
        }
    }

    const int64_t valueOut = tx.GetValueOut();
    if (valueIn < valueOut) {
        return state.Invalid("bad-txns-in-belowout");
    }

    txfee = valueIn - valueOut;
    if (txfee < params.nMinRelayTxFee) {
        return state.Invalid("bad-txns-fee-below-min");
    }
    return true;
}

bool ConnectBlock(
    const primitives::CBlock& block,
    CCoinsViewCache& view,
    const consensus::Params& params,
    ValidationState& state
) {
    if (block.vtx.empty()) return state.Invalid("bad-blk-empty");
    if (!block.vtx[0].IsCoinBase()) return state.Invalid("bad-cb-missing");

    if (crypto::HexStr(block.ComputeMerkleRoot()) != block.hashMerkleRoot) {
        return state.Invalid("bad-txnmrklroot");
    }

    if (!primitives::CheckProofOfWork(block.GetHash(), block.targetHex)) {
        return state.Invalid("high-hash-pow-invalid");
    }

    int64_t totalFees = 0;
    for (size_t i = 0; i < block.vtx.size(); ++i) {
        const auto& tx = block.vtx[i];
        if (i > 0 && tx.IsCoinBase()) return state.Invalid("bad-cb-multiple");
        if (!CheckTransaction(tx, state)) return false;

        int64_t fee = 0;
        if (i > 0) {
            if (!CheckTxInputs(tx, view, block.nHeight, fee, params, state)) return false;
            totalFees += fee;
            for (const auto& in : tx.vin) {
                view.SpendCoin(in.prevout);
            }
        }
    }

    const int64_t maxReward = consensus::GetBlockSubsidy(block.nHeight, params) + totalFees;
    if (block.nHeight > 0 && block.vtx[0].GetValueOut() > maxReward) {
        return state.Invalid("bad-cb-amount");
    }

    for (const auto& tx : block.vtx) {
        const std::string txid = tx.GetTxId();
        for (uint32_t outIdx = 0; outIdx < tx.vout.size(); ++outIdx) {
            view.AddCoin(
                primitives::COutPoint{txid, outIdx},
                Coin{tx.vout[outIdx], block.nHeight, tx.IsCoinBase()}
            );
        }
    }
    return true;
}

} // namespace xypher::validation
