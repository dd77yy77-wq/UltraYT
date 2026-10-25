/*
 * UltraYT single-file launcher.
 * The program (Electron + app) is a zip appended to this exe. On the first run it is unpacked to
 * %LOCALAPPDATA%\UltraYT\app (shows a small progress window), later runs start right away.
 */
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <stdio.h>
#include <stdarg.h>
#include "unzipcore.h"

#define INNER_EXE L"UltraYT.exe"
#define ID_FILE L".payload-id"

static uz_zip g_zip;
static wchar_t g_target[MAX_PATH * 2];
static wchar_t g_tmp[MAX_PATH * 2];
static wchar_t g_error[600];
static HWND g_wnd;

/* ------------------------------------------------------------ helpers */

static void rmtree(const wchar_t *dir) {
    wchar_t pattern[MAX_PATH * 2];
    swprintf(pattern, MAX_PATH * 2, L"%ls\\*", dir);

    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(pattern, &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
            wchar_t child[MAX_PATH * 2];
            swprintf(child, MAX_PATH * 2, L"%ls\\%ls", dir, fd.cFileName);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                rmtree(child);
            } else {
                SetFileAttributesW(child, FILE_ATTRIBUTE_NORMAL);
                DeleteFileW(child);
            }
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    RemoveDirectoryW(dir);
}

static void mkdirs(const wchar_t *path) {
    wchar_t buf[MAX_PATH * 2];
    wcsncpy(buf, path, MAX_PATH * 2 - 1);
    buf[MAX_PATH * 2 - 1] = 0;
    for (wchar_t *p = buf + 3; *p; p++) {
        if (*p == L'\\') { *p = 0; CreateDirectoryW(buf, NULL); *p = L'\\'; }
    }
    CreateDirectoryW(buf, NULL);
}

static int write_all(HANDLE f, const unsigned char *data, size_t size) {
    while (size) {
        DWORD chunk = size > (64u << 20) ? (64u << 20) : (DWORD)size;
        DWORD written = 0;
        if (!WriteFile(f, data, chunk, &written, NULL) || written != chunk) return 0;
        data += chunk;
        size -= chunk;
    }
    return 1;
}

static int read_id(const wchar_t *dir, char *out, size_t cap) {
    wchar_t path[MAX_PATH * 2];
    swprintf(path, MAX_PATH * 2, L"%ls\\%ls", dir, ID_FILE);
    HANDLE f = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (f == INVALID_HANDLE_VALUE) return 0;
    DWORD n = 0;
    BOOL ok = ReadFile(f, out, (DWORD)cap - 1, &n, NULL);
    CloseHandle(f);
    if (!ok) return 0;
    out[n] = 0;
    return 1;
}

static void fail(const wchar_t *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vswprintf(g_error, 600, fmt, ap);
    va_end(ap);
}

/* ------------------------------------------------------------- worker */

