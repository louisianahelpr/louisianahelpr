#!/usr/bin/env node
/**
 * The Small Business Saturday page's data (owner 2026-11-19 ~7:05 PM: "Yes do small business with our small business
 * sponsors"; ~7:15 PM: "We can link their facebooks or website for people to reach out"). Reads the lead's checked file
 * ~/Desktop/Gift-guide-picks/_small-biz-saturday-1119.json (confirmed 25 Days sponsors that are independent Louisiana
 * businesses) and its small-biz-logos/ folder, and writes:
 *   - src/content/giftGuideSmallBiz.json: one card per business, grouped by category in page order;
 *   - public/gift-guides/small-biz/<slug>.<ext>: each logo, at most 240 px a side (sips), never a filename with a day.
 * Rules (FOLLOWUP-OWNER-1119.md items 60, 61, 64):
 *   - NEVER a giveaway day, and no giveaway wording at all (the tracker's "their giveaway pairing" notes are dropped);
 *   - no price in any text (a "(from $6 ...)" aside is cut); no email or phone;
 *   - the card links its website, else its Facebook Page, else its Instagram ("Visit shop"), plus its Facebook and
 *     Instagram when it has them; a business with no link shows its name only;
 *   - Sprinkle in Time Too declined logo use: name only (no logo);
 *   - the two sponsors who signed up 11-19 PM (Birdwell's, Bossier City; Accesorios Para Niñas) are added here from
 *     the email log (Desktop/Louisiana Helpr Work/Email and outreach/Email logs/Replies-1119.txt): Birdwell's site
 *     (shopbirdwells.com, their email domain, its own page read 11-20: "a southern classics home and gifting store"),
 *     no logo given; Accesorios Para Niñas by its Instagram (@accesorios_by_chabe), town not given.
 *   - owner 2026-11-21: confirmed Louisiana sponsors only (confirmedLocal below, read against the 25 Days Sponsor
 *     Tracker's copy in scripts/gift-guide-sponsor-order-1121.json); the page is the deals page's Small Business
 *     Saturday section (src/pages/info/giftGuides/GiftGuideDeals.tsx).
 * Not in CI (it reads the lead's folder): registered in scripts/check-generated-current.mjs (gift-guide-small-biz).
 * Guard: src/test/giftGuideSmallBiz1120.test.tsx.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { SMALL_BIZ_CATEGORIES } from "../src/content/giftGuideSmallBiz.mjs";

const REPO = resolve(import.meta.dirname, "..");
const DIR = join(homedir(), "Desktop/Gift-guide-picks");
const OUT = join(REPO, "src/content/giftGuideSmallBiz.json");
const LOGOS = join(REPO, "public/gift-guides/small-biz");

/**
 * The card shows the name only. Sprinkle in Time Too declined logo use (FOLLOWUP item 64). Tiffany Morton (audit 11-20)
 * left this list on 11-22: her TM logo from her Facebook is in SPONSOR_PAGE_LOGO below.
 */
const NO_LOGO = new Set(["sprinkle-in-time-too"]);
/**
 * A picture kept in the repo instead of a logo file from the folder. The Fois (owner 11-22 #12: "find a picture for the
 * fois"): its file on hand is David Rabalais's headshot, so the card shows the film's official poster he sent us
 * (25 Days Logos/Dec02-David-Rabalais-The-Fois-POSTER-not-logo.png), cropped to its top so the title reads small,
 * 400px WebP, not cut out (a poster, not a product). It lives in sponsor-picks/, which no generator clears.
 */
/**
 * Consistency audit 1122 #7 (the same image for the same business on every page): these cards show the logo the 25 Days
 * sponsors page draws (public/gift-guides/sponsors/<slug>.webp, written by scripts/gift-guide-sponsor-logos.mjs from
 * ~/Desktop/25 Days Logos). Monarch Books, Hair Fashion and Spa, Tiffany Morton and Phyllis Guy showed a beige name box
 * here; Mystic Forests' folder file had app buttons baked in (now the clean crop the sponsors page uses).
 */
const SPONSOR_PAGE_LOGO = {
  ...Object.fromEntries(
    ["monarch-books", "hair-fashion-and-spa", "tiffany-morton-cosmetic-tattooing", "phyllis-guy-dance-center", "mystic-forests-nursery",
      // 11-27 placements: the cutouts the sponsors page draws
      "luminous-advanced-aesthetics", "camellia-point-public-house", "jubilant-soapsetions"].map((s) => [s, `/gift-guides/sponsors/${s}.webp`]),
  ),
  "miss-claudias-vintage": "/gift-guides/sponsors/miss-claudias-vintage-clothing-and-costumes.webp",
};
const REPO_LOGO = { "david-rabalais-the-fois": "/gift-guides/sponsor-picks/the-fois-poster.webp", ...SPONSOR_PAGE_LOGO };
/**
 * Words the page says differently: the AllWays Lounge's street ("St. Claude Ave.") reads as the Marigny, since no
 * member-facing text may say "Claude" (src/test/noClaudeInMemberCopy.test.ts).
 */
