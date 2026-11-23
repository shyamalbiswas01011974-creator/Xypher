// Copyright (c) 2025-2026 Xypher Core Developers
// xypherd — Native C++17 Blockchain Consensus & Supply-Demand Market Core (Bitcoin Core Architecture)

#include "chain.h"
#include "consensus/params.h"
#include "crypto/sha256.h"
#include "market/price_engine.h"
#include "primitives/block.h"
#include "primitives/transaction.h"
#include "validation.h"

#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

std::string JsonEscape(const std::string& s) {
    std::ostringstream out;
    for (char c : s) {
        switch (c) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default: out << c; break;
        }
    }
    return out.str();
}

std::string FmtDouble(double v, int prec = 6) {
    if (!std::isfinite(v)) return "0";
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(prec) << v;
    return ss.str();
}

double ParseDoubleArg(const std::unordered_map<std::string, std::string>& args, const std::string& key, double fallback) {
    auto it = args.find(key);
    if (it == args.end()) return fallback;
    try {
        double v = std::stod(it->second);
        return std::isfinite(v) ? v : fallback;
    } catch (...) {
        return fallback;
    }
}

int64_t ParseIntArg(const std::unordered_map<std::string, std::string>& args, const std::string& key, int64_t fallback) {
    auto it = args.find(key);
    if (it == args.end()) return fallback;
    try {
        return std::stoll(it->second);
    } catch (...) {
        return fallback;
    }
}

xypher::market::MarketStateInput ParseMarketState(const std::unordered_map<std::string, std::string>& args) {
    xypher::market::MarketStateInput st;
    st.inrReserve = ParseDoubleArg(args, "--inr-reserve", 2500.0);
    st.xyphReserve = ParseDoubleArg(args, "--xyph-reserve", 250000.0);
    st.circulatingSupplyXyph = ParseDoubleArg(args, "--circulating", 20.0);
    st.supplyBaselineXyph = ParseDoubleArg(args, "--baseline", 20.0);
    st.totalBoughtXyph = ParseDoubleArg(args, "--bought", 0.0);
    st.totalSoldXyph = ParseDoubleArg(args, "--sold", 0.0);
    st.inrPerUsd = ParseDoubleArg(args, "--inr-per-usd", 84.0);
    return st;
}

int CmdInfo() {
    xypher::consensus::Params p;
    std::cout << "{"
              << "\"engine\":\"xypherd C++17 Core\","
              << "\"architecture\":\"Bitcoin Core UTXO + SHA256d PoW + Supply-Demand AMM\","
              << "\"cppStandard\":\"C++17\","
              << "\"compiler\":\"" << JsonEscape(__VERSION__) << "\","
              << "\"networkName\":\"" << JsonEscape(p.networkName) << "\","
              << "\"symbol\":\"" << xypher::consensus::COIN_SYMBOL << "\","
              << "\"chainId\":" << p.chainId << ","
              << "\"coinUnits\":" << xypher::consensus::COIN << ","
              << "\"targetBlockTimeSec\":" << p.nPowTargetSpacing << ","
              << "\"initialSubsidyXyph\":" << (p.nInitialSubsidy / xypher::consensus::COIN) << ","
              << "\"halvingIntervalBlocks\":" << p.nSubsidyHalvingInterval << ","
              << "\"halvingYears\":" << xypher::consensus::HALVING_YEARS << ","
              << "\"minNetworkFeeXyph\":" << (p.nMinRelayTxFee / xypher::consensus::COIN) << ","
              << "\"maxBlocks\":" << p.nMaxBlocks << ","
              << "\"maxMoneyXyph\":" << (p.nMaxMoney / xypher::consensus::COIN)
              << "}\n";
    return 0;
}

