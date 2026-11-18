"""Gift guide photo covers (owner's pin_covers.py "cover2" layout, 11-18): six product cutouts, three a side, on cream
around a white arch holding the guide's lead, title and the LOUISIANA HELPR footer.

Run with a Python that has Pillow, numpy and scipy (not the repo's runtime; the covers are static files):
  python scripts/gift-guide-photo-covers.py [slug ...]
With no slugs it draws the By person, By budget, top By career and every By store guide. A guide with fewer than six
usable photos keeps its gingham/arch cover (the owner's, public/gift-guides/covers/<slug>.webp) untouched.

Photos: only each pick's own `image` from src/content/giftGuidePicks/<slug>.json, never an Amazon-hosted one (owner
chose the safe route; AMAZON_CDN_PHOTOS stays off). A photo is used only on a near-white background: the cutout keeps
pixels more than 26 off white, then the large connected parts (holes filled), so lifestyle shots are skipped.
Fonts: ~/Desktop/Pin-cover-generator/fonts (the owner's generator). Cache: $GIFT_COVER_CACHE or ~/.lh-shots/gg-cover-cache.
"""
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICKS = os.path.join(ROOT, "src", "content", "giftGuidePicks")
OUT = os.path.join(ROOT, "public", "gift-guides", "covers")
FONTS = os.path.expanduser("~/Desktop/Pin-cover-generator/fonts")
CACHE = os.environ.get("GIFT_COVER_CACHE", os.path.expanduser("~/.lh-shots/gg-cover-cache"))
INK, CREAM, WHITE = (56, 46, 36), (248, 245, 236), (255, 255, 255)
AMAZON = re.compile(r"(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon)\.com$")
S = 960  # drawn at 2x, saved at 480x480 like the owner's covers
TOP_CAREERS = 24  # the first By career guides in the index (its order is the owner's)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def index():
    src = open(os.path.join(ROOT, "src", "content", "giftGuideIndex.ts"), encoding="utf8").read()
    rows = re.findall(r'\{ group: "([^"]+)",[^}]*?slug: "([^"]+)", title: "([^"]+)", lead: "([^"]*)"([^}]*)\}', src)
    return [{"group": g, "slug": s, "title": t, "lead": l, "child": "parent:" in rest} for g, s, t, l, rest in rows]


def targets(rows):
    careers = [r for r in rows if r["group"] == "By career"][:TOP_CAREERS]
    return [r for r in rows if r["group"] in ("By person", "By budget", "By store")] + careers


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(path):
        data = open(path, "rb").read()
        return data or None
    data = b""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (cover builder)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(6_000_000)
    except Exception as e:  # noqa: BLE001 - a dead photo just isn't used; the cache remembers it as empty
        print(f"  skip {url[:90]}: {e}", file=sys.stderr)
    open(path, "wb").write(data)
    return data or None


