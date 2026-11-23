// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/primitives/block.h & src/consensus/merkle.cpp

#ifndef XYPHER_PRIMITIVES_BLOCK_H
#define XYPHER_PRIMITIVES_BLOCK_H

#include "crypto/sha256.h"
#include "primitives/transaction.h"

#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

namespace xypher::primitives {

struct CBlockHeader {
    int32_t nVersion = 2;
    int64_t nHeight = 0;
    std::string hashPrevBlock;
    std::string hashMerkleRoot;
    uint64_t nTime = 0;
    std::string targetHex;
    uint64_t nNonce = 0;

    crypto::Hash256 GetHash() const {
        std::ostringstream ss;
        ss << nVersion << "|" << nHeight << "|" << hashPrevBlock << "|"
           << hashMerkleRoot << "|" << nTime << "|" << targetHex << "|" << nNonce;
        return crypto::Hash256d(ss.str());
    }

    std::string GetHashHex() const {
        return crypto::HexStr(GetHash());
    }
};

struct CBlock : public CBlockHeader {
    std::vector<CTransaction> vtx;

    crypto::Hash256 ComputeMerkleRoot() const {
        if (vtx.empty()) {
            return crypto::Hash256{};
        }
        std::vector<crypto::Hash256> layer;
        layer.reserve(vtx.size());
        for (const auto& tx : vtx) {
            layer.push_back(tx.GetHash());
        }
        while (layer.size() > 1) {
            if (layer.size() % 2 != 0) {
                layer.push_back(layer.back());
            }
            std::vector<crypto::Hash256> next;
            next.reserve(layer.size() / 2);
            for (size_t i = 0; i < layer.size(); i += 2) {
                next.push_back(crypto::Hash256d(layer[i], layer[i + 1]));
            }
            layer = std::move(next);
        }
        return layer[0];
    }
};

/** Lexicographic big-endian Proof-of-Work verification: blockHash <= target */
inline bool CheckProofOfWork(const crypto::Hash256& blockHash, const std::string& targetHex) {
    crypto::Hash256 target{};
    if (!crypto::ParseHash256(targetHex, target)) {
        return false;
    }
    for (size_t i = 0; i < 32; ++i) {
        if (blockHash[i] < target[i]) return true;
        if (blockHash[i] > target[i]) return false;
    }
    return true;
}

} // namespace xypher::primitives

#endif // XYPHER_PRIMITIVES_BLOCK_H
