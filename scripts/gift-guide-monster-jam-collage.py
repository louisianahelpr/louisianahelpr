"""The Monster Jam gift guide's Facebook collage (owner 2026-11-24: "lets put together a monster jam gift guide that i can
share on facebook"; she chose a ready-to-post picture collage as well as the site page, "with every item we can find").

Portrait 1080x1350 PNGs (Facebook's tallest feed shape) in the gift guide covers' holiday style: the Kids red gingham
(scripts/gift-guide-wide-og.py FAMILY "red"), a cream card with a thin red outline, the italic lead and the serif title,
LOUISIANA HELPR along the bottom (no logo: the page's profile picture carries it). Each item: its photo (a transparent
cutout where we have one; a store photo's white melts into the cream), a short name, its price ("was $X" crossed out
for a deal) and the store's name. NO AMAZON ITEMS (Facebook rule): the rows come from collageRows1124's rule in
scripts/giftGuideMonsterJam1124.mjs (store-amazon or an amazon.com / amzn.to link is left out), mirrored here and
checked two-way by src/test/giftGuideMonsterJam1124.test.tsx against the manifest this writes.

Writes <out>/monster-jam-guide-<n>.png and scripts/gift-guide-monster-jam-collage-1124.json (the ids on each picture).
Run with a Python that has Pillow and numpy:
  python scripts/gift-guide-monster-jam-collage.py ["<out dir>"]
"""
import json
import math
import os
import re
import sys
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
ROWS = json.load(open(os.path.join(ROOT, "scripts", "gift-guide-monster-jam-1124.json"), encoding="utf8"))["rows"]
MANIFEST = os.path.join(ROOT, "scripts", "gift-guide-monster-jam-collage-1124.json")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Desktop/Louisiana Helpr Work/Social and Pinterest/Monster-Jam-guide-1124")
GEN = next((d for d in [os.environ.get("GIFT_COVER_GEN") or "", os.path.expanduser("~/Desktop/Pin-cover-generator"),
                        os.path.expanduser("~/Desktop/Louisiana Helpr Work/Social and Pinterest/Pin-cover-generator")]
            if d and os.path.exists(os.path.join(d, "pin_covers.py"))), os.path.expanduser("~/Desktop/Pin-cover-generator"))
sys.path.insert(0, GEN)
import pin_covers as pc  # noqa: E402 - the owner's generator: same fonts, gingham and cream as every cover

PHOTO_CACHE = os.path.expanduser("~/.lh-shots/mj-guide-1124/src")
S = 2
W, H = 1080 * S, 1350 * S
RED = ((168, 36, 42), (222, 150, 148), (250, 247, 239))
ACC = (158, 59, 59)
STORE_NAMES = {"store-walmart": "Walmart", "store-target": "Target", "store-kohls": "Kohl's", "store-macys": "Macy's",
               "store-maisonette": "Maisonette", "store-wayfair": "Wayfair", "store-dsw": "DSW"}
MAX_PER_PICTURE = 9
COLS = 3


def is_amazon(r):
    host = urlparse(r["href"]).hostname or ""
    return r["store"] == "store-amazon" or host == "amazon.com" or host.endswith(".amazon.com") or host == "amzn.to"


# Names too long for two lines on a picture, said shorter (the site page keeps the full name).
SHORT = {
    "Smash and Bash Grave Digger Remote Control Truck 1:15": "Grave Digger Remote Control Truck",
    "Chomping Megalodon 1:15 Remote Control Truck": "Megalodon Remote Control Truck",
    "Racing Rivals Grave Digger vs. Spider-Man RC Set": "Racing Rivals Remote Control Set",
    "Supercharge Speedway Figure-8 Playset": "Speedway Figure-8 Track",
    "Mini Jams Megalodon Squid Takedown Playset": "Megalodon Squid Playset",
    "Grave Digger Monstruction 5\" Buildable Truck": "Grave Digger Build-a-Truck",
    "Monstruction Turbo Shift ThunderROARus 10\" Transforming Build": "ThunderROARus Build-a-Truck",
    "Kid Casters Monster Jam Youth Fishing Pole + Reel Combo": "Kids Fishing Pole + Reel",
    "Kid Casters Monster Jam Tackle Play Box": "Kids Tackle Box",
    "Hot Wheels Mutant Chaos Truck, Car + Slime": "Mutant Chaos Truck + Slime",
    "Hot Wheels Snake Slam Takedown Playset": "Snake Slam Playset",
    "Hot Wheels Mutant Chaos Loop Challenge Playset": "Mutant Chaos Loop Track",
    "1:64 Truck": "1:64 Truck (styles vary)",
}


