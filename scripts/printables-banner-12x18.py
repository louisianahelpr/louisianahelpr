#!/usr/bin/env python3
"""
The Thanksgiving banner's print-ready 12 x 18 in (3:2) copy (owner 2026-11-21, relayed by the lead: "Print it at
Walgreens"; Walgreens posters come 11x14, 12x18, 16x20, 20x30 and 24x36, no 2:1 size). The owner's 2:1 design
(happy-thanksgiving-banner.jpg, 2800 x 1400) is placed untouched, centered, on its own white (the light gingham cells
at its top edge measure 255,255,255), padded top and bottom to 2800 x 1867, its full resolution (no upscale: it adds
no detail). JPEG quality 74 keeps it under the repo's 300 KB public asset cap (src/test/publicAssetsUnderCap.test.ts);
a 5400 x 3600 copy measured 585-948 KB. The original 2:1 file stays.

Usage: python3 scripts/printables-banner-12x18.py
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, "public", "printables", "thanksgiving-banner")
src = Image.open(os.path.join(DIR, "happy-thanksgiving-banner.jpg")).convert("RGB")
W = src.width
H = round(W * 2 / 3)
out = Image.new("RGB", (W, H), (255, 255, 255))
out.paste(src, (0, (H - src.height) // 2))
path = os.path.join(DIR, "happy-thanksgiving-banner-12x18.jpg")
out.save(path, "JPEG", quality=74, optimize=True, progressive=True, subsampling=2, dpi=(round(W / 18), round(W / 18)))
print(path, out.size, os.path.getsize(path) // 1024, "KB")