static DWORD WINAPI worker(LPVOID param) {
    const char *id = (const char *)param;

    rmtree(g_tmp);
    mkdirs(g_tmp);

    const unsigned char *p = g_zip.cd;
    for (uint32_t i = 0; i < g_zip.count; i++) {
        uz_entry e;
        const unsigned char *next = uz_entry_at(&g_zip, p, &e);
        if (!next) { fail(L"Файл программы повреждён (оглавление)."); goto bad; }
        p = next;

        wchar_t rel[MAX_PATH * 2];
        int n = MultiByteToWideChar(CP_UTF8, 0, (const char *)e.name, (int)e.name_len, rel, MAX_PATH * 2 - 2);
        if (n <= 0) { fail(L"Файл программы повреждён (имя файла)."); goto bad; }
        rel[n] = 0;
        for (wchar_t *c = rel; *c; c++) if (*c == L'/') *c = L'\\';
        if (wcsstr(rel, L"..") || rel[0] == L'\\' || (n > 1 && rel[1] == L':')) { fail(L"Небезопасное имя файла в архиве."); goto bad; }

        wchar_t full[MAX_PATH * 2];
        swprintf(full, MAX_PATH * 2, L"%ls\\%ls", g_tmp, rel);

        if (rel[n - 1] == L'\\') { mkdirs(full); continue; }

        wchar_t parent[MAX_PATH * 2];
        wcscpy(parent, full);
        wchar_t *slash = wcsrchr(parent, L'\\');
        if (slash) { *slash = 0; mkdirs(parent); }

        unsigned char *buf = e.usize ? (unsigned char *)VirtualAlloc(NULL, e.usize, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE) : NULL;
        if (e.usize && !buf) { fail(L"Не хватает памяти для распаковки."); goto bad; }
        int rc = e.usize ? uz_extract(&g_zip, &e, buf) : 0;
        if (rc) {
            if (buf) VirtualFree(buf, 0, MEM_RELEASE);
            fail(rc == -2 ? L"Контрольная сумма файла не совпала. Файл UltraYT.exe повреждён, скачайте его заново." : L"Не удалось распаковать файл из архива.");
            goto bad;
        }

        HANDLE f = CreateFileW(full, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        int ok = f != INVALID_HANDLE_VALUE && write_all(f, buf, e.usize);
        if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
        if (buf) VirtualFree(buf, 0, MEM_RELEASE);
        if (!ok) { fail(L"Не удалось записать файл на диск (возможно, нет места): %ls", rel); goto bad; }
    }

    {
        wchar_t idpath[MAX_PATH * 2];
        swprintf(idpath, MAX_PATH * 2, L"%ls\\%ls", g_tmp, ID_FILE);
        HANDLE f = CreateFileW(idpath, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (f == INVALID_HANDLE_VALUE || !write_all(f, (const unsigned char *)id, strlen(id))) {
            if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
            fail(L"Не удалось записать служебный файл.");
            goto bad;
        }
        CloseHandle(f);
    }

    rmtree(g_target);
    if (GetFileAttributesW(g_target) != INVALID_FILE_ATTRIBUTES) {
        fail(L"Не удалось заменить старую версию. Закройте UltraYT (проверьте диспетчер задач) и запустите снова.");
        goto bad;
    }
    if (!MoveFileExW(g_tmp, g_target, 0)) {
        fail(L"Не удалось завершить установку файлов (ошибка %lu).", GetLastError());
        goto bad;
    }
    return 0;

bad:
    rmtree(g_tmp);
    return 1;
}

/* ------------------------------------------------------------- window */

static LRESULT CALLBACK wndproc(HWND h, UINT m, WPARAM w, LPARAM l) {
    if (m == WM_CLOSE) return 0; /* can't be closed halfway through unpacking */
    return DefWindowProcW(h, m, w, l);
}

static void make_window(HINSTANCE inst) {
    INITCOMMONCONTROLSEX icc = { sizeof icc, ICC_PROGRESS_CLASS };
    InitCommonControlsEx(&icc);

    WNDCLASSW wc = { 0 };
    wc.lpfnWndProc = wndproc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    wc.lpszClassName = L"UltraYTSetup";
    RegisterClassW(&wc);

    int w = 460, h = 150;
    int x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
    int y = (GetSystemMetrics(SM_CYSCREEN) - h) / 2;
    g_wnd = CreateWindowExW(WS_EX_TOPMOST, L"UltraYTSetup", L"UltraYT", WS_POPUP | WS_CAPTION, x, y, w, h, NULL, NULL, inst, NULL);

    HFONT font = (HFONT)GetStockObject(DEFAULT_GUI_FONT);
    HWND label = CreateWindowW(L"STATIC",
        L"Первый запуск: распаковываю файлы программы.\nЭто нужно только один раз, займёт меньше минуты.",
        WS_CHILD | WS_VISIBLE, 20, 18, 410, 44, g_wnd, NULL, inst, NULL);
    SendMessageW(label, WM_SETFONT, (WPARAM)font, TRUE);

    HWND bar = CreateWindowW(PROGRESS_CLASSW, NULL, WS_CHILD | WS_VISIBLE | 0x08 /* PBS_MARQUEE */, 20, 74, 410, 18, g_wnd, NULL, inst, NULL);
    SendMessageW(bar, WM_USER + 10 /* PBM_SETMARQUEE */, TRUE, 30);

    ShowWindow(g_wnd, SW_SHOW);
    UpdateWindow(g_wnd);
}

/* -------------------------------------------------------------- main */

static const wchar_t *args_tail(const wchar_t *cmd) {
    if (*cmd == L'"') {
        cmd++;
        while (*cmd && *cmd != L'"') cmd++;
        if (*cmd) cmd++;
    } else {
        while (*cmd && *cmd != L' ' && *cmd != L'\t') cmd++;
    }
    while (*cmd == L' ' || *cmd == L'\t') cmd++;
    return cmd;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, LPWSTR cmdline, int show) {
    (void)prev; (void)cmdline; (void)show;

    wchar_t self[MAX_PATH * 2];
    GetModuleFileNameW(NULL, self, MAX_PATH * 2);

    HANDLE file = CreateFileW(self, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    LARGE_INTEGER size = { 0 };
    if (file != INVALID_HANDLE_VALUE) GetFileSizeEx(file, &size);
    HANDLE mapping = file != INVALID_HANDLE_VALUE ? CreateFileMappingW(file, NULL, PAGE_READONLY, 0, 0, NULL) : NULL;
    const unsigned char *data = mapping ? (const unsigned char *)MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0) : NULL;
    if (!data || uz_open(&g_zip, data, (uint64_t)size.QuadPart)) {
        MessageBoxW(NULL, L"Не удалось прочитать данные внутри UltraYT.exe. Файл неполный или повреждён, скачайте его заново.", L"UltraYT", MB_ICONERROR);
        return 1;
    }

    char id[32];
    snprintf(id, sizeof id, "%08x%08x", g_zip.id_a, g_zip.id_b);

    wchar_t root[MAX_PATH * 2];
    DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", root, MAX_PATH);
    if (!n || n >= MAX_PATH) { GetTempPathW(MAX_PATH, root); wcscat(root, L"UltraYT"); } else { wcscat(root, L"\\UltraYT"); }
    swprintf(g_target, MAX_PATH * 2, L"%ls\\app", root);
    swprintf(g_tmp, MAX_PATH * 2, L"%ls\\app.new", root);

    wchar_t inner[MAX_PATH * 2];
    swprintf(inner, MAX_PATH * 2, L"%ls\\%ls", g_target, INNER_EXE);

    char have[32] = { 0 };
    int ready = GetFileAttributesW(inner) != INVALID_FILE_ATTRIBUTES && read_id(g_target, have, sizeof have) && !strcmp(have, id);

    if (!ready) {
        mkdirs(root);
        make_window(inst);

        HANDLE th = CreateThread(NULL, 0, worker, id, 0, NULL);
        if (!th) { MessageBoxW(NULL, L"Не удалось запустить распаковку.", L"UltraYT", MB_ICONERROR); return 1; }

        for (;;) {
            DWORD r = MsgWaitForMultipleObjects(1, &th, FALSE, INFINITE, QS_ALLINPUT);
            if (r == WAIT_OBJECT_0) break;
            MSG msg;
            while (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
        DWORD code = 1;
        GetExitCodeThread(th, &code);
        CloseHandle(th);
        DestroyWindow(g_wnd);

        if (code) {
            MessageBoxW(NULL, g_error[0] ? g_error : L"Не удалось распаковать программу.", L"UltraYT", MB_ICONERROR);
            return 1;
        }
    }

    UnmapViewOfFile(data);
    CloseHandle(mapping);
    CloseHandle(file);

    wchar_t command[MAX_PATH * 4];
    swprintf(command, MAX_PATH * 4, L"\"%ls\" %ls", inner, args_tail(GetCommandLineW()));

    STARTUPINFOW si = { sizeof si };
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, command, NULL, NULL, FALSE, 0, NULL, g_target, &si, &pi)) {
        wchar_t msg[300];
        swprintf(msg, 300, L"Не удалось запустить UltraYT (ошибка %lu). Возможно, файл заблокировал антивирус.", GetLastError());
        MessageBoxW(NULL, msg, L"UltraYT", MB_ICONERROR);
        return 1;
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return 0;
}