// Holiday audit 1121 #58: a tracker aside about the owner ("(she emails them digitally)") reads as a note, not a gift.
const REWORD = [[/\bon St\. Claude Ave(nue|\.)?/g, "in the Marigny"], [/\bSt\. Claude\b/g, "Marigny"], [/ gift certificate \(she emails them digitally\)/g, " e-gift certificate"]];
/** Signed up after the file was made (owner's inbox 11-19 PM, 9:01 and 9:26 PM). */
const ADDED = [
  {
    slug: "birdwells", name: "Birdwell's", town: "Bossier City", category: "Home & Decor",
    description: "A Southern home and gifting store: home furnishings, decor, art and gift registries.",
    best_gift: "A Birdwell's digital gift card", website_url: "https://shopbirdwells.com/", shipping: "Digital gift card",
  },
  {
    slug: "accesorios-para-ninas", name: "Accesorios Para Niñas", town: "", category: "Kids",
    description: "Handmade hair accessories for little girls.", best_gift: "A set of girls' hair accessories",
    instagram_url: "https://www.instagram.com/accesorios_by_chabe/", shipping: "Ships or local drop-off",
  },
  // 25 Days sponsors placed Fri 11-27 (tracker data/sponsors.js); links from each business's own Instagram bio or website.
  {
    slug: "luminous-advanced-aesthetics", name: "Luminous Advanced Aesthetics", town: "Baton Rouge", category: "Beauty & Wellness",
    description: "An advanced aesthetics spa studio: facials, peels and skin treatments with holistic wellness touches.",
    best_gift: "A Luminous gift card toward a facial", website_url: "https://www.luminousadvancedaesthetics.com/",
    facebook_url: "https://www.facebook.com/109016033904081", instagram_url: "https://www.instagram.com/luminousadvancedaesthetics/",
  },
  {
    slug: "miss-claudias-vintage", name: "Miss Claudia's Vintage Clothing & Costumes", town: "New Orleans", category: "Fashion & Accessories",
    description: "Uptown New Orleans vintage shop: fine, fun and unique vintage clothing, costumes and wigs.",
    best_gift: "A Miss Claudia's gift certificate", website_url: "https://missclaudiasvintage.etsy.com/",
    facebook_url: "https://www.facebook.com/missclaudiasvintage", instagram_url: "https://www.instagram.com/missclaudiasvintage/",
    shipping: "Shop in New Orleans; vintage pieces also sold online",
  },
  {
    slug: "camellia-point-public-house", name: "Camellia Point Public House", town: "Slidell", category: "Food & Sweets",
    description: "A family- and dog-friendly pub with craft beer, cocktails, smash burgers, a playground and live music.",
    best_gift: "A Camellia Point gift card", facebook_url: "https://www.facebook.com/647288261796572",
    instagram_url: "https://www.instagram.com/camelliapoint/", shipping: "Local only (at the pub in Slidell)",
  },
  {
    slug: "jubilant-soapsetions", name: "Jubilant Soapsetions", town: "Monroe", category: "Home & Decor",
    description: "Small-batch, scratch-made bar soaps from plant oils and butters, in custom scents.",
    best_gift: "A soap bundle", website_url: "https://jubilantsoapsetions.com/",
    facebook_url: "https://www.facebook.com/jubilantsoapsetions", instagram_url: "https://www.instagram.com/jubilantsoapsetions/",
    shipping: "Ships (online shop)",
  },
];

/** Words a shopper must not read on this page (FOLLOWUP item 64: never a giveaway day or prize). */
const HIDDEN_WORDS = /\b(giveaway|winner|prize)\b/i;
/** An aside the lead's research left in the text (a price, a check note, a giveaway pairing). */
const NOTE_WORDS = /giveaway|winner|prize|\$|confirm|verified|tracker/i;
/** Only letters, numbers, spaces and plain punctuation reach the page (an allowlist: no markup can survive). */
const ALLOWED = /[^\p{L}\p{N}\s.,'’&!?()\-–—:;/#+%$]/gu;

/**
 * Text a shopper may read: kept to ALLOWED characters, then every "(...)" aside that holds a price or a research note
 * is dropped, every sentence naming a giveaway is dropped, and any "$" price left is dropped; spaces tidied. A scan,
 * not a pattern strip, so nothing can re-form after a removal.
 */
export const cleanText = (s) => {
  const text = String(s ?? "").replace(ALLOWED, " ");
  // Asides: one scan over the parentheses.
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") {
      const close = text.indexOf(")", i);
      if (close !== -1 && NOTE_WORDS.test(text.slice(i + 1, close))) {
        i = close;
        continue;
      }
    }
    out += text[i];
  }
  // Sentences naming a giveaway; then each word holding a "$" (a price), with a "from"/"only"/"at" just before it.
  const sentences = out.split(/(?<=[.;])\s+/).filter((x) => !HIDDEN_WORDS.test(x));
  const kept = [];
  for (const w of sentences.join(" ").split(/\s+/)) {
    if (w.includes("$")) {
      if (kept.length && /^(from|only|at)$/i.test(kept[kept.length - 1])) kept.pop();
      continue;
    }
    kept.push(w);
  }
  return kept.join(" ").replace(/\s+([.,;:])/g, "$1").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
};

