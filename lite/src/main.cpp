// UltraYT Lite: YouTube TV in a small native window, using the WebView2 runtime that comes with Windows 11.
// No browser engine is bundled, so the program is only a few hundred kilobytes.

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl/client.h>

#include <cstdio>
#include <cwchar>
#include <functional>
#include <string>

#include "WebView2.h"
#include "WebView2Loader.h"
#include "iids.h"
#include "inject_js.h" // kInjectScript, generated from src/inject.js by build.sh

using Microsoft::WRL::ComPtr;

#define LITE_VERSION L"0.2.0"

static const wchar_t kAppName[] = L"UltraYT Lite";
static const wchar_t kClassName[] = L"UltraYTLiteWindow";
static const wchar_t kMutexName[] = L"UltraYTLite.SingleInstance";
static const wchar_t kDesktopUrl[] = L"https://www.youtube.com/"; // the normal site, the default
static const wchar_t kTvUrl[] = L"https://www.youtube.com/tv";     // the TV interface, with --tv
static const wchar_t kRuntimeDownloadPage[] = L"https://go.microsoft.com/fwlink/p/?LinkId=2124703";

// ---------------------------------------------------------------------------------------------------- application state

struct App {
    HINSTANCE instance = nullptr;
    HWND window = nullptr;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;

    bool tvMode = false; // --tv: the TV interface with a TV user agent and gamepad keys instead of the normal site
    bool fullscreen = false;
    bool fullscreenBeforePage = false; // whether the window was already fullscreen when the page asked for fullscreen
    WINDOWPLACEMENT placement = {};
    LONG_PTR style = 0;
};

static App g;

// ------------------------------------------------------------------------------------------------------------ helpers

// a COM object that implements one of WebView2's "handler" interfaces (a single Invoke method) by calling a function
template <class Interface, class... Args>
class Callback final : public Interface {
public:
    using Function = std::function<HRESULT(Args...)>;

    static Interface* Make(Function function) { return new Callback(std::move(function)); }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
        if (!object) return E_POINTER;
        if (riid == IID_IUnknown || riid == InterfaceId<Interface>::value) {
            *object = static_cast<Interface*>(this);
            AddRef();
            return S_OK;
        }
        *object = nullptr;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references_); }

    ULONG STDMETHODCALLTYPE Release() override {
        ULONG left = InterlockedDecrement(&references_);
        if (left == 0) delete this;
        return left;
    }

    HRESULT STDMETHODCALLTYPE Invoke(Args... args) override { return function_(args...); }

private:
    explicit Callback(Function function) : function_(std::move(function)) {}

    Function function_;
    volatile LONG references_ = 1;
};

// the options passed when the WebView2 environment is created
class EnvironmentOptions final : public ICoreWebView2EnvironmentOptions {
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** object) override {
        if (!object) return E_POINTER;
        if (riid == IID_IUnknown || riid == InterfaceId<ICoreWebView2EnvironmentOptions>::value) {
            *object = static_cast<ICoreWebView2EnvironmentOptions*>(this);
            AddRef();
            return S_OK;
        }
        *object = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&references_); }
    ULONG STDMETHODCALLTYPE Release() override {
        ULONG left = InterlockedDecrement(&references_);
        if (left == 0) delete this;
        return left;
    }

    HRESULT STDMETHODCALLTYPE get_AdditionalBrowserArguments(LPWSTR* value) override { return Copy(arguments_, value); }
    HRESULT STDMETHODCALLTYPE put_AdditionalBrowserArguments(LPCWSTR value) override { arguments_ = value ? value : L""; return S_OK; }
    HRESULT STDMETHODCALLTYPE get_Language(LPWSTR* value) override { return Copy(language_, value); }
    HRESULT STDMETHODCALLTYPE put_Language(LPCWSTR value) override { language_ = value ? value : L""; return S_OK; }
    HRESULT STDMETHODCALLTYPE get_TargetCompatibleBrowserVersion(LPWSTR* value) override { return Copy(version_, value); }
    HRESULT STDMETHODCALLTYPE put_TargetCompatibleBrowserVersion(LPCWSTR value) override { version_ = value ? value : L""; return S_OK; }
    HRESULT STDMETHODCALLTYPE get_AllowSingleSignOnUsingOSPrimaryAccount(BOOL* allow) override {
        if (!allow) return E_POINTER;
        *allow = FALSE;
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE put_AllowSingleSignOnUsingOSPrimaryAccount(BOOL) override { return S_OK; }

    EnvironmentOptions() {
        // video has to start from a gamepad press, which the browser does not count as a user gesture
        arguments_ = L"--autoplay-policy=no-user-gesture-required";
        version_ = L"86.0.622.22"; // the oldest runtime this program needs
    }

private:
    static HRESULT Copy(const std::wstring& text, LPWSTR* value) {
        if (!value) return E_POINTER;
        if (text.empty()) {
            *value = nullptr;
            return S_OK;
        }
        size_t bytes = (text.size() + 1) * sizeof(wchar_t);
        *value = static_cast<LPWSTR>(CoTaskMemAlloc(bytes));
        if (!*value) return E_OUTOFMEMORY;
        memcpy(*value, text.c_str(), bytes);
        return S_OK;
    }

    std::wstring arguments_, language_, version_;
    volatile LONG references_ = 1;
};

