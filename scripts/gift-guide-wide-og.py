"""The gift guide pages' 1200x630 link previews (owner 2026-11-22, "Fix the preview on these links": her Facebook post of
/gift-guides/her came out as a SMALL square thumbnail beside the title, because each guide's og:image was its 600x600
cover; the landing's 1200x630 card gets Facebook's big card). One landscape card per page that has its own head, in the
square covers' own pin style (~/Desktop/Pin-cover-generator, scripts/gift-guide-photo-covers.py render()): the page's
own banner gingham (Her beige, Him green, Kids red, ...), the cream arch with the italic lead ("gifts for") and the
serif title, the line-diamond-line divider and the LOUISIANA HELPR footer. Her, Him, Kids and the 25 Days sponsors
show their own cover's six product cutouts (scripts/gift-guide-cover-items.json, local files), three a side; Black
Friday and Cyber Monday six of their own deals' cutouts (public/gift-guides/deals/cutouts/); the printables pages their own preview images; the other pages the arch alone.

Writes public/gift-guides/og-wide/<key>.jpg (1200x630, JPEG, at most 150 KB) and src/lib/giftGuideWideOg.mjs (each
file's first 8 hex of its MD5, the ?v= cache key api/share.ts adds). Guard: src/test/giftGuideWideOg1122.test.ts.

Run with a Python that has Pillow, numpy and scipy (~/.lh-shots/gg-cutout-venv/bin/python):
  python scripts/gift-guide-wide-og.py            (every card)
  python scripts/gift-guide-wide-og.py her kids   (just these)
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public")
OUT = os.path.join(PUB, "gift-guides", "og-wide")
VERSIONS = os.path.join(ROOT, "src", "lib", "giftGuideWideOg.mjs")
GEN = next((d for d in [os.environ.get("GIFT_COVER_GEN") or "", os.path.expanduser("~/Desktop/Pin-cover-generator"),
                        os.path.expanduser("~/Desktop/Louisiana Helpr Work/Social and Pinterest/Pin-cover-generator")]
            if d and os.path.exists(os.path.join(d, "pin_covers.py"))), os.path.expanduser("~/Desktop/Pin-cover-generator"))
sys.path.insert(0, GEN)
import pin_covers as pc  # noqa: E402 - the owner's generator, so the cards are the pins' own style

S = 2  # drawn at 2400x1260, saved at 1200x630
W, H = 1200 * S, 630 * S
CREAM_O = (250, 247, 239)
# The square covers' own families (gift-guide-photo-covers.py FAMILY) = the page banners' CSS (.gg-green, .gg-red,
# .gg-oat in src/pages/info/giftGuides/giftGuidesStyles.ts).
FAMILY = {
    "green": ((38, 94, 60), (150, 178, 154), CREAM_O),
    "oat": ((219, 204, 180), (231, 220, 202), CREAM_O),
    "red": ((168, 36, 42), (222, 150, 148), CREAM_O),
}
ACCENT = {"green": (94, 101, 68), "red": (158, 59, 59), "oat": (138, 106, 69)}

MANIFEST = json.load(open(os.path.join(ROOT, "scripts", "gift-guide-cover-items.json"), encoding="utf8"))


def manifest_photos(slug):
    """The cover's own six cutouts, read from public/ (the manifest names their live URLs)."""
    out = []
    for it in MANIFEST[slug]["items"]:
        rel = it["image"].split("louisianahelpr.com/", 1)[1]
        out.append(Image.open(os.path.join(PUB, rel)).convert("RGBA"))
    return out


# Each deals day's own deals (src/content/giftGuideDeals.json, its `event`), by brand: a mix of kinds (owner 11-20: at
# most 1-2 of a kind), never an Amazon photo (Associates terms: Amazon's own photo is never cut out or edited), only the
# deals' own transparent cutouts in public/gift-guides/deals/cutouts/. A brand no longer listed is filled from the day's
# other cutout deals, one per brand.
DEALS_PICKS = {
    "black-friday": ["Caraway", "Glossier", "Quay", "XTRATUF", "BaubleBar", "Melissa & Doug"],
    "cyber-monday": ["Olive & June", "Rare Beauty", "Summer Fridays", "Glow Recipe", "Laneige", "Peak Design"],
}


