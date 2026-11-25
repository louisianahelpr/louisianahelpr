"""Gift guide photo covers in the owner's Pinterest pin style (pin_covers.py photo_cover / cover2_example.cover2, 11-18):
the guide family's gingham, a big cream arch (about half the width, nearly the full height, thin inner outline) with
"gifts for" in script, the serif guide name, a short divider and the spaced LOUISIANA HELPR footer, and six product
cutouts, three a side, overlapping the arch edges with the pins' soft shadow. Owner 11-18: "make the arched bigger so
the items kind of over lap the arch" / "Like these" (her pin covers). The gingham is the three agreed families of the
committed text-only covers (owner 11-18: "we agreed on the red green and beige earlier"), softened a little so the
products stay easy to see: green for By person/By store/Life moments/Louisiana, tan for By budget/By career/Colors, red
for For kids/Hobbies/Pets. The footer is the name's ink in Montserrat 600, readable on the landing's 160 px tiles.

Products (owner 11-18: "Idk that mom wants muck boots?"): the cover audit's six, then the fit audit's final_top25, else the guide's featured order (the picks file's own
order, from _featured-order.json), skipping a photo that will not cut out cleanly; one per brand, at most one per kind
(one boot, one pair of shoes, one drinkware, ...), and no boots at all on Mom/Her/Wife except UGG. A store page
(store-*) may repeat its own brand and kind (Durango Boots is all boots).

Run with a Python that has Pillow, numpy and scipy (not the repo's runtime; the covers are static files):
  python scripts/gift-guide-photo-covers.py            (every cover; writes scripts/gift-guide-cover-items.json)
  python scripts/gift-guide-photo-covers.py --stores   (only the store section's covers, after new store photos)
It draws every guide in landing order. Six products, or four (two a side) when fewer than six pass; a guide still
short gets the same polished cover with no products. No product appears on two covers of the same landing section
(owner 11-18: "No duplicates on cover", then "no repeats within a section"): a product counts as its brand (or line:
any Stanley, any Squishmallow) and kind, the first cover in landing order keeps it, one boot cover per section, and a
one-brand store page keeps its brand. Careers may repeat a product, never on two career
covers next to each other (owner 11-18). Only covers whose products changed are redrawn unless GIFT_COVER_ALL=1. A store page also uses its store's products named in other guides. scripts/check-gift-cover-duplicates.mjs checks the manifest.
No Louisiana items outside the Louisiana section (owner 11-18).

Photos: each pick's own `image` from src/content/giftGuidePicks/<slug>.json, Amazon-hosted ones included (owner 11-18
approved Amazon photos: "Just screenshot then crop the rest of them from Amazon it's fine"; AMAZON_CDN_PHOTOS on). A photo is used only on a near-white background: the cutout keeps
pixels more than 26 off white, then the large connected parts (holes filled), so lifestyle shots are skipped. TIGHT
names white products on white (AirPods), whose threshold mask finds only the shading: they are cut out instead by
flooding the background from the photo's edge at 2 off white. COVER_SKIP drops odd or niche picks from one cover
(Walmart: the welding helmet and Hot Wheels; owner 11-18).
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

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PICKS = os.path.join(ROOT, "src", "content", "giftGuidePicks")
OUT = os.path.join(ROOT, "public", "gift-guides", "covers")
OG = os.path.join(ROOT, "public", "gift-guides", "og")
CACHE = os.environ.get("GIFT_COVER_CACHE", os.path.expanduser("~/.lh-shots/gg-cover-cache"))
# The owner's generator moved on her Desktop (11-20); $GIFT_COVER_GEN overrides, else the first folder holding pin_covers.py.
GEN = next((d for d in [os.environ.get("GIFT_COVER_GEN") or "", os.path.expanduser("~/Desktop/Pin-cover-generator"),
                        os.path.expanduser("~/Desktop/Louisiana Helpr Work/Social and Pinterest/Pin-cover-generator")]
            if d and os.path.exists(os.path.join(d, "pin_covers.py"))), os.path.expanduser("~/Desktop/Pin-cover-generator"))
sys.path.insert(0, GEN)
import pin_covers as pc  # noqa: E402 - the owner's generator, so the covers are the pins' own style
# The three agreed families (owner 11-18: "we agreed on the red green and beige earlier"), each the committed text-only
# covers' own gingham (check, band, overlap, measured at their 480 px check centres), softened 30% / 15% toward the
# overlap cream so the products stay easy to see on the checks.
CREAM_O = (250, 247, 239)


def soften(pal, k=0.30, kb=0.15):
    a, b, o = pal
    mix = lambda c, t: tuple(round(x + (y - x) * t) for x, y in zip(c, CREAM_O))  # noqa: E731
    return mix(a, k), mix(b, kb), o


FAMILY = {
    # Owner 11-21: "we also agreed on a more christmas red and christmas green": deep holly green and berry red checks,
    # no longer softened toward cream (beige stays as it was).
    "green": ((38, 94, 60), (150, 178, 154), CREAM_O),
    "tan": soften(((206, 186, 154), (228, 215, 196), CREAM_O), 0.30, 0.15),
    "red": ((168, 36, 42), (222, 150, 148), CREAM_O),
}
TINT = {"By person": "green", "By store": "green", "Life moments": "green", "Louisiana": "green",
        "By budget": "tan", "By career": "tan", "Colors": "tan", "For kids": "red", "Hobbies": "red", "Pets": "red"}
# Owner 11-21 ("update the her him and kids guides to be red green or beige"): one family each, so the three
# live guides never share a colour. Wins over the section tint above. Owner 2026-11-21 (later): "make her beige and
# change the kids cover to red".
# Owner 2026-11-24 ("the preview on the link is the green cover with the 6 images"): Monster Jam is green.
SLUG_TINT = {"her": "tan", "him": "green", "kids": "red", "monster-jam": "green", "bluey": "green", "marvel": "green", "kpop-demon-hunters": "green", "pokemon": "green", "minecraft": "green", "hot-wheels": "green", "cars": "green"}
TIGHT = re.compile(r"airpods", re.I)
# The cover audit's six per guide (11-18; "idk that a girl wants a grill toy"), then the fit audit's final_top25 for
# that guide (owner 11-18: "Make sure all gifts are appropriate per section"). Only the guide's own picks are used
# (never another guide's photo); a guide the fit audit did not cover (most store pages) uses its own featured order.
AUDIT_DIR = next((d for d in [os.environ.get("GIFT_COVER_AUDIT_DIR") or "", os.path.expanduser("~/Desktop/Gift-guide-picks"),
                              os.path.expanduser("~/Desktop/Louisiana Helpr Work/Gift guides and affiliate/Gift-guide-picks")]
                  if d and os.path.isdir(d)), os.path.expanduser("~/Desktop/Gift-guide-picks"))


def _load(name):
    path = os.path.join(AUDIT_DIR, name)
    return json.load(open(path, encoding="utf8")) if os.path.exists(path) else {}


AUDIT = _load("_cover-picks-1118.json")
# The owner's own cover picks (11-21, e.g. "for the her guide remove the camera and the biodance from the cover. replace
# those with the hatch alarm clock and the current body red light mask"): scripts/gift-guide-cover-pins.json, in the repo.
# A guide listed there draws its "items" first, by name, before any audit list. "photos" gives an Amazon-linked pick a
# photo of the same product from another store (a transparent cutout under public/gift-guides/cutouts/), so it can be on
# the cover while Amazon's own photo is never edited or drawn (Associates terms; scripts/check-gift-cover-in-guide.mjs).
COVER_PINS = {k: v for k, v in json.load(open(os.path.join(ROOT, "scripts", "gift-guide-cover-pins.json"), encoding="utf8")).items()
              if not k.startswith("_")}
FIT = _load("_fit-audit-1118.json")
MANIFEST = os.path.join(ROOT, "scripts", "gift-guide-cover-items.json")
# Store covers show what a store sells (owner 11-18: "the images on the store only would show what items the store
# carries"): bestseller photos per store from _store-cover-images-1118.json, after the store's own picks, minus the
# photos rejected on review (scripts/gift-guide-store-image-rejects.json: ads, text-heavy shots, people, logos; a
# photo listed there is never drawn on any cover, whichever pick carries it).
STORE_IMAGES = _load("_store-cover-images-1118.json")
# Round 2 of the bestseller photos (122 stores, 57 not in round 1) was gathered but never read here (r3 H1): it is.
for _k, _v in _load("_store-cover-images-r2-1118.json").items():
    if isinstance(_v, list):
        _have = {x.get("image") for x in STORE_IMAGES.get(_k, []) if isinstance(x, dict)}
        STORE_IMAGES[_k] = list(STORE_IMAGES.get(_k, [])) + [x for x in _v if isinstance(x, dict) and x.get("image") not in _have]
# Store cover photos gathered for the text-only store covers (r3 follow-up, 11-19), kept in the repo: each a store's own
# product photo on a plain backdrop (its product page's og:image or JSON-LD image, its Shopify catalog, or the link
# library), fetched with a browser user agent at 1 request a second per host, checked against these cutout rules and by eye.
_extra = os.path.join(ROOT, "scripts", "gift-guide-store-cover-photos.json")
for _k, _v in (json.load(open(_extra, encoding="utf8")) if os.path.exists(_extra) else {}).items():
    if isinstance(_v, list):
        _have = {x.get("image") for x in STORE_IMAGES.get(_k, []) if isinstance(x, dict)}
        STORE_IMAGES[_k] = list(STORE_IMAGES.get(_k, [])) + [x for x in _v if isinstance(x, dict) and x.get("image") not in _have]
# Round 2 of the Amazon store fill (short store key -> products), the same way: after the store's own picks.
STORE_FILL = {f"store-{k}": v for k, v in _load("_store-fill-amazon-1118.json").items() if isinstance(v, list)}
_rej = os.path.join(ROOT, "scripts", "gift-guide-store-image-rejects.json")
STORE_REJECTS = set(json.load(open(_rej, encoding="utf8")).get("rejects", {})) if os.path.exists(_rej) else set()
# Pick photos that show a different product than the pick's name (ShopMy pins, found 11-18): never on a cover.
BAD_PHOTOS = {"https://static.shopmy.us/uploads/pretty-prod-1793650025807",  # "Cheirosa 62 Perfume Mist": earbuds
              "https://static.shopmy.us/pins/zoom-104125781-1794427184151-1106872-chsnut_1.jpg",  # a throw: UGG slipper
              "https://static.shopmy.us/pins/zoom-104053796-1794418641085-"}  # "Owala 32oz": Crocs
COVER_SKIP = {"store-walmart": re.compile(r"welding|hot wheels", re.I),
              # owner 11-18: "idk that a girl wants a grill toy"
              **{g: re.compile(r"\bgrill\b", re.I) for g in ("girls", "niece", "girls-babies", "girls-little-kids",
                                                              "girls-big-kids", "girls-teens", "big-sisters")}}
# Never on any cover: a gift card or membership (a logo, not a product), a storefront or collection pick (a word
# mark), underwear and the like (a model in briefs), deodorant, and the white JBL Go photo (it cuts out grey).
COVER_NEVER = re.compile(r"gift ?card|e-?gift|membership|subscription|underwear|bikini|\bperiod\b|\bbriefs?\b|"
                         r"\bbras?\b|bralette|lingerie|thong|panty|panties|\bcami\b|camisole|slip dress|compression|deodorant|body spray|collection|best ?sellers|"
                         r"the best skincare|jbl go 4|spicebox|planner stickers|heated (electric|black buffalo)", re.I)  # "HEATED" badge photos
# Clothes shot on a person (r3 H1 review: Lululemon's jogger and half-zip cut out as a whole model): on a store cover
# only from a pure white photo (a flat lay or packshot); a grey studio backdrop is a model shot.
WORN = re.compile(r"\bjoggers?\b|leggings?|\bpants?\b|hoodie|half[- ]zip|quarter[- ]zip|funnel[- ]neck|pullover|"
                  r"crewneck|sweatshirt|\bshorts?\b|\btank\b|\bdress\b|jumpsuit|romper|\bjackets?\b|\bparka\b|\bvest\b|"
                  r"\bcoat\b|cardigan|sweater|blouse|\bshirt\b|\btop\b|\bonesie\b|pajamas?|\bpjs?\b|\brobe\b|loungewear|\bset\b.*\b(lounge|pajama)", re.I)


def skin(c):
    """The share of a cutout's pixels in the usual skin-tone range (YCbCr): a person wearing the product."""
    al = np.asarray(c.split()[3]) > 128
    if not al.any():
        return 0.0
    ycc = np.asarray(c.convert("RGB").convert("YCbCr")).astype(int)[al]
    return float(((ycc[:, 1] >= 77) & (ycc[:, 1] <= 127) & (ycc[:, 2] >= 137) & (ycc[:, 2] <= 173) & (ycc[:, 0] > 60)).mean())


