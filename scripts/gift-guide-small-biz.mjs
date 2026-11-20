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

/** Logo use declined (FOLLOWUP item 64): the card shows the name only. */
const NO_LOGO = new Set(["sprinkle-in-time-too"]);
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

const src = JSON.parse(readFileSync(join(DIR, "_small-biz-saturday-1119.json"), "utf8"));
const rows = [...src.businesses, ...ADDED.filter((a) => !src.businesses.some((b) => b.slug === a.slug))];
rmSync(LOGOS, { recursive: true, force: true });
mkdirSync(LOGOS, { recursive: true });
const cards = [];
for (const b of rows) {
  if (!SMALL_BIZ_CATEGORIES.includes(b.category)) throw new Error(`gift-guide-small-biz: ${b.name}: unknown category ${b.category}`);
  const website = https(b.website_url);
  const facebook = https(b.facebook_url);
  const instagram = https(b.instagram_url);
  let logo;
  const file = b.logo_file && !NO_LOGO.has(b.slug) ? join(DIR, b.logo_file) : null;
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
    slug: b.slug, name: b.name, town: cleanText(b.town), category: b.category,
    description: cleanText(b.description), gift: cleanText(b.best_gift),
    ...(website || facebook || instagram ? { href: website ?? facebook ?? instagram } : {}),
    ...(website ? { website } : {}), ...(facebook ? { facebook } : {}), ...(instagram ? { instagram } : {}),
    ...(logo ? { logo } : {}), ships: shipsOf(b.shipping),
  });
}
cards.sort((a, b) => SMALL_BIZ_CATEGORIES.indexOf(a.category) - SMALL_BIZ_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name));
writeFileSync(OUT, `[\n${cards.map((c) => JSON.stringify(c)).join(",\n")}\n]\n`);
console.log(`gift-guide-small-biz: ${cards.length} businesses, ${cards.filter((c) => c.logo).length} logos, ${cards.filter((c) => !c.href).length} with no link`);
