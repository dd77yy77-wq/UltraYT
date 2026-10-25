#!/usr/bin/env bash
# Publishes the built lite/UltraYT-Lite.exe as an update that the installed copies pick up by themselves.
#
#   lite/build.sh
#   lite/tools/release.sh "what changed, one short line without quotes"
#   git add lite && git commit && git push
#
# It copies the program to lite/dist/UltraYT-Lite-<version>.exe (the last three are kept) and writes lite/version.json,
# the feed that the program reads: version, address, SHA-256, size. The version is the one in src/main.cpp (LITE_VERSION_A);
# it has to be raised before building, otherwise nobody sees an update.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
NOTES="${1:-}"
EXE="$HERE/UltraYT-Lite.exe"

VERSION="$(sed -n 's/^#define LITE_VERSION_A "\([0-9.]*\)"$/\1/p' "$HERE/src/main.cpp")"
[ -n "$VERSION" ] || { echo "cannot find LITE_VERSION_A in src/main.cpp" >&2; exit 1; }
[ -f "$EXE" ] || { echo "$EXE is not built, run lite/build.sh first" >&2; exit 1; }

python3 - "$HERE" "$EXE" "$VERSION" "$NOTES" <<'PY'
import hashlib, json, os, re, sys, glob, shutil, datetime

here, exe, version, notes = sys.argv[1:5]
data = open(exe, 'rb').read()

# the program has to be the one the version says (a stale build would be installed again and again)
marker = ('/%s (UltraYT, Windows)' % version).encode('utf-16-le')
if marker not in data:
    sys.exit('%s does not contain version %s, build it again' % (exe, version))
if data[:2] != b'MZ':
    sys.exit('not a Windows program')
if re.search(r'["\\\\]', notes):
    sys.exit('the note must not contain quotes or backslashes')

dist = os.path.join(here, 'dist')
os.makedirs(dist, exist_ok=True)
name = 'UltraYT-Lite-%s.exe' % version
shutil.copyfile(exe, os.path.join(dist, name))

feed = {
    'version': version,
    'url': 'https://raw.githubusercontent.com/dd77yy77-wq/UltraYT/main/lite/dist/' + name,
    'sha256': hashlib.sha256(data).hexdigest(),
    'size': len(data),
    'released': datetime.date.today().isoformat(),
    'notes': notes,
}
with open(os.path.join(here, 'version.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(feed, f, indent=2, ensure_ascii=False)
    f.write('\n')

# keep the newest three
def key(path):
    return tuple(int(x) for x in re.findall(r'\d+', os.path.basename(path)))
files = sorted(glob.glob(os.path.join(dist, 'UltraYT-Lite-*.exe')), key=key)
for old in files[:-3]:
    os.remove(old)

print('version %s, %d bytes, sha256 %s' % (version, len(data), feed['sha256']))
PY
