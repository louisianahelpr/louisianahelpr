"""Gift guide photo covers in the owner's Pinterest pin style (pin_covers.py photo_cover / cover2_example.cover2, 11-18):
the pins' soft pastel gingham, a big cream arch (about half the width, nearly the full height, thin inner outline) with
"gifts for" in script, the serif guide name, a short divider and the spaced LOUISIANA HELPR footer, and six product
cutouts, three a side, overlapping the arch edges with the pins' soft shadow. Owner 11-18: "make the arched bigger so
the items kind of over lap the arch" / "Like these" (her pin covers). The gingham keeps each guide's family tint in
the pins' pastel version (pin_covers.PAL): sage for By person/By store/Life moments/Louisiana, beige for By budget/
By career/Colors, pink for For kids/Hobbies/Pets.

Products (owner 11-18: "Idk that mom wants muck boots?"): taken in the guide's featured order (the picks file's own
order, from _featured-order.json), skipping a photo that will not cut out cleanly; one per brand, at most one per kind
(one boot, one pair of shoes, one drinkware, ...), and no boots at all on Mom/Her/Wife except UGG. A store page
(store-*) may repeat its own brand and kind (Durango Boots is all boots).

Run with a Python that has Pillow, numpy and scipy (not the repo's runtime; the covers are static files):
  python scripts/gift-guide-photo-covers.py [slug ...]
With no slugs it draws the By person, By budget, top By career and every By store guide. A guide with fewer than six
usable photos keeps its gingham/arch cover (the owner's, public/gift-guides/covers/<slug>.webp) untouched.

Photos: only each pick's own `image` from src/content/giftGuidePicks/<slug>.json, never an Amazon-hosted one (owner
chose the safe route; AMAZON_CDN_PHOTOS stays off). A photo is used only on a near-white background: the cutout keeps
pixels more than 26 off white, then the large connected parts (holes filled), so lifestyle shots are skipped. RAGGED
names products whose white-on-white photo cuts out ragged (AirPods: only the shading is found); the next pick is used.
Drawing and fonts: ~/Desktop/Pin-cover-generator (the owner's generator; pin_covers is imported). Cache: $GIFT_COVER_CACHE or ~/.lh-shots/gg-cover-cache.
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
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICKS = os.path.join(ROOT, "src", "content", "giftGuidePicks")
OUT = os.path.join(ROOT, "public", "gift-guides", "covers")
CACHE = os.environ.get("GIFT_COVER_CACHE", os.path.expanduser("~/.lh-shots/gg-cover-cache"))
AMAZON = re.compile(r"(^|\.)(media-amazon|images-amazon|ssl-images-amazon|amazon)\.com$")
TOP_CAREERS = 24
# The first By career guides in the index (its order is the owner's).
GEN = os.path.expanduser("~/Desktop/Pin-cover-generator")
sys.path.insert(0, GEN)
import pin_covers as pc  # noqa: E402 - the owner's generator, so the covers are the pins' own style
TINT = {"By person": "sage", "By store": "sage", "Life moments": "sage", "Louisiana": "sage",
        "By budget": "beige", "By career": "beige", "Colors": "beige", "For kids": "pink", "Hobbies": "pink", "Pets": "pink"}
RAGGED = re.compile(r"airpods", re.I)
NO_BOOTS = {"mom", "her", "wife"}  # owner 11-18: no Muck/XTRATUF/rain boots on these; UGG is fine
KINDS = {
    "boot": re.compile(r"\bboots?\b|xtratuf|muck ?boot|muckster|wellies", re.I),
    "shoe": re.compile(r"slipper|\bclogs?\b|sneaker|\bshoes?\b|sandal|loafer|moccasin", re.I),
    "drink": re.compile(r"tumbler|water bottle|\bmug\b|\bcup\b|quencher|rambler|freesip", re.I),
    "candle": re.compile(r"candle", re.I),
    "hat": re.compile(r"\bhat\b|\bcap\b|beanie", re.I),
    "sock": re.compile(r"\bsocks?\b", re.I),
    "frame": re.compile(r"picture frame|photo frame", re.I),
    "earbuds": re.compile(r"airpods|earbuds", re.I),
    "fragrance": re.compile(r"perfume|eau de|cologne|fragrance mist", re.I),
}


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
    boxes = ndimage.find_objects(lab)
    # A thin stripe (a colour bar or a ruler line under the product) shows plainly on the gingham: drop it.
    thin = {i + 1 for i, b in enumerate(boxes)
            if min(b[0].stop - b[0].start, b[1].stop - b[1].start) * 8 < max(b[0].stop - b[0].start, b[1].stop - b[1].start)}
    big = [i + 1 for i, v in enumerate(sizes) if v >= 0.08 * sizes.max() and i + 1 not in thin]
    if not big:
        return None
    if len(big) > 8:
        return None  # many separate pieces: a word mark or a logo, not a product
    fg = ndimage.binary_fill_holes(np.isin(lab, big))
    share = fg.mean()
    if share < 0.04 or share > 0.9:
        return None
    ys, xs = np.nonzero(fg)
    w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    if max(w, h) > 3 * min(w, h):
        return None  # a banner or badge ("HEATED"), not a product
    if len(big) > 4 and fg.sum() < 0.35 * w * h:
        return None  # a few sparse letters around an icon: a logo ("vstapn"), not a product
    alpha = Image.fromarray((fg * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


def kinds(p):
    text = f"{p.get('name') or ''} {p.get('brand') or ''}"
    return {k for k, rx in KINDS.items() if rx.search(text)}


def allowed(slug, p, taken):
    """The variety rules for one more product on this cover, given the picks already on it."""
    ks = kinds(p)
    if "boot" in ks and slug in NO_BOOTS and not re.search(r"\bugg\b", f"{p.get('brand')} {p.get('name')}", re.I):
        return False
    if slug.startswith("store-"):
        return True
    brand = (p.get("brand") or "").strip().lower()
    if brand and brand in {(t.get("brand") or "").strip().lower() for t in taken}:
        return False
    return not (ks & set().union(*[kinds(t) for t in taken])) if taken else True


def photos(slug, need=6):
    try:
        picks = json.load(open(os.path.join(PICKS, f"{slug}.json"), encoding="utf8"))["picks"]
    except FileNotFoundError:
        return []
    cands, seen = [], set()
    for p in picks:
        u = p.get("image")
        if not u or not u.startswith("https://") or u in seen or AMAZON.search(urlparse(u).hostname or ""):
            continue
        # A store's own storefront pick (name == brand, "Bass Pro Shops") carries its logo, not a product.
        if (p.get("name") or "").strip().lower() == (p.get("brand") or "").strip().lower():
            continue
        seen.add(u)
        cands.append(p)
    got, taken = [], []
    for start in range(0, min(len(cands), 50), 10):
        batch = [p for p in cands[start:start + 10]]
        with ThreadPoolExecutor(6) as pool:
            datas = list(pool.map(fetch, [p["image"] for p in batch]))
        for p, data in zip(batch, datas):
            if len(got) >= need or RAGGED.search(p.get("name") or "") or not allowed(slug, p, taken):
                continue
            c = cutout(data) if data else None
            if c is not None:
                got.append(c)
                taken.append(p)
        if len(got) >= need:
            break
    print(f"  {slug}: " + " | ".join((t.get("name") or "")[:28] for t in taken), flush=True)
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


def wrap(d, text, f, width):
    lines, cur = [], ""
    # "Father-in-Law" may break after its first hyphen, like a word break.
    words = [x for w in text.split() for x in (re.sub(r"^([^-]+-)", r"\1 ", w).split() if d.textlength(w, font=f) > width else [w])]
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    return lines + [cur]


def draw(row, prods, out):
    """pin_covers.photo_cover / cover2_example.cover2 on a 1000 x 1000 square, saved at 480 x 480."""
    W = 1000
    im = pc.gingham(W, W, TINT.get(row["group"], "sage"))
    d = ImageDraw.Draw(im)
    k = 1.0
    x0, y0, x1, y1 = 234, 92, 766, 922  # the pin's arch width (53%), nearly the square's full height
    pc.arch(d, x0 - 22 * k, y0 - 22 * k, x1 + 22 * k, y1 + 20 * k, fill=pc.CREAM)
    pc.arch(d, x0, y0, x1, y1, outline=pc.INK, width=2)
    cx = (x0 + x1) / 2
    lsize = 60
    while pc.font("CG-Italic.ttf", lsize).getlength(row["lead"]) > x1 - x0 - 80 and lsize > 36:
        lsize -= 4
    d.text((cx, y0 + (x1 - x0) * 0.40), row["lead"], font=pc.font("CG-Italic.ttf", lsize), fill=pc.INK, anchor="mm")
    size = 78
    while True:
        tf = pc.font("PlayfairDisplay.ttf", size)
        lines = wrap(d, row["title"], tf, x1 - x0 - 190)  # clear of the products over the arch edge
        if (len(lines) <= 3 and all(d.textlength(l, font=tf) <= x1 - x0 - 170 for l in lines)) or size <= 36:
            break
        size -= 4
    lh = size * 105 / 78
    ty = (y0 + y1) / 2 + 20 - (len(lines) - 1) * lh / 2
    for i, l in enumerate(lines):
        d.text((cx, ty + i * lh), l, font=tf, fill=pc.INK, anchor="mm")
    d.line([(cx - 50, y1 - 170), (cx + 50, y1 - 170)], fill=pc.INK, width=2)
    pc.tracked(d, cx, y1 - 82, "LOUISIANA HELPR", pc.font("Montserrat.ttf", 20), 6)
    H0, mx = y1 - y0, 330
    for i, p in zip(range(6), prods):
        side, fy, rot, sc, off = pc.EVEN[i]
        off += 22 if fy < 0.3 or fy > 0.7 else -18  # the middle pair sits further out, clear of the guide name
        p = even(p, int(mx * sc * 0.78)).rotate(rot, resample=Image.BICUBIC, expand=True)
        s = pc.shadow(p)
        px = x0 + off if side < 0 else x1 - off
        py = y0 + (0.14 + (fy - 0.12) * (0.72 / 0.74)) * H0
        bx = int(min(max(px - s.width / 2, -8), W - s.width + 8))
        by = int(min(max(py - s.height / 2, -8), W - s.height + 8))
        im.paste(s, (bx, by), s)
    im.resize((480, 480), Image.LANCZOS).save(out, "WEBP", quality=58, method=6)


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
