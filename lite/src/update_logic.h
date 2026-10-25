// The parts of the self-update that do not depend on Windows: versions, the update feed, which addresses may be downloaded from,
// SHA-256 and the check that a downloaded file is a 64-bit Windows program.
// Plain C++ so that it is tested on Linux (test/update-logic.test.js); src/updater.h does the downloading and the file work.
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <optional>
#include <string>

namespace upd {

// ---------------------------------------------------------------------------------------------------------------- versions

// "0.3.2" -> {0, 3, 2, 0}; one to four numbers of up to four digits, nothing else
inline bool ParseVersion(const std::string& text, int out[4]) {
    for (int i = 0; i < 4; i++) out[i] = 0;
    if (text.empty() || text.size() > 19) return false;

    int part = 0, digits = 0, value = 0;
    for (size_t i = 0; i <= text.size(); i++) {
        char c = i < text.size() ? text[i] : '.';
        if (c >= '0' && c <= '9') {
            if (++digits > 4) return false;
            value = value * 10 + (c - '0');
        } else if (c == '.') {
            if (digits == 0 || part >= 4) return false;
            out[part++] = value;
            digits = 0;
            value = 0;
        } else {
            return false;
        }
    }
    return true;
}

// -1 when a < b, 0 when equal, 1 when a > b, 2 when either is not a version
inline int CompareVersions(const std::string& a, const std::string& b) {
    int x[4], y[4];
    if (!ParseVersion(a, x) || !ParseVersion(b, y)) return 2;

    for (int i = 0; i < 4; i++) {
        if (x[i] != y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}

// ------------------------------------------------------------------------------------------------------------- the feed

inline constexpr const char* kUrlPrefix = "https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/";
inline constexpr const char* kHost = "raw.githubusercontent.com";
inline constexpr uint64_t kMaxSize = 8 * 1024 * 1024; // the program is well under 1 MB, anything big is not an update

// only this project's files on GitHub's raw file host, plain path characters, a .exe at the end
inline bool AllowedUrl(const std::string& url) {
    const size_t prefix = std::strlen(kUrlPrefix);
    if (url.size() <= prefix + 4 || url.size() > 256) return false;
    if (url.compare(0, prefix, kUrlPrefix) != 0) return false;
    if (url.compare(url.size() - 4, 4, ".exe") != 0) return false;

    for (size_t i = prefix; i < url.size(); i++) {
        char c = url[i];
        bool plain = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-' || c == '/';
        if (!plain) return false;
        if (c == '/' && (url[i - 1] == '/')) return false;
        if (c == '.' && url[i - 1] == '.') return false; // no ".."
    }
    return true;
}

// the part of the address after the host, for WinHTTP
inline std::string UrlPath(const std::string& url) {
    return url.substr(std::strlen("https://") + std::strlen(kHost));
}

// "key": "text" with no escapes (the feed is written by tools/release.sh and has none)
inline std::optional<std::string> JsonString(const std::string& json, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    size_t at = json.find(needle);
    if (at == std::string::npos) return std::nullopt;

    size_t i = at + needle.size();
    while (i < json.size() && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
    if (i >= json.size() || json[i] != ':') return std::nullopt;
    i++;
    while (i < json.size() && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
    if (i >= json.size() || json[i] != '"') return std::nullopt;
    i++;

    std::string value;
    while (i < json.size() && json[i] != '"') {
        if (json[i] == '\\' || static_cast<unsigned char>(json[i]) < 0x20) return std::nullopt;
        value.push_back(json[i++]);
    }
    if (i >= json.size()) return std::nullopt;
    return value;
}

inline std::optional<uint64_t> JsonNumber(const std::string& json, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    size_t at = json.find(needle);
    if (at == std::string::npos) return std::nullopt;

    size_t i = at + needle.size();
    while (i < json.size() && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;
    if (i >= json.size() || json[i] != ':') return std::nullopt;
    i++;
    while (i < json.size() && (json[i] == ' ' || json[i] == '\t' || json[i] == '\r' || json[i] == '\n')) i++;

    uint64_t value = 0;
    int digits = 0;
    while (i < json.size() && json[i] >= '0' && json[i] <= '9') {
        if (++digits > 12) return std::nullopt;
        value = value * 10 + static_cast<uint64_t>(json[i++] - '0');
    }
    if (digits == 0) return std::nullopt;
    return value;
}

struct Feed {
    std::string version;
    std::string url;
    std::string sha256; // 64 lowercase hex digits
    uint64_t size = 0;
};

inline bool IsSha256Hex(const std::string& text) {
    if (text.size() != 64) return false;
    for (char c : text) {
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    }
    return true;
}

// everything the update needs, and nothing that does not look right
inline bool ParseFeed(const std::string& json, Feed& out) {
    if (json.size() > 16 * 1024) return false;

    auto version = JsonString(json, "version");
    auto url = JsonString(json, "url");
    auto sha = JsonString(json, "sha256");
    auto size = JsonNumber(json, "size");
    if (!version || !url || !sha || !size) return false;

    int parts[4];
    if (!ParseVersion(*version, parts)) return false;
    if (!AllowedUrl(*url)) return false;
    if (!IsSha256Hex(*sha)) return false;
    if (*size < 1024 || *size > kMaxSize) return false;

    out.version = *version;
    out.url = *url;
    out.sha256 = *sha;
    out.size = *size;
    return true;
}

// -------------------------------------------------------------------------------------------------------------- SHA-256

class Sha256 {
public:
    Sha256() { Reset(); }

    void Reset() {
        static const uint32_t start[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
        std::memcpy(state_, start, sizeof(state_));
        length_ = 0;
        used_ = 0;
    }

    void Update(const uint8_t* data, size_t size) {
        length_ += size;
        while (size > 0) {
            size_t take = 64 - used_ < size ? 64 - used_ : size;
            std::memcpy(block_ + used_, data, take);
            used_ += take;
            data += take;
            size -= take;
            if (used_ == 64) {
                Block(block_);
                used_ = 0;
            }
        }
    }

    std::string FinishHex() {
        const uint64_t bits = length_ * 8;
        const uint8_t one = 0x80, zero = 0;
        Update(&one, 1);
        while (used_ != 56) Update(&zero, 1);

        uint8_t tail[8];
        for (int i = 0; i < 8; i++) tail[i] = static_cast<uint8_t>(bits >> (56 - 8 * i));
        Update(tail, 8);

        static const char digits[] = "0123456789abcdef";
        std::string hex;
        for (int i = 0; i < 8; i++) {
            for (int shift = 28; shift >= 0; shift -= 4) hex.push_back(digits[(state_[i] >> shift) & 15]);
        }
        Reset();
        return hex;
    }

private:
    static uint32_t Rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

    void Block(const uint8_t* in) {
        static const uint32_t k[64] = {
            0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
            0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
            0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
            0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
            0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
            0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

        uint32_t w[64];
        for (int i = 0; i < 16; i++) {
            w[i] = (uint32_t(in[i * 4]) << 24) | (uint32_t(in[i * 4 + 1]) << 16) | (uint32_t(in[i * 4 + 2]) << 8) | uint32_t(in[i * 4 + 3]);
        }
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = Rotr(w[i - 15], 7) ^ Rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            uint32_t s1 = Rotr(w[i - 2], 17) ^ Rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }

        uint32_t a = state_[0], b = state_[1], c = state_[2], d = state_[3], e = state_[4], f = state_[5], g = state_[6], h = state_[7];
        for (int i = 0; i < 64; i++) {
            uint32_t s1 = Rotr(e, 6) ^ Rotr(e, 11) ^ Rotr(e, 25);
            uint32_t choose = (e & f) ^ (~e & g);
            uint32_t t1 = h + s1 + choose + k[i] + w[i];
            uint32_t s0 = Rotr(a, 2) ^ Rotr(a, 13) ^ Rotr(a, 22);
            uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
            uint32_t t2 = s0 + majority;
            h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
        }

        state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
        state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
    }

    uint32_t state_[8];
    uint8_t block_[64];
    uint64_t length_;
    size_t used_;
};

inline std::string Sha256Hex(const uint8_t* data, size_t size) {
    Sha256 hash;
    hash.Update(data, size);
    return hash.FinishHex();
}

// -------------------------------------------------------------------------------------------------------- a program file

// "MZ", a "PE\0\0" header where the DOS header says, and the machine type of 64-bit x86
inline bool IsWindowsX64Program(const uint8_t* data, size_t size) {
    if (size < 0x100 || data[0] != 'M' || data[1] != 'Z') return false;

    uint32_t header = uint32_t(data[0x3c]) | (uint32_t(data[0x3d]) << 8) | (uint32_t(data[0x3e]) << 16) | (uint32_t(data[0x3f]) << 24);
    if (header > size - 6 || header < 0x40) return false;
    if (std::memcmp(data + header, "PE\0\0", 4) != 0) return false;

    return data[header + 4] == 0x64 && data[header + 5] == 0x86; // IMAGE_FILE_MACHINE_AMD64 = 0x8664
}

} // namespace upd