static void ShowError(const wchar_t* what, HRESULT hr) {
    wchar_t text[640];
    swprintf(text, sizeof text / sizeof text[0], L"%ls\n\nКод ошибки: 0x%08X", what, static_cast<unsigned>(hr));
    MessageBoxW(g.window, text, kAppName, MB_ICONERROR | MB_OK);
}

// the host name of an http(s) address, lower case, or an empty string for anything else
static std::wstring HostOf(const std::wstring& uri) {
    size_t start;
    if (uri.rfind(L"https://", 0) == 0) start = 8;
    else if (uri.rfind(L"http://", 0) == 0) start = 7;
    else return L"";

    size_t end = uri.find_first_of(L"/:?#", start);
    std::wstring host = uri.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
    for (auto& c : host) c = static_cast<wchar_t>(towlower(c));
    return host;
}

static bool HostIs(const std::wstring& host, const wchar_t* domain) {
    size_t length = wcslen(domain);
    if (host.size() < length) return false;
    if (host.compare(host.size() - length, length, domain) != 0) return false;
    return host.size() == length || host[host.size() - length - 1] == L'.';
}

static bool IsGoogleHost(const std::wstring& host) {
    return HostIs(host, L"youtube.com") || HostIs(host, L"google.com") || HostIs(host, L"gstatic.com") || HostIs(host, L"googleapis.com") ||
           HostIs(host, L"googleusercontent.com") || HostIs(host, L"ytimg.com") || HostIs(host, L"ggpht.com");
}

// ----------------------------------------------------------------------------------------------------- window handling

static void ResizeWebView() {
    if (!g.controller) return;

    RECT bounds;
    GetClientRect(g.window, &bounds);
    g.controller->put_Bounds(bounds);
}