def worn(slug, p, c):
    """Clothes on a model: on a store page any non-white photo, anywhere a photo with a person's skin showing."""
    if c is None or not WORN.search(p.get("name") or ""):
        return False
    return (slug.startswith("store-") and not CUT_WHY.get("white")) or skin(c) > 0.06
COVER_SKIP["sister"] = re.compile(r"cozychic", re.I)  # a pale throw on the cream arch
# r3 M6 (11-19): pale items that wash out on the cream arch and the gingham.
COVER_SKIP["girlfriend"] = re.compile(r"necklace", re.I)
COVER_SKIP["cousins"] = re.compile(r"bottles?\b", re.I)
COVER_SKIP["boater"] = re.compile(r"multi-?tool", re.I)
COVER_SKIP["louisiana-boutiques"] = re.compile(r"earrings?", re.I)
COVER_SKIP["artist"] = re.compile(r"controller|gaming|console|headset", re.I)  # design review M3: art supplies, not games
# Budget covers lead with colourful, recognisable gifts (owner 11-18): socks, tees, hats, lunch bags and the like last.
PLAIN = re.compile(r"\bsocks?\b|\btees?\b|t-shirt|tasting cup|\bcrew\b|trucker hat|lunch (bag|lugger)|scalp massager", re.I)
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
    "plush": re.compile(r"squishmallow|plush|stuffed", re.I),
    "griddle": re.compile(r"griddle|\bgrill\b|smoker", re.I),
    "speaker": re.compile(r"speaker|soundlink", re.I),
    "ereader": re.compile(r"kindle|e-reader", re.I),
    "massager": re.compile(r"theragun|massage gun|massager", re.I),
    # r3 M4/M5 (11-19): the same item twice on one cover (two hand warmers, two Dutch ovens, two tourniquets) and the
    # same item on neighbouring covers of a row under different colour names (a pink and a red KitchenAid mixer).
    "warmer": re.compile(r"hand ?warmers?|body warmers?|\bwarmers\b", re.I),
    "dutchoven": re.compile(r"dutch oven|cocotte|\ble creuset\b", re.I),
    "tourniquet": re.compile(r"tourniquet", re.I),
    "skillet": re.compile(r"skillet|cast[- ]iron pan|fry pan", re.I),
    "mixer": re.compile(r"stand mixer|\bkitchenaid\b.*\bmixer\b", re.I),
    "cards": re.compile(r"playing cards|\bbicycle\b.*\bcards?\b|deck of cards", re.I),
    "diecast": re.compile(r"hot wheels|die-?cast|matchbox", re.I),
    "handcream": re.compile(r"hand cream|hand balm|hand lotion", re.I),
    "lip": re.compile(r"\blip (oil|balm|butter|mask|gloss|glowy|sleeping|treatment|tint)|lip ?balm|lip ?gloss|lip ?oil", re.I),
}
# A product line counts as its brand for "no duplicates across covers" (owner 11-18: any Squishmallow, any Stanley ...).
LINES = re.compile(r"squishmallow|airpods|stanley|owala|blackstone|yeti|kindle|theragun|hydro ?flask|\bjbl\b|\blego\b|"
                   r"crayola|barbie|bluey|\bugg\b|xtratuf|ember|\bbose\b|ninja|dyson|traeger|leatherman|instax|nintendo|"
                   r"laneige|sol de janeiro|cheirosa|carhartt|vera bradley|hot wheels|kitchenaid|le creuset|l'occitane", re.I)


