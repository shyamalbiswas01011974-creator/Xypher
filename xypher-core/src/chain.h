// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/chain.h — Cryptographic 64-Char Hash Chain Linking

#ifndef XYPHER_CHAIN_H
#define XYPHER_CHAIN_H

#include "consensus/params.h"
#include "primitives/block.h"
#include "validation.h"

#include <cstdint>
#include <string>
#include <vector>

namespace xypher::chain {

/** Genesis Block (#0) previous hash: exactly 64 hexadecimal zero characters */
inline constexpr const char* GENESIS_PREV_HASH =
    "0000000000000000000000000000000000000000000000000000000000000000";

inline constexpr size_t HASH_HEX_LENGTH = 64;

/** Verify a string is exactly 64 hexadecimal characters (256-bit SHA-256d digest) */
bool IsValidHexHash64(const std::string& hex);

/** Per-block link audit result */
struct BlockLinkAudit {
    int64_t height = 0;
    std::string hash;
    size_t hashLength = 0;
    std::string prevHash;
    size_t prevHashLength = 0;
    std::string expectedPrevHash;
    std::string merkleRoot;
    uint64_t timestamp = 0;
    uint64_t nonce = 0;
    size_t txCount = 0;
    bool isGenesis = false;
    bool genesisPrevAllZeros = false;
    bool hashValid64 = false;
    bool prevHashValid64 = false;
    bool linkValid = false;
    bool merkleValid = false;
    bool powValid = false;
    bool blockValid = false;
    std::string error;
};

struct ChainVerificationReport {
    bool valid = true;
    int64_t blockCount = 0;
    int64_t validLinks = 0;
    int64_t brokenLinks = 0;
    int64_t firstBrokenHeight = -1;
    std::string genesisPrevHash = GENESIS_PREV_HASH;
    std::vector<BlockLinkAudit> blocks;
};

/** Lightweight summary input for verifying an external live ledger chain in C++17 */
struct ExternalBlockLinkInput {
    int64_t height = 0;
    std::string hash;
    std::string prevHash;
    std::string merkleRoot;
    uint64_t timestamp = 0;
    uint64_t nonce = 0;
    size_t txCount = 0;
};

/**
 * Bitcoin-Core-style active blockchain container.
 * Enforces:
 *   1. Block #0 (Genesis) MUST have hashPrevBlock == 64 zeros (GENESIS_PREV_HASH).
 *   2. Every block hash and previous hash MUST be exactly 64 hex characters (SHA-256d).
 *   3. Every block #N (N > 0) MUST connect to Block #(N-1) via hashPrevBlock == blocks[N-1].GetHashHex().
 */
class CChain {
public:
    explicit CChain(consensus::Params params = consensus::Params{});

    /** Mine & connect Genesis Block #0 with 64-zero hashPrevBlock */
    const primitives::CBlock& InitGenesis(
        const std::string& genesisMinerAddress,
        uint64_t genesisTime = 1760000000ULL,
        const std::string& targetHex = "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
    );

    /** Mine & append the next block whose hashPrevBlock equals Tip().GetHashHex() */
    bool MineAndConnectNextBlock(
        const std::string& minerAddress,
        uint64_t blockTime,
        const std::string& targetHex,
        validation::ValidationState& state
    );

    /** Full cryptographic audit of all blocks, 64-char hashes, Genesis 64-zero prevHash, and chain links */
    ChainVerificationReport VerifyChain() const;

    /** Mutate block payload at a given height (for tamper-detection proof) without re-mining successors */
    bool SimulateTamperAtHeight(int64_t height, const std::string& tamperedNote);

    const std::vector<primitives::CBlock>& Blocks() const { return blocks_; }
    const validation::CCoinsViewCache& UtxoView() const { return utxo_; }

private:
    consensus::Params params_;
    std::vector<primitives::CBlock> blocks_;
    validation::CCoinsViewCache utxo_;
};

/** Verify an externally supplied sequence of blocks (e.g. live XYPH Network ledger) in C++17 */
ChainVerificationReport VerifyExternalBlockLinks(
    const std::vector<ExternalBlockLinkInput>& inputBlocks
);

} // namespace xypher::chain

#endif // XYPHER_CHAIN_H
