#!/usr/bin/env bash
# Builds the single-file UltraYT.exe (Windows x64) on Linux or macOS.
# Needs: curl, unzip, python3 and the llvm-mingw toolchain (x86_64-w64-mingw32-clang, -windres) on PATH.
# Electron is downloaded from its official GitHub release and checked against the published checksum.
set -euo pipefail

ELECTRON=44.5.1
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/out"
rm -rf "$OUT"; mkdir -p "$OUT/UltraYT"

ZIP="electron-v$ELECTRON-win32-x64.zip"
BASE="https://github.com/electron/electron/releases/download/v$ELECTRON"
curl -fsSL -o "$OUT/$ZIP" "$BASE/$ZIP"
curl -fsSL -o "$OUT/SHASUMS256.txt" "$BASE/SHASUMS256.txt"
(cd "$OUT" && grep " \*$ZIP\$" SHASUMS256.txt | sha256sum -c -)

unzip -q "$OUT/$ZIP" -d "$OUT/UltraYT"
rm -f "$OUT/UltraYT/resources/default_app.asar"

# Optional: DROP_FILES="dxcompiler.dll dxil.dll" leaves these Chromium files out (they are only used for WebGPU), OUT_NAME sets the exe's name
for f in ${DROP_FILES:-}; do rm -f "$OUT/UltraYT/$f"; done

# Chromium's own interface languages: keep English (required) and Russian, drop the other ~50 (about 46 MB unpacked)
KEEP_LOCALES="en-US ru"
for pak in "$OUT/UltraYT/locales/"*.pak; do
  case " $KEEP_LOCALES " in *" $(basename "$pak" .pak) "*) ;; *) rm -f "$pak" ;; esac
done
APP="$OUT/UltraYT/resources/app"
mkdir -p "$APP/node_modules"
cp -r "$HERE/src" "$HERE/locale" "$HERE/assets" "$HERE/LICENSE" "$APP/"
python3 - "$HERE/package.json" "$APP/package.json" <<'PY'
import json, sys
p = json.load(open(sys.argv[1], encoding='utf-8'))
keep = ('name', 'version', 'description', 'main', 'license', 'author')
json.dump({k: p[k] for k in keep if k in p}, open(sys.argv[2], 'w', encoding='utf-8'), indent=4, ensure_ascii=False)
PY
cp -r "$HERE/shims/"* "$APP/node_modules/"
mv "$OUT/UltraYT/electron.exe" "$OUT/UltraYT/UltraYT.exe"
python3 "$HERE/launcher/pack_payload.py" "$OUT/UltraYT" "$OUT/payload.zip"  # LZMA, takes a few minutes

cd "$HERE/launcher"
x86_64-w64-mingw32-windres stub.rc -O coff -o "$OUT/stub.res"
x86_64-w64-mingw32-clang -O2 -municode -mwindows -static -s -o "$OUT/stub.exe" stub.c "$OUT/stub.res" -lcomctl32 -luser32 -lkernel32
cat "$OUT/stub.exe" "$OUT/payload.zip" > "$HERE/${OUT_NAME:-UltraYT.exe}"
echo "done: $HERE/${OUT_NAME:-UltraYT.exe}"