def short_name(n):
    n = re.sub(r"\s*\([^)]*\)", "", n)
    n = re.sub(r"^Monster Jam\s+", "", n)
    n = n.replace("Hot Wheels Monster Trucks", "Hot Wheels").replace(" Die-Cast", "").replace(", 2-Piece", "").strip(" ,")
    return SHORT.get(n, n)


def money(v):
    return f"${v:.0f}" if abs(v - round(v)) < 0.005 else f"${v:.2f}"


def photo(r):
    img = r["image"]
    if img.startswith("https://www.louisianahelpr.com/"):
        return Image.open(os.path.join(PUB, img.split("louisianahelpr.com/", 1)[1])).convert("RGBA"), True
    p = os.path.join(PHOTO_CACHE, f"{r['id']}.jpg")
    if os.path.exists(p):
        return Image.open(p).convert("RGBA"), False
    raise SystemExit(f"no local photo for {r['id']} ({img}); add a cutout first")


def fit(p, w, h):
    bb = p.getbbox() or (0, 0, p.width, p.height)
    p = p.crop(bb)
    q = min(w / p.width, h / p.height)
    return p.resize((max(1, int(p.width * q)), max(1, int(p.height * q))), Image.LANCZOS)


def font(name, size, weight=None):
    f = pc.font(name, size)
    if weight:
        f.set_variation_by_axes([weight])
    return f


def wrap(d, text, f, width, max_lines=2):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while d.textlength(lines[-1] + "…", font=f) > width and " " in lines[-1]:
            lines[-1] = lines[-1].rsplit(" ", 1)[0]
        lines[-1] += "…"
    return lines