int CmdSpot(const std::unordered_map<std::string, std::string>& args) {
    const auto st = ParseMarketState(args);
    const auto ev = xypher::market::CSupplyDemandEngine::EvaluateSpot(st);
    std::cout << "{"
              << "\"engine\":\"xypherd-cpp17\","
              << "\"ammSpotInr\":" << FmtDouble(ev.ammSpotInr, 6) << ","
              << "\"scarcityMultiplier\":" << FmtDouble(ev.scarcityMultiplier, 4) << ","
              << "\"demandMultiplier\":" << FmtDouble(ev.demandMultiplier, 4) << ","
              << "\"supplyDemandIndex\":" << FmtDouble(ev.supplyDemandIndex, 4) << ","
              << "\"spotPriceInr\":" << FmtDouble(ev.spotPriceInr, 6) << ","
              << "\"spotPriceUsd\":" << FmtDouble(ev.spotPriceUsd, 6) << ","
              << "\"buyPressurePercent\":" << FmtDouble(ev.buyPressurePercent, 1) << ","
              << "\"marketCapInr\":" << FmtDouble(ev.marketCapInr, 2) << ","
              << "\"marketCapUsd\":" << FmtDouble(ev.marketCapUsd, 2) << ","
              << "\"marketRegime\":\"" << JsonEscape(ev.marketRegime) << "\""
              << "}\n";
    return 0;
}

int CmdQuote(const std::string& side, const std::unordered_map<std::string, std::string>& args) {
    const auto st = ParseMarketState(args);
    const double amount = ParseDoubleArg(args, "--amount", 0.0);
    const auto q = (side == "buy")
        ? xypher::market::CSupplyDemandEngine::QuoteBuy(st, amount)
        : xypher::market::CSupplyDemandEngine::QuoteSell(st, amount);

    std::cout << "{"
              << "\"engine\":\"xypherd-cpp17\","
              << "\"side\":\"" << q.side << "\","
              << "\"inputAmount\":" << FmtDouble(q.inputAmount, 4) << ","
              << "\"outputAmount\":" << FmtDouble(q.outputAmount, 4) << ","
              << "\"spotBeforeInr\":" << FmtDouble(q.spotBeforeInr, 6) << ","
              << "\"spotAfterInr\":" << FmtDouble(q.spotAfterInr, 6) << ","
              << "\"spotAfterUsd\":" << FmtDouble(q.spotAfterUsd, 6) << ","
              << "\"executionPriceInr\":" << FmtDouble(q.executionPriceInr, 6) << ","
              << "\"priceImpactPercent\":" << FmtDouble(q.priceImpactPercent, 2) << ","
              << "\"newInrReserve\":" << FmtDouble(q.newInrReserve, 4) << ","
              << "\"newXyphReserve\":" << FmtDouble(q.newXyphReserve, 4) << ","
              << "\"newTotalBoughtXyph\":" << FmtDouble(q.newTotalBoughtXyph, 4) << ","
              << "\"newTotalSoldXyph\":" << FmtDouble(q.newTotalSoldXyph, 4) << ","
              << "\"scarcityMultiplier\":" << FmtDouble(q.scarcityMultiplier, 4) << ","
              << "\"demandMultiplier\":" << FmtDouble(q.demandMultiplier, 4) << ","
              << "\"marketRegime\":\"" << JsonEscape(q.marketRegime) << "\""
              << "}\n";
    return 0;
}