static void SetFullscreen(bool on) {
    if (on == g.fullscreen || !g.window) return;

    if (on) {
        g.placement.length = sizeof g.placement;
        GetWindowPlacement(g.window, &g.placement);
        g.style = GetWindowLongPtrW(g.window, GWL_STYLE);

        MONITORINFO monitor = { sizeof monitor };
        GetMonitorInfoW(MonitorFromWindow(g.window, MONITOR_DEFAULTTONEAREST), &monitor);

        SetWindowLongPtrW(g.window, GWL_STYLE, g.style & ~static_cast<LONG_PTR>(WS_OVERLAPPEDWINDOW));
        SetWindowPos(g.window, HWND_TOP, monitor.rcMonitor.left, monitor.rcMonitor.top, monitor.rcMonitor.right - monitor.rcMonitor.left,
                     monitor.rcMonitor.bottom - monitor.rcMonitor.top, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        SetWindowLongPtrW(g.window, GWL_STYLE, g.style);
        SetWindowPlacement(g.window, &g.placement);
        SetWindowPos(g.window, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }

    g.fullscreen = on;
}

static void FocusWebView() {
    if (g.controller) g.controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
        case WM_SIZE:
            ResizeWebView();
            return 0;
        case WM_SETFOCUS:
            FocusWebView();
            return 0;
        case WM_ACTIVATE:
            if (LOWORD(wparam) != WA_INACTIVE) FocusWebView();
            return 0;
        case WM_DPICHANGED: {
            const RECT* suggested = reinterpret_cast<const RECT*>(lparam);
            SetWindowPos(window, nullptr, suggested->left, suggested->top, suggested->right - suggested->left, suggested->bottom - suggested->top,
                         SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_CLOSE:
            DestroyWindow(window);
            return 0;
        case WM_DESTROY:
            if (g.controller) g.controller->Close();
            g.webview.Reset();
            g.controller.Reset();
            g.environment.Reset();
            PostQuitMessage(0);
            return 0;
    }

    return DefWindowProcW(window, message, wparam, lparam);
}

// --------------------------------------------------------------------------------------------------------------- webview

// what the TV apps (Cobalt) present to YouTube, which only lets "TV" clients into the leanback interface
static std::wstring UserAgentOverride() {
    SYSTEMTIME now;
    GetLocalTime(&now);

    std::wstring year = std::to_wstring(now.wYear);
    std::wstring userAgent =
        L"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Cobalt/27.lts.3.1040976-gold (unlike Gecko) v8/13.8.258.54-jit gles Starboard/18, "
        L"UltraYT_DESKTOP_x8664_" + year + L"/" LITE_VERSION L" (UltraYT, Windows) ultrayt.lite/" LITE_VERSION;

    return L"{\"userAgent\":\"" + userAgent +
           L"\",\"userAgentMetadata\":{\"brands\":[{\"brand\":\"UltraYT\",\"version\":\"27\"}],"
           L"\"fullVersionList\":[{\"brand\":\"UltraYT\",\"version\":\"27.lts.3\"}],\"fullVersion\":\"27.lts.3\","
           L"\"platform\":\"Starboard\",\"platformVersion\":\"\",\"architecture\":\"x86\",\"model\":\"\","
           L"\"mobile\":false,\"bitness\":\"64\",\"wow64\":false}}";
}

static void ConfigureSettings() {
    ComPtr<ICoreWebView2Settings> settings;
    if (FAILED(g.webview->get_Settings(&settings)) || !settings) return;

    // the normal site keeps the browser behaviour (right-click menu, zoom with Ctrl and the wheel), the TV interface does not need it
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_AreDefaultContextMenusEnabled(g.tvMode ? FALSE : TRUE);
    settings->put_IsZoomControlEnabled(g.tvMode ? FALSE : TRUE);
    settings->put_IsBuiltInErrorPageEnabled(TRUE);
    settings->put_AreDevToolsEnabled(TRUE); // F12 opens them, useful when something does not work
}

static void AddEventHandlers() {
    EventRegistrationToken token;

    // F11 and Alt+Enter: fullscreen, F12: developer tools
    auto keys = Callback<ICoreWebView2AcceleratorKeyPressedEventHandler, ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs*>::Make(
        [](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind;
            UINT key = 0;
            INT flags = 0;
            args->get_KeyEventKind(&kind);
            args->get_VirtualKey(&key);
            args->get_KeyEventLParam(&flags);

            if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) return S_OK;

            bool alt = (GetKeyState(VK_MENU) & 0x8000) != 0;
            bool repeat = (flags & (1 << 30)) != 0;

            if (key == VK_F11 || (key == VK_RETURN && alt)) {
                if (!repeat) SetFullscreen(!g.fullscreen);
                args->put_Handled(TRUE);
            } else if (key == VK_F12) {
                if (!repeat && g.webview) g.webview->OpenDevToolsWindow();
                args->put_Handled(TRUE);
            }
            return S_OK;
        });
    g.controller->add_AcceleratorKeyPressed(keys, &token);
    keys->Release();

    // the page asked for fullscreen (a video's fullscreen button)
    auto html = Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler, ICoreWebView2*, IUnknown*>::Make(
        [](ICoreWebView2* sender, IUnknown*) -> HRESULT {
            BOOL inPage = FALSE;
            sender->get_ContainsFullScreenElement(&inPage);

            if (inPage) {
                g.fullscreenBeforePage = g.fullscreen;
                SetFullscreen(true);
            } else if (!g.fullscreenBeforePage) {
                SetFullscreen(false);
            }
            return S_OK;
        });
    g.webview->add_ContainsFullScreenElementChanged(html, &token);
    html->Release();

    // links that want a new window: YouTube and Google pages stay in this window, other web links open in the browser
    auto popups = Callback<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs*>::Make(
        [](ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            LPWSTR raw = nullptr;
            args->put_Handled(TRUE);
            if (FAILED(args->get_Uri(&raw)) || !raw) return S_OK;

            std::wstring uri = raw;
            CoTaskMemFree(raw);

            std::wstring host = HostOf(uri);
            if (host.empty()) return S_OK; // not a web address, nothing is opened
            if (IsGoogleHost(host)) sender->Navigate(uri.c_str());
            else ShellExecuteW(nullptr, L"open", uri.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            return S_OK;
        });
    g.webview->add_NewWindowRequested(popups, &token);
    popups->Release();

    // the microphone is for voice search, everything else the page asks for is refused
    auto permissions = Callback<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs*>::Make(
        [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            args->get_PermissionKind(&kind);
            args->put_State(kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
            return S_OK;
        });
    g.webview->add_PermissionRequested(permissions, &token);
    permissions->Release();

    // a crashed page is reloaded, a dead browser process ends the program
    auto failures = Callback<ICoreWebView2ProcessFailedEventHandler, ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*>::Make(
        [](ICoreWebView2* sender, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_PROCESS_FAILED_KIND kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
            args->get_ProcessFailedKind(&kind);

            if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) {
                ShowError(L"Браузерный компонент WebView2 завершился. UltraYT Lite будет закрыт.", E_FAIL);
                PostMessageW(g.window, WM_CLOSE, 0, 0);
            } else {
                sender->Reload();
            }
            return S_OK;
        });
    g.webview->add_ProcessFailed(failures, &token);
    failures->Release();

    // window.close() from the page
    auto closing = Callback<ICoreWebView2WindowCloseRequestedEventHandler, ICoreWebView2*, IUnknown*>::Make([](ICoreWebView2*, IUnknown*) -> HRESULT {
        PostMessageW(g.window, WM_CLOSE, 0, 0);
        return S_OK;
    });
    g.webview->add_WindowCloseRequested(closing, &token);
    closing->Release();
}

// the normal site needs nothing extra: the WebView2 browser identifies itself as Edge, which YouTube and Google accept
// the TV interface needs the user agent first (it has to be in place before the first request), then the scripts, then the page
static void StartNavigation() {
    if (!g.tvMode) {
        g.webview->Navigate(kDesktopUrl);
        return;
    }

    std::wstring override = UserAgentOverride();

    auto afterUserAgent = Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler, HRESULT, LPCWSTR>::Make([](HRESULT result, LPCWSTR) -> HRESULT {
        if (FAILED(result)) ShowError(L"Не удалось задать идентификатор приложения для YouTube.", result);

        auto afterScript = Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, HRESULT, LPCWSTR>::Make(
            [](HRESULT scriptResult, LPCWSTR) -> HRESULT {
                if (FAILED(scriptResult)) ShowError(L"Не удалось подключить управление геймпадом.", scriptResult);

                g.webview->Navigate(kTvUrl);
                return S_OK;
            });
        g.webview->AddScriptToExecuteOnDocumentCreated(kInjectScript, afterScript);
        afterScript->Release();
        return S_OK;
    });

    HRESULT hr = g.webview->CallDevToolsProtocolMethod(L"Emulation.setUserAgentOverride", override.c_str(), afterUserAgent);
    afterUserAgent->Release();
    if (FAILED(hr)) ShowError(L"Не удалось запустить YouTube.", hr);
}

static HRESULT OnControllerCreated(HRESULT result, ICoreWebView2Controller* controller) {
    if (FAILED(result) || !controller) {
        ShowError(L"Не удалось создать окно WebView2.", FAILED(result) ? result : E_FAIL);
        PostMessageW(g.window, WM_CLOSE, 0, 0);
        return S_OK;
    }

    g.controller = controller;
    g.controller->get_CoreWebView2(&g.webview);
    if (!g.webview) {
        ShowError(L"WebView2 не вернул окно браузера.", E_FAIL);
        PostMessageW(g.window, WM_CLOSE, 0, 0);
        return S_OK;
    }

    ConfigureSettings();
    AddEventHandlers();
    g.controller->put_IsVisible(TRUE);
    ResizeWebView();
    FocusWebView();
    StartNavigation();
    return S_OK;
}

static HRESULT OnEnvironmentCreated(HRESULT result, ICoreWebView2Environment* environment) {
    if (FAILED(result) || !environment) {
        ShowError(L"Не удалось запустить WebView2.", FAILED(result) ? result : E_FAIL);
        PostMessageW(g.window, WM_CLOSE, 0, 0);
        return S_OK;
    }

    g.environment = environment;

    auto handler = Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT, ICoreWebView2Controller*>::Make(OnControllerCreated);
    HRESULT hr = g.environment->CreateCoreWebView2Controller(g.window, handler);
    handler->Release();

    if (FAILED(hr)) {
        ShowError(L"Не удалось создать окно WebView2.", hr);
        PostMessageW(g.window, WM_CLOSE, 0, 0);
    }
    return S_OK;
}

// true when the WebView2 runtime is installed; otherwise offers to open the page where Microsoft provides it
static bool EnsureRuntime() {
    LPWSTR version = nullptr;
    HRESULT hr = GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    bool found = SUCCEEDED(hr) && version != nullptr;
    if (version) CoTaskMemFree(version);
    if (found) return true;

    int answer = MessageBoxW(nullptr,
                             L"Для работы UltraYT Lite нужен компонент Microsoft Edge WebView2 Runtime, но он не найден.\n\n"
                             L"В Windows 11 он есть по умолчанию. Открыть страницу загрузки Microsoft?",
                             kAppName, MB_ICONQUESTION | MB_YESNO);
    if (answer == IDYES) ShellExecuteW(nullptr, L"open", kRuntimeDownloadPage, nullptr, nullptr, SW_SHOWNORMAL);
    return false;
}

static bool StartWebView() {
    wchar_t localAppData[MAX_PATH] = {};
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, SHGFP_TYPE_CURRENT, localAppData))) {
        ShowError(L"Не найдена папка для данных программы.", E_FAIL);
        return false;
    }

    std::wstring folder = std::wstring(localAppData) + L"\\UltraYT Lite";
    std::wstring data = folder + L"\\WebView2"; // sign-in and settings of the page live here
    SHCreateDirectoryExW(nullptr, data.c_str(), nullptr);

    auto options = new EnvironmentOptions();
    auto handler = Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT, ICoreWebView2Environment*>::Make(OnEnvironmentCreated);
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, data.c_str(), options, handler);
    handler->Release();
    options->Release();

    if (FAILED(hr)) {
        ShowError(L"Не удалось запустить WebView2.", hr);
        return false;
    }
    return true;
}