def deals_photos(event):
    deals = [d for d in json.load(open(os.path.join(ROOT, "src", "content", "giftGuideDeals.json"), encoding="utf8"))
             if d.get("event") == event and str(d.get("image", "")).startswith("/gift-guides/deals/cutouts/")]
    by_brand = {}
    for d in deals:
        by_brand.setdefault(d["brand"], d)
    brands = [b for b in DEALS_PICKS[event] if b in by_brand] + [b for b in by_brand if b not in DEALS_PICKS[event]]
    return [no_backdrop(Image.open(os.path.join(PUB, by_brand[b]["image"].lstrip("/"))).convert("RGBA")) for b in brands[:6]]


def no_backdrop(p, tol=14):
    """A deal photo still on its white backdrop (opaque corners) loses it (owner 11-20: cutouts only, never a white box):
    the near-white pixels joined to the photo's edge go transparent, with a 1 px soft edge. A transparent cutout is kept."""
    a = np.asarray(p).copy()
    if a[0, 0, 3] < 10 and a[-1, -1, 3] < 10:
        return p
    from scipy import ndimage
    white = (a[:, :, :3].min(axis=2) >= 255 - tol)
    lab, _ = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    a[:, :, 3] = np.minimum(a[:, :, 3], np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8))))
    out = Image.fromarray(a, "RGBA")
    return out.crop(out.getbbox() or (0, 0, out.width, out.height))


def flat(rel):
    """A printable's preview, drawn as it is (never recoloured), with an opaque alpha so it takes the shadow."""
    return Image.open(os.path.join(PUB, rel)).convert("RGBA")


# key -> (served path it is for, tint, lead, title, photos)
PAGES = {
    "her": ("/gift-guides/her", "oat", "gifts for", "Her", lambda: manifest_photos("her")),
    "him": ("/gift-guides/him", "green", "gifts for", "Him", lambda: manifest_photos("him")),
    "kids": ("/gift-guides/kids", "red", "gifts for", "Kids", lambda: manifest_photos("kids")),
    "25-days-sponsors": ("/gift-guides/25-days-sponsors", "green", "shop our", "25 Days Sponsors", lambda: manifest_photos("25-days-sponsors")),
    "black-friday": ("/gift-guides/black-friday", "red", "the best", "Black Friday Deals", lambda: deals_photos("black-friday")),
    "cyber-monday": ("/gift-guides/cyber-monday", "red", "the best", "Cyber Monday Deals", lambda: deals_photos("cyber-monday")),
    "small-business-saturday": ("/gift-guides/small-business-saturday", "green", "shop small", "Small Business Saturday", None),
    "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags",
                  lambda: [flat(f"printables/tags/{n}.webp") for n in ("red-white-vintage-santa", "green-cream-vintage", "red-green-illustrated-watercolor", "green-white-vintage-car")]),
    "coloring-books": ("/gift-guides/printables/coloring-books", "red", "free printables", "Coloring Books",
                       lambda: [flat("printables/coloring-book/preview-girls.webp"), flat("printables/coloring-book/preview-boys.webp")]),
    "banners": ("/gift-guides/printables/banners", "red", "free printables", "Banners",
                lambda: [flat("printables/thanksgiving-banner/preview.webp"), flat("printables/merry-christmas-plaid/preview.webp"),
                         flat("printables/merry-christmas-red-stripe/preview.webp"), flat("printables/merry-christmas-green-stripe/preview.webp")]),
    "find-a-gift": ("/gift-guides?who=", "oat", "make it fun", "Find a Gift", None),
    "swipe": ("/gift-guides/swipe", "oat", "make it fun", "Swipe to Find Gifts", None),
    "draw-names": ("/gift-guides/draw-names", "oat", "make it fun", "Secret Santa Name Draw", None),
    "planner": ("/gift-guides/planner", "oat", "make it fun", "Gift Planner", None),
    "my-list": ("/gift-guides/my-list", "red", "your saved gifts", "My Wish List", None),
    "wish-list": ("/gift-guides/list/<code>", "red", "shared with you", "Wish List", None),
    "holidays": ("/holidays", "green", "lights & events", "Louisiana Holiday Hub", None),
}


def even(p, m, frac=0.42):
    """Every product covers about the same area of an m x m box (cover2_example.even)."""
    area = (np.asarray(p.split()[3]) > 40).sum()
    r = (frac * m * m / max(area, 1)) ** 0.5
    w, h = p.width * r, p.height * r
    if max(w, h) > m * 1.1:
        q = m * 1.1 / max(w, h)
        w, h = w * q, h * q
    return p.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)


def fit(p, bw, bh):
    r = min(bw / p.width, bh / p.height)
    return p.resize((max(1, int(p.width * r)), max(1, int(p.height * r))), Image.LANCZOS)