def index():
    """The owner's index, then every researched store page (giftGuideCatalog's GUIDE_INDEX: By store, "shop", name order)."""
    src = open(os.path.join(ROOT, "src", "content", "giftGuideIndex.ts"), encoding="utf8").read()
    rows = re.findall(r'\{ group: "([^"]+)",[^}]*?slug: "([^"]+)", title: "([^"]+)", lead: "([^"]*)"([^}]*)\}', src)
    out = [{"group": g, "slug": s_, "title": t, "lead": l, "child": "parent:" in rest, "owner": True,
            "parent": (re.search(r'parent: "([^"]+)"', rest) or [None, None])[1]} for g, s_, t, l, rest in rows]
    picks = open(os.path.join(ROOT, "src", "content", "giftGuidePicks.ts"), encoding="utf8").read()
    m = re.search(r"export const RESEARCHED_STORES[^=]*= (\{.*?\});\n", picks)
    owner = {r["slug"] for r in out}
    stores = json.loads(m.group(1)) if m else {}
    extra = sorted(((s_, st["name"]) for s_, st in stores.items() if s_ not in owner), key=lambda x: x[1].lower())
    # Big batch 1120: a guide merged into another as a section, or a folded store page, has no chunk and no page: no
    # cover. The Kids hub (no list of its own) keeps its cover.
    has_page = lambda s_: s_ == "kids" or os.path.exists(os.path.join(PICKS, f"{s_}.json"))
    return [r for r in out if has_page(r["slug"])] + [{"group": "By store", "slug": s_, "title": n, "lead": "shop", "child": False, "owner": False} for s_, n in extra if has_page(s_)]


def targets(rows):
    """Every guide (owner 11-18: "all covers need to be updated with the items not just certain ones")."""
    return rows


def fetch(url):
    # A photo the site hosts itself (a sponsor photo, a 11-20 cutout) is read from public/: it may not be deployed yet,
    # and a 404 would be remembered in the cache as a dead photo.
    own = "https://www.louisianahelpr.com/gift-guides/"
    if url.startswith(own):
        local = os.path.join(ROOT, "public", "gift-guides", *url[len(own):].split("?")[0].split("/"))
        if os.path.exists(local):
            return open(local, "rb").read()
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest())
    if os.path.exists(path):
        data = open(path, "rb").read()
        return data or None
    data = b""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = r.read(6_000_000)
    except Exception as e:  # noqa: BLE001 - a dead photo just isn't used; the cache remembers it as empty
        print(f"  skip {url[:90]}: {e}", file=sys.stderr)
    open(path, "wb").write(data)
    return data or None


CUT_WHY = {}  # the last rejection reason per call (debug: why a photo was skipped)


def _reject(why):
    CUT_WHY["last"] = why
    return None


def cutout(data, tight=False):
    """The product on a near-white photo, as RGBA cropped to it; None for a photo that isn't on white."""
    try:
        src = Image.open(io.BytesIO(data))
        if src.mode in ("RGBA", "LA", "PA") or (src.mode == "P" and "transparency" in src.info):
            # A transparent PNG (Stanley's own product shots) is the cleanest cutout of all: flatten it onto white.
            # convert("RGB") alone turns its transparent background black, and every such photo failed the white
            # border test (r3 H1: store-stanley drew 2 of 26 photos, so its cover went text only).
            rgba = src.convert("RGBA")
            al = np.asarray(rgba)[:, :, 3]
            ring = np.concatenate([al[0], al[-1], al[:, 0], al[:, -1]])
            if (ring <= 8).mean() > 0.98 and 0.04 < (al > 128).mean() < 0.9:
                # Already a clean cutout (the guides' own cutouts, a brand's transparent packshot): keep its alpha as is.
                # Flattened onto white, a white product (a cream cap, a white mask) merged into the backdrop and was cut
                # apart (owner 11-21 cover review).
                rgba.thumbnail((600, 600))
                return rgba.crop(rgba.getbbox())
            im = Image.new("RGB", rgba.size, (255, 255, 255))
            im.paste(rgba, (0, 0), rgba)
        else:
            im = src.convert("RGB")
    except Exception:  # noqa: BLE001 - not an image the browser would show either
        return _reject("not an image")
    im.thumbnail((600, 600))
    a = np.asarray(im).astype(int)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    # The studio backdrop: pure white, or one even light tone (a shop's #F5F5F5 or cream, r3 H1: 193 photos on the
    # short covers were clean product shots on an off-white backdrop and were all skipped as "not on white"). The
    # cutout measures each pixel's distance from that backdrop, so pure white behaves exactly as before.
    # A photo may sit on two light tones (Lululemon: a pale grey panel on a white canvas): the second tone, when it
    # holds a quarter of the border, counts as backdrop too, and each pixel is measured from the nearer tone.
    light = lambda c: c.min() >= 205 and c.mean() >= 225  # noqa: E731 - white, grey #EBEBEB, Milk Bar's peach
    bg = np.median(border, axis=0)
    rest = border[np.abs(bg - border).max(axis=1) > 12]
    tones = [bg] + ([np.median(rest, axis=0)] if len(rest) >= 0.25 * len(border) else [])
    if not all(light(t) for t in tones):
        return _reject("a dark or coloured backdrop")  # a lifestyle shot
    CUT_WHY["white"] = len(tones) == 1 and bg.min() >= 250  # pure white: a flat lay or a packshot, not a model shot
    off = np.min([np.abs(t - a).max(axis=2) for t in tones], axis=0)
    boff = np.min([np.abs(t - border).max(axis=1) for t in tones], axis=0)
    if (boff <= 26).mean() < 0.85:
        return _reject("not on one even backdrop")  # a lifestyle shot
    if (boff <= 6).mean() < 0.7:
        return _reject("an uneven backdrop")  # a cast shadow or a gradient (Sol de Janeiro's jar): it cuts out sliced
    fg = off > 26
    if tight:
        lab, _ = ndimage.label(off <= 2)
        edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        fg = ~np.isin(lab, list(edge))
    raw = fg
    fg = ndimage.binary_opening(fg, iterations=1)
    lab, n = ndimage.label(fg)
    if n == 0:
        return _reject("nothing on the backdrop")
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    boxes = ndimage.find_objects(lab)
    big = [i + 1 for i, v in enumerate(sizes) if v >= 0.08 * sizes.max()]
    # The product's own small pieces (the CREAMi's cup, a kit's parts, a glasses arm) sit near its big parts and stay.
    # A small piece standing apart (a "TOP TOY" badge, a colour bar under the product) would show as junk on the
    # gingham, and erasing a real piece would show a partial product: the photo is skipped either way.
    near = ndimage.binary_dilation(np.isin(lab, big), iterations=20)
    zone = ndimage.binary_dilation(np.isin(lab, big), iterations=90)
    for i, v in enumerate(sizes):
        if i + 1 in big or v < 0.01 * sizes.max():
            continue
        b = boxes[i]
        thin = min(b[0].stop - b[0].start, b[1].stop - b[1].start) * 8 < max(b[0].stop - b[0].start, b[1].stop - b[1].start)
        here = lab == i + 1
        if not zone[here].any() or (thin and not near[here].any()):
            return _reject("a stray piece apart from the product")
        big.append(i + 1)
    if len(big) > 14:
        return _reject("many separate pieces")  # many separate pieces: a word mark or a logo, not a product
    keep = np.isin(lab, big)
    # The opening above shaves thin attached parts (grill legs, glasses arms, cords): put back raw pixels touching them.
    keep |= raw & ndimage.binary_dilation(keep, iterations=3)
    fg = ndimage.binary_fill_holes(keep)
    # Owner 11-21 ("no guides images have background like the stanley cooler ... has white in the background of the
    # handle"): a hole the product encloses (a bag's handle, a mug's ear) that is the photo's own backdrop is cut out
    # too, so the gingham shows through it. Only a sizeable hole of near-backdrop colour; the product's own white
    # panels are shaded or printed and stay.
    holes, nh = ndimage.label(fg & ~keep | (fg & (off <= 8)))
    for i in range(1, nh + 1):
        h = holes == i
        if h.sum() >= 0.004 * h.size and not (h[0].any() or h[-1].any() or h[:, 0].any() or h[:, -1].any()) and (off[h] <= 10).mean() > 0.9:
            fg &= ~h
    edge = np.concatenate([fg[:2].ravel(), fg[-2:].ravel(), fg[:, :2].ravel(), fg[:, -2:].ravel()])
    # A product standing on the photo's bottom edge (Dillard's crops shoes and bags tight to the floor) is whole: only
    # the bottom edge touched, along at most half its width.
    rests = fg[-2:].any(axis=0).mean() <= 0.5 and not (fg[:2].any() or fg[:, :2].any() or fg[:, -2:].any())
    if edge.mean() > 0.015 and not rests:
        return _reject("the product runs off its own photo")  # the product runs off its own photo: it would show sliced (a tight crop grazing the edge is fine)
    if not tight and (off[fg] <= 40).mean() > 0.6:
        return _reject("white on white (the JBL Go)")  # white on white (the JBL Go): it cuts out grey
    share = fg.mean()
    if share < 0.04 or share > 0.9:
        return _reject("product too small or too big in its photo")
    ys, xs = np.nonzero(fg)
    w, h = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    if max(w, h) > 3 * min(w, h):
        return _reject("a banner or badge ('HEATED'), not a product")  # a banner or badge ("HEATED"), not a product
    if len(big) > 4 and fg.sum() < 0.2 * w * h:
        return _reject("a few sparse letters around an icon")  # a few sparse letters around an icon: a logo ("vstapn"), not a product
    alpha = Image.fromarray((fg * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.0))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out.crop(out.getbbox())


