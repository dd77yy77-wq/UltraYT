// Self-update of UltraYT-Lite.exe: a few seconds after the start (and then every few hours) a background thread reads the feed
// (lite/version.json in the project's repository), downloads a newer program when there is one, checks it
// (size, SHA-256 from the feed, a 64-bit Windows program) and swaps it in place of the running one:
//
//     UltraYT-Lite.exe      -> UltraYT-Lite.exe.old   (the running program can be renamed, not overwritten; kept as a backup)
//     UltraYT-Lite.exe.new  -> UltraYT-Lite.exe
//
// The new version starts the next time the program is started; the window title tells that it is ready.
// What the update may be (version, address, size, hash) is decided by update_logic.h, the steps and what went wrong are written to
// %LOCALAPPDATA%\UltraYT Lite\update.log. Started with --no-update the program does not look for updates.
#pragma once

#include <winhttp.h>

#include <cstdarg>
#include <cstdio>
#include <string>
#include <vector>

#include "update_logic.h"

#ifndef WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
#define WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY 4
#endif

namespace updater {

// posted to the window when an update has been installed, lParam is a "new wchar_t[]" with the version (the window frees it)
constexpr UINT kInstalledMessage = WM_APP + 1;

constexpr const char* kFeedPath = "/dd77yy77-wq/UltraYT/main/lite/version.json";
constexpr DWORD kFirstCheckDelayMs = 20 * 1000;
constexpr DWORD kCheckIntervalMs = 6 * 60 * 60 * 1000;
constexpr DWORD kRetryIntervalMs = 10 * 60 * 1000; // after a failure (no network yet, for example) the next try comes sooner

enum class Result { Installed, UpToDate, Failed };

static HWND window = nullptr;
static std::wstring logPath;
static std::string currentVersion;

static std::wstring Widen(const std::string& text) {
    return std::wstring(text.begin(), text.end()); // only ASCII ever goes through here (versions, validated paths)
}

static void Log(const char* format, ...) {
    if (logPath.empty()) return;

    char message[512];
    va_list arguments;
    va_start(arguments, format);
    vsnprintf(message, sizeof(message) - 1, format, arguments);
    va_end(arguments);
    message[sizeof(message) - 1] = 0;

    SYSTEMTIME now;
    GetLocalTime(&now);
    char line[640];
    int length = snprintf(line, sizeof(line), "%04d-%02d-%02d %02d:%02d:%02d  %s\r\n", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, message);
    if (length <= 0) return;

    HANDLE file = CreateFileW(logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;

    DWORD written = 0;
    WriteFile(file, line, static_cast<DWORD>(length), &written, nullptr);
    CloseHandle(file);
}

// GET https://raw.githubusercontent.com<path>; the answer must be 200 and no longer than `limit` bytes
static bool Get(const std::string& path, uint64_t limit, std::vector<uint8_t>& body, DWORD& status) {
    body.clear();
    status = 0;

    HINTERNET session = WinHttpOpen(L"UltraYT-Lite/" LITE_VERSION, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) session = WinHttpOpen(L"UltraYT-Lite/" LITE_VERSION, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return false;

    bool ok = false;
    HINTERNET connection = nullptr;
    HINTERNET request = nullptr;

    do {
        WinHttpSetTimeouts(session, 10000, 10000, 20000, 60000);

        connection = WinHttpConnect(session, Widen(upd::kHost).c_str(), INTERNET_DEFAULT_HTTPS_PORT, 0);
        if (!connection) break;

        request = WinHttpOpenRequest(connection, L"GET", Widen(path).c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
        if (!request) break;

        static const wchar_t headers[] = L"Cache-Control: no-cache\r\n";
        if (!WinHttpSendRequest(request, headers, static_cast<DWORD>(-1), WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) break;
        if (!WinHttpReceiveResponse(request, nullptr)) break;

        DWORD size = sizeof(status);
        if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)) break;
        if (status != 200) break;

        bool complete = true;
        for (;;) {
            DWORD available = 0;
            if (!WinHttpQueryDataAvailable(request, &available)) { complete = false; break; }
            if (available == 0) break;

            if (body.size() + available > limit) { complete = false; break; }

            size_t before = body.size();
            body.resize(before + available);
            DWORD read = 0;
            if (!WinHttpReadData(request, body.data() + before, available, &read)) { complete = false; break; }
            body.resize(before + read);
        }
        ok = complete;
    } while (false);

    DWORD error = ok ? 0 : GetLastError();
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    WinHttpCloseHandle(session);
    if (!ok) SetLastError(error);
    return ok;
}

static bool WriteFileFully(const std::wstring& path, const std::vector<uint8_t>& bytes) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;

    bool ok = true;
    size_t done = 0;
    while (done < bytes.size()) {
        DWORD wrote = 0;
        DWORD chunk = static_cast<DWORD>(bytes.size() - done > (1u << 20) ? (1u << 20) : bytes.size() - done);
        if (!WriteFile(file, bytes.data() + done, chunk, &wrote, nullptr) || wrote == 0) { ok = false; break; }
        done += wrote;
    }
    if (ok) ok = FlushFileBuffers(file) != FALSE;

    DWORD error = ok ? 0 : GetLastError();
    CloseHandle(file);
    if (!ok) SetLastError(error);
    return ok;
}

static bool ReadFileFully(const std::wstring& path, std::vector<uint8_t>& bytes) {
    bytes.clear();
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;

    uint8_t buffer[64 * 1024];
    bool ok = true;
    for (;;) {
        DWORD read = 0;
        if (!ReadFile(file, buffer, sizeof(buffer), &read, nullptr)) { ok = false; break; }
        if (read == 0) break;
        if (bytes.size() + read > upd::kMaxSize) { ok = false; break; }
        bytes.insert(bytes.end(), buffer, buffer + read);
    }
    CloseHandle(file);
    return ok;
}

// another program (a virus scanner looking at the new file, usually) may hold a file for a moment, so try a few times
static bool MoveWithRetry(const std::wstring& from, const std::wstring& to, DWORD flags) {
    for (int attempt = 0; attempt < 8; attempt++) {
        if (MoveFileExW(from.c_str(), to.c_str(), flags)) return true;
        Sleep(500);
    }
    return false;
}

static bool Install(const std::vector<uint8_t>& program, const std::string& version) {
    wchar_t buffer[2048];
    DWORD length = GetModuleFileNameW(nullptr, buffer, 2040);
    if (length == 0 || length >= 2040) {
        Log("install: cannot find the program's own path");
        return false;
    }

    const std::wstring current = buffer;
    const std::wstring fresh = current + L".new";
    const std::wstring backup = current + L".old";

    if (!WriteFileFully(fresh, program)) {
        Log("install: cannot write %ls (error %lu), the folder may be read-only", fresh.c_str(), GetLastError());
        DeleteFileW(fresh.c_str());
        return false;
    }

    // read it back: what is on the disk is what was checked
    std::vector<uint8_t> written;
    if (!ReadFileFully(fresh, written) || upd::Sha256Hex(written.data(), written.size()) != upd::Sha256Hex(program.data(), program.size())) {
        Log("install: the written file does not match, error %lu", GetLastError());
        DeleteFileW(fresh.c_str());
        return false;
    }

    if (!MoveWithRetry(current, backup, MOVEFILE_REPLACE_EXISTING)) {
        Log("install: cannot move the running program aside (error %lu)", GetLastError());
        DeleteFileW(fresh.c_str());
        return false;
    }

    if (!MoveWithRetry(fresh, current, 0)) {
        DWORD error = GetLastError();
        bool restored = MoveWithRetry(backup, current, MOVEFILE_REPLACE_EXISTING);
        Log("install: cannot put the new program in place (error %lu), the old one %s", error, restored ? "is back" : "COULD NOT BE RESTORED, it is in the .old file");
        DeleteFileW(fresh.c_str());
        return false;
    }

    Log("installed %s, it starts the next time the program is started", version.c_str());
    return true;
}

static Result CheckOnce() {
    std::vector<uint8_t> body;
    DWORD status = 0;

    if (!Get(kFeedPath, 16 * 1024, body, status)) {
        Log("feed: cannot read it (http %lu, error %lu)", status, GetLastError());
        return Result::Failed;
    }

    upd::Feed feed;
    if (!upd::ParseFeed(std::string(body.begin(), body.end()), feed)) {
        Log("feed: it is not what was expected, ignored");
        return Result::Failed;
    }

    int order = upd::CompareVersions(feed.version, currentVersion);
    if (order != 1) {
        Log("feed: %s, this is %s, nothing to do", feed.version.c_str(), currentVersion.c_str());
        return Result::UpToDate;
    }

    Log("found %s (this is %s), downloading %llu bytes", feed.version.c_str(), currentVersion.c_str(), static_cast<unsigned long long>(feed.size));

    if (!Get(upd::UrlPath(feed.url), feed.size, body, status)) {
        Log("download: failed (http %lu, error %lu)", status, GetLastError());
        return Result::Failed;
    }
    if (body.size() != feed.size) {
        Log("download: %llu bytes instead of %llu, dropped", static_cast<unsigned long long>(body.size()), static_cast<unsigned long long>(feed.size));
        return Result::Failed;
    }
    if (upd::Sha256Hex(body.data(), body.size()) != feed.sha256) {
        Log("download: the SHA-256 does not match the feed, dropped");
        return Result::Failed;
    }
    if (!upd::IsWindowsX64Program(body.data(), body.size())) {
        Log("download: not a 64-bit Windows program, dropped");
        return Result::Failed;
    }

    if (!Install(body, feed.version)) return Result::Failed;

    wchar_t* version = new wchar_t[feed.version.size() + 1];
    std::wstring wide = Widen(feed.version);
    wcscpy(version, wide.c_str());
    if (!PostMessageW(window, kInstalledMessage, 0, reinterpret_cast<LPARAM>(version))) delete[] version;
    return Result::Installed;
}

static DWORD WINAPI Worker(LPVOID) {
    Sleep(kFirstCheckDelayMs);
    for (;;) {
        Result result = CheckOnce();
        if (result == Result::Installed) return 0;
        Sleep(result == Result::Failed ? kRetryIntervalMs : kCheckIntervalMs);
    }
}

// folder: %LOCALAPPDATA%\UltraYT Lite (exists by now)
static void Start(HWND mainWindow, const std::wstring& folder, const char* version) {
    window = mainWindow;
    currentVersion = version;
    logPath = folder + L"\\update.log";

    // the log stays small, and a leftover of an interrupted update is not kept
    WIN32_FILE_ATTRIBUTE_DATA info;
    if (GetFileAttributesExW(logPath.c_str(), GetFileExInfoStandard, &info) && info.nFileSizeLow > 64 * 1024) DeleteFileW(logPath.c_str());

    wchar_t buffer[2048];
    DWORD length = GetModuleFileNameW(nullptr, buffer, 2040);
    if (length > 0 && length < 2040) DeleteFileW((std::wstring(buffer) + L".new").c_str());

    HANDLE thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr);
    if (thread) CloseHandle(thread);
    else Log("cannot start the update thread (error %lu)", GetLastError());
}

} // namespace updater