// ----------------------------------------------------------------------------------------------------------- entry point

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    // a second start only brings the first window to the front
    HANDLE mutex = CreateMutexW(nullptr, TRUE, kMutexName);
    if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(kClassName, nullptr);
        if (existing) {
            if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
        }
        return 0;
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        ShowError(L"Не удалось запустить программу.", hr);
        return 1;
    }

    if (!EnsureRuntime()) return 1;

    g.instance = instance;

    WNDCLASSEXW windowClass = { sizeof windowClass };
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = instance;
    windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    windowClass.hIconSm = windowClass.hIcon;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = CreateSolidBrush(RGB(0x28, 0x28, 0x28));
    windowClass.lpszClassName = kClassName;
    RegisterClassExW(&windowClass);

    g.window = CreateWindowExW(0, kClassName, kAppName, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1280, 720, nullptr, nullptr, instance, nullptr);
    if (!g.window) {
        ShowError(L"Не удалось создать окно.", HRESULT_FROM_WIN32(GetLastError()));
        return 1;
    }

    g.tvMode = wcsstr(GetCommandLineW(), L"--tv") != nullptr;
    bool startFullscreen = wcsstr(GetCommandLineW(), L"--fullscreen") != nullptr;
    ShowWindow(g.window, startFullscreen ? SW_SHOWNORMAL : SW_SHOWMAXIMIZED);
    if (startFullscreen) SetFullscreen(true);
    UpdateWindow(g.window);

    if (!StartWebView()) {
        DestroyWindow(g.window);
    }

    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    CoUninitialize();
    return static_cast<int>(message.wParam);
}
