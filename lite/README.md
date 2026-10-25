# UltraYT Lite

YouTube in a small native Windows window: the normal youtube.com site by default, the TV interface with `--tv`. It uses the WebView2 runtime that is part of Windows 11, so no browser engine is bundled and the program is about 400 KB.

Status: early prototype. Works like a browser window without browser chrome: touch, mouse and keyboard as on youtube.com, the right-click menu, zoom with `Ctrl` + wheel, fullscreen (`F11`, `Alt+Enter`, the video's own button or the large round button that `src/desktop.js` adds to the player next to the controls), developer tools (`F12`). The title bar is YouTube red (Windows 11). Sign-in is kept in `%LOCALAPPDATA%\UltraYT Lite`.

Command line: `--fullscreen` starts in fullscreen, `--tv` opens the TV interface (`youtube.com/tv`) with a TV user agent and gamepad support (the gamepad script in `src/inject.js` is only used in this mode).

## Build

`./build.sh` on Linux or macOS, needs only the [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) toolchain on `PATH`. Nothing is downloaded.
`node --test test/gamepad.test.js` runs the gamepad script in Chromium (needs Playwright, skipped otherwise).

## Third-party code (`third_party/`)

- `webview2/WebView2.h` is the WebView2 SDK header from Microsoft (BSD license, see `LICENSE.txt`). One `#include` was changed to lower case for case-sensitive file systems.
- `loader/` is [OpenWebView2Loader](https://github.com/jchv/OpenWebView2Loader) by John Chadwick (ISC license, see `LICENSE.md`), a free reimplementation of `WebView2Loader`, linked into the program so no extra DLL is needed. Two `#include` names were changed to lower case.

## Updates

The program updates itself. Twenty seconds after the start, and then every six hours, it reads `lite/version.json` from this repository
(version, address, SHA-256, size), and when the version is newer than its own it downloads `lite/dist/UltraYT-Lite-<version>.exe`, checks the size,
the SHA-256 and that it is a 64-bit Windows program, and swaps it in place of the running file. The old one stays next to it as `UltraYT-Lite.exe.old`
(a backup: rename it back if a new version misbehaves). The new version starts the next time the program is started, the window title says that it is ready.
What happens is written to `%LOCALAPPDATA%\UltraYT Lite\update.log`. `--no-update` turns the check off.

Only this project's files on `raw.githubusercontent.com` are accepted (`src/update_logic.h`), and the folder with the program has to be writable.

Publishing a version:

```
# raise LITE_VERSION_A in src/main.cpp and the numbers in res/lite.rc and res/lite.manifest
lite/build.sh
lite/tools/release.sh "what changed, one short line without quotes"
git add lite && git commit && git push
```

`node --test test/update-logic.test.js test/desktop.test.js test/gamepad.test.js` checks the update rules (versions, feed, addresses, SHA-256),
the feed that is published and the page scripts. The downloading and the swapping of the file (`src/updater.h`) can only be tried on Windows.