# Guides whose items ARE card art (lead 11-19: "gift card art is fine as an item"; Sam's Club cards, magazine covers,
# subscription boxes): gift cards and memberships are allowed there, and a photo that fills its frame is drawn whole
# as a rounded card instead of cut out.
CARD_GUIDES = {"gift-cards", "subscriptions"}
# Neutral Lover is cream, ivory and white things: its light products are the point (shown with the stronger shadow).
LIGHT_OK = {"neutral-lover"}


def card(data):
    """The photo as a card: cropped to its content (a white margin trimmed), corners rounded."""
    try:
        src = Image.open(io.BytesIO(data))
        rgba = src.convert("RGBA")
        im = Image.new("RGB", rgba.size, (255, 255, 255))
        im.paste(rgba, (0, 0), rgba)
    except Exception:  # noqa: BLE001 - not an image the browser would show either
        return None
    im.thumbnail((600, 600))
    a = np.asarray(im).astype(int)
    ys, xs = np.nonzero(np.abs(255 - a).max(axis=2) > 12)
    if len(xs) < 0.2 * a.shape[0] * a.shape[1]:
        return None
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    w, h = im.size
    if max(w, h) > 2.2 * min(w, h):
        return None
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(min(w, h) * 0.06), fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def is_light(c):
    """Mostly light (white, cream, pale): over half its pixels above luminance 200, or a mean above 185."""
    rgb = np.asarray(c.convert("RGB")).astype(float)
    al = np.asarray(c.split()[3]) > 128
    if not al.any():
        return True
    lum = (rgb[al] * (0.299, 0.587, 0.114)).sum(axis=1)
    return (lum > 200).mean() > 0.5 or lum.mean() > 185


def brand_word(p):
    name = p.get("name") or ""
    m = LINES.search(name)
    if m:
        w = re.sub(r"\W+", "", m.group(0).lower())
        return {"squishmallows": "squishmallow", "cheirosa": "soldejaneiro"}.get(w, w)
    b = (p.get("brand") or "").strip().lower()
    if not b or "affiliate" in b or b in {"walmart", "target", "amazon basics"}:
        return ""  # no maker named (or the brand field names the store): the product counts by its own name
    return re.sub(r"\W+", "", b)


def dedupe(name):
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def cover_key(p, own_brand=None):
    """The product as "no duplicates across covers" counts it: its brand (or line) and its kind."""
    b = brand_word(p)
    if not b:
        return f"item:{dedupe(p.get('name'))}"
    if own_brand and b == own_brand:
        return f"{b}:{dedupe(p.get('name'))}"  # a brand's own store page shows several of its products
    ks = sorted(kinds(p))
    if not ks:  # no known kind: its type is the name's last word ("... Rain Defender Jacket" -> jacket)
        words = [w for w in re.findall(r"[a-z]+", (p.get("name") or "").lower()) if len(w) > 2 and w not in ("pack", "set", "with", "and")]
        ks = words[-1:]
    return f"{b}:{','.join(ks)}"


def kinds(p):
    text = f"{p.get('name') or ''} {p.get('brand') or ''}"
    return {k for k, rx in KINDS.items() if rx.search(text)}


LOUISIANA = re.compile(
    r"louisiana|cajun|creole|\bnola\b|new orleans|fleur[ -]de[ -]lis|mardi gras|carnival mask|\bsaints\b|\blsu\b|"
    r"geaux|zatarain|chachere|cafe du monde|caf\u00e9 du monde|camellia|crawfish|boudin|beignet|praline|king cake|"
    r"\bbayou|gumbo|jambalaya|acadian|tabasco|community coffee|slap ya mama|steen'?s|who dat|pelican|swamp|"
    r"aunt sally|big easy|magnolia|second line|zydeco|\bnoca\b|tulane|ragin|\bul lafayette", re.I)


# Covers still short of four after every candidate (r3 follow-up: the fit audit's removals left Service Industry with
# three, its other photos all shoes): a second product of a kind already on the cover is allowed, never a third.
REPEAT_KIND = set()


def allowed(slug, p, taken, group=""):
    """The variety rules for one more product on this cover, given the picks already on it."""
    # A store page shows its own products (Magnolia, the Texas home brand, matched "magnolia" and drew nothing).
    if group != "Louisiana" and slug != "purple-and-gold-lover" and not slug.startswith("store-") and LOUISIANA.search(f"{p.get('name') or ''} {p.get('brand') or ''}"):
        return False  # owner 11-18: no Louisiana items on a cover outside the Louisiana section
    ks = kinds(p)
    if "boot" in ks and slug in NO_BOOTS and not re.search(r"\bugg\b", f"{p.get('brand')} {p.get('name')}", re.I):
        return False
    if slug.startswith("store-"):
        return True
    brand = (p.get("brand") or "").strip().lower()
    if brand and brand in {(t.get("brand") or "").strip().lower() for t in taken}:
        return False
    if slug in REPEAT_KIND:
        return not any(sum(k in kinds(t) for t in taken) >= 2 for k in ks)
    return not (ks & set().union(*[kinds(t) for t in taken])) if taken else True


# A cover shows only products that are in that guide right now (owner 11-20: "The covers need to have correct
# pictures": the Dad cover still showed a removed slide, and store covers drew bestseller photos of products the page
# never listed), and never an Amazon photo (Amazon images are not edited, so they cannot be cut out for a cover).
# $GIFT_COVER_ALSO_IN names a second picks folder (a train branch's): a product must be on the guide's list there too,
# so a cover drawn on a branch still holds once the train's removals land.
AMAZON = re.compile(r"(^|[./])(amazon\.[a-z.]+|media-amazon\.com|ssl-images-amazon\.com|amzn\.to|a\.co)(/|$)", re.I)
ALSO_IN = os.environ.get("GIFT_COVER_ALSO_IN") or ""
_ALSO = {}


