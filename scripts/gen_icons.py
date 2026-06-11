#!/usr/bin/env python3
"""Generate PNG icons (dark rounded square, red play triangle) for the PWA
and the extension. Pure stdlib so it runs anywhere: python3 scripts/gen_icons.py"""
import os
import struct
import zlib

BG = (22, 22, 28, 255)        # #16161c
ACCENT = (224, 68, 62, 255)   # #e0443e
CLEAR = (0, 0, 0, 0)


def make_icon(size):
    px = [[CLEAR] * size for _ in range(size)]
    radius = size * 0.18
    # rounded square background
    for y in range(size):
        for x in range(size):
            cx = min(max(x, radius), size - 1 - radius)
            cy = min(max(y, radius), size - 1 - radius)
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
                px[y][x] = BG
    # play triangle, slightly right of center like an ORP pivot
    left, right = size * 0.34, size * 0.74
    top, bottom = size * 0.28, size * 0.72
    for y in range(size):
        for x in range(size):
            if left <= x <= right and top <= y <= bottom:
                frac = (x - left) / (right - left)
                mid = size / 2
                half = (1 - frac) * (bottom - top) / 2
                if mid - half <= y <= mid + half:
                    px[y][x] = ACCENT
    return px


def write_png(path, px):
    size = len(px)
    raw = b''.join(
        b'\x00' + b''.join(struct.pack('4B', *p) for p in row) for row in px
    )
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    print(path)


root = os.path.join(os.path.dirname(__file__), '..')
for d, sizes in [('public/icons', (192, 512)), ('extension/icons', (16, 48, 128))]:
    os.makedirs(os.path.join(root, d), exist_ok=True)
    for s in sizes:
        write_png(os.path.join(root, d, f'icon-{s}.png'), make_icon(s))
