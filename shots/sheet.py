#!/usr/bin/env python3
"""Contact sheet: python3 sheet.py out.png a.png b.png ... (labels from filenames)."""
import sys
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).convert("RGB") for f in files]
scale = float(__import__("os").environ.get("SCALE", "0.6"))
ims = [im.resize((int(im.width * scale), int(im.height * scale))) for im in ims]
cols = int(__import__("os").environ.get("COLS", "4"))
w = max(im.width for im in ims); h = max(im.height for im in ims) + 18
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), "#888")
d = ImageDraw.Draw(sheet)
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), f.split("/")[-1][:60], fill="white")
sheet.save(out)
print(out, sheet.size)
