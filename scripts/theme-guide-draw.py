"""The square cover of one themed kids guide (owner 2026-11-24: "the preview on the link is the green cover with the 6
images"), drawn exactly like Monster Jam's: scripts/gift-guide-photo-covers.py's render() on the green gingham
(SLUG_TINT), its six photos from the guide's entry in scripts/gift-guide-cover-items.json, saved as
public/gift-guides/covers/<slug>.webp (480 px, at most 19.5 KB, the covers guard). Run by scripts/theme-guide-import.mjs:
  python3 scripts/theme-guide-draw.py <slug> "<Title>"
Render only: the cover generator's photo cutting needs scipy.ndimage, which drawing never calls, so it is stubbed when
this Mac has no scipy.
"""
import importlib.util
import json
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
try:
    import scipy.ndimage  # noqa: F401 - the real one when installed
except ImportError:  # render-only: the stub is never called while drawing
    scipy = types.ModuleType("scipy")
    scipy.ndimage = types.ModuleType("scipy.ndimage")
    sys.modules["scipy"] = scipy
    sys.modules["scipy.ndimage"] = scipy.ndimage

from PIL import Image  # noqa: E402

spec = importlib.util.spec_from_file_location("covers", os.path.join(ROOT, "scripts", "gift-guide-photo-covers.py"))
covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(covers)


def main():
    if len(sys.argv) != 3:
        sys.exit('usage: theme-guide-draw.py <slug> "<Title>"')
    slug, title = sys.argv[1], sys.argv[2]
    if covers.SLUG_TINT.get(slug) != "green":
        sys.exit(f"{slug}: not green in SLUG_TINT (scripts/gift-guide-photo-covers.py)")
    manifest = json.load(open(covers.MANIFEST, encoding="utf8"))
    items = manifest[slug]["items"]
    if len(items) != 6:
        sys.exit(f"{slug}: {len(items)} cover items, need 6")
    prods = []
    for it in items:
        rel = it["image"].split("louisianahelpr.com/", 1)[1]
        prods.append(Image.open(os.path.join(ROOT, "public", rel)).convert("RGBA"))
    row = {"slug": slug, "group": "For kids", "lead": "the", "title": title}
    im = covers.render(row, prods)
    out = os.path.join(covers.OUT, f"{slug}.webp")
    small = im.resize((480, 480), Image.LANCZOS)
    for q in (58, 52, 46, 40, 34):  # the covers guard: at most 20 KB each
        small.save(out, "WEBP", quality=q, method=6)
        if os.path.getsize(out) <= 19_500:
            break
    print(f"cover {slug}: {os.path.getsize(out)} bytes")


if __name__ == "__main__":
    main()
