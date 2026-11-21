"""Product photo cutouts for the gift guides (owner 11-20: "none of the images should have a background either").

Every non-Amazon pick photo that is NOT already on a white background (a grey studio backdrop, a model shot, a scene)
gets its background removed with Apple Vision's foreground mask (VNGenerateForegroundInstanceMaskRequest, the model
behind Photos' "Lift subject"; scripts/gift-guide-cutout.swift, compiled once into the cache), cropped to the product,
and written as a transparent WebP under public/gift-guides/cutouts/<key>.webp. The page then shows the cutout on white
(src/content/giftGuideCutouts.ts reads src/content/giftGuideCutouts.json, the list of keys).

AMAZON PHOTOS ARE NEVER EDITED (Amazon Associates Operating Agreement: product images may not be altered; audit D):
a pick on the Amazon store, or with an Amazon link or an Amazon-hosted photo, is skipped before anything is fetched.
On the page an Amazon photo only blends onto white with CSS (mix-blend-mode: multiply), unchanged.

A cutout is kept only when it looks right: the subject covers between MIN_COVER and MAX_COVER of the frame (Vision
found a product, and removed something), and the photo is not on scripts/gift-guide-cutout-rejects.json (cutouts
rejected on review: a background that stayed, a product cut in half). Everything else keeps its original photo.

Run with a Python that has Pillow and numpy (the cover venv: ~/.lh-shots/gg-cover-venv/bin/python), on a Mac with
Xcode's swiftc, in batches (BATCH photos per Vision run, so memory stays flat on the 8 GB Mac):
  python scripts/gift-guide-cutouts.py              (every pick; reuses cached downloads and cutouts)
  python scripts/gift-guide-cutouts.py --sheet DIR  (also writes review contact sheets, original | cutout, into DIR)
Writes: public/gift-guides/cutouts/*.webp, src/content/giftGuideCutouts.json (keys), scripts/gift-guide-cutouts.json
(photo URL -> key, and each skipped photo's reason). Guard: src/test/giftGuideCutouts1120.test.ts.
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICKS = os.path.join(ROOT, "src", "content", "giftGuidePicks")
OUT = os.path.join(ROOT, "public", "gift-guides", "cutouts")
KEYS = os.path.join(ROOT, "src", "content", "giftGuideCutouts.json")
MANIFEST = os.path.join(ROOT, "scripts", "gift-guide-cutouts.json")
REJECTS = os.path.join(ROOT, "scripts", "gift-guide-cutout-rejects.json")
SWIFT = os.path.join(ROOT, "scripts", "gift-guide-cutout.swift")
CACHE = os.environ.get("GIFT_CUTOUT_CACHE", os.path.expanduser("~/.lh-shots/gg-cutout-cache"))
BATCH = 20
SIZE = 480  # the longest side of a cutout (the page's largest product photo is about 300 CSS px wide)
# The share of a photo's border ring that must be near-white for it to count as "on white" (no cutout needed).
WHITE_RING = 0.9
WHITE_MIN = 242
MIN_COVER, MAX_COVER = 0.03, 0.97

AMAZON_HOSTS = ("amazon.", "amzn.", "media-amazon.com", "ssl-images-amazon.com", "images-amazon.com")


def fnv1a32(s):
    """The cutout's key: FNV-1a 32 of the photo URL, 8 hex digits (the same function as src/content/giftGuideCutouts.ts)."""
    h = 0x811C9DC5
    for b in s.encode("utf8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def is_amazon(p):
    """Any sign of an Amazon product: never edited."""
    if p.get("store") == "store-amazon":
        return True
    for u in (p.get("href") or "", p.get("image") or "", p.get("fallback_href") or ""):
        host = urlparse(u).hostname or ""
        if any(a in host for a in AMAZON_HOSTS):
            return True
    return False


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(path):
        return open(path, "rb").read() or None
    data = b""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = r.read(8_000_000)
    except Exception as e:  # noqa: BLE001 - a dead photo keeps its original; the cache remembers it as empty
        print(f"  skip {url[:90]}: {e}", file=sys.stderr)
    open(path, "wb").write(data)
    return data or None


def on_white(img):
    """True when the photo's outer ring is near-white (or already transparent): CSS multiply hides its box already."""
    a = np.asarray(img.convert("RGBA").resize((200, 200)))
    ring = np.concatenate([a[:8].reshape(-1, 4), a[-8:].reshape(-1, 4), a[:, :8].reshape(-1, 4), a[:, -8:].reshape(-1, 4)])
    clear = ring[:, 3] < 16
    white = (ring[:, :3].min(axis=1) >= WHITE_MIN) | clear
    return white.mean() >= WHITE_RING


def swift_bin():
    exe = os.path.join(CACHE, "gift-guide-cutout")
    if not os.path.exists(exe) or os.path.getmtime(exe) < os.path.getmtime(SWIFT):
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(["swiftc", "-O", SWIFT, "-o", exe], check=True)
    return exe


def finish(png_path):
    """Crop a Vision cutout to its subject (a little air around it), square, at most SIZE; None when it looks wrong."""
    im = Image.open(png_path).convert("RGBA")
    alpha = np.asarray(im)[:, :, 3]
    cover = float((alpha > 128).mean())
    if not MIN_COVER <= cover <= MAX_COVER:
        return None, f"subject covers {cover:.0%} of the frame"
    ys, xs = np.nonzero(alpha > 16)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    im = im.crop((x0, y0, x1, y1))
    side = int(max(im.size) * 1.08)
    sq = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    if side > SIZE:
        sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
    return sq, None


def picks():
    out = []
    for f in sorted(os.listdir(PICKS)):
        if f.endswith(".json"):
            out += json.load(open(os.path.join(PICKS, f), encoding="utf8")).get("picks", [])
    return out


def sheet(rows, path):
    """A review sheet: each photo, then its cutout on white."""
    W = 160
    img = Image.new("RGB", (W * 4, W * ((len(rows) + 1) // 2)), "white")
    d = ImageDraw.Draw(img)
    for k, (orig, cut, label) in enumerate(rows):
        x, y = (k % 2) * W * 2, (k // 2) * W
        o = orig.convert("RGB")
        o.thumbnail((W - 6, W - 16))
        img.paste(o, (x + 3, y + 3))
        c = cut.copy()
        c.thumbnail((W - 6, W - 16))
        bg = Image.new("RGBA", c.size, (255, 255, 255, 255))
        bg.alpha_composite(c)
        img.paste(bg.convert("RGB"), (x + W + 3, y + 3))
        d.text((x + 3, y + W - 12), label[:40], fill=(90, 90, 90))
    img.save(path)


def main():
    sheet_dir = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    rejects = set(json.load(open(REJECTS, encoding="utf8")).get("rejects", {})) if os.path.exists(REJECTS) else set()
    os.makedirs(OUT, exist_ok=True)
    seen, todo, skipped = set(), [], {}
    amazon = 0
    for p in picks():
        u = p.get("image") or ""
        if not u.startswith("https://") or u in seen:
            continue
        seen.add(u)
        if is_amazon(p):
            amazon += 1
            continue  # never fetched, never edited
        todo.append(u)
    exe = swift_bin()
    cutouts, review = {}, []
    tmp = os.path.join(CACHE, "tmp")
    os.makedirs(tmp, exist_ok=True)
    for start in range(0, len(todo), BATCH):
        batch, args = [], []
        for u in todo[start:start + BATCH]:
            key = fnv1a32(u)
            if u in rejects:
                skipped[u] = "rejected on review"
                continue
            data = fetch(u)
            if not data:
                skipped[u] = "photo did not load"
                continue
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
            except Exception:  # noqa: BLE001 - not an image we can read: keep the original
                skipped[u] = "unreadable"
                continue
            if on_white(img):
                skipped[u] = "already on white"
                continue
            src = os.path.join(tmp, f"{key}-in.png")
            img.convert("RGB").save(src)
            batch.append((u, key, img))
            args += [src, os.path.join(tmp, f"{key}-out.png")]
        if not args:
            continue
        res = subprocess.run([exe, *args], capture_output=True, text=True)
        ok = {line.split("\t")[1] for line in res.stdout.splitlines() if line.startswith("OK\t")}
        for u, key, img in batch:
            src, dst = os.path.join(tmp, f"{key}-in.png"), os.path.join(tmp, f"{key}-out.png")
            if src not in ok or not os.path.exists(dst):
                skipped[u] = "no subject found"
            else:
                cut, why = finish(dst)
                if cut is None:
                    skipped[u] = why
                else:
                    cut.save(os.path.join(OUT, f"{key}.webp"), "WEBP", quality=82, method=6)
                    cutouts[u] = key
                    if sheet_dir:
                        review.append((img, cut, key))
            for f in (src, dst):
                if os.path.exists(f):
                    os.remove(f)
        print(f"{min(start + BATCH, len(todo))}/{len(todo)}: {len(cutouts)} cut out", flush=True)
    keep = set(cutouts.values())
    for f in os.listdir(OUT):
        if f.endswith(".webp") and f[:-5] not in keep:
            os.remove(os.path.join(OUT, f))
    assert len(keep) == len(cutouts), "two photo URLs share a cutout key"
    json.dump(sorted(keep), open(KEYS, "w", encoding="utf8"), indent=0)
    open(KEYS, "a").write("\n")
    json.dump({"cutouts": dict(sorted(cutouts.items())), "skipped": dict(sorted(skipped.items()))}, open(MANIFEST, "w", encoding="utf8"), indent=1, ensure_ascii=False)
    open(MANIFEST, "a").write("\n")
    if sheet_dir:
        os.makedirs(sheet_dir, exist_ok=True)
        for k in range(0, len(review), 40):
            sheet(review[k:k + 40], os.path.join(sheet_dir, f"cutouts-{k // 40 + 1:02d}.png"))
    print(f"amazon (never edited): {amazon}; checked: {len(todo)}; cut out: {len(cutouts)}; skipped: {len(skipped)}")


if __name__ == "__main__":
    main()
