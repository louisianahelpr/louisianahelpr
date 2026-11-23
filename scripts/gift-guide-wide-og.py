"""The gift guide pages' 1200x630 link previews (owner 2026-11-22, "Fix the preview on these links": her Facebook post of
/gift-guides/her came out as a SMALL square thumbnail beside the title, because each guide's og:image was its 600x600
cover; the landing's 1200x630 card gets Facebook's big card). One landscape card per page that has its own head, in the
square covers' own pin style (~/Desktop/Pin-cover-generator, scripts/gift-guide-photo-covers.py render()): the page's
own banner gingham (Her beige, Him green, Kids red, ...), the cream arch with the italic lead ("gifts for") and the
serif title, the line-diamond-line divider and the LOUISIANA HELPR footer, and nothing else (owner 2026-11-22, 8:16 PM,
on the gift tags preview: "the previews should not have items or stuff on it. just the arch and background basically.
fix all of them"): no product cutouts, deal pictures or printable previews on any card, every arch at the wide
words-alone size.

Writes public/gift-guides/og-wide/<key>.jpg (1200x630, JPEG, at most 150 KB) and src/lib/giftGuideWideOg.mjs (each
file's first 8 hex of its MD5, the ?v= cache key api/share.ts adds). Guards: src/test/giftGuideWideOg1122.test.ts, src/test/giftGuideWideOgArchOnly1122.test.ts.

Run with a Python that has Pillow and numpy, which pin_covers imports (e.g. /opt/homebrew/bin/python3):
  python scripts/gift-guide-wide-og.py            (every card)
  python scripts/gift-guide-wide-og.py her kids   (just these)
"""
import hashlib
import json
import os
import sys

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

# key -> (served path it is for, tint, lead, title). No photo source: every card is the gingham and the arch alone.
PAGES = {
    "her": ("/gift-guides/her", "oat", "gifts for", "Her"),
    "him": ("/gift-guides/him", "green", "gifts for", "Him"),
    "kids": ("/gift-guides/kids", "red", "gifts for", "Kids"),
    "25-days-sponsors": ("/gift-guides/25-days-sponsors", "green", "shop our", "25 Days Sponsors"),
    "black-friday": ("/gift-guides/black-friday", "red", "the best", "Black Friday Deals"),
    "cyber-monday": ("/gift-guides/cyber-monday", "red", "the best", "Cyber Monday Deals"),
    "small-business-saturday": ("/gift-guides/small-business-saturday", "green", "shop small", "Small Business Saturday"),
    "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags"),
    "coloring-books": ("/gift-guides/printables/coloring-books", "red", "free printables", "Coloring Books"),
    "banners": ("/gift-guides/printables/banners", "red", "free printables", "Banners"),
    "find-a-gift": ("/gift-guides?who=", "oat", "make it fun", "Find a Gift"),
    "swipe": ("/gift-guides/swipe", "oat", "make it fun", "Swipe to Find Gifts"),
    "draw-names": ("/gift-guides/draw-names", "oat", "make it fun", "Secret Santa Name Draw"),
    "planner": ("/gift-guides/planner", "oat", "make it fun", "Gift Planner"),
    "my-list": ("/gift-guides/my-list", "red", "your saved gifts", "My Wish List"),
    "wish-list": ("/gift-guides/list/<code>", "red", "shared with you", "Wish List"),
    "holidays": ("/holidays", "green", "lights & events", "Louisiana Holiday Hub"),
}


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


def render(tint, lead, title):
    im = pc.gingham(W, H, tint, c=42 * S, palettes=FAMILY)
    acc = ACCENT[tint]
    # The arch at the words-alone width (nothing beside it).
    half = 250 * S
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
        _path, tint, lead, title = PAGES[key]
        im = render(tint, lead, title)
        path = os.path.join(OUT, f"{key}.jpg")
        q = save(im, path)
        print(f"{key}: q{q}, {os.path.getsize(path) // 1024} KB")
    write_versions()


if __name__ == "__main__":
    main()