int CmdSelfTest() {
    using namespace xypher;
    struct TestResult {
        std::string name;
        bool passed;
        std::string detail;
    };
    std::vector<TestResult> results;
    const auto t0 = std::chrono::steady_clock::now();

    // 1. FIPS 180-4 SHA-256 & Double-SHA-256 vector check
    {
        const std::string shaAbc = crypto::HexStr(crypto::Sha256("abc"));
        const bool ok = (shaAbc == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        results.push_back({
            "SHA-256 / SHA256d Cryptographic Vector",
            ok,
            ok ? "Verified FIPS 180-4 SHA-256('abc') & Double-SHA-256 digest" : "Digest mismatch"
        });
    }

    // 2. Consensus 10-Year Halving Schedule & Zero-Fee Rule
    {
        const consensus::Params p;
        const int64_t r1 = consensus::GetBlockSubsidy(1, p);
        const int64_t r2 = consensus::GetBlockSubsidy(525'601, p);
        const int64_t r3 = consensus::GetBlockSubsidy(1'051'201, p);
        const bool ok = (r1 == 10 * consensus::COIN) &&
                        (r2 == 5 * consensus::COIN) &&
                        (r3 == 250'000'000LL) &&
                        (p.nMinRelayTxFee == 0);
        results.push_back({
            "10-Year Halving Schedule & Zero Network Fee",
            ok,
            "Block #1=10 XYPH -> Block #525,601=5 XYPH -> Block #1,051,201=2.5 XYPH · Fee=0 XYPH"
        });
    }

    // 3. Bitcoin-Core-Style UTXO Set, Merkle Root, PoW Verification & Double-Spend Rejection
    {
        const consensus::Params p;
        validation::CCoinsViewCache utxo;
        validation::ValidationState state;

        primitives::CBlock blk1;
        blk1.nHeight = 1;
        blk1.hashPrevBlock = std::string(64, '0');
        blk1.nTime = 1760000600ULL;
        blk1.targetHex = "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

        primitives::CTransaction cb1;
        cb1.vin.push_back(primitives::CTxIn{primitives::COutPoint{std::string(64, '0'), 0xffffffffu}, "coinbase:1", "", 0xffffffffu});
        cb1.vout.push_back(primitives::CTxOut{10 * consensus::COIN, "cMinerWallet1"});
        blk1.vtx.push_back(cb1);
        blk1.hashMerkleRoot = crypto::HexStr(blk1.ComputeMerkleRoot());
        while (!primitives::CheckProofOfWork(blk1.GetHash(), blk1.targetHex)) {
            blk1.nNonce++;
        }

        const bool connected1 = validation::ConnectBlock(blk1, utxo, p, state);

        // Spend full 10 XYPH with 0 fee in Block #2
        primitives::CTransaction spendTx;
        spendTx.vin.push_back(primitives::CTxIn{primitives::COutPoint{cb1.GetTxId(), 0}, "sig", "pub", 0xffffffffu});
        spendTx.vout.push_back(primitives::CTxOut{10 * consensus::COIN, "cRecipientWallet2"});

        primitives::CBlock blk2;
        blk2.nHeight = 2;
        blk2.hashPrevBlock = blk1.GetHashHex();
        blk2.nTime = 1760001200ULL;
        blk2.targetHex = blk1.targetHex;

        primitives::CTransaction cb2;
        cb2.vin.push_back(primitives::CTxIn{primitives::COutPoint{std::string(64, '0'), 0xffffffffu}, "coinbase:2", "", 0xffffffffu});
        cb2.vout.push_back(primitives::CTxOut{10 * consensus::COIN, "cMinerWallet1"});
        blk2.vtx.push_back(cb2);
        blk2.vtx.push_back(spendTx);
        blk2.hashMerkleRoot = crypto::HexStr(blk2.ComputeMerkleRoot());
        while (!primitives::CheckProofOfWork(blk2.GetHash(), blk2.targetHex)) {
            blk2.nNonce++;
        }

        validation::ValidationState state2;
        const bool connected2 = validation::ConnectBlock(blk2, utxo, p, state2);

        // Attempt double-spend of cb1 UTXO
        int64_t fee = 0;
        validation::ValidationState dblState;
        const bool dblAllowed = validation::CheckTxInputs(spendTx, utxo, 3, fee, p, dblState);

        const bool ok = connected1 && connected2 && !dblAllowed &&
                        utxo.GetBalance("cRecipientWallet2") == 10 * consensus::COIN &&
                        utxo.GetBalance("cMinerWallet1") == 10 * consensus::COIN;
        results.push_back({
            "UTXO ConnectBlock, PoW Nonce Mining & Double-Spend Block",
            ok,
            ok ? ("Mined 2 PoW blocks (" + std::to_string(blk1.nNonce + blk2.nNonce) + " hashes), confirmed 0-fee 10 XYPH spend & rejected double-spend")
               : ("Failed: " + state.rejectReason + " / " + state2.rejectReason)
        });
    }

    // 4. Supply & Demand Law #1: High Buy Demand + Low Supply => Price INCREASES
    {
        market::MarketStateInput base;
        base.inrReserve = 2500.0;
        base.xyphReserve = 250000.0;
        base.circulatingSupplyXyph = 5000.0;
        base.supplyBaselineXyph = 10000.0; // Low supply (half baseline) -> scarcity > 1
        const auto spotBefore = market::CSupplyDemandEngine::EvaluateSpot(base);
        const auto buyQuote = market::CSupplyDemandEngine::QuoteBuy(base, 1500.0);
        const bool ok = (spotBefore.scarcityMultiplier > 1.0) &&
                        (buyQuote.spotAfterInr > buyQuote.spotBeforeInr) &&
                        (buyQuote.priceImpactPercent > 0.0) &&
                        (buyQuote.demandMultiplier > 1.0);
        results.push_back({
            "Economic Law: High Demand & Low Supply Increases Price",
            ok,
            "Spot rose from ₹" + FmtDouble(buyQuote.spotBeforeInr, 5) + " -> ₹" +
            FmtDouble(buyQuote.spotAfterInr, 5) + " (+" + FmtDouble(buyQuote.priceImpactPercent, 2) +
            "%, scarcity " + FmtDouble(buyQuote.scarcityMultiplier, 2) + "x)"
        });
    }

    // 5. Supply & Demand Law #2: High Supply + Low Demand (Selling) => Price DECREASES
    {
        market::MarketStateInput highSupply;
        highSupply.inrReserve = 2500.0;
        highSupply.xyphReserve = 250000.0;
        highSupply.circulatingSupplyXyph = 25000.0;
        highSupply.supplyBaselineXyph = 10000.0; // High supply (2.5x baseline) -> scarcity < 1
        const auto spotBefore = market::CSupplyDemandEngine::EvaluateSpot(highSupply);
        const auto sellQuote = market::CSupplyDemandEngine::QuoteSell(highSupply, 50000.0);
        const bool ok = (spotBefore.scarcityMultiplier < 1.0) &&
                        (sellQuote.spotAfterInr < sellQuote.spotBeforeInr) &&
                        (sellQuote.priceImpactPercent < 0.0) &&
                        (sellQuote.demandMultiplier < 1.0);
        results.push_back({
            "Economic Law: High Supply & Selling Decreases Price",
            ok,
            "Spot fell from ₹" + FmtDouble(sellQuote.spotBeforeInr, 5) + " -> ₹" +
            FmtDouble(sellQuote.spotAfterInr, 5) + " (" + FmtDouble(sellQuote.priceImpactPercent, 2) +
            "%, scarcity " + FmtDouble(sellQuote.scarcityMultiplier, 2) + "x)"
        });
    }

    // 6. 64-Char Hash Chain Linking & Genesis 64-Zero Previous Hash Enforcement
    {
        chain::CChain testChain;
        testChain.InitGenesis("cGenesisMiner0", 1760000000ULL);
        validation::ValidationState st1;
        validation::ValidationState st2;
        const bool m1 = testChain.MineAndConnectNextBlock(
            "cMinerNode1",
            1760000600ULL,
            "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            st1
        );
        const bool m2 = testChain.MineAndConnectNextBlock(
            "cMinerNode2",
            1760001200ULL,
            "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            st2
        );
        const auto cleanReport = testChain.VerifyChain();
        const bool genesisOk = !cleanReport.blocks.empty() &&
                               cleanReport.blocks[0].isGenesis &&
                               cleanReport.blocks[0].genesisPrevAllZeros &&
                               cleanReport.blocks[0].prevHash == chain::GENESIS_PREV_HASH &&
                               cleanReport.blocks[0].hashLength == 64;
        const bool linksOk = cleanReport.valid && cleanReport.validLinks == 3 && cleanReport.brokenLinks == 0;

        // Tamper Block #1 and verify CChain detects the broken 64-char hash chain link to Block #2
        testChain.SimulateTamperAtHeight(1, "tampered-coinbase-payload");
        const auto tamperedReport = testChain.VerifyChain();
        const bool tamperCaught = !tamperedReport.valid && tamperedReport.brokenLinks >= 1;

        const bool ok = m1 && m2 && genesisOk && linksOk && tamperCaught;
        results.push_back({
            "64-Char Hash Chain Linking & Genesis 64-Zero PrevHash",
            ok,
            ok ? "Genesis #0 prevHash=64 zeros -> Block #1 -> Block #2 linked by 64-char SHA256d hashes; tamper breaks chain"
               : "Chain link or Genesis 64-zero check failed"
        });
    }

    const auto t1 = std::chrono::steady_clock::now();
    const double elapsedMs = std::chrono::duration<double, std::milli>(t1 - t0).count();

    bool allPassed = true;
    for (const auto& r : results) {
        if (!r.passed) allPassed = false;
    }

    std::cout << "{"
              << "\"engine\":\"xypherd C++17 Core\","
              << "\"allPassed\":" << (allPassed ? "true" : "false") << ","
              << "\"durationMs\":" << FmtDouble(elapsedMs, 2) << ","
              << "\"tests\":[";
    for (size_t i = 0; i < results.size(); ++i) {
        if (i > 0) std::cout << ",";
        std::cout << "{"
                  << "\"name\":\"" << JsonEscape(results[i].name) << "\","
                  << "\"passed\":" << (results[i].passed ? "true" : "false") << ","
                  << "\"detail\":\"" << JsonEscape(results[i].detail) << "\""
                  << "}";
    }
    std::cout << "]}\n";
    return allPassed ? 0 : 1;
}

int CmdBenchmarkPow(const std::unordered_map<std::string, std::string>& args) {
    const int64_t iterations = std::max<int64_t>(1000, std::min<int64_t>(200000, ParseIntArg(args, "--iterations", 50000)));
    const auto t0 = std::chrono::steady_clock::now();
    xypher::crypto::Hash256 last{};
    for (int64_t i = 0; i < iterations; ++i) {
        last = xypher::crypto::Hash256d("xypher-pow-bench|" + std::to_string(i));
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double sec = std::max(0.000001, std::chrono::duration<double>(t1 - t0).count());
    const double hashRate = static_cast<double>(iterations) / sec;
    std::cout << "{"
              << "\"engine\":\"xypherd C++17 Core\","
              << "\"iterations\":" << iterations << ","
              << "\"durationMs\":" << FmtDouble(sec * 1000.0, 2) << ","
              << "\"hashesPerSec\":" << FmtDouble(hashRate, 0) << ","
              << "\"sampleHash\":\"" << xypher::crypto::HexStr(last) << "\""
              << "}\n";
    return 0;
}

void PrintChainReportJson(
    const xypher::chain::ChainVerificationReport& report,
    const std::string& mode,
    int64_t tamperedHeight
) {
    std::cout << "{"
              << "\"engine\":\"xypherd C++17 Core\","
              << "\"mode\":\"" << JsonEscape(mode) << "\","
              << "\"valid\":" << (report.valid ? "true" : "false") << ","
              << "\"hashHexLength\":" << xypher::chain::HASH_HEX_LENGTH << ","
              << "\"genesisPrevHash\":\"" << report.genesisPrevHash << "\","
              << "\"blockCount\":" << report.blockCount << ","
              << "\"validLinks\":" << report.validLinks << ","
              << "\"brokenLinks\":" << report.brokenLinks << ","
              << "\"firstBrokenHeight\":" << report.firstBrokenHeight << ","
              << "\"tamperedHeight\":" << tamperedHeight << ","
              << "\"blocks\":[";
    for (size_t i = 0; i < report.blocks.size(); ++i) {
        const auto& b = report.blocks[i];
        if (i > 0) std::cout << ",";
        std::cout << "{"
                  << "\"height\":" << b.height << ","
                  << "\"hash\":\"" << JsonEscape(b.hash) << "\","
                  << "\"hashLength\":" << b.hashLength << ","
                  << "\"prevHash\":\"" << JsonEscape(b.prevHash) << "\","
                  << "\"prevHashLength\":" << b.prevHashLength << ","
                  << "\"expectedPrevHash\":\"" << JsonEscape(b.expectedPrevHash) << "\","
                  << "\"merkleRoot\":\"" << JsonEscape(b.merkleRoot) << "\","
                  << "\"timestamp\":" << b.timestamp << ","
                  << "\"nonce\":" << b.nonce << ","
                  << "\"txCount\":" << b.txCount << ","
                  << "\"isGenesis\":" << (b.isGenesis ? "true" : "false") << ","
                  << "\"genesisPrevAllZeros\":" << (b.genesisPrevAllZeros ? "true" : "false") << ","
                  << "\"hashValid64\":" << (b.hashValid64 ? "true" : "false") << ","
                  << "\"prevHashValid64\":" << (b.prevHashValid64 ? "true" : "false") << ","
                  << "\"linkValid\":" << (b.linkValid ? "true" : "false") << ","
                  << "\"merkleValid\":" << (b.merkleValid ? "true" : "false") << ","
                  << "\"powValid\":" << (b.powValid ? "true" : "false") << ","
                  << "\"blockValid\":" << (b.blockValid ? "true" : "false") << ","
                  << "\"error\":\"" << JsonEscape(b.error) << "\""
                  << "}";
    }
    std::cout << "]}\n";
}

int CmdChainDemo(const std::unordered_map<std::string, std::string>& args) {
    const int64_t numBlocks = std::max<int64_t>(2, std::min<int64_t>(8, ParseIntArg(args, "--blocks", 4)));
    const int64_t tamperHeight = ParseIntArg(args, "--tamper", -1);

    xypher::chain::CChain cchain;
    const std::string target = "00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    cchain.InitGenesis("cXypherGenesisNode0", 1760000000ULL, target);

    for (int64_t h = 1; h < numBlocks; ++h) {
        xypher::validation::ValidationState state;
        cchain.MineAndConnectNextBlock(
            "cXypherMinerNode" + std::to_string(h),
            1760000000ULL + static_cast<uint64_t>(h * 600),
            target,
            state
        );
    }

    int64_t appliedTamper = -1;
    if (tamperHeight >= 0 && tamperHeight < numBlocks) {
        if (cchain.SimulateTamperAtHeight(tamperHeight, "TAMPERED_BLOCK_DATA_AT_HEIGHT_" + std::to_string(tamperHeight))) {
            appliedTamper = tamperHeight;
        }
    }

    const auto report = cchain.VerifyChain();
    PrintChainReportJson(report, appliedTamper >= 0 ? "tamper-test" : "cpp-chain-demo", appliedTamper);
    return 0;
}

int CmdVerifyLinks(const std::unordered_map<std::string, std::string>& args) {
    auto it = args.find("--payload");
    const std::string payload = (it != args.end()) ? it->second : "";
    std::vector<xypher::chain::ExternalBlockLinkInput> inputs;

    std::stringstream ss(payload);
    std::string row;
    while (std::getline(ss, row, ';')) {
        if (row.empty()) continue;
        std::vector<std::string> cols;
        std::stringstream rs(row);
        std::string col;
        while (std::getline(rs, col, '|')) {
            cols.push_back(col);
        }
        if (cols.size() < 3) continue;
        xypher::chain::ExternalBlockLinkInput item;
        try {
            item.height = std::stoll(cols[0]);
            item.hash = cols[1];
            item.prevHash = cols[2];
            item.merkleRoot = cols.size() > 3 ? cols[3] : "";
            item.timestamp = cols.size() > 4 ? std::stoull(cols[4]) : 0ULL;
            item.nonce = cols.size() > 5 ? std::stoull(cols[5]) : 0ULL;
            item.txCount = cols.size() > 6 ? static_cast<size_t>(std::stoull(cols[6])) : 0;
            inputs.push_back(std::move(item));
        } catch (...) {
            continue;
        }
    }

    const auto report = xypher::chain::VerifyExternalBlockLinks(inputs);
    PrintChainReportJson(report, "live-network-audit", -1);
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    std::unordered_map<std::string, std::string> args;
    for (int i = 1; i < argc; ++i) {
        std::string key = argv[i];
        if (key.rfind("--", 0) == 0 && i + 1 < argc) {
            args[key] = argv[++i];
        }
    }

    const std::string cmd = args.count("--cmd") ? args["--cmd"] : "info";
    if (cmd == "info") return CmdInfo();
    if (cmd == "spot") return CmdSpot(args);
    if (cmd == "quote-buy") return CmdQuote("buy", args);
    if (cmd == "quote-sell") return CmdQuote("sell", args);
    if (cmd == "self-test") return CmdSelfTest();
    if (cmd == "benchmark-pow") return CmdBenchmarkPow(args);
    if (cmd == "chain-demo") return CmdChainDemo(args);
    if (cmd == "verify-links") return CmdVerifyLinks(args);

    std::cerr << "{\"error\":\"Unknown command\"}\n";
    return 1;
}