def shadow(p, strength=0.26):
    pad, blur = 20 * S, 9 * S
    s = Image.new("RGBA", (p.width + 2 * pad, p.height + 2 * pad), (0, 0, 0, 0))
    blk = Image.new("RGBA", p.size, (40, 30, 20, 255))
    blk.putalpha(p.split()[3].point(lambda v: int(v * strength)))
    s.paste(blk, (pad + 4 * S, pad + 8 * S), blk)
    s = s.filter(ImageFilter.GaussianBlur(blur))
    s.paste(p, (pad, pad), p)
    return s


def title_font(size):
    f = pc.font("PlayfairDisplay.ttf", size)
    f.set_variation_by_axes([600])
    return f


def wrap2(d, text, f, width):
    """One line if it fits, else the two-line split whose longer line is shortest."""
    if d.textlength(text, font=f) <= width:
        return [text]
    ws = text.split()
    return min(([" ".join(ws[:k]), " ".join(ws[k:])] for k in range(1, len(ws))), key=lambda ls: max(d.textlength(x, font=f) for x in ls), default=[text])


def paste_clamped(im, s, cx, cy, p):
    """Paste shadowed `s` centred at (cx, cy), the product itself kept 14 px inside the card."""
    m, pad = 14 * S, 20 * S
    bb = p.getbbox() or (0, 0, p.width, p.height)
    bx = int(cx - s.width / 2)
    by = int(cy - s.height / 2)
    bx = min(max(bx, m - pad - bb[0]), W - m - pad - bb[2])
    by = min(max(by, m - pad - bb[1]), H - m - pad - bb[3])
    im.paste(s, (bx, by), s)


