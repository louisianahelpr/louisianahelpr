"""The Black Friday & Cyber Monday deals guide's cover (owner 2026-11-19), in the gift guide covers' own pin style.

Draws public/gift-guides/deals/black-friday-cyber-monday.webp (480 px, at most 20 KB like every cover) and its share card
public/gift-guides/deals/black-friday-cyber-monday.jpg (600 px, at most 45 KB) with scripts/gift-guide-photo-covers.py's
own render() (gingham, cream arch, script lead, serif name, LOUISIANA HELPR footer, six product cutouts), from the deals
in src/content/giftGuideDeals.json: the first deal of each category in turn (the generator's order, our commission
high to low), one per brand, skipping a photo that will not cut out cleanly. It never touches another guide's cover or
the covers manifest (the deals guide is no catalog guide, so it is outside public/gift-guides/covers).

Run with the covers' Python (Pillow, numpy, scipy): ~/.lh-shots/gg-cover-venv/bin/python scripts/gift-guide-deals-cover.py
"""
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLUG = "black-friday-cyber-monday"
OUT = os.path.join(ROOT, "public", "gift-guides", "deals")

spec = importlib.util.spec_from_file_location("covers", os.path.join(ROOT, "scripts", "gift-guide-photo-covers.py"))
covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(covers)
from PIL import Image  # noqa: E402 - after the covers module, which sets up the generator's path

# Red: the classic Christmas family (hunter green / oxblood / cream; owner 11-09), and "For kids" maps to red in TINT.
ROW = {"group": "For kids", "slug": SLUG, "lead": "Black Friday &", "title": "Cyber Monday Deals"}
# Looked at 2026-11-19: the Hatch Restore cuts out as a plain beige dome that reads as no product on the checks.
SKIP = {"Hatch"}


def products(need=6):
    deals = json.load(open(os.path.join(ROOT, "src", "content", "giftGuideDeals.json"), encoding="utf8"))
    by_cat = {}
    for d in deals:
        by_cat.setdefault(d["category"], []).append(d)
    order = []
    while any(by_cat.values()):
        for cat in list(by_cat):
            if by_cat[cat]:
                order.append(by_cat[cat].pop(0))
    out, brands = [], set()
    for d in order:
        if len(out) >= need:
            break
        if d["brand"] in brands or d["brand"] in SKIP or not d.get("image"):
            continue
        data = covers.fetch(d["image"])
        cut = covers.cutout(data) if data else None
        if cut is None:
            print(f"  skip {d['brand']}: {covers.CUT_WHY.get('last', 'no photo')}")
            continue
        print(f"  use  {d['brand']} ({d['category']})")
        brands.add(d["brand"])
        out.append(cut)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    prods = products()
    im = covers.render(ROW, prods)
    webp = os.path.join(OUT, f"{SLUG}.webp")
    small = im.resize((480, 480), Image.LANCZOS)
    for q in (58, 52, 46, 40, 34):
        small.save(webp, "WEBP", quality=q, method=6)
        if os.path.getsize(webp) <= 19_500:
            break
    jpg = os.path.join(OUT, f"{SLUG}.jpg")
    big = im.resize((600, 600), Image.LANCZOS)
    for q in (78, 72, 66, 60):
        big.save(jpg, "JPEG", quality=q, progressive=True, optimize=True)
        if os.path.getsize(jpg) <= 45_000:
            break
    print(f"{len(prods)} products; {os.path.getsize(webp)} B webp, {os.path.getsize(jpg)} B jpg")


if __name__ == "__main__":
    main()