def is_amazon(p):
    return any(AMAZON.search(re.sub(r"^https?://", "", p.get(k) or "").split("?")[0].split("/")[0] + "/") for k in ("image", "href")) or p.get("store") == "store-amazon"


def own_picks(slug):
    try:
        picks = json.load(open(os.path.join(PICKS, f"{slug}.json"), encoding="utf8"))["picks"]
    except FileNotFoundError:
        return []
    photos = COVER_PINS.get(slug, {}).get("photos", {})
    picks = [dict(q, image=photos[q.get("name")]) if is_amazon(q) and q.get("name") in photos else q
             for q in picks if not is_amazon(q) or q.get("name") in photos]
    if ALSO_IN:
        if slug not in _ALSO:
            try:
                _ALSO[slug] = {(q.get("name"), q.get("image")) for q in json.load(open(os.path.join(ALSO_IN, f"{slug}.json"), encoding="utf8"))["picks"]}
            except FileNotFoundError:
                _ALSO[slug] = None
        if _ALSO[slug] is not None:
            picks = [q for q in picks if (q.get("name"), q.get("image")) in _ALSO[slug]]
    return picks


_STORE_POOL = {}


def store_pool(slug):
    """A store page's products named in any guide (the same store), for a store page whose own file has few photos."""
    if not _STORE_POOL:
        for f in sorted(os.listdir(PICKS)):
            if f.endswith(".json"):
                for q in json.load(open(os.path.join(PICKS, f), encoding="utf8")).get("picks", []):
                    if q.get("store") and q.get("image"):
                        _STORE_POOL.setdefault(q["store"], []).append(q)
    return _STORE_POOL.get(slug, [])


_FREQ = {}


def generic(p):
    """A product on 10 or more guides' lists (a Kindle, an Apple Watch): last on a guide's cover list (design review M3)."""
    if not _FREQ:
        for f in sorted(os.listdir(PICKS)):
            if f.endswith(".json"):
                for n in {dedupe(q.get("name")) for q in json.load(open(os.path.join(PICKS, f), encoding="utf8")).get("picks", [])}:
                    _FREQ[n] = _FREQ.get(n, 0) + 1
    return _FREQ.get(dedupe(p.get("name")), 0) >= 10


# A colour guide's cover leads with its colour (design review M3: Purple & Gold showed a Kindle and a blender).
COLOR_WORDS = {"purple-and-gold-lover": r"purple|gold|\blsu\b|tigers?|geaux", "pink-lover": r"pink|rose|blush",
               "blue-lover": r"blue|navy|cobalt", "red-lover": r"\bred\b|crimson|cherry", "green-lover": r"green|sage|olive",
               "black-lover": r"black|onyx", "yellow-lover": r"yellow|lemon|sunflower|gold", "purple-lover": r"purple|lavender|lilac",
               "neutral-lover": r"cream|ivory|beige|tan|oat|neutral|linen"}


_CAREERS = set()


def careers():
    if not _CAREERS:
        _CAREERS.update(r["slug"] for r in index() if r["group"] == "By career")
    return _CAREERS


_CHILDREN = {}


def candidates(slug):
    own = own_picks(slug)
    if not own and not slug.startswith("store-"):
        # A hub with no list of its own (Kids, r3 H1: its cover was text only) shows its child guides' picks, in turn.
        if not _CHILDREN:
            for r in index():
                if r.get("parent"):
                    _CHILDREN.setdefault(r["parent"], []).append(r["slug"])
        lists = [own_picks(c) for c in _CHILDREN.get(slug, [])]
        own = [q for row in zip(*lists) for q in row] if lists else []
    if not slug.startswith("store-"):
        # Products few guides list come first, a product on 10+ guides' lists last (design review M3: the Accountants,
        # Lawyers and Real Estate covers were near-identical); otherwise the guide's own order.
        own = sorted(own, key=lambda q: (generic(q), min(_FREQ.get(dedupe(q.get("name")), 0), 10) if slug in careers() else 0))
        if slug in COLOR_WORDS:
            rx = re.compile(COLOR_WORDS[slug], re.I)
            own = [q for q in own if rx.search(q.get("name") or "")] + [q for q in own if not rx.search(q.get("name") or "")]
    pins = COVER_PINS.get(slug, {}).get("items", [])
    if pins:  # exactly the owner's own cover picks, in her order (four of hers draw as four, two a side)
        first = [q for n in pins for q in own if q.get("name") == n][:len(pins)]
        return first
    if slug.startswith("store-"):
        return own  # only what the store page lists (owner 11-20), never another guide's or a bestseller photo
    fit = FIT.get(slug) if isinstance(FIT.get(slug), dict) else None
    if not fit or not fit.get("final_top25"):
        return own
    names = [n for n in AUDIT.get(slug, []) if isinstance(n, str)] + [n for n in fit["final_top25"] if isinstance(n, str)]
    # Then the rest of the guide's own picks the fit audit kept (not in its remove lists), so a cover has items to show.
    dropped = {dedupe(n) for k in ("remove", "remove_louisiana") for n in fit.get(k, []) if isinstance(n, str)}
    names += [q.get("name") for q in own if dedupe(q.get("name")) not in dropped]
    out = []
    for n in names:
        p = next((q for q in own if q.get("name") == n), None) or next(
            (q for q in own if dedupe(q.get("name")) == dedupe(n)), None)
        if p and p not in out:
            out.append(p)
    return out