const https = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? u : undefined);
/** Ships, or local only, read from the business's own shipping note. */
const shipsOf = (s) => (/\b(ship|mail|nationwide|online|digital)/i.test(String(s ?? "")) ? "ships" : "local");
/**
 * Holiday audit 1121 #58: a place you go (a theatre, a riverboat, a studio, a dance school) never "Ships", even when
 * its tickets or classes are sold online; only a maker's goods ship.
 */
const VISIT_CATEGORIES = new Set(["Experiences & Tours", "Services", "Beauty & Wellness"]);
const VENUE_SLUGS = new Set(["phyllis-guy-dance-center", "playtopia-lafayette"]);
export const shipsFor = (b) => (VISIT_CATEGORIES.has(b.category) || VENUE_SLUGS.has(b.slug) ? "local" : shipsOf(b.shipping));
/** Holiday audit 1121 #58: the card names the business, not the person behind it ("Bake & Brush (Holli M. Landry)"). */
export const cardName = (name) => String(name ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
/** Holiday audit 1121 #58: a town or region, never an area code ("Acadiana (337)", "Lafayette (serves 337 and 225)"). */
export const cardTown = (town) => String(town ?? "").replace(/\s*\((?:serves\s+)?\d{3}(?:\s*(?:and|,|\/)\s*\d{3})*\)/gi, "").trim();

/**
 * CONFIRMED SPONSORS ONLY (owner 2026-11-21, the deals page's Small Business Saturday section): a business shows only
 * when its 25 Days Sponsor Tracker name (TRACKER_NAME) is in scripts/gift-guide-sponsor-order-1121.json's `value` list
 * (prize, value and delivery confirmed) and in neither its `notConfirmed` nor its `national` list. A card with no
 * tracker name (Birdwell's and Accesorios Para Niñas signed up 11-19 PM and are not on the tracker) stays off.
 * Sprinkle in Time Too said NO to "OK on the wall" on its sign-up (Small-Business-Saturday-1119.md "check before
 * publishing": feature only if the owner OKs it); no OK is on record, so it stays off (HELD).
 */
export const TRACKER_NAME = {
  "bake-and-brush": "Bake & Brush", "basic-bee": "Basic Bee", "breads-and-sweets-by-babs": "Breads and Sweets by Babs",
  "dupuys-abbeville": "Dupuy's Abbeville", "faith-and-fire-bbq": "Faith & Fire BBQ", "ripleys-crawfish": "Ripley's Crawfish",
  "sprinkle-in-time-too": "Sprinkle in Time Too", "crab-man-plus": "The Crab Man Plus", "zydeco-chop-chop": "Zydeco Chop Chop",
  "beavers-abundance": "Beaver's Abundance", "candle-bloom-confections": "Candle Bloom Confections",
  "mystic-forests-nursery": "Mystic Forests Nursery", "humble-home-decor-candles": "The Humble Home Decor & Candles",
  "tufted-artworks": "Tufted Artworks", "wicks-nola": "Wicks NOLA Candle Company", "faulks-game-calls": "Faulk's Game Call Co.",
  "monarch-books": "Monarch Books", "david-rabalais-the-fois": "David Rabalais", "soft-life-collective": "The Soft Life Collective",
  "whimsies-from-within": "Whimsies from Within", "written-on-the-river": "Written on the River",
  "cajun-belle-studio": "Cajun Belle Studio", "cher-bebe-embroidery": "Cher Bebe Embroidery",
  "megan-benoits-closet": "Megan Benoit's Closet", "botanical-nail-and-skin-studio": "Botanical Nail and Skin Studio",
  "hair-fashion-and-spa": "Hair Fashion and Spa", "tiffany-morton-cosmetic-tattooing": "Tiffany Morton Cosmetic Tattooing",
  "phyllis-guy-dance-center": "Phyllis Guy Dance Center", "playtopia-lafayette": "Playtopia Lafayette",
  "cat-5-fishing-charters": "Cat 5 Fishing Charters", "crabtrap-functional-fitness": "Crabtrap Functional Fitness",
  "gods-country-rv-resort": "God's Country RV Resort", "le-petit-theatre": "Le Petit Theatre",
  "creole-queen": "Paddlewheeler Creole Queen", "rip-van-winkle-gardens": "Rip Van Winkle Gardens",
  "allways-lounge": "AllWays Lounge & Cabaret", "barclell-photography": "Barclell Photography", "britt-creates": "Britt Creates",
  "hannahbelle-photography": "Hannahbelle Photography", "hello-darlin": "Hello Darlin'",
  "jessica-lanham-photography": "Jessica Lanham Photography", "olivia-grace-photography": "Olivia Grace Photography",
  "suzi-marques-photography": "Suzi Marques Photography",
  // 11-27 placements (ADDED above)
  "luminous-advanced-aesthetics": "Luminous Advanced Aesthetics", "miss-claudias-vintage": "Miss Claudia's Vintage Clothing & Costumes",
  "camellia-point-public-house": "Camellia Point Public House", "jubilant-soapsetions": "Jubilant Soapsetions",
};
/** Confirmed in the tracker, but held off this page until the owner says yes (see above). */
export const HELD = new Set(["sprinkle-in-time-too"]);

/** Whether a card may show: a confirmed, Louisiana (not national) 25 Days sponsor, not held. */
export function confirmedLocal(slug, order) {
  const name = TRACKER_NAME[slug];
  if (!name || HELD.has(slug)) return false;
  return Object.hasOwn(order.value, name) && !order.notConfirmed.includes(name) && !order.national.includes(name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
const order = JSON.parse(readFileSync(join(REPO, "scripts/gift-guide-sponsor-order-1121.json"), "utf8"));
const src = JSON.parse(readFileSync(join(DIR, "_small-biz-saturday-1119.json"), "utf8"));
/** Sponsors the owner dropped (owner 11-20: R&R Wedding Co.): off the page entirely (holiday audit B). */
const DROPPED = new Set(["rr-wedding-co"]);
const all = [...src.businesses, ...ADDED.filter((a) => !src.businesses.some((b) => b.slug === a.slug))].filter((b) => !DROPPED.has(b.slug));
const rows = all.filter((b) => confirmedLocal(b.slug, order));
console.log(`left off (not confirmed, national, not on the tracker or held): ${all.filter((b) => !rows.includes(b)).map((b) => b.name).join(", ")}`);
rmSync(LOGOS, { recursive: true, force: true });
mkdirSync(LOGOS, { recursive: true });
const cards = [];
for (const b of rows) {
  if (!SMALL_BIZ_CATEGORIES.includes(b.category)) throw new Error(`gift-guide-small-biz: ${b.name}: unknown category ${b.category}`);
  const website = https(b.website_url);
  const facebook = https(b.facebook_url);
  const instagram = https(b.instagram_url);
  let logo = REPO_LOGO[b.slug];
  const file = b.logo_file && !NO_LOGO.has(b.slug) && !logo ? join(DIR, b.logo_file) : null;
  if (file) {
    const ext = extname(file).toLowerCase() === ".png" ? ".png" : ".jpg";
    const to = join(LOGOS, `${b.slug}${ext}`);
    try {
      copyFileSync(file, to);
      // At most 240 px a side (the card draws it at 72); macOS sips keeps the format.
      execFileSync("sips", ["-Z", "240", to], { stdio: "ignore" });
      logo = `/gift-guides/small-biz/${b.slug}${ext}`;
    } catch (e) {
      // A logo the folder does not hold: the card shows the name instead.
      if (e?.code !== "ENOENT") throw e;
    }
  }
  cards.push({
    slug: b.slug, name: cardName(b.name), town: cardTown(cleanText(b.town)), category: b.category,
    description: REWORD.reduce((t, [re, to]) => t.replace(re, to), cleanText(b.description)), gift: REWORD.reduce((t, [re, to]) => t.replace(re, to), cleanText(b.best_gift)),
    ...(website || facebook || instagram ? { href: website ?? facebook ?? instagram } : {}),
    ...(website ? { website } : {}), ...(facebook ? { facebook } : {}), ...(instagram ? { instagram } : {}),
    ...(logo ? { logo } : {}), ships: shipsFor(b),
  });
}
cards.sort((a, b) => SMALL_BIZ_CATEGORIES.indexOf(a.category) - SMALL_BIZ_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
writeFileSync(OUT, `[\n${cards.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`);
console.log(`gift-guide-small-biz: ${cards.length} businesses, ${cards.filter((c) => c.logo).length} logos, ${cards.filter((c) => !c.href).length} with no link`);
}
