// Interface ids of the WebView2 interfaces this program implements itself, copied from WebView2.h.
// (mingw does not understand the uuid attributes of that header, so __uuidof cannot be used.)
#pragma once
#include <windows.h>

constexpr GUID ParseGuid(const char (&text)[37]) {
    auto digit = [](char c) -> unsigned { return c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10; };
    auto hex = [&](int from, int count) -> unsigned long long {
        unsigned long long value = 0;
        for (int i = 0; i < count; i++) value = value * 16 + digit(text[from + i]);
        return value;
    };
    return GUID{ static_cast<unsigned long>(hex(0, 8)), static_cast<unsigned short>(hex(9, 4)), static_cast<unsigned short>(hex(14, 4)),
                 { static_cast<unsigned char>(hex(19, 2)), static_cast<unsigned char>(hex(21, 2)), static_cast<unsigned char>(hex(24, 2)),
                   static_cast<unsigned char>(hex(26, 2)), static_cast<unsigned char>(hex(28, 2)), static_cast<unsigned char>(hex(30, 2)),
                   static_cast<unsigned char>(hex(32, 2)), static_cast<unsigned char>(hex(34, 2)) } };
}

template <class Interface>
struct InterfaceId;

#define LITE_INTERFACE_ID(type, text) \
    template <> struct InterfaceId<type> { static constexpr GUID value = ParseGuid(text); };

LITE_INTERFACE_ID(ICoreWebView2EnvironmentOptions, "2fde08a8-1e9a-4766-8c05-95a9ceb9d1c5")
LITE_INTERFACE_ID(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, "4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d")
LITE_INTERFACE_ID(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, "6c4819f3-c9b7-4260-8127-c9f5bde7f68c")
LITE_INTERFACE_ID(ICoreWebView2AcceleratorKeyPressedEventHandler, "b29c7e28-fa79-41a8-8e44-65811c76dcb2")
LITE_INTERFACE_ID(ICoreWebView2ContainsFullScreenElementChangedEventHandler, "e45d98b1-afef-45be-8baf-6c7728867f73")
LITE_INTERFACE_ID(ICoreWebView2NewWindowRequestedEventHandler, "d4c185fe-c81c-4989-97af-2d3fa7ab5651")
LITE_INTERFACE_ID(ICoreWebView2PermissionRequestedEventHandler, "15e1c6a3-c72a-4df3-91d7-d097fbec6bfd")
LITE_INTERFACE_ID(ICoreWebView2ProcessFailedEventHandler, "79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1")
LITE_INTERFACE_ID(ICoreWebView2WindowCloseRequestedEventHandler, "5c19e9e0-092f-486b-affa-ca8231913039")
LITE_INTERFACE_ID(ICoreWebView2CallDevToolsProtocolMethodCompletedHandler, "5c4889f0-5ef6-4c5a-952c-d8f1b92d0574")
LITE_INTERFACE_ID(ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler, "b99369f3-9b11-47b5-bc6f-8e7895fcea17")