def cutout(data):
    """The product on a near-white photo, as RGBA cropped to it; None for a photo that isn't on white."""
    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:  # noqa: BLE001 - not an image the browser would show either
        return None
    im.thumbnail((600, 600))
    a = np.asarray(im).astype(int)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    if (np.abs(255 - border).max(axis=1) <= 26).mean() < 0.85:
        return None  # not on white: a lifestyle shot
    fg = np.abs(255 - a).max(axis=2) > 26
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg)
    if n == 0:
        return None
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    fg = ndimage.binary_fill_holes(np.isin(lab, [i + 1 for i, v in enumerate(sizes) if v >= 0.04 * sizes.max()]))
    share = fg.mean()
    if share < 0.04 or share > 0.9:
        return None
    ys, xs = np.nonzero(fg)
    w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    if max(w, h) > 3 * min(w, h):
        return None  # a banner or badge ("HEATED"), not a product
    alpha = Image.fromarray((fg * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def photos(slug, need=6):
    try:
        picks = json.load(open(os.path.join(PICKS, f"{slug}.json"), encoding="utf8"))["picks"]
    except FileNotFoundError:
        return []
    urls, seen = [], set()
    for p in picks:
        u = p.get("image")
        if not u or not u.startswith("https://") or u in seen or AMAZON.search(urlparse(u).hostname or ""):
            continue
        # A store's own storefront pick (name == brand, "Bass Pro Shops") carries its logo, not a product.
        if (p.get("name") or "").strip().lower() == (p.get("brand") or "").strip().lower():
            continue
        seen.add(u)
        urls.append(u)
    got = []
    for start in range(0, min(len(urls), 30), 10):
        with ThreadPoolExecutor(6) as pool:
            for data in pool.map(fetch, urls[start:start + 10]):
                c = cutout(data) if data else None
                if c is not None:
                    got.append(c)
        if len(got) >= need:
            break
    return got[:need]


def even(p, m, frac=0.42):
    """Every product covers about the same area of an m x m box (cover2_example.even)."""
    area = (np.asarray(p.split()[3]) > 40).sum()
    r = (frac * m * m / max(area, 1)) ** 0.5
    w, h = p.width * r, p.height * r
    if max(w, h) > m * 1.1:
        q = m * 1.1 / max(w, h)
        w, h = w * q, h * q
    return p.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)


def shadow(p):
    s = Image.new("RGBA", (p.width + 30, p.height + 30), (0, 0, 0, 0))
    blk = Image.new("RGBA", p.size, (40, 30, 20, 255))
    blk.putalpha(p.split()[3].point(lambda v: int(v * 0.16)))
    s.paste(blk, (18, 21), blk)
    s = s.filter(ImageFilter.GaussianBlur(7))
    s.paste(p, (15, 15), p)
    return s


def wrap(d, text, f, width):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    return lines + [cur]


def tracked(d, cx, y, text, f, track):
    tw = sum(f.getlength(ch) for ch in text) + track * (len(text) - 1)
    x = cx - tw / 2
    for ch in text:
        d.text((x, y), ch, font=f, fill=INK, anchor="lm")
        x += f.getlength(ch) + track


def draw(row, prods, out):
    im = Image.new("RGB", (S, S), CREAM)
    d = ImageDraw.Draw(im)
    x0, x1, y0, y1 = 318, 642, 92, 868
    r = (x1 - x0) / 2
    d.pieslice([x0, y0, x1, y0 + 2 * r], 180, 360, fill=WHITE)
    d.rectangle([x0, y0 + r, x1, y1], fill=WHITE)
    d.arc([x0 + 12, y0 + 12, x1 - 12, y0 + 2 * r - 12], 180, 360, fill=INK, width=2)
    d.line([(x0 + 12, y0 + r), (x0 + 12, y1 - 12)], fill=INK, width=2)
    d.line([(x1 - 13, y0 + r), (x1 - 13, y1 - 12)], fill=INK, width=2)
    d.line([(x0 + 12, y1 - 13), (x1 - 12, y1 - 13)], fill=INK, width=2)
    cx = (x0 + x1) / 2
    words = row["lead"].split()
    leads = [" ".join(words[:-1]), words[-1]] if len(words) > 1 else words
    lf = font("CG-Italic.ttf", 44)
    for i, l in enumerate(leads):
        d.text((cx, 300 + i * 48), l, font=lf, fill=INK, anchor="mm")
    size = 62
    while True:
        tf = font("PlayfairDisplay.ttf", size)
        lines = wrap(d, row["title"], tf, x1 - x0 - 56)
        if (len(lines) <= 3 and all(d.textlength(l, font=tf) <= x1 - x0 - 40 for l in lines)) or size <= 30:
            break
        size -= 4
    lh = size * 1.25
    ty = 520 - (len(lines) - 1) * lh / 2
    for i, l in enumerate(lines):
        d.text((cx, ty + i * lh), l, font=tf, fill=INK, anchor="mm")
    d.line([(cx - 36, 720), (cx + 36, 720)], fill=INK, width=2)
    tracked(d, cx, 790, "LOUISIANA HELPR", font("Montserrat.ttf", 21), 4)
    slots = [(-1, 0.19, -7), (1, 0.19, 6), (-1, 0.5, 5), (1, 0.5, -5), (-1, 0.81, -6), (1, 0.81, 7)]
    for (side, fy, rot), p in zip(slots, prods):
        p = even(p, 250).rotate(rot, resample=Image.BICUBIC, expand=True)
        s = shadow(p)
        px = x0 / 2 if side < 0 else (x1 + S) / 2
        bx = int(min(max(px - s.width / 2, 4), S - s.width - 4))
        by = int(min(max(fy * S - s.height / 2, 4), S - s.height - 4))
        im.paste(s, (bx, by), s)
    im.resize((480, 480), Image.LANCZOS).save(out, "WEBP", quality=72, method=6)


def main():
    rows = index()
    want = set(sys.argv[1:])
    todo = [r for r in rows if r["slug"] in want] if want else targets(rows)
    drawn, kept = [], []
    for row in todo:
        prods = photos(row["slug"])
        if len(prods) < 6:
            kept.append(f"{row['slug']} ({len(prods)} photos)")
            continue
        draw(row, prods, os.path.join(OUT, f"{row['slug']}.webp"))
        drawn.append(row["slug"])
        print(f"cover {row['slug']}", flush=True)
    print(f"photo covers: {len(drawn)} drawn, {len(kept)} kept their gingham cover (fewer than 6 usable photos)")
    json.dump({"drawn": drawn, "kept": kept}, open(os.path.join(CACHE, "last-run.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
