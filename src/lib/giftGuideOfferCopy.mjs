/**
 * Sales and discount-code copy for the gift guides, cleaned from the raw feed words (holiday audit 1121 #57: lines
 * cut off mid-sentence ("... Plus Free Charm with"), rows that are not sales ("The Gazelle Rhinestone Revival brings
 * eye-catching sparkle ..."), ALL CAPS ("BLACK FRIDAY SALE:"), "Shop Now!", an end date inside the text beside the
 * row's own "Ends Nov 30", "Lancome" for Lancôme, and codes that said only "Holiday code").
 *
 * ONE rule, used twice: scripts/gift-guide-picks.mjs cleans SALES and DEAL_CODES before it writes them, and the
 * sidebar and the deals days (GiftGuidesSidebar, GiftGuideDeals) clean what they read, so a file written before this
 * rule (or a later feed row) never shows raw. Cleaning is idempotent. Plain ESM (the generator imports it).
 * Guard: src/test/giftGuideHolidayPolish1121c.test.ts.
 */

/** Feed words rewritten by hand where the generic rules cannot recover the offer (each checked against its feed row). */
export const OFFER_REWRITES = {
  // _later-deals.json Fabrique: the feed cut "Free Charm with" off before its spend (a price, so the loader drops it).
  "Black Friday Warm-up - Up to 50% off Orders and Free Shipping Plus Free Charm with": "Black Friday warm-up: up to 50% off and free shipping",
  // Ulta: "Purchase of" lost its dollar amount the same way.
  "Get a Free Magic Pick Nail Art Stickers, Under The Tree with a Dashing Diva Purchase of": "Free Magic Pick nail art stickers with a Dashing Diva purchase",
};

/**
 * The real offer of a code whose feed words carried a product price (the loader then wrote "Holiday code"), from the
 * same feed row (_later-deals.json), with the product price left out.
 */
export const CODE_OFFERS = {
  // "K-Cup Pods $13.99 Per Box (20-24 ct)" with code WINTERBREW.
  WINTERBREW: "K-Cup pods on sale",
  // "Squishy Advent Calendars are $6.99+, extra $5 off $20 with code SQUISH".
  SQUISH: "Extra $5 off $20 on squishy advent calendars",
  // "Buy More, Earn More! Earn a $50-$1,250 Gift Card with code NMTREAT".
  NMTREAT: "A gift card back when you buy more",
};

/**
 * Each feed code's own affiliate link (its _later-deals.json row's affiliate_href), so the codes box opens the store
 * after a copy (holiday audit 1121 #81). An owner's code (giftGuides.ts discountCodes) carries its `href` inline.
 */
export const CODE_LINKS = {
  WINTERBREW: "https://mavely.app.link/qtj9YjqQa8b",
  SQUISH: "https://mavely.app.link/xfxJPdKQa8b",
  NMTREAT: "https://mavely.app.link/451RGK7Qa8b",
  GRATITUDE: "https://mavely.app.link/1IAq8TqQa8b",
};

/** Store names as the brands spell them. */
export const STORE_SPELLING = { Lancome: "Lancôme", "Kitchen Aid": "KitchenAid" };

/** Words that stay in capitals (acronyms and brand marks). */
const KEEP_CAPS = new Set(["BFCM", "VS", "PINK", "NYX", "NB", "HG", "TV", "PJS", "CB2", "UGG", "USA", "LSU", "BOGO"]);
/** A line that ends on one of these was cut off by the feed. */
const DANGLING = /\b(with|of|our|and|the|a|an|for|to|your)$/i;
/** What makes a line a sale: a percent, a dollar amount off, something free, a gift with purchase, buy-get, or the
 * words sale/deal/save/off. */
const IS_OFFER = /\d\s?%|\$\s?\d|\bfree\b|\bgift with\b|\bbogo\b|\bbuy\b.*\bget\b|\bsale\b|\bdeals?\b|\bsave\b|\boff\b/i;

const isCapsWord = (w) => {
  const bare = w.replace(/[^A-Za-z0-9]/g, "");
  return bare.length >= 2 && /[A-Z]/.test(bare) && bare === bare.toUpperCase() && !/\d/.test(bare) && !KEEP_CAPS.has(bare);
};
/** A run of two or more words in capitals is shouting ("BLACK FRIDAY SALE:"); one word alone is a brand (HEYDUDE, DKNY). */
const unshout = (s) => {
  const parts = s.split(/(\s+)/);
  const words = parts.map((p, i) => (i % 2 === 0 ? p : null));
  for (let i = 0; i < words.length; i += 2) {
    let j = i;
    while (j < words.length && words[j] !== null && isCapsWord(words[j])) j += 2;
    if ((j - i) / 2 >= 2) for (let k = i; k < j; k += 2) parts[k] = parts[k].toLowerCase();
    if (j > i) i = j - 2;
  }
  return parts.join("").replace(/\bblack friday\b/gi, "Black Friday").replace(/\bcyber monday\b/gi, "Cyber Monday");
};

/** The cleaned line, or null when it is no sale or was cut off past saving. */
export function cleanOffer(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (OFFER_REWRITES[s]) return OFFER_REWRITES[s];
  s = s
    .replace(/\s*\bShop Now\b!?/gi, "")
    .replace(/\s*-\s*Happy Shopping\b!?/i, "")
    .replace(/\s*\bEnds\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\.?/gi, "")
    .replace(/\bOFF\*/g, "off")
    .replace(/\s+--\s+/g, " - ")
    .replace(/\bLancome\b/g, "Lancôme");
  s = unshout(s);
  s = s.replace(/\s+/g, " ").replace(/[\s.!]+$/, "").trim();
  if (!s) return null;
  // A first letter lowered by the capitals rule goes back up ("BLACK FRIDAY SALE: ..." -> "Black Friday sale: ...").
  s = s[0].toUpperCase() + s.slice(1);
  if (DANGLING.test(s)) return null;
  if (!IS_OFFER.test(s)) return null;
  return s;
}

/** A store's name as the brand spells it. */
export const cleanStore = (store) => STORE_SPELLING[store] ?? store;

/** The sales list with each line cleaned, and the lines that are no sale left out. */
export function cleanSales(sales) {
  return sales.flatMap((x) => {
    const offer = cleanOffer(x.offer);
    return offer ? [{ ...x, store: cleanStore(x.store), offer }] : [];
  });
}

/** The codes with each offer cleaned; a "Holiday code" takes its real offer, and a code with none is left out. */
export function cleanCodes(codes) {
  return codes.flatMap((c) => {
    const offer = CODE_OFFERS[c.code] ?? (c.offer === "Holiday code" ? null : cleanOffer(c.offer));
    const href = c.href ?? CODE_LINKS[c.code];
    return offer ? [{ ...c, store: cleanStore(c.store), offer, ...(href ? { href } : {}) }] : [];
  });
}