def picture(rows, n, total):
    im = pc.gingham(W, H, "red", c=42 * S, palettes={"red": RED}).convert("RGBA")
    m = 44 * S
    card = (m, m, W - m, H - m)
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((card[0], card[1] + 8 * S, card[2], card[3] + 8 * S), radius=28 * S, fill=255)
    im.paste(Image.new("RGBA", (W, H), (40, 30, 20, 255)), (0, 0), sh.filter(ImageFilter.GaussianBlur(12 * S)).point(lambda v: int(v * 0.22)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(card, radius=28 * S, fill=pc.CREAM)
    g = 16 * S
    d.rounded_rectangle((card[0] + g, card[1] + g, card[2] - g, card[3] - g), radius=20 * S, outline=ACC, width=2 * S)
    cx = W / 2
    d.text((cx, card[1] + 92 * S), "the", font=pc.font("CG-Italic.ttf", 50 * S), fill=ACC, anchor="mm")
    d.text((cx, card[1] + 160 * S), "Monster Jam Gift Guide", font=font("PlayfairDisplay.ttf", 66 * S, 600), fill=pc.INK, anchor="mm")
    sub = f"{n} of {total}" if total > 1 else ""
    dy = card[1] + 218 * S
    d.line([(cx - 60 * S, dy), (cx - 14 * S, dy)], fill=ACC, width=2 * S)
    d.line([(cx + 14 * S, dy), (cx + 60 * S, dy)], fill=ACC, width=2 * S)
    d.polygon([(cx, dy - 7 * S), (cx + 7 * S, dy), (cx, dy + 7 * S), (cx - 7 * S, dy)], fill=ACC)
    # The grid: 3 across, rows centred; a short last row sits centred too.
    top, bottom = card[1] + 250 * S, card[3] - 96 * S
    left, right = card[0] + 40 * S, card[2] - 40 * S
    nrows = math.ceil(len(rows) / COLS)
    cw, ch = (right - left) / COLS, (bottom - top) / nrows
    nf = font("Montserrat.ttf", 25 * S, 600)
    pf = font("PlayfairDisplay.ttf", 38 * S, 700)
    wf = font("Montserrat.ttf", 23 * S, 500)
    sf = font("Montserrat.ttf", 19 * S, 600)
    for i, r in enumerate(rows):
        row, col = divmod(i, COLS)
        in_row = min(COLS, len(rows) - row * COLS)
        x0 = left + (right - left - in_row * cw) / 2 + col * cw
        y0 = top + row * ch
        ph_h = ch - 150 * S
        p, cut = photo(r)
        p = fit(p, cw - 40 * S, ph_h - 10 * S)
        px, py = int(x0 + (cw - p.width) / 2), int(y0 + (ph_h - p.height) / 2 + 6 * S)
        if cut:
            sd = Image.new("RGBA", (p.width + 60 * S, p.height + 60 * S), (0, 0, 0, 0))
            blk = Image.new("RGBA", p.size, (40, 30, 20, 255))
            blk.putalpha(p.split()[3].point(lambda v: int(v * 0.22)))
            sd.paste(blk, (30 * S + 3 * S, 30 * S + 7 * S), blk)
            sd = sd.filter(ImageFilter.GaussianBlur(7 * S))
            im.paste(sd, (px - 30 * S, py - 30 * S), sd)
            im.paste(p, (px, py), p)
        else:
            # A store photo on white: multiply it onto the cream so its white box disappears.
            region = im.crop((px, py, px + p.width, py + p.height)).convert("RGB")
            from PIL import ImageChops
            mixed = ImageChops.multiply(region, p.convert("RGB"))
            im.paste(mixed, (px, py))
        d = ImageDraw.Draw(im)
        ty = y0 + ph_h + 6 * S
        for k, line in enumerate(wrap(d, short_name(r["name"]), nf, cw - 24 * S)):
            d.text((x0 + cw / 2, ty + k * 31 * S), line, font=nf, fill=pc.INK, anchor="mt")
        py2 = ty + 70 * S
        price = money(r["price"])
        if r.get("was") and r["was"] > r["price"] + 0.005:
            was = f"was {money(r['was'])}"
            wp, ww = d.textlength(price, font=pf), d.textlength(was, font=wf)
            gap = 12 * S
            sx = x0 + cw / 2 - (wp + gap + ww) / 2
            d.text((sx, py2 + 26 * S), price, font=pf, fill=ACC, anchor="lm")
            wx = sx + wp + gap
            d.text((wx, py2 + 28 * S), was, font=wf, fill=(120, 108, 96), anchor="lm")
            # Strike only the old price, not the word "was".
            wl = d.textlength("was ", font=wf)
            d.line([(wx + wl, py2 + 29 * S), (wx + ww, py2 + 29 * S)], fill=(120, 108, 96), width=2 * S)
        else:
            d.text((x0 + cw / 2, py2 + 26 * S), price, font=pf, fill=ACC, anchor="mm")
        store = STORE_NAMES[r["store"]].upper()
        tracked_w = sum(sf.getlength(c) for c in store) + 2 * S * (len(store) - 1)
        sx = x0 + cw / 2 - tracked_w / 2
        for c in store:
            d.text((sx, py2 + 66 * S), c, font=sf, fill=(110, 98, 86), anchor="lm")
            sx += sf.getlength(c) + 2 * S
    ff = font("Montserrat.ttf", 26 * S, 600)
    foot = "LOUISIANA HELPR"
    tw = sum(ff.getlength(c) for c in foot) + 3 * S * (len(foot) - 1)
    x = cx - tw / 2
    fy = card[3] - 52 * S
    for c in foot:
        d.text((x, fy), c, font=ff, fill=pc.INK, anchor="lm")
        x += ff.getlength(c) + 3 * S
    if sub:
        d.text((card[2] - 44 * S, fy), sub, font=pc.font("CG-Italic.ttf", 30 * S), fill=ACC, anchor="rm")
    return im.convert("RGB").resize((1080, 1350), Image.LANCZOS)


def main():
    rows = [r for r in ROWS if not is_amazon(r)]
    total = max(1, math.ceil(len(rows) / MAX_PER_PICTURE))
    per = math.ceil(len(rows) / total)
    os.makedirs(OUT, exist_ok=True)
    pictures = []
    for n in range(total):
        part = rows[n * per:(n + 1) * per]
        name = f"monster-jam-guide-{n + 1}.png"
        picture(part, n + 1, total).save(os.path.join(OUT, name), optimize=True)
        pictures.append({"file": name, "ids": [r["id"] for r in part]})
        print(name, len(part))
    with open(MANIFEST, "w", encoding="utf8") as f:
        json.dump({"pictures": pictures}, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