def photos(slug, need=6, group="", used=(), reserved=None, boots_ok=True, seen_before=(), pre=None):
    """Up to `need` products for one cover; `pre` (cutouts, picks) are the first pass's four, topped up here."""
    reserved = reserved or {}
    own_brand = next((b for b, st in reserved.items() if st == slug), None)
    picks = candidates(slug)
    if seen_before:  # careers: products no earlier career cover showed come first, so the covers read apart (M3)
        picks = [q for q in picks if cover_key(q) not in seen_before] + [q for q in picks if cover_key(q) in seen_before]
    if slug.startswith("under-"):
        picks = [q for q in picks if not PLAIN.search(q.get("name") or "")] + [q for q in picks if PLAIN.search(q.get("name") or "")]
    cands, seen = [], set()
    for p in picks:
        u = p.get("image")
        if not u or not u.startswith("https://") or u in seen or u in BAD_PHOTOS or u in STORE_REJECTS:
            continue
        # A store's own storefront pick (name == brand, "Bass Pro Shops") carries its logo, not a product.
        if (p.get("name") or "").strip().lower() == (p.get("brand") or "").strip().lower():
            continue
        if (COVER_NEVER.search(p.get("name") or "") and slug not in CARD_GUIDES) or " " not in (p.get("name") or "").strip():
            continue  # a one-word name ("Gisou") is a storefront pick: its photo is the word mark
        seen.add(u)
        cands.append(p)
    got, taken, light = (list(pre[0]), list(pre[1]), []) if pre else ([], [], [])
    pinned = set(COVER_PINS.get(slug, {}).get("items", []))  # the owner's own cover picks skip the variety and light rules
    why = {}  # why each candidate was passed over, printed when a cover comes up short (r3 H1: fail loudly)

    def no(reason):
        why[reason] = why.get(reason, 0) + 1

    for start in range(0, len(cands), 10):  # every candidate (r3 H1: a cap of 50 left late-section covers empty)
        batch = [p for p in cands[start:start + 10]]
        with ThreadPoolExecutor(6) as pool:
            datas = list(pool.map(fetch, [p["image"] for p in batch]))
        for p, data in zip(batch, datas):
            skip = COVER_SKIP.get(slug)
            if len(got) >= need or any(p is t for t in taken):
                continue
            if p.get("name") not in pinned and ((skip and skip.search(p.get("name") or "")) or not allowed(slug, p, taken, group)):
                no("variety/fit rule")
                continue
            if not boots_ok and "boot" in kinds(p) and not slug.startswith("store-"):
                no("boot already in section")
                continue  # one boot cover per section (owner 11-18)
            key = cover_key(p, own_brand)
            if key in used or dedupe(p.get("name")) in used:
                no("on an earlier cover in section")
                continue  # already on another cover (owner 11-18: "No duplicates")
            if group == "By store" and reserved.get(brand_word(p) or None, slug) != slug:
                no("brand kept by its own store page")
                continue
            # A store page may show several of its own products of one kind (Durango Boots is all boots, r3 follow-up:
            # its five boots all counted as "durango:boot" and the cover went text only): there the same item is the same name.
            same = {dedupe(t.get("name")) for t in taken} if slug.startswith("store-") else {cover_key(t, own_brand) for t in taken}
            if (dedupe(p.get("name")) if slug.startswith("store-") else key) in same:
                no("same item already on this cover")
                continue
            if not data:
                no("photo did not download")
                continue
            c = cutout(data, tight=bool(TIGHT.search(p.get("name") or "")))
            if c is None and slug in CARD_GUIDES:
                c = card(data)
            if worn(slug, p, c):
                no("clothes on a model")
            elif c is None:
                no("photo not on white")
            elif is_light(c) and slug not in LIGHT_OK and p.get("name") not in pinned:
                light.append((c, p))  # blends into the cream arch (owner 11-18: "Like the Owala bottle is light")
            else:
                got.append(c)
                taken.append(p)
        if len(got) >= need:
            break
    # A light one (with the stronger shadow) only to reach four; four colourful beat six with light ones (owner 11-18).
    for c, p in light[:max(0, 4 - len(got))]:
        got.append(c)
        taken.append(p)
    if len(got) < 4 and not slug.startswith("store-") and slug not in REPEAT_KIND:
        REPEAT_KIND.add(slug)
        try:
            return photos(slug, need=need, group=group, used=used, reserved=reserved, boots_ok=boots_ok,
                          seen_before=seen_before, pre=(got, taken))
        finally:
            REPEAT_KIND.discard(slug)
    print(f"  {slug}: " + " | ".join((t.get("name") or "")[:28] for t in taken), flush=True)
    if len(got) < 4:
        print(f"  SHORT {slug}: {len(got)} of {len(cands)} candidates usable; passed over: "
              + ", ".join(f"{k} {v}" for k, v in sorted(why.items(), key=lambda kv: -kv[1])), file=sys.stderr, flush=True)
    return got[:need], taken[:need], own_brand


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


MARGIN = 25  # 12 px at 480
# Polish (owner 11-18: "it needs some kind of polish"): a soft shadow under the arch, the name a touch heavier with a
# faint shadow, "gifts for" and the arch outline in the site's olive (--bark, #5E6544), and a line-diamond-line divider.
# GIFT_COVER_PLAIN=1 draws the unpolished version for comparison.
POLISH = os.environ.get("GIFT_COVER_PLAIN") != "1"
OLIVE = (94, 101, 68)
# Each family's accent for "gifts for", the arch outline and the divider (owner 11-18: "the red one with the red word
# and border how green is"); the name and the footer stay ink.
ACCENT = {"green": OLIVE, "red": (158, 59, 59), "tan": (138, 106, 69)}


def title_font(size):
    f = pc.font("PlayfairDisplay.ttf", size)
    if POLISH:
        f.set_variation_by_axes([600])
    return f


def arch_mask(W, x0, y0, x1, y1, dy=0):
    m = Image.new("L", (W, W), 0)
    pc.arch(ImageDraw.Draw(m), x0, y0 + dy, x1, y1 + dy, fill=255)
    return m


def shadow(p):
    """pin_covers.shadow, a touch stronger, and stronger again under a white or light product so it reads on the checks."""
    rgb = np.asarray(p.convert("RGB")).astype(int)
    al = np.asarray(p.split()[3]) > 128
    light = al.any() and (rgb[al].min(axis=1) > 200).mean() > 0.5
    s = Image.new("RGBA", (p.width + 40, p.height + 40), (0, 0, 0, 0))
    blk = Image.new("RGBA", p.size, (40, 30, 20, 255))
    blk.putalpha(p.split()[3].point(lambda v: int(v * (0.42 if light else 0.26))))
    s.paste(blk, (24, 28), blk)
    s = s.filter(ImageFilter.GaussianBlur(9))
    s.paste(p, (20, 20), p)
    return s


def draw(row, prods, out, share=None):
    """The cover (480 px WebP) from `prods`, and the share JPG (600 px) from `share`, the guide's top three (M7)."""
    im = render(row, prods)
    small = im.resize((480, 480), Image.LANCZOS)
    for q in (58, 52, 46, 40, 34):  # the covers guard: at most 20 KB each
        small.save(out, "WEBP", quality=q, method=6)
        if os.path.getsize(out) <= 19_500:
            break
    # A share JPG (Facebook's link preview does not reliably take WebP): 600 px, at most 45 KB, drawn fresh.
    og = os.path.join(OG, os.path.basename(out)[:-5] + ".jpg")
    big = (render(row, share) if share is not None else im).resize((600, 600), Image.LANCZOS)
    for q in (78, 72, 66, 60):
        big.save(og, "JPEG", quality=q, progressive=True, optimize=True)
        if os.path.getsize(og) <= 45_000:
            break


