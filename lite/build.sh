#!/usr/bin/env bash
# Builds UltraYT-Lite.exe (Windows x64) on Linux or macOS.
# Needs the llvm-mingw toolchain (x86_64-w64-mingw32-clang++, -windres) on PATH. Nothing is downloaded.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
mkdir -p "$OUT"

# the page script becomes a wide string constant inside the program
{
  printf 'static const wchar_t kInjectScript[] = LR"__JS__(\n'
  cat "$HERE/src/inject.js"
  printf '\n)__JS__";\n'
} > "$OUT/inject_js.h"

(cd "$HERE/res" && x86_64-w64-mingw32-windres lite.rc -O coff -o "$OUT/lite.res")

x86_64-w64-mingw32-clang++ -std=c++20 -O2 -Wall -Wno-unused-parameter -municode -mwindows -static -s \
  -I"$HERE/third_party/webview2" -I"$HERE/third_party/loader" -I"$OUT" \
  "$HERE/src/main.cpp" "$HERE/third_party/loader/WebView2Loader.cpp" "$OUT/lite.res" \
  -o "$HERE/${OUT_NAME:-UltraYT-Lite.exe}" \
  -lole32 -lshell32 -luser32 -lgdi32 -ladvapi32 -lversion -loleaut32 -luuid
echo "done: $HERE/${OUT_NAME:-UltraYT-Lite.exe}"
