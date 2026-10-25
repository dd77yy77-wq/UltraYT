# UltraYT

YouTube in its TV / game-console interface as a Windows desktop app: controller and touch screen support, ad blocking, no SponsorBlock, no automatic updates.
Built for handhelds such as the ROG Xbox Ally X.

## Run

Download `UltraYT.exe` (one file) and start it. The first launch unpacks the program into `%LOCALAPPDATA%\UltraYT\app` (about 370 MB, under a minute); after that it starts immediately.
Settings and your sign-in are stored in `%APPDATA%\UltraYT`. Press `R3` on the controller or `Ctrl+O` to open the settings.

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