def render(row, prods):
    """pin_covers.photo_cover / cover2_example.cover2 on a 1000 x 1000 square."""
    W = 1000
    fam = SLUG_TINT.get(row["slug"]) or TINT.get(row["group"], "green")
    im = pc.gingham(W, W, fam, c=56, palettes=FAMILY)
    acc = ACCENT[fam] if POLISH else pc.INK
    d = ImageDraw.Draw(im)
    k = 1.0
    x0, y0, x1, y1 = 260, 92, 740, 922  # 48% wide (owner 11-18: bigger items), nearly the square's full height
    if POLISH:  # the arch lifts off the gingham like a card: 3 px down, 10 px blur, 18% at 480
        sh = arch_mask(W, x0 - 22 * k, y0 - 22 * k, x1 + 22 * k, y1 + 20 * k, dy=6).filter(ImageFilter.GaussianBlur(21))
        im.paste(Image.new("RGB", (W, W), (40, 30, 20)), (0, 0), sh.point(lambda v: int(v * 0.18)))
        d = ImageDraw.Draw(im)
    pc.arch(d, x0 - 22 * k, y0 - 22 * k, x1 + 22 * k, y1 + 20 * k, fill=pc.CREAM)
    pc.arch(d, x0, y0, x1, y1, outline=acc, width=2)
    cx = (x0 + x1) / 2
    lsize = 84  # owner 11-18: "Make the title and gifts for bigger" (1.4x the pin's 60)
    while pc.font("CG-Italic.ttf", lsize).getlength(row["lead"]) > x1 - x0 - 170 and lsize > 44:
        lsize -= 4
    d.text((cx, y0 + (x1 - x0) * 0.40), row["lead"], font=pc.font("CG-Italic.ttf", lsize), fill=acc, anchor="mm")
    size = 100  # 1.3x the pin's 78; a name too wide for one line breaks to two big lines ("Under / $50", owner 11-18)
    while True:
        tf = title_font(size)
        lines = wrap(d, row["title"], tf, x1 - x0 - 190)  # clear of the products over the arch edge
        if len(lines) > 2:  # a tighter break: the two-line split whose longer line is shortest ("Commercial Fishermen / & Shrimpers")
            ws = row["title"].split()
            lines = min(([" ".join(ws[:k]), " ".join(ws[k:])] for k in range(1, len(ws))), key=lambda ls: max(d.textlength(l, font=tf) for l in ls), default=lines)
        # Two lines at most (gg-r3 UX audit #9, owner: "2 lines"): a long name steps down in size until it fits two.
        if (len(lines) <= 2 and all(d.textlength(l, font=tf) <= x1 - x0 - 170 for l in lines)) or size <= 28:
            break
        size -= 4
    lh = size * 105 / 78
    ty = (y0 + y1) / 2 + 20 - (len(lines) - 1) * lh / 2
    if POLISH:  # a faint shadow under the name: 1 px down, 12%, a tiny blur
        tl = Image.new("L", (W, W), 0)
        for i, l in enumerate(lines):
            ImageDraw.Draw(tl).text((cx, ty + i * lh + 2), l, font=tf, fill=255, anchor="mm")
        im.paste(Image.new("RGB", (W, W), (40, 30, 20)), (0, 0), tl.filter(ImageFilter.GaussianBlur(1.5)).point(lambda v: int(v * 0.12)))
        d = ImageDraw.Draw(im)
    for i, l in enumerate(lines):
        d.text((cx, ty + i * lh), l, font=tf, fill=pc.INK, anchor="mm")
    dy = y1 - 170
    if POLISH:  # line, diamond, line
        d.line([(cx - 52, dy), (cx - 14, dy)], fill=acc, width=2)
        d.line([(cx + 14, dy), (cx + 52, dy)], fill=acc, width=2)
        d.polygon([(cx, dy - 7), (cx + 7, dy), (cx, dy + 7), (cx - 7, dy)], fill=acc)
    else:
        d.line([(cx - 50, dy), (cx + 50, dy)], fill=pc.INK, width=2)
    # Footer readable on a 160 px phone tile (owner 11-18: "Louisiana Helpr is still hard to see"): the name's ink, ~1.7x.
    ff = pc.font("Montserrat.ttf", 30)
    ff.set_variation_by_axes([600])  # Montserrat.ttf is variable and defaults to weight 100 (hairline)
    pc.tracked(d, cx, y1 - 80, "LOUISIANA HELPR", ff, 2)
    H0, mx = y1 - y0, 330
    # 4 items: two a side, top and bottom; 3 (the share image's top three): top left, middle right, bottom left.
    use = {3: (0, 3, 4), 4: (0, 1, 4, 5), 5: (0, 1, 2, 4, 5)}.get(len(prods), range(6))
    for i, p in zip(use, prods):
        side, fy, rot, sc, off = pc.EVEN[i]
        # 0.95x the pin's size (owner 11-18, after 1.35x and 1.15x: "items are too big now", "the items are smaller");
        # about 9% of each over the arch edge, the same for every row so the spacing stays even.
        p = even(p, int(mx * sc * 0.78 * 0.95)).rotate(rot, resample=Image.BICUBIC, expand=True)
        bb = p.getbbox() or (0, 0, p.width, p.height)
        off = -(bb[2] - bb[0]) * 0.41
        s = shadow(p)
        px = x0 + off if side < 0 else x1 - off
        py = y0 + (0.14 + (fy - 0.12) * (0.72 / 0.74)) * H0
        # The product (not its shadow) stays MARGIN inside the canvas (12 px at 480).
        bb = p.getbbox() or (0, 0, p.width, p.height)
        bx = int(px - s.width / 2)
        by = int(py - s.height / 2)
        bx = min(max(bx, MARGIN - 20 - bb[0]), W - MARGIN - 20 - bb[2])
        by = min(max(by, MARGIN - 20 - bb[1]), W - MARGIN - 20 - bb[3])
        im.paste(s, (bx, by), s)
    return im


def top_three(row):
    """The share image's products (design review M7): the guide's first three listed picks that pass the photo checks."""
    got = []
    for p in candidates(row["slug"]):
        u = p.get("image")
        if len(got) >= 3:
            break
        if not u or u in BAD_PHOTOS or u in STORE_REJECTS or COVER_NEVER.search(p.get("name") or ""):
            continue
        if not allowed(row["slug"], p, [], row["group"]):
            continue
        data = fetch(u)
        c = cutout(data, tight=bool(TIGHT.search(p.get("name") or ""))) if data else None
        if c is not None and not is_light(c):
            got.append(c)
    return got if len(got) == 3 else None


_USABLE = {}


def usable_count(row):
    """How many of a guide's candidates would draw (a clean, not-light cutout that fits the guide), so pass 1 can serve
    the scarcest covers first. Each photo's verdict is remembered by URL (not the cutout: memory is tight)."""
    slug, n = row["slug"], 0
    skip = COVER_SKIP.get(slug)
    for p in candidates(slug):
        u = p.get("image")
        if not u or not u.startswith("https://") or u in BAD_PHOTOS or u in STORE_REJECTS or (COVER_NEVER.search(p.get("name") or "") and slug not in CARD_GUIDES):
            continue
        if (skip and skip.search(p.get("name") or "")) or not allowed(slug, p, [], row["group"]):
            continue
        key = (u, slug in LIGHT_OK, slug in CARD_GUIDES, slug.startswith("store-"))
        if key not in _USABLE:
            data = fetch(u)
            c = cutout(data, tight=bool(TIGHT.search(p.get("name") or ""))) if data else None
            if c is None and data and slug in CARD_GUIDES:
                c = card(data)
            _USABLE[key] = c is not None and (slug in LIGHT_OK or not is_light(c)) and not worn(slug, p, c)
        n += _USABLE[key]
    return n


def brand_stores(rows):
    """Store pages that sell one brand ("store-stanley", "store-durango-boots") keep that brand: no other store cover shows it."""
    out = {}
    for r in rows:
        if r["group"] != "By store":
            continue
        ws = [brand_word(p) for p in own_picks(r["slug"]) if p.get("image") and brand_word(p)]
        if len(ws) >= 3:
            top = max(set(ws), key=ws.count)
            if ws.count(top) >= 0.6 * len(ws) and top not in out:
                out[top] = r["slug"]
    return out


def write_versions():
    """Each cover's and share image's content hash, so its URL changes when the art does (owner 11-21: "the colors on the
    cover need to match the color when you click into the guide"; browsers and the service worker kept the old file at
    the unchanged URL). scripts/gift-guide-cover-versions.mjs writes src/lib/giftGuideCoverVersions.mjs; the catalog and
    api/share.ts add ?v=<hash>. Guard: src/test/giftGuideCoverVersions1121.test.ts."""
    import subprocess
    subprocess.run(["node", os.path.join(ROOT, "scripts", "gift-guide-cover-versions.mjs")], check=True)


