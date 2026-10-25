#!/usr/bin/env python3
"""Packs a folder into the zip that is appended to UltraYT.exe.

usage: pack_payload.py <folder> <output.zip>

Files are compressed with LZMA (zip method 14, 64 MB dictionary) and stored as they are when that does not help
(for example the .pak files, which are already compressed). The order, the timestamps and the compressor settings are fixed,
so the same folder always gives the same zip.
"""
import lzma
import os
import struct
import sys
import zlib

DICT_SIZE = 64 * 1024 * 1024
LC, LP, PB = 3, 0, 2
PROPS = struct.pack('<BI', (PB * 5 + LP) * 9 + LC, DICT_SIZE)
FILTERS = [{
    'id': lzma.FILTER_LZMA1, 'preset': 9, 'dict_size': DICT_SIZE, 'lc': LC, 'lp': LP, 'pb': PB,
    'mf': lzma.MF_BT4, 'nice_len': 273,
}]
DOS_TIME, DOS_DATE = 0, (0 << 9) | (1 << 5) | 1  # 1980-01-01 00:00:00
MIN_GAIN = 0.97  # LZMA is used only if the result is at most this share of the original


def lzma_stream(data):
    comp = lzma.LZMACompressor(lzma.FORMAT_RAW, filters=FILTERS)
    packed = comp.compress(data) + comp.flush()
    return struct.pack('<BBH', 9, 4, len(PROPS)) + PROPS + packed


def main(folder, output):
    entries = []
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        rel_root = os.path.relpath(root, folder).replace(os.sep, '/')
        if rel_root != '.':
            entries.append((rel_root + '/', None))
        for name in sorted(files):
            rel = name if rel_root == '.' else rel_root + '/' + name
            entries.append((rel, os.path.join(root, name)))
    entries.sort(key=lambda e: e[0])

    out = open(output, 'wb')
    central = []
    for name, path in entries:
        raw_name = name.encode('utf-8')
        data = b'' if path is None else open(path, 'rb').read()
        method, flags, payload = 0, 0x0800, data
        if data:
            packed = lzma_stream(data)
            if len(packed) <= len(data) * MIN_GAIN:
                method, flags, payload = 14, 0x0800 | 0x0002, packed  # bit 1: the stream ends with an end marker
        crc = zlib.crc32(data) & 0xFFFFFFFF
        offset = out.tell()
        version = 63 if method == 14 else 20
        out.write(struct.pack('<IHHHHHIIIHH', 0x04034B50, version, flags, method, DOS_TIME, DOS_DATE, crc, len(payload), len(data), len(raw_name), 0))
        out.write(raw_name)
        out.write(payload)
        central.append(struct.pack('<IHHHHHHIIIHHHHHII', 0x02014B50, (3 << 8) | version, version, flags, method, DOS_TIME, DOS_DATE, crc,
                                   len(payload), len(data), len(raw_name), 0, 0, 0, 0, (0o40755 << 16) if path is None else (0o100644 << 16), offset) + raw_name)
        print(f'{name}: {len(data)} -> {len(payload)}', file=sys.stderr) if len(data) > 1_000_000 else None

    start = out.tell()
    for record in central:
        out.write(record)
    size = out.tell() - start
    out.write(struct.pack('<IHHHHIIH', 0x06054B50, 0, 0, len(central), len(central), size, start, 0))
    out.close()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
