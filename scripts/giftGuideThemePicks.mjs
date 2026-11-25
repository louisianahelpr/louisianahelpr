/**
 * A THEMED KIDS GUIDE'S PAGE PICKS, laid out like For Kids (owner 2026-11-24 ~7 PM, on /gift-guides/monster-jam: "Remove
 * these buttons and add a filter like the main 3 guides. They should also be sorted like the main 3 guides"). ONE rule
 * for the generator (scripts/giftGuideThemes1124.mjs themePicks1124) and the one-command import
 * (scripts/theme-guide-import.mjs), so every theme, today's and every later import, gets the same chunk:
 *  - no category sections: the page groups the picks into the main guides' price sections (Stocking stuffers under $10,
 *    Under $25, $25 to $50 ... by the price each card shows; src/lib/pickPriceShown.mjs PRICE_SECTIONS), so a pick carries
 *    no `section` / `sectionId` and the "Jump to a section" chips have nothing to draw;
 *  - `priceRank`, the cheapest-first place the main guides' price sort reads (scripts/giftGuidePriceRank1121.mjs rankByPrice
 *    on the row's own price), and the chunk is written in that order;
 *  - `ageMin` / `ageMax` (years) from the research's own age ("3+", "4-12", "18-36m", "12m-5T", "toddler"), for the
 *    Filter's Age chips. An age the research did not state as a number or a toddler ("kids", "all", "adult sizes") gives
 *    none, so that pick stays out of every Age chip, as an untagged Kids pick does (never a guess).
 * Guard: src/test/giftGuideThemeLayout1124.test.tsx.
 */
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";

const num = "(\\d+(?:\\.\\d+)?)";
/** "18m" -> 1.5, "5T" / "5" -> 5 (T is a toddler clothing size: years). */
const years = (n, unit) => (unit === "m" ? Number(n) / 12 : Number(n));

/** The research's age text as whole-or-part years { ageMin, ageMax? }, or {} when it states no number. */
export function themeAge(age) {
  const a = String(age ?? "").trim().toLowerCase();
  let m = a.match(new RegExp(`^${num}(m)?\\+$`));
  if (m) return { ageMin: years(m[1], m[2]) };
  m = a.match(new RegExp(`^${num}(m)?-${num}(m|t)?$`));
  if (m) {
    // "18-36m": the unit after the second number covers both; "18m-12": months, then years.
    const firstUnit = m[2] ?? (m[4] === "m" ? "m" : "");
    return { ageMin: years(m[1], firstUnit), ageMax: years(m[3], m[4]) };
  }
  // A toddler is 1 to 3 years old.
  if (a === "toddler") return { ageMin: 1, ageMax: 3 };
  if (a === "teens") return { ageMin: 13, ageMax: 17 };
  if (a === "teen-adult") return { ageMin: 13 };
  return {};
}

/** One theme's chunk picks, cheapest first (the ResearchedPick shape the other guides use). */
export function themeChunkPicks(slug, rows) {
  const ranked = rankByPrice(rows.map((r) => ({ ...r, sortPrice: Number(r.price) })));
  return ranked.map(({ row, priceRank }) => {
    const { id: _id, was: _was, age, section: _section, sectionId: _sectionId, ownerAdd: _ownerAdd, sortPrice: _sp, ...p } = row;
    return { ...p, ...themeAge(age), ...(priceRank === null ? {} : { priceRank }), ownerPick: true, from: slug };
  });
}
