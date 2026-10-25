// Checks of src/update_logic.h, built and run by test/update-logic.test.js.
//   update_logic_check            runs the checks, exit code 0 when all pass
//   update_logic_check sha FILE   prints the SHA-256 of a file (the test compares it with node's)
//   update_logic_check feed FILE  reads a feed the way the program does: prints version, address, hash and size, or exits with 1
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "../src/update_logic.h"

static int failures = 0;
#define CHECK(condition) do { if (!(condition)) { std::printf("FAILED line %d: %s\n", __LINE__, #condition); failures++; } } while (0)

static std::string Feed(const std::string& version, const std::string& url, const std::string& sha, const std::string& size) {
    return "{\n  \"version\": \"" + version + "\",\n  \"url\": \"" + url + "\",\n  \"sha256\": \"" + sha + "\",\n  \"size\": " + size + ",\n  \"notes\": \"text\"\n}\n";
}

int main(int argc, char** argv) {
    if (argc == 3 && std::string(argv[1]) == "sha") {
        std::ifstream file(argv[2], std::ios::binary);
        std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        std::printf("%s\n", upd::Sha256Hex(bytes.data(), bytes.size()).c_str());
        return 0;
    }

    if (argc == 3 && std::string(argv[1]) == "feed") {
        std::ifstream file(argv[2], std::ios::binary);
        std::string json((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        upd::Feed feed;
        if (!upd::ParseFeed(json, feed)) return 1;
        std::printf("%s\n%s\n%s\n%llu\n", feed.version.c_str(), feed.url.c_str(), feed.sha256.c_str(), static_cast<unsigned long long>(feed.size));
        return 0;
    }

    // versions
    CHECK(upd::CompareVersions("0.3.2", "0.3.2") == 0);
    CHECK(upd::CompareVersions("0.3.2", "0.4.0") == -1);
    CHECK(upd::CompareVersions("0.4.0", "0.3.9") == 1);
    CHECK(upd::CompareVersions("0.10.0", "0.9.0") == 1);      // numbers, not text
    CHECK(upd::CompareVersions("1.0", "1.0.0") == 0);
    CHECK(upd::CompareVersions("1.0.0.1", "1.0.0") == 1);
    CHECK(upd::CompareVersions("0.3.2", "") == 2);
    CHECK(upd::CompareVersions("0.3.x", "0.3.2") == 2);
    CHECK(upd::CompareVersions("0..2", "0.3.2") == 2);
    CHECK(upd::CompareVersions(".1", "0.3.2") == 2);
    CHECK(upd::CompareVersions("1.", "0.3.2") == 2);
    CHECK(upd::CompareVersions("1.2.3.4.5", "0.3.2") == 2);
    CHECK(upd::CompareVersions("12345.0", "0.3.2") == 2);
    CHECK(upd::CompareVersions("-1.0", "0.3.2") == 2);

    // addresses
    const std::string good = "https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/lite/dist/UltraYT-Lite-0.4.0.exe";
    CHECK(upd::AllowedUrl(good));
    CHECK(upd::UrlPath(good) == "/dd77yy77-wq/UltraYT/main/lite/dist/UltraYT-Lite-0.4.0.exe");
    CHECK(!upd::AllowedUrl("http://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a.exe"));            // not https
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/someone/else/main/a.exe"));                    // another repository
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com.evil.example/dd77yy77-wq/UltraYT/main/a.exe")); // another host
    CHECK(!upd::AllowedUrl("https://evil.example/https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/a.exe"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/../../x/y/z/a.exe")); // up the tree
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main//a.exe"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a.exe?x=1"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a.exe#x"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a b.exe"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a.dll"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/a.exe\\..\\b.exe"));
    CHECK(!upd::AllowedUrl("https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/.exe"));
    CHECK(!upd::AllowedUrl(""));

    // the feed
    const std::string sha(64, 'a');
    upd::Feed feed;
    CHECK(upd::ParseFeed(Feed("0.4.0", good, sha, "440000"), feed));
    CHECK(feed.version == "0.4.0" && feed.url == good && feed.sha256 == sha && feed.size == 440000);
    CHECK(upd::ParseFeed("{\"version\":\"1.0\",\"url\":\"" + good + "\",\"sha256\":\"" + sha + "\",\"size\":2048}", feed)); // compact
    CHECK(!upd::ParseFeed(Feed("0.4", "http://example.org/a.exe", sha, "440000"), feed));
    CHECK(!upd::ParseFeed(Feed("0.4.x", good, sha, "440000"), feed));
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, std::string(63, 'a'), "440000"), feed));
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, std::string(64, 'A'), "440000"), feed));   // lowercase only
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, std::string(64, 'g'), "440000"), feed));
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, sha, "0"), feed));
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, sha, "99999999999"), feed));                 // too big
    CHECK(!upd::ParseFeed(Feed("0.4.0", good, sha, "\"440000\""), feed));                  // a string, not a number
    CHECK(!upd::ParseFeed("", feed));
    CHECK(!upd::ParseFeed("<html>404: Not Found</html>", feed));
    CHECK(!upd::ParseFeed("{\"version\":\"0.4.0\"}", feed));
    CHECK(!upd::ParseFeed(std::string(20000, ' ') + Feed("0.4.0", good, sha, "440000"), feed));
    CHECK(!upd::JsonString("{\"a\": \"x\\\"y\"}", "a").has_value());                       // escapes are not accepted

    // SHA-256 (FIPS 180-4 examples)
    auto hex = [](const std::string& text) { return upd::Sha256Hex(reinterpret_cast<const uint8_t*>(text.data()), text.size()); };
    CHECK(hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    CHECK(hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") == "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    CHECK(hex(std::string(1000000, 'a')) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");

    // a program file
    std::vector<uint8_t> pe(512, 0);
    pe[0] = 'M'; pe[1] = 'Z'; pe[0x3c] = 0x80;
    std::memcpy(&pe[0x80], "PE\0\0", 4);
    pe[0x84] = 0x64; pe[0x85] = 0x86;
    CHECK(upd::IsWindowsX64Program(pe.data(), pe.size()));
    pe[0x84] = 0x4c; pe[0x85] = 0x01;                                                      // 32-bit
    CHECK(!upd::IsWindowsX64Program(pe.data(), pe.size()));
    pe[0x84] = 0x64; pe[0x85] = 0x86; pe[0] = '<';
    CHECK(!upd::IsWindowsX64Program(pe.data(), pe.size()));                                // a web page
    pe[0] = 'M'; pe[0x3c] = 0xff; pe[0x3d] = 0xff;
    CHECK(!upd::IsWindowsX64Program(pe.data(), pe.size()));                                // header outside of the file
    CHECK(!upd::IsWindowsX64Program(pe.data(), 10));

    if (failures == 0) std::printf("all checks passed\n");
    return failures == 0 ? 0 : 1;
}
