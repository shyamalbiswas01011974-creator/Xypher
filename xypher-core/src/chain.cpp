// Copyright (c) 2025-2026 Xypher Core Developers
// Modeled after Bitcoin Core src/chain.cpp — 64-Char Hash Chain Linking & Verification

#include "chain.h"

#include "crypto/sha256.h"

namespace xypher::chain {

bool IsValidHexHash64(const std::string& hex) {
    if (hex.size() != HASH_HEX_LENGTH) return false;
    for (char c : hex) {
        const bool isDigit = (c >= '0' && c <= '9');
        const bool isLowerHex = (c >= 'a' && c <= 'f');
        const bool isUpperHex = (c >= 'A' && c <= 'F');
        if (!isDigit && !isLowerHex && !isUpperHex) {
            return false;
        }
    }
    return true;
}

CChain::CChain(consensus::Params params) : params_(std::move(params)) {}

const primitives::CBlock& CChain::InitGenesis(
    const std::string& genesisMinerAddress,
    uint64_t genesisTime,
    const std::string& targetHex
) {
    blocks_.clear();
    utxo_ = validation::CCoinsViewCache{};

    primitives::CBlock genesis;
    genesis.nVersion = 2;
    genesis.nHeight = 0;
    genesis.hashPrevBlock = GENESIS_PREV_HASH; // 64 zeros
    genesis.nTime = genesisTime;
    genesis.targetHex = targetHex;
    genesis.nNonce = 0;

    primitives::CTransaction coinbase;
    coinbase.vin.push_back(primitives::CTxIn{
        primitives::COutPoint{GENESIS_PREV_HASH, 0xffffffffu},
        "genesis:0:xypher-core-chain",
        "",
        0xffffffffu
    });
    coinbase.vout.push_back(primitives::CTxOut{
        consensus::GetBlockSubsidy(0, params_),
        genesisMinerAddress
    });

    genesis.vtx.push_back(std::move(coinbase));
    genesis.hashMerkleRoot = crypto::HexStr(genesis.ComputeMerkleRoot());

    while (!primitives::CheckProofOfWork(genesis.GetHash(), genesis.targetHex)) {
        genesis.nNonce++;
    }

    validation::ValidationState state;
    validation::ConnectBlock(genesis, utxo_, params_, state);
    blocks_.push_back(std::move(genesis));
    return blocks_.back();
}

bool CChain::MineAndConnectNextBlock(
    const std::string& minerAddress,
    uint64_t blockTime,
    const std::string& targetHex,
    validation::ValidationState& state
) {
    if (blocks_.empty()) {
        return state.Invalid("chain-missing-genesis");
    }

    const primitives::CBlock& prev = blocks_.back();
    const std::string prevHashHex = prev.GetHashHex();
    if (!IsValidHexHash64(prevHashHex)) {
        return state.Invalid("bad-prev-hash-64");
    }

    primitives::CBlock blk;
    blk.nVersion = 2;
    blk.nHeight = prev.nHeight + 1;
    blk.hashPrevBlock = prevHashHex; // Exact 64-character hash of previous block
    blk.nTime = blockTime;
    blk.targetHex = targetHex;
    blk.nNonce = 0;

    primitives::CTransaction coinbase;
    coinbase.vin.push_back(primitives::CTxIn{
        primitives::COutPoint{GENESIS_PREV_HASH, 0xffffffffu},
        "coinbase:" + std::to_string(blk.nHeight),
        "",
        0xffffffffu
    });
    coinbase.vout.push_back(primitives::CTxOut{
        consensus::GetBlockSubsidy(blk.nHeight, params_),
        minerAddress
    });

    blk.vtx.push_back(std::move(coinbase));
    blk.hashMerkleRoot = crypto::HexStr(blk.ComputeMerkleRoot());

    while (!primitives::CheckProofOfWork(blk.GetHash(), blk.targetHex)) {
        blk.nNonce++;
    }

    if (!validation::ConnectBlock(blk, utxo_, params_, state)) {
        return false;
    }

    blocks_.push_back(std::move(blk));
    return true;
}

bool CChain::SimulateTamperAtHeight(int64_t height, const std::string& tamperedNote) {
    if (height < 0 || static_cast<size_t>(height) >= blocks_.size()) {
        return false;
    }
    auto& blk = blocks_[static_cast<size_t>(height)];
    if (!blk.vtx.empty() && !blk.vtx[0].vin.empty()) {
        blk.vtx[0].vin[0].scriptSig = tamperedNote;
        blk.hashMerkleRoot = crypto::HexStr(blk.ComputeMerkleRoot());
        return true;
    }
    return false;
}

ChainVerificationReport CChain::VerifyChain() const {
    ChainVerificationReport report;
    report.blockCount = static_cast<int64_t>(blocks_.size());

    std::string prevComputedHash = GENESIS_PREV_HASH;

    for (size_t i = 0; i < blocks_.size(); ++i) {
        const auto& blk = blocks_[i];
        BlockLinkAudit audit;
        audit.height = blk.nHeight;
        audit.hash = blk.GetHashHex();
        audit.hashLength = audit.hash.size();
        audit.prevHash = blk.hashPrevBlock;
        audit.prevHashLength = audit.prevHash.size();
        audit.expectedPrevHash = (i == 0) ? std::string(GENESIS_PREV_HASH) : prevComputedHash;
        audit.merkleRoot = blk.hashMerkleRoot;
        audit.timestamp = blk.nTime;
        audit.nonce = blk.nNonce;
        audit.txCount = blk.vtx.size();
        audit.isGenesis = (i == 0 && blk.nHeight == 0);
        audit.genesisPrevAllZeros = audit.isGenesis && (audit.prevHash == GENESIS_PREV_HASH);
        audit.hashValid64 = IsValidHexHash64(audit.hash);
        audit.prevHashValid64 = IsValidHexHash64(audit.prevHash);
        audit.linkValid = audit.prevHashValid64 && (audit.prevHash == audit.expectedPrevHash);
        audit.merkleValid = (crypto::HexStr(blk.ComputeMerkleRoot()) == blk.hashMerkleRoot);
        audit.powValid = primitives::CheckProofOfWork(blk.GetHash(), blk.targetHex);

        if (!audit.hashValid64) {
            audit.error = "Block hash is not a valid 64-character hex SHA-256d digest";
        } else if (audit.isGenesis && !audit.genesisPrevAllZeros) {
            audit.error = "Genesis block (#0) previous hash must be exactly 64 zeros";
        } else if (!audit.linkValid) {
            audit.error = "Chain link broken: previousHash does not match Block #" +
                          std::to_string(blk.nHeight - 1) + " 64-char hash";
        } else if (!audit.merkleValid) {
            audit.error = "Merkle root mismatch inside block transactions";
        } else if (!audit.powValid) {
            audit.error = "Proof-of-Work hash exceeds target after block data modification";
        }

        audit.blockValid = audit.hashValid64 && audit.prevHashValid64 && audit.linkValid &&
                           audit.merkleValid && audit.powValid &&
                           (!audit.isGenesis || audit.genesisPrevAllZeros);

        if (audit.blockValid) {
            report.validLinks++;
        } else {
            report.valid = false;
            report.brokenLinks++;
            if (report.firstBrokenHeight < 0) {
                report.firstBrokenHeight = audit.height;
            }
        }

        prevComputedHash = audit.hash;
        report.blocks.push_back(std::move(audit));
    }

    return report;
}

ChainVerificationReport VerifyExternalBlockLinks(
    const std::vector<ExternalBlockLinkInput>& inputBlocks
) {
    ChainVerificationReport report;
    report.blockCount = static_cast<int64_t>(inputBlocks.size());

    std::string expectedPrev = GENESIS_PREV_HASH;

    for (size_t i = 0; i < inputBlocks.size(); ++i) {
        const auto& b = inputBlocks[i];
        BlockLinkAudit audit;
        audit.height = b.height;
        audit.hash = b.hash;
        audit.hashLength = b.hash.size();
        audit.prevHash = b.prevHash;
        audit.prevHashLength = b.prevHash.size();
        audit.expectedPrevHash = (b.height == 0) ? std::string(GENESIS_PREV_HASH) : expectedPrev;
        audit.merkleRoot = b.merkleRoot;
        audit.timestamp = b.timestamp;
        audit.nonce = b.nonce;
        audit.txCount = b.txCount;
        audit.isGenesis = (b.height == 0);
        audit.genesisPrevAllZeros = audit.isGenesis && (b.prevHash == GENESIS_PREV_HASH);
        audit.hashValid64 = IsValidHexHash64(b.hash);
        audit.prevHashValid64 = IsValidHexHash64(b.prevHash);
        audit.merkleValid = b.merkleRoot.empty() || IsValidHexHash64(b.merkleRoot);
        audit.powValid = true; // Verified on full node connect

        if (b.height == 0) {
            audit.linkValid = audit.genesisPrevAllZeros;
        } else if (i > 0 && inputBlocks[i - 1].height == b.height - 1) {
            audit.linkValid = audit.prevHashValid64 && (b.prevHash == inputBlocks[i - 1].hash);
        } else {
            // Non-contiguous window boundary (e.g. jump from Genesis to recent tip window)
            audit.expectedPrevHash = b.prevHash;
            audit.linkValid = audit.prevHashValid64 && (b.prevHash != GENESIS_PREV_HASH);
        }

        if (!audit.hashValid64) {
            audit.error = "Block hash must be exactly 64 hex characters";
        } else if (audit.isGenesis && !audit.genesisPrevAllZeros) {
            audit.error = "Genesis block (#0) previousHash must be 64 zeros";
        } else if (!audit.linkValid) {
            audit.error = "Previous hash does not match parent block 64-char hash";
        }

        audit.blockValid = audit.hashValid64 && audit.prevHashValid64 && audit.linkValid &&
                           (!audit.isGenesis || audit.genesisPrevAllZeros);

        if (audit.blockValid) {
            report.validLinks++;
        } else {
            report.valid = false;
            report.brokenLinks++;
            if (report.firstBrokenHeight < 0) {
                report.firstBrokenHeight = audit.height;
            }
        }

        expectedPrev = b.hash;
        report.blocks.push_back(std::move(audit));
    }

    return report;
}

} // namespace xypher::chain
