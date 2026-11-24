/**
 * Google search setup for the live gift guide pages (owner 2026-11-23 ~8:50 PM, "Google search setup": the guide pages
 * had ~3 Google visitors in 4 days). Live audit 11-23 (curl of the prerendered HTML): every guide's <title> was just its
 * name ("Gifts for Her — Helpr": no year, no "Christmas", no price words), the descriptions ran past 155 characters,
 * the pre-JS intro was one generic count line, and Her linked only Him, Kids and the deals days linked no other guide.
 *
 * This module holds the search words for those pages, read by the head (giftGuidePageMeta.mjs), the pre-JS body
 * (seoBodies.mjs) and the page's own visible intro (GuideQa.tsx), so the three cannot drift. Every claim is checked
 * against the picks: each guide has picks under $10, $25 and $50 and a price on every pick (the budget filter), Kids
 * has its Age and Price filters, and each guide holds Louisiana gifts (Saints, LSU, Cajun books...). The og:title
 * (the Facebook headline the owner shares) is NOT changed here.
 * Guard: src/test/guideSearchHead1123.test.ts. Types: guideSearch.d.mts.
 */

/** Her, Him and Kids: the <title> (at most 60 characters, sentence case, ending " — Helpr" as every guide tab does: audit 1122 #25), the "who" words of the description, and the visible intro. */
export const GUIDE_SEARCH = {
  her: {
    title: "Gifts for her 2026: Christmas ideas under $25 & $50 — Helpr",
    who: "for her",
    intro:
      "Christmas gift ideas for her, from stocking stuffers under $10 to gifts under $25, $50 and $100, with Louisiana gifts mixed in. Every gift shows its price, and each one links straight to the store that sells it.",
  },
  him: {
    title: "Gifts for him 2026: Christmas ideas under $25 & $50 — Helpr",
    who: "for him",
    intro:
      "Christmas gift ideas for him, from stocking stuffers under $10 to gifts under $25, $50 and $100, with Louisiana gifts mixed in. Every gift shows its price, and each one links straight to the store that sells it.",
  },
  kids: {
    title: "Christmas gifts for kids 2026: by age & price — Helpr",
    who: "for kids",
    intro:
      "Christmas gifts for kids, from stocking stuffers to gifts under $25 and $50, with a few Louisiana books and toys mixed in. Filter by age and price to narrow the list, and every gift links straight to the store that sells it.",
  },
};

/** The deals days' <title>s (each at most 60 characters). Their banner and og:title stay their pageTitle. */
export const DEAL_DAY_SEARCH_TITLES = {
  "black-friday": "Black Friday gift deals & codes 2026 — Helpr",
  "cyber-monday": "Cyber Monday gift deals & codes 2026 — Helpr",
  "small-business-saturday": "Small Business Saturday 2026: Louisiana shops — Helpr",
};

/** The main guide and deals pages, linked from each other in the pre-JS body (each page leaves itself out). */
export const GUIDE_CROSS_LINKS = [
  ["her", "Gifts for Her"],
  ["him", "Gifts for Him"],
  ["kids", "Gifts for Kids"],
  ["black-friday", "Black Friday Deals"],
  ["small-business-saturday", "Small Business Saturday"],
  ["cyber-monday", "Cyber Monday Deals"],
];

/** The longest description Google shows before cutting it. */
export const MAX_DESCRIPTION = 155;

/**
 * A searchable guide's description: its count, the price words and its first lead pick, at most MAX_DESCRIPTION
 * characters (the closing line, then the lead pick, drop when it would run over). `null` when `slug` is not one of
 * GUIDE_SEARCH or it holds no picks.
 */
export function guideSearchDescription(slug, count, leadName) {
  const s = Object.prototype.hasOwnProperty.call(GUIDE_SEARCH, slug) ? GUIDE_SEARCH[slug] : null;
  const n = Number(count) || 0;
  if (!s || n <= 0) return null;
  const lead = String(leadName ?? "").trim();
  const head = `${n} Christmas gift ideas ${s.who}: stocking stuffers under $10, gifts under $25 and $50`;
  const tries = [
    ...(lead ? [`${head}, and favorites like ${lead}. Every pick shows its price.`, `${head}, and favorites like ${lead}.`] : []),
    `${head}. Every pick shows its price.`,
    `${head}.`,
  ];
  return tries.find((t) => t.length <= MAX_DESCRIPTION) ?? tries[tries.length - 1];
}
