# UltraYT Lite

YouTube in a small native Windows window: the normal youtube.com site by default, the TV interface with `--tv`. It uses the WebView2 runtime that is part of Windows 11, so no browser engine is bundled and the program is about 400 KB.

Status: early prototype. Works like a browser window without browser chrome: touch, mouse and keyboard as on youtube.com, the right-click menu, zoom with `Ctrl` + wheel, fullscreen (`F11`, `Alt+Enter` or the video's own button), developer tools (`F12`). Sign-in is kept in `%LOCALAPPDATA%\UltraYT Lite`.

Command line: `--fullscreen` starts in fullscreen, `--tv` opens the TV interface (`youtube.com/tv`) with a TV user agent and gamepad support (the gamepad script in `src/inject.js` is only used in this mode).

## Build

`./build.sh` on Linux or macOS, needs only the [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) toolchain on `PATH`. Nothing is downloaded.
`node --test test/gamepad.test.js` runs the gamepad script in Chromium (needs Playwright, skipped otherwise).

## Third-party code (`third_party/`)

- `webview2/WebView2.h` is the WebView2 SDK header from Microsoft (BSD license, see `LICENSE.txt`). One `#include` was changed to lower case for case-sensitive file systems.
- `loader/` is [OpenWebView2Loader](https://github.com/jchv/OpenWebView2Loader) by John Chadwick (ISC license, see `LICENSE.md`), a free reimplementation of `WebView2Loader`, linked into the program so no extra DLL is needed. Two `#include` names were changed to lower case.