def render(tint, lead, title, photos, kind):
    im = pc.gingham(W, H, tint, c=42 * S, palettes=FAMILY)
    acc = ACCENT[tint]
    # The arch: about a third of the card wide with products beside it, wider with the words alone.
    half = {"products": 200, "flat": 205, "none": 250}[kind] * S
    cx = W / 2
    x0, x1 = cx - half, cx + half
    y0, y1 = 66 * S, 588 * S
    g = 20 * S  # the cream border outside the outline
    sh = Image.new("L", (W, H), 0)
    pc.arch(ImageDraw.Draw(sh), x0 - g, y0 - g + 6 * S, x1 + g, y1 + g + 6 * S, fill=255)
    im.paste(Image.new("RGB", (W, H), (40, 30, 20)), (0, 0), sh.filter(ImageFilter.GaussianBlur(10 * S)).point(lambda v: int(v * 0.20)))
    d = ImageDraw.Draw(im)
    pc.arch(d, x0 - g, y0 - g, x1 + g, y1 + g, fill=pc.CREAM)
    pc.arch(d, x0, y0, x1, y1, outline=acc, width=2 * S)
    aw, ah = x1 - x0, y1 - y0
    # The title on one line when it fits at 66 px or more, else two lines of at most 74 px (two big lines crowd the
    # lead); the lead near the top of the arch (owner's pin rule: lead higher), sized to the arch's chord at its height.
    tf, lines, size = None, None, 84 * S
    while size >= 66 * S:
        tf = title_font(size)
        if d.textlength(title, font=tf) <= aw - 70 * S:
            lines = [title]
            break
        size -= 2 * S
    if lines is None:
        size = 74 * S
        while True:
            tf = title_font(size)
            lines = wrap2(d, title, tf, aw - 70 * S)
            if all(d.textlength(x, font=tf) <= aw - 70 * S for x in lines) or size <= 40 * S:
                break
            size -= 2 * S
    lh = size * 1.18
    ly = y0 + ah * (0.235 if len(lines) > 1 else 0.25)
    r = aw / 2
    chord = 2 * max(0.0, r * r - max(0.0, r - (ly - y0 - 30 * S)) ** 2) ** 0.5 if ly - y0 - 30 * S < r else aw
    lsize = 66 * S
    while pc.font("CG-Italic.ttf", lsize).getlength(lead) > chord - 70 * S and lsize > 36 * S:
        lsize -= 2 * S
    d.text((cx, ly), lead, font=pc.font("CG-Italic.ttf", lsize), fill=acc, anchor="mm")
    ty = y0 + ah * (0.545 if len(lines) > 1 else 0.53) - (len(lines) - 1) * lh / 2
    tl = Image.new("L", (W, H), 0)
    for i, x in enumerate(lines):
        ImageDraw.Draw(tl).text((cx, ty + i * lh + 2 * S), x, font=tf, fill=255, anchor="mm")
    im.paste(Image.new("RGB", (W, H), (40, 30, 20)), (0, 0), tl.filter(ImageFilter.GaussianBlur(1.5 * S)).point(lambda v: int(v * 0.12)))
    d = ImageDraw.Draw(im)
    for i, x in enumerate(lines):
        d.text((cx, ty + i * lh), x, font=tf, fill=pc.INK, anchor="mm")
    dy = y0 + ah * 0.80
    d.line([(cx - 44 * S, dy), (cx - 12 * S, dy)], fill=acc, width=2 * S)
    d.line([(cx + 12 * S, dy), (cx + 44 * S, dy)], fill=acc, width=2 * S)
    d.polygon([(cx, dy - 6 * S), (cx + 6 * S, dy), (cx, dy + 6 * S), (cx - 6 * S, dy)], fill=acc)
    ff = pc.font("Montserrat.ttf", 25 * S)
    ff.set_variation_by_axes([600])
    tw = sum(ff.getlength(ch) for ch in "LOUISIANA HELPR") + 2 * S * 14
    x = cx - tw / 2
    for ch in "LOUISIANA HELPR":
        d.text((x, y0 + ah * 0.895), ch, font=ff, fill=pc.INK, anchor="lm")
        x += ff.getlength(ch) + 2 * S

    if kind == "products":
        # Three a side, like the square covers: top and bottom over the arch edge, the middle one further out.
        # (side, y as a share of the card, x offset from the arch edge outward, tilt)
        slots = [(-1, 0.25, 70, -8), (1, 0.25, 70, 8), (-1, 0.52, 255, 6), (1, 0.52, 255, -6), (-1, 0.79, 70, -7), (1, 0.79, 70, 8)]
        order = [0, 1, 2, 3, 4, 5]  # manifest order: left/right alternating like the square covers' EVEN slots
        for i, p in zip(order, photos):
            side, fy, off, rot = slots[i]
            q = even(p, 200 * S).rotate(rot, resample=Image.BICUBIC, expand=True)
            edge = x0 - g if side < 0 else x1 + g
            px = edge - off * S if side < 0 else edge + off * S
            paste_clamped(im, shadow(q), px, H * fy, q)
    elif kind == "flat":
        n = len(photos)
        if n == 2:  # one big preview a side
            slots = [(-1, 0.5, 0, 4, 300, 400), (1, 0.5, 0, -4, 300, 400)]
        else:  # two a side, staggered
            slots = [(-1, 0.30, 30, -5, 300, 230), (1, 0.30, 30, 5, 300, 230), (-1, 0.72, 30, 4, 300, 230), (1, 0.72, 30, -4, 300, 230)]
        for (side, fy, off, rot, bw, bh), p in zip(slots, photos):
            q = fit(p, bw * S, bh * S).rotate(rot, resample=Image.BICUBIC, expand=True)
            space = (x0 - g) / 2  # the middle of the gingham beside the arch
            px = space - off * S if side < 0 else W - space + off * S
            paste_clamped(im, shadow(q, 0.30), px, H * fy, q)
    return im.resize((1200, 630), Image.LANCZOS)


def save(im, path):
    for q in (84, 82, 78, 74, 70):
        im.save(path, "JPEG", quality=q, progressive=True, optimize=True)
        if os.path.getsize(path) <= 150_000:
            return q
    raise SystemExit(f"{path} is over 150 KB at q70")


def write_versions():
    out = {}
    for f in sorted(os.listdir(OUT)):
        if f.endswith(".jpg"):
            out[f[:-4]] = hashlib.md5(open(os.path.join(OUT, f), "rb").read()).hexdigest()[:8]
    with open(VERSIONS, "w", encoding="utf8") as fh:
        fh.write("/** GENERATED by scripts/gift-guide-wide-og.py: each 1200x630 link preview in public/gift-guides/og-wide/ and the first 8 hex\n"
                 " * of its MD5, the ?v= cache key api/share.ts adds. Do not edit; re-run the script. */\n"
                 f"export const WIDE_OG_VERSIONS = {json.dumps(out)};\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    keys = sys.argv[1:] or list(PAGES)
    for key in keys:
        _path, tint, lead, title, get = PAGES[key]
        photos = []
        if get is not None:
            photos = get()
        kind = "none" if not photos else ("flat" if key in ("gift-tags", "coloring-books", "banners") else "products")
        im = render(tint, lead, title, photos, kind)
        path = os.path.join(OUT, f"{key}.jpg")
        q = save(im, path)
        print(f"{key}: {len(photos)} photos, q{q}, {os.path.getsize(path) // 1024} KB")
    write_versions()


if __name__ == "__main__":
    main()
