# UltraYT Lite

YouTube TV (the console / TV interface) in a small native Windows window. It uses the WebView2 runtime that is part of Windows 11, so no browser engine is bundled and the program is about 400 KB.

Status: first prototype (stage 1). Window, YouTube TV with a TV user agent, fullscreen (`F11` or `Alt+Enter`), gamepad support, developer tools (`F12`), sign-in is kept in `%LOCALAPPDATA%\UltraYT Lite`. Start it with `--fullscreen` to open in fullscreen.

## Build

`./build.sh` on Linux or macOS, needs only the [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) toolchain on `PATH`. Nothing is downloaded.
`node --test test/gamepad.test.js` runs the gamepad script in Chromium (needs Playwright, skipped otherwise).

## Third-party code (`third_party/`)

- `webview2/WebView2.h` is the WebView2 SDK header from Microsoft (BSD license, see `LICENSE.txt`). One `#include` was changed to lower case for case-sensitive file systems.
- `loader/` is [OpenWebView2Loader](https://github.com/jchv/OpenWebView2Loader) by John Chadwick (ISC license, see `LICENSE.md`), a free reimplementation of `WebView2Loader`, linked into the program so no extra DLL is needed. Two `#include` names were changed to lower case.
