"""Product photo cutouts for the deals page (owner 11-20: "none of the images should have a background either").

The deals page's photos (scripts/gift-guide-deals-1121.json) get the same treatment as the gift guides' picks
(scripts/gift-guide-cutouts.py, whose helpers this reuses): a photo whose outer ring is already near-white is kept as
it is (the card's white well hides its box); any other photo gets its background removed by Apple Vision's foreground
mask, cropped to the product and written as a transparent WebP under public/gift-guides/deals/cutouts/<key>.webp.
AMAZON PHOTOS ARE NEVER EDITED (Amazon Associates Operating Agreement): an Amazon link or photo is skipped before
anything is fetched. Its own folder, so the picks' run (which deletes cutouts no pick uses) never touches these.

Run with the cover venv (~/.lh-shots/gg-cover-venv/bin/python) on a Mac with Xcode's swiftc:
  python scripts/gift-guide-deals-cutouts.py [--sheet DIR]
Writes public/gift-guides/deals/cutouts/*.webp and scripts/gift-guide-deals-cutouts.json (photo URL -> key, and each
skipped photo's reason); scripts/gift-guide-deals.mjs reads that file. Guard: src/test/giftGuideDeals1119.test.tsx.
"""
import importlib.util
import io
import json
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("gg_cutouts", os.path.join(ROOT, "scripts", "gift-guide-cutouts.py"))
cut = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cut)

SRC = os.path.join(ROOT, "scripts", "gift-guide-deals-1121.json")
OUT = os.path.join(ROOT, "public", "gift-guides", "deals", "cutouts")
MANIFEST = os.path.join(ROOT, "scripts", "gift-guide-deals-cutouts.json")
# Stricter than the picks' "on white" (242, 90% of the ring): at 242 a pale grey studio backdrop (Caraway, Glossier,
# Quay, XTRATUF on 2026-11-21) passed and showed as a grey box in the card's white well. Only a nearly pure white ring
# (or a transparent one) keeps its photo as it is.
cut.WHITE_MIN = 250
cut.WHITE_RING = 0.97
# Photos cut out and served from our own folder even when on white: the store's CDN answers a browser's request with a
# 404 (MAC's Shopify file 404s for an Accept header listing avif/webp, 200 for a plain request; measured 2026-11-21).
FORCE = {"https://cdn.shopify.com/s/files/1/0774/8481/8690/files/mac_sku_M0N916_1x1_0_44fa46a9-7e37-4923-a4f8-de22757a00bb.png"}


def main():
    sheet_dir = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    deals = json.load(open(SRC, encoding="utf8"))["deals"]
    os.makedirs(OUT, exist_ok=True)
    exe = cut.swift_bin()
    tmp = os.path.join(cut.CACHE, "tmp-deals")
    os.makedirs(tmp, exist_ok=True)
    cutouts, skipped, review, args, batch = {}, {}, [], [], []
    for d in deals:
        u = d.get("image") or ""
        if not u.startswith("https://") or u in cutouts or u in skipped:
            continue
        if cut.is_amazon({"href": d.get("href"), "image": u, "store": "store-amazon" if d.get("store") == "Amazon" else ""}):
            skipped[u] = "Amazon photo (never edited)"
            continue
        data = cut.fetch(u)
        if not data:
            skipped[u] = "photo did not load"
            continue
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception:  # noqa: BLE001 - not an image we can read: keep the original
            skipped[u] = "unreadable"
            continue
        if cut.on_white(img) and u not in FORCE:
            skipped[u] = "already on white"
            continue
        key = cut.fnv1a32(u)
        src = os.path.join(tmp, f"{key}-in.png")
        img.convert("RGB").save(src)
        batch.append((u, key, img))
        args += [src, os.path.join(tmp, f"{key}-out.png")]
    ok = set()
    if args:
        res = subprocess.run([exe, *args], capture_output=True, text=True)
        ok = {line.split("\t")[1] for line in res.stdout.splitlines() if line.startswith("OK\t")}
    for u, key, img in batch:
        src, dst = os.path.join(tmp, f"{key}-in.png"), os.path.join(tmp, f"{key}-out.png")
        if src not in ok or not os.path.exists(dst):
            skipped[u] = "no subject found"
        else:
            piece, why = cut.finish(dst)
            if piece is None:
                skipped[u] = why
            else:
                piece.save(os.path.join(OUT, f"{key}.webp"), "WEBP", quality=82, method=6)
                cutouts[u] = key
                review.append((img, piece, key))
        for f in (src, dst):
            if os.path.exists(f):
                os.remove(f)
    keep = set(cutouts.values())
    for f in os.listdir(OUT):
        if f.endswith(".webp") and f[:-5] not in keep:
            os.remove(os.path.join(OUT, f))
    json.dump({"cutouts": dict(sorted(cutouts.items())), "skipped": dict(sorted(skipped.items()))}, open(MANIFEST, "w", encoding="utf8"), indent=1, ensure_ascii=False)
    open(MANIFEST, "a").write("\n")
    if sheet_dir and review:
        os.makedirs(sheet_dir, exist_ok=True)
        cut.sheet(review, os.path.join(sheet_dir, "deals-cutouts.png"))
    print(f"deals photos: cut out {len(cutouts)}; kept as they are {len(skipped)}")


if __name__ == "__main__":
    main()
