// Copyright (c) 2025-2026 Xypher Core Developers
// FIPS 180-4 SHA-256 & Double-SHA-256 (SHA256d), modeled after Bitcoin Core crypto/sha256.h

#ifndef XYPHER_CRYPTO_SHA256_H
#define XYPHER_CRYPTO_SHA256_H

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace xypher::crypto {

using Hash256 = std::array<uint8_t, 32>;

class CSHA256 {
public:
    static constexpr size_t OUTPUT_SIZE = 32;

    CSHA256();
    CSHA256& Write(const uint8_t* data, size_t len);
    CSHA256& Write(const std::string& str);
    void Finalize(uint8_t hash[OUTPUT_SIZE]);
    Hash256 Finalize();
    CSHA256& Reset();

private:
    void Transform(const uint8_t chunk[64]);
    uint32_t s_[8];
    uint8_t buf_[64];
    uint64_t bytes_;
};

/** Single SHA-256 */
Hash256 Sha256(const uint8_t* data, size_t len);
Hash256 Sha256(const std::string& data);

/** Double SHA-256 (Bitcoin Core Hash256 / SHA256d) */
Hash256 Hash256d(const uint8_t* data, size_t len);
Hash256 Hash256d(const std::string& data);
Hash256 Hash256d(const Hash256& left, const Hash256& right);

std::string HexStr(const Hash256& hash);
std::string HexStr(const uint8_t* data, size_t len);
bool ParseHash256(const std::string& hex, Hash256& out);

} // namespace xypher::crypto

#endif // XYPHER_CRYPTO_SHA256_H
