#!/usr/bin/env python3
"""
Adds one printable banner from the owner's Canva export (2:1, e.g. 6912 x 3456 PNG) to public/printables/<id>/,
the same three files the Thanksgiving banner ships (see scripts/printables-banner-12x18.py for why):
  <name>.jpg           the wide 2:1 design at 2800 x 1400
  <name>-12x18.jpg     the same design centered on white, padded to 3:2 (2800 x 1867) so a Walgreens 12x18 poster does not crop it
  preview.webp         640 x 320 card picture
Each JPEG is saved at the highest quality that stays under the repo's 300 KB public asset cap
(src/test/publicAssetsUnderCap.test.ts). Then add the card to src/content/printables.ts (after Thanksgiving, which stays first; then newest first).

Usage: python3 scripts/printables-banner-add.py <source.png> <id> <file-name>
  e.g. python3 scripts/printables-banner-add.py ~/Downloads/merry-christmas-plaid.png merry-christmas-plaid merry-christmas-plaid-banner
"""
import os
import sys

from PIL import Image

CAP = 299 * 1024
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def save_under_cap(img, path, dpi):
    for q in range(86, 40, -2):
        img.save(path, "JPEG", quality=q, optimize=True, progressive=True, subsampling=2, dpi=(dpi, dpi))
        if os.path.getsize(path) <= CAP:
            break
    print(path, img.size, os.path.getsize(path) // 1024, "KB q", q)


src_path, pid, name = sys.argv[1:4]
out_dir = os.path.join(ROOT, "public", "printables", pid)
os.makedirs(out_dir, exist_ok=True)
src = Image.open(src_path).convert("RGB")
W = 2800
wide = src.resize((W, W // 2), Image.LANCZOS)
save_under_cap(wide, os.path.join(out_dir, f"{name}.jpg"), round(W / 18))
H = round(W * 2 / 3)
tall = Image.new("RGB", (W, H), (255, 255, 255))
tall.paste(wide, (0, (H - wide.height) // 2))
save_under_cap(tall, os.path.join(out_dir, f"{name}-12x18.jpg"), round(W / 18))
prev = os.path.join(out_dir, "preview.webp")
src.resize((640, 320), Image.LANCZOS).save(prev, "WEBP", quality=80, method=6)
print(prev, os.path.getsize(prev) // 1024, "KB")
