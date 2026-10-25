# UltraYT

YouTube in its TV / game-console interface as a Windows desktop app: controller and touch screen support, ad blocking, no SponsorBlock, small self-updates of the app code.
Built for handhelds such as the ROG Xbox Ally X.

## Run

Download `UltraYT.exe` (one file) and start it. The first launch unpacks the program into `%LOCALAPPDATA%\UltraYT\app` (about 370 MB, under a minute); after that it starts immediately.
Settings and your sign-in are stored in `%APPDATA%\UltraYT`. Press `R3` on the controller or `Ctrl+O` to open the settings.

## Updates

At startup (and from Settings → About) UltraYT reads `version.json` from this repository. If it lists a newer version, the small app-code bundle `updates/app-<version>.json.gz` (a few hundred KB) is downloaded, checked against the SHA-256 from the feed and stored in `%LOCALAPPDATA%\UltraYT\updates`. The new version starts the next time UltraYT is launched, or right away with "Restart and install". If a downloaded version fails to start or never loads a page in three launches in a row, it is dropped and the version inside `UltraYT.exe` runs instead. Automatic checks can be turned off in the settings.

Updates replace the app code only (`src`, `locale`, `assets`), not Electron itself. A new Electron version needs a new `UltraYT.exe`.
Whoever can write to this repository decides what the app runs, so keep the GitHub account protected (two-factor sign-in).

To publish an update: raise `version` in `package.json`, run `node tools/make-update.js --notes "what changed"` and push `version.json` and `updates/` to `main`.

## What is inside

- Ad blocking, DeArrow (honest titles and thumbnails), Return Dislikes, hide Shorts, no "Continue watching?" prompt
- Forced H.264, hardware decoding, resolution unlock, Super Resolution removal, low memory mode
- Game controller navigation and an on-screen touch overlay
- Fullscreen, borderless, always on top, pause on focus loss, custom CSS (userstyles)
- Optional extras: music mode, ultrawide layout, remaining time

## Build

`./build.sh` produces `UltraYT.exe` on Linux or macOS. It needs `curl`, `unzip`, `zip`, `python3` and the [llvm-mingw](https://github.com/mstorsjo/llvm-mingw) toolchain on `PATH`.
The exe is a small launcher (`launcher/`) with the Electron app appended as a zip. `shims/` holds minimal stand-ins for two npm packages so no package registry is needed.
Pushing a `v*` tag runs the same build on GitHub and attaches `UltraYT.exe` to the release.

## License

MIT, see `LICENSE`. UltraYT is derived from an MIT-licensed open-source project; its copyright notice is kept in `LICENSE` as the license requires.
