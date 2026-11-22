#!/usr/bin/env python3
"""
The 1200x630 share cards for the Coloring books and Banners printables pages (owner 2026-11-21: "coloring book and
banner should have their own page", each with its own share image). Same look as the gift tags card
(public/printables/og-printables.jpg): the rose gingham (56 px repeat, measured from that card), a cream panel with
"FREE PRINTABLE", the title in the serif, one line, "LOUISIANA HELPR", and the owner's own preview images on the
right, shown as they are (never redrawn or recoloured).

Writes public/printables/og-coloring-books.jpg and public/printables/og-banners.jpg. Re-run when a preview changes and
bump the ?v= in api/share.ts giftGuideCover.

Usage: python3 scripts/printables-og-cards.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "public", "printables")
W, H = 1200, 630
DARK, MID, CREAM = (200, 154, 148), (221, 185, 180), (250, 246, 238)
PANEL = (250, 247, 240)
INK, RED, GREEN = (52, 43, 35), (143, 47, 42), (47, 74, 46)
SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
SERIF_I = "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"
SANS_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"


def gingham():
    im = Image.new("RGB", (W, H), CREAM)
    px = im.load()
    for y in range(H):
        ys = (y % 56) < 28
        for x in range(W):
            xs = (x % 56) < 28
            px[x, y] = DARK if xs and ys else MID if xs or ys else CREAM
    return im


def shadowless_paste(card, img, box_w, box_h, cx, cy, angle=0):
    img = img.convert("RGB")
    img.thumbnail((box_w, box_h), Image.LANCZOS)
    if angle:
        img = img.convert("RGBA").rotate(angle, resample=Image.BICUBIC, expand=True)
        card.paste(img, (cx - img.width // 2, cy - img.height // 2), img)
    else:
        card.paste(img, (cx - img.width // 2, cy - img.height // 2))


def card(title_lines, line, images, out):
    c = gingham()
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((48, 48, 608, 582), radius=28, fill=PANEL)
    d.text((96, 122 if len(title_lines) < 3 else 98), "FREE PRINTABLE", font=ImageFont.truetype(SANS_B, 20), fill=RED, spacing=4)
    y = 170 if len(title_lines) < 3 else 150
    for text, italic in title_lines:
        f = ImageFont.truetype(SERIF_I if italic else SERIF, 64)
        d.text((96, y), text, font=f, fill=RED if italic else INK)
        y += 78
    y += 18
    f = ImageFont.truetype(SANS, 24)
    for part in line:
        d.text((96, y), part, font=f, fill=INK)
        y += 36
    d.text((96, 500), "LOUISIANA HELPR", font=ImageFont.truetype(SANS_B, 20), fill=GREEN)
    for (path, bw, bh, cx, cy, angle) in images:
        shadowless_paste(c, Image.open(os.path.join(PUB, path)), bw, bh, cx, cy, angle)
    c.save(os.path.join(PUB, out), "JPEG", quality=86, progressive=True, optimize=True)
    print(out, os.path.getsize(os.path.join(PUB, out)) // 1024, "KB")


card([("Christmas", False), ("coloring books", True)], ["Two 21-page books to print", "at home, free."],
     [("coloring-book/preview-girls.webp", 250, 330, 780, 320, 4), ("coloring-book/preview-boys.webp", 250, 330, 1010, 320, -4)],
     "og-coloring-books.jpg")
card([("Happy", False), ("Thanksgiving", True), ("banner", True)], ["Print it at Walgreens or any", "photo counter, free."],
     [("thanksgiving-banner/preview.webp", 520, 260, 900, 315, 0)],
     "og-banners.jpg")
