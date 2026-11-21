#!/usr/bin/env python3
"""
The /gift-guides landing's own 1200x630 share card (public/gift-guides/og/landing.jpg), drawn from the live guides'
own share covers (public/gift-guides/og/<slug>.jpg, written by scripts/gift-guide-photo-covers.py) side by side on
the covers' cream, under one "Holiday gift guides" line.

Holiday audit 1121 (High): the card still showed the 8 guides of 11-19 (Mom, Dad, Her, Him, Grandma, Fishermen,
Girls, Louisiana-Made) in the old sage and pink gingham, four of them retired; only Her (beige), Him (green) and Kids
(red) are live (src/content/giftGuideLive.mjs). Re-run this whenever a live guide's cover changes, then bump
GIFT_GUIDES_LANDING_OG's ?v= in api/share.ts so Facebook re-scrapes it. Guard: src/test/giftGuideHolidayAudit1121.test.tsx.

Usage: python3 scripts/gift-guide-landing-og.py
"""
import hashlib
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OG = os.path.join(ROOT, "public", "gift-guides", "og")
SOURCES = os.path.join(ROOT, "scripts", "gift-guide-landing-og.json")
LIVE = ["her", "him", "kids"]  # the landing's order (owner 11-21: Her, Him, Kids)
W, H = 1200, 630
CREAM = (250, 247, 240)  # the old card's and the covers' cream, measured
INK = (52, 43, 35)
TILE, GAP, TOP = 372, 22, 196

GEN = next((d for d in [os.environ.get("GIFT_COVER_GEN") or "", os.path.expanduser("~/Desktop/Pin-cover-generator"),
                        os.path.expanduser("~/Desktop/Louisiana Helpr Work/Social and Pinterest/Pin-cover-generator")]
            if d and os.path.exists(os.path.join(d, "pin_covers.py"))), None)


def title_font(size):
    """The covers' own Playfair Display (the owner's generator), else a serif the Mac has."""
    if GEN:
        sys.path.insert(0, GEN)
        import pin_covers as pc  # noqa: E402 - the owner's generator, so the card matches the covers
        f = pc.font("PlayfairDisplay.ttf", size)
        try:
            f.set_variation_by_axes([600])
        except Exception as e:  # a static font file has no weight axis; its own weight is fine
            print("landing og: no weight axis:", e)
        return f
    return ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia.ttf", size)


def main():
    card = Image.new("RGB", (W, H), CREAM)
    x0 = (W - (TILE * len(LIVE) + GAP * (len(LIVE) - 1))) // 2
    for i, slug in enumerate(LIVE):
        tile = Image.open(os.path.join(OG, f"{slug}.jpg")).convert("RGB").resize((TILE, TILE), Image.LANCZOS)
        card.paste(tile, (x0 + i * (TILE + GAP), TOP))
    d = ImageDraw.Draw(card)
    d.text((W // 2, 98), "Holiday gift guides", font=title_font(76), fill=INK, anchor="mm")
    out = os.path.join(OG, "landing.jpg")
    card.save(out, "JPEG", quality=86, progressive=True, optimize=True)
    # What the card was drawn from: the guard fails when a live cover changes and this card was not redrawn.
    sources = {slug: hashlib.sha256(open(os.path.join(OG, f"{slug}.jpg"), "rb").read()).hexdigest() for slug in LIVE}
    with open(SOURCES, "w", encoding="utf8") as f:
        json.dump({"_": "sha256 of each live cover og/landing.jpg was drawn from (scripts/gift-guide-landing-og.py)", **sources}, f, indent=2)
        f.write("\n")
    print("wrote", out, card.size, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