def main():
    rows = index()
    stores_only = sys.argv[1:] == ["--stores"]
    if sys.argv[1:] and not stores_only:
        sys.exit("usage: gift-guide-photo-covers.py [--stores]  (--stores redraws only the store section's covers)")
    os.makedirs(OG, exist_ok=True)
    reserved = brand_stores(rows)
    # A one-brand store keeps its brand only when its own cover can show at least four of its products.
    groups = {r["slug"]: r["group"] for r in rows}
    reserved = {b: st for b, st in reserved.items() if len(photos(st, group=groups[st], reserved=reserved)[0]) >= 4}
    # No repeats within a landing section (owner 11-18); a product may show again in another section.
    # Careers may repeat a product, never on two career covers next to each other (the previous two in landing order).
    used, boots, manifest, kept, four = {}, set(), {}, [], []
    old = json.load(open(MANIFEST, encoding="utf8")) if os.path.exists(MANIFEST) else {}
    if stores_only:  # repeats are counted within a section, so the store section can be redrawn on its own
        manifest = {s_: c for s_, c in old.items() if c.get("section") != "By store"}
    # Only guides that ship a cover (a guide with no picks is not built, and a stray cover file fails the two-way check).
    # A guide made new by the 1120 merges (Pet Lovers, Fitness Lovers ...) gets its first cover here.
    all_rows = [r for r in rows if not r["owner"] or os.path.exists(os.path.join(OUT, f"{r['slug']}.webp")) or os.path.exists(os.path.join(PICKS, f"{r['slug']}.json"))]
    rows = [r for r in targets(all_rows) if not stores_only or r["group"] == "By store"]
    order = [r["slug"] for r in rows]
    career_order = [r["slug"] for r in rows if r["group"] == "By career"]
    picked = {}  # slug -> (cutouts, picks, own_brand)

    def ids(taken, own_brand):
        return {cover_key(t, own_brand) for t in taken} | {dedupe(t.get("name")) for t in taken}

    def section_used(row):
        """What this cover may not show: its section's products, or for a career its two career neighbours a side."""
        if row["group"] != "By career":
            return used.setdefault(row["group"], set())
        i = career_order.index(row["slug"])
        near = career_order[max(0, i - 2):i] + career_order[i + 1:i + 3]
        return set().union(*[ids(picked[n][1], picked[n][2]) for n in near if n in picked]) if near else set()

    def take(row, need, pre=None, free=frozenset()):
        seen = set().union(*[ids(v[1], v[2]) for k, v in picked.items() if k in career_order]) if row["group"] == "By career" else set()
        mine = ids(pre[1], pre[2]) if pre else set()
        sec = (section_used(row) - mine if row["group"] != "By career" else section_used(row)) - free
        got, taken, own_brand = photos(row["slug"], need=need, group=row["group"], used=sec, reserved=reserved,
                                       boots_ok=row["group"] not in boots or any("boot" in kinds(t) for t in (pre[1] if pre else [])),
                                       seen_before=seen - mine, pre=pre[:2] if pre else None)
        picked[row["slug"]] = (got, taken, own_brand)
        if row["group"] != "By career":
            used.setdefault(row["group"], set()).update(ids(taken, own_brand))
        if any("boot" in kinds(t) for t in taken):
            boots.add(row["group"])

    # Pass 1, four each, the scarcest cover first (r3 H1): drawn in landing order with six each, the first covers of a
    # section took every photo a later cover could use, and 90 landing covers went out text only. A cover with few usable
    # photos now picks before one with many; pass 2 then tops every cover up to six in landing order.
    usable = {r["slug"]: usable_count(r) for r in rows}
    for row in sorted(rows, key=lambda r: (usable[r["slug"]], order.index(r["slug"]))):
        take(row, 4)
    for row in rows:
        if len(picked[row["slug"]][0]) >= 4:
            take(row, 6, pre=picked[row["slug"]])
    # Pass 3 (r3 H1): a cover still short of four takes, one at a time, a product another cover of its section holds;
    # the product moves (it is never on both), so the section keeps no repeats. A donor holding exactly four refills from
    # its own other photos, and when it cannot, the move is undone. Careers take only from their neighbours (the covers
    # whose products they may not repeat).
    rowof = {r["slug"]: r for r in rows}

    def near_careers(slug):
        i = career_order.index(slug)
        return set(career_order[max(0, i - 2):i] + career_order[i + 1:i + 3])

    for row in sorted(rows, key=lambda r: (usable[r["slug"]], order.index(r["slug"]))):
        blocked = set()
        while 0 < 4 - len(picked[row["slug"]][0]):
            pool = near_careers(row["slug"]) if row["group"] == "By career" else {k for k in picked if groups.get(k) == row["group"]}
            donors = {k: v for k, v in picked.items() if k != row["slug"] and k in pool and k in rowof and len(v[0]) >= 4}
            holder = {i: k for k, v in donors.items() for t in v[1] for i in ids([t], v[2])}
            free = frozenset(i for i in holder if i not in blocked)
            before, saved = picked[row["slug"]], {g: set(u) for g, u in used.items()}
            take(row, len(before[0]) + 1, pre=before, free=free)
            new = [t for t in picked[row["slug"]][1] if not any(t is b for b in before[1])]
            if not new:
                picked[row["slug"]] = before
                break
            moved = ids(new, before[2])
            k = next((holder[i] for i in moved if i in holder), None)
            if not k:
                continue
            donor_before = picked[k]
            g, t, ob = donor_before
            keep = [j for j, x in enumerate(t) if not (ids([x], ob) & moved)]
            picked[k] = ([g[j] for j in keep], [t[j] for j in keep], ob)
            if len(picked[k][0]) < 4:
                take(rowof[k], 4, pre=picked[k])
            if len(picked[k][0]) < 4:  # the donor would go short: undo, and do not offer that product again
                picked[row["slug"]], picked[k] = before, donor_before
                used.clear()
                used.update(saved)
                blocked |= moved
    short = []
    for row in rows:
        prods, taken, own_brand = picked[row["slug"]]
        if len(prods) == 5:
            prods, taken = prods[:4], taken[:4]  # two a side reads evenly; five leaves one side short
        if len(prods) < 4:
            kept.append(f"{row['slug']} ({len(prods)} photos)")
            short.append(row["slug"])
            prods, taken = [], []  # the same polished arch and gingham, text only (logged below, and the guard fails a shown one)
        elif len(prods) == 4:
            four.append(row["slug"])
        manifest[row["slug"]] = {"section": row["group"],
                                 "items": [{"name": t.get("name"), "key": cover_key(t, own_brand), "image": t.get("image")} for t in taken]}
        out = os.path.join(OUT, f"{row['slug']}.webp")
        # GIFT_COVER_REDRAW=a,b redraws those covers too (a drawing change, such as the two-line names, with the same products).
        redraw = row["slug"] in os.environ.get("GIFT_COVER_REDRAW", "").split(",")
        if old.get(row["slug"]) == manifest[row["slug"]] and os.path.exists(out) and os.environ.get("GIFT_COVER_ALL") != "1" and not redraw:
            continue  # the same products as the cover on disk: left as it is (GIFT_COVER_ALL=1 redraws every cover)
        draw(row, prods, out, share=top_three(row))
        print(f"cover {row['slug']} ({len(prods)})", flush=True)
    if stores_only:  # keep the manifest in landing order
        landing = [r["slug"] for r in all_rows]
        manifest = {k: manifest[k] for k in sorted(manifest, key=landing.index)}
    with open(MANIFEST, "w", encoding="utf8") as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
        f.write("\n")
    # The catalog gives a guide its cover only when it is in this list (every file here is a guide's, the two-way check).
    slugs = sorted(s_ for s_ in manifest if os.path.exists(os.path.join(OUT, f"{s_}.webp")))
    with open(os.path.join(ROOT, "src", "content", "giftGuideCoverSlugs.ts"), "w", encoding="utf8") as f:
        f.write("/** Generated by scripts/gift-guide-photo-covers.py: the guides with a cover in public/gift-guides/covers. */\n")
        f.write("export const COVER_SLUGS: readonly string[] = " + json.dumps(slugs) + ";\n")
    # api/share.ts's lists of which guides have a share JPG and a WebP cover (two-way with the folders).
    share = os.path.join(ROOT, "src", "lib", "giftGuideShareImages.mjs")
    if os.path.exists(share):
        text = open(share, encoding="utf8").read()
        for name, folder, ext in (("OG_JPG_SLUGS", OG, ".jpg"), ("COVER_WEBP_SLUGS", OUT, ".webp")):
            # og/landing.jpg is the landing's own 1200x630 card (holistic review M7), no guide's share image.
            have = sorted(f[: -len(ext)] for f in os.listdir(folder) if f.endswith(ext) and f != "landing.jpg")
            text = re.sub(rf"export const {name} = new Set\(\[.*?\]\);", f"export const {name} = new Set({json.dumps(have, separators=(', ', ': '))});", text)
        open(share, "w", encoding="utf8").write(text)
    write_versions()
    print(f"covers: {len(manifest)} drawn, {len(four)} with 4 items, {len(kept)} text only (fewer than 4 usable photos)")
    if short:  # r3 H1: never silently; src/test/giftGuideCoversShowItems.test.ts fails any of these the site shows
        print(f"TEXT ONLY ({len(short)}), fewer than 4 usable product photos: " + ", ".join(kept), file=sys.stderr)
    json.dump({"four": four, "kept": kept}, open(os.path.join(CACHE, "last-run.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
