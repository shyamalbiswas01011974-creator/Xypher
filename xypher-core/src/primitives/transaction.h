// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/primitives/transaction.h

#ifndef XYPHER_PRIMITIVES_TRANSACTION_H
#define XYPHER_PRIMITIVES_TRANSACTION_H

#include "crypto/sha256.h"

#include <cstdint>
#include <sstream>
#include <string>
#include <vector>

namespace xypher::primitives {

struct COutPoint {
    std::string hash;
    uint32_t n = 0;

    bool IsNull() const {
        return hash.empty() || hash == std::string(64, '0');
    }

    bool operator==(const COutPoint& other) const {
        return hash == other.hash && n == other.n;
    }

    std::string Key() const {
        return hash + ":" + std::to_string(n);
    }
};

struct CTxIn {
    COutPoint prevout;
    std::string scriptSig;
    std::string pubKeyHex;
    uint32_t nSequence = 0xffffffffu;
};

struct CTxOut {
    int64_t nValue = 0;
    std::string address;
};

class CTransaction {
public:
    int32_t nVersion = 2;
    std::vector<CTxIn> vin;
    std::vector<CTxOut> vout;
    uint32_t nLockTime = 0;

    bool IsCoinBase() const {
        return vin.size() == 1 && vin[0].prevout.IsNull();
    }

    int64_t GetValueOut() const {
        int64_t total = 0;
        for (const auto& out : vout) {
            total += out.nValue;
        }
        return total;
    }

    crypto::Hash256 GetHash() const {
        std::ostringstream ss;
        ss << "tx:v" << nVersion << "|in:" << vin.size() << "|";
        for (const auto& in : vin) {
            ss << in.prevout.hash << ":" << in.prevout.n << ":" << in.scriptSig << ":" << in.pubKeyHex << "|";
        }
        ss << "out:" << vout.size() << "|";
        for (const auto& out : vout) {
            ss << out.address << ":" << out.nValue << "|";
        }
        ss << "lock:" << nLockTime;
        return crypto::Hash256d(ss.str());
    }

    std::string GetTxId() const {
        return crypto::HexStr(GetHash());
    }
};

} // namespace xypher::primitives

#endif // XYPHER_PRIMITIVES_TRANSACTION_H
