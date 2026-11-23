// Copyright (c) 2025-2026 Xypher Core Developers
// Self-contained FIPS 180-4 SHA-256 & Double-SHA-256 implementation

#include "crypto/sha256.h"

#include <cstring>

namespace xypher::crypto {

namespace {

static constexpr uint32_t K[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};

inline uint32_t RotR(uint32_t x, uint32_t n) {
    return (x >> n) | (x << (32 - n));
}

inline uint32_t ReadBE32(const uint8_t* ptr) {
    return (static_cast<uint32_t>(ptr[0]) << 24) |
           (static_cast<uint32_t>(ptr[1]) << 16) |
           (static_cast<uint32_t>(ptr[2]) << 8) |
           static_cast<uint32_t>(ptr[3]);
}

inline void WriteBE32(uint8_t* ptr, uint32_t x) {
    ptr[0] = static_cast<uint8_t>((x >> 24) & 0xffu);
    ptr[1] = static_cast<uint8_t>((x >> 16) & 0xffu);
    ptr[2] = static_cast<uint8_t>((x >> 8) & 0xffu);
    ptr[3] = static_cast<uint8_t>(x & 0xffu);
}

inline void WriteBE64(uint8_t* ptr, uint64_t x) {
    WriteBE32(ptr, static_cast<uint32_t>(x >> 32));
    WriteBE32(ptr + 4, static_cast<uint32_t>(x & 0xffffffffu));
}

} // namespace

CSHA256::CSHA256() {
    Reset();
}

CSHA256& CSHA256::Reset() {
    s_[0] = 0x6a09e667u;
    s_[1] = 0xbb67ae85u;
    s_[2] = 0x3c6ef372u;
    s_[3] = 0xa54ff53au;
    s_[4] = 0x510e527fu;
    s_[5] = 0x9b05688cu;
    s_[6] = 0x1f83d9abu;
    s_[7] = 0x5be0cd19u;
    bytes_ = 0;
    return *this;
}

void CSHA256::Transform(const uint8_t chunk[64]) {
    uint32_t w[64];
    for (int i = 0; i < 16; ++i) {
        w[i] = ReadBE32(chunk + i * 4);
    }
    for (int i = 16; i < 64; ++i) {
        const uint32_t s0 = RotR(w[i - 15], 7) ^ RotR(w[i - 15], 18) ^ (w[i - 15] >> 3);
        const uint32_t s1 = RotR(w[i - 2], 17) ^ RotR(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    uint32_t a = s_[0];
    uint32_t b = s_[1];
    uint32_t c = s_[2];
    uint32_t d = s_[3];
    uint32_t e = s_[4];
    uint32_t f = s_[5];
    uint32_t g = s_[6];
    uint32_t h = s_[7];

    for (int i = 0; i < 64; ++i) {
        const uint32_t S1 = RotR(e, 6) ^ RotR(e, 11) ^ RotR(e, 25);
        const uint32_t ch = (e & f) ^ ((~e) & g);
        const uint32_t temp1 = h + S1 + ch + K[i] + w[i];
        const uint32_t S0 = RotR(a, 2) ^ RotR(a, 13) ^ RotR(a, 22);
        const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        const uint32_t temp2 = S0 + maj;

        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    s_[0] += a;
    s_[1] += b;
    s_[2] += c;
    s_[3] += d;
    s_[4] += e;
    s_[5] += f;
    s_[6] += g;
    s_[7] += h;
}

CSHA256& CSHA256::Write(const uint8_t* data, size_t len) {
    size_t bufSize = static_cast<size_t>(bytes_ % 64);
    if (bufSize > 0 && bufSize + len >= 64) {
        const size_t fill = 64 - bufSize;
        std::memcpy(buf_ + bufSize, data, fill);
        Transform(buf_);
        data += fill;
        len -= fill;
        bytes_ += fill;
        bufSize = 0;
    }
    while (len >= 64) {
        Transform(data);
        data += 64;
        len -= 64;
        bytes_ += 64;
    }
    if (len > 0) {
        std::memcpy(buf_ + bufSize, data, len);
        bytes_ += len;
    }
    return *this;
}

CSHA256& CSHA256::Write(const std::string& str) {
    return Write(reinterpret_cast<const uint8_t*>(str.data()), str.size());
}

void CSHA256::Finalize(uint8_t hash[OUTPUT_SIZE]) {
    static const uint8_t pad[64] = {0x80};
    uint8_t sizedesc[8];
    WriteBE64(sizedesc, bytes_ << 3);
    Write(pad, 1 + ((119 - (bytes_ % 64)) % 64));
    Write(sizedesc, 8);
    for (int i = 0; i < 8; ++i) {
        WriteBE32(hash + i * 4, s_[i]);
    }
}

Hash256 CSHA256::Finalize() {
    Hash256 out{};
    Finalize(out.data());
    return out;
}

Hash256 Sha256(const uint8_t* data, size_t len) {
    CSHA256 ctx;
    ctx.Write(data, len);
    return ctx.Finalize();
}

Hash256 Sha256(const std::string& data) {
    return Sha256(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

Hash256 Hash256d(const uint8_t* data, size_t len) {
    const Hash256 first = Sha256(data, len);
    return Sha256(first.data(), first.size());
}

Hash256 Hash256d(const std::string& data) {
    return Hash256d(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

Hash256 Hash256d(const Hash256& left, const Hash256& right) {
    uint8_t buf[64];
    std::memcpy(buf, left.data(), 32);
    std::memcpy(buf + 32, right.data(), 32);
    return Hash256d(buf, 64);
}

std::string HexStr(const uint8_t* data, size_t len) {
    static constexpr char HEX[] = "0123456789abcdef";
    std::string out;
    out.reserve(len * 2);
    for (size_t i = 0; i < len; ++i) {
        out.push_back(HEX[(data[i] >> 4) & 0x0f]);
        out.push_back(HEX[data[i] & 0x0f]);
    }
    return out;
}

std::string HexStr(const Hash256& hash) {
    return HexStr(hash.data(), hash.size());
}

bool ParseHash256(const std::string& hex, Hash256& out) {
    std::string clean = hex;
    if (clean.size() >= 2 && clean[0] == '0' && (clean[1] == 'x' || clean[1] == 'X')) {
        clean = clean.substr(2);
    }
    if (clean.size() != 64) return false;
    auto nibble = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
        if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
        return -1;
    };
    for (size_t i = 0; i < 32; ++i) {
        int hi = nibble(clean[i * 2]);
        int lo = nibble(clean[i * 2 + 1]);
        if (hi < 0 || lo < 0) return false;
        out[i] = static_cast<uint8_t>((hi << 4) | lo);
    }
    return true;
}

} // namespace xypher::crypto
