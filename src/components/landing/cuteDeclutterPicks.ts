/**
 * Owner 11-18, on the landing's "Popular on Declutter" grid: "Are they actually popular? Show cuter things like the Vera
 * Bradley bag, lamp, sunglasses pillow cover Basket stockings etc".
 *
 * Measured on prod 11-18 (read-only SQL): declutter_popular_items(24) returned none of those (boxed toys, a heating pad,
 * an acrylic number stand, a hospital bed: only 16 listings have any views, so the order is mostly recency), and the
 * items she named sat at positions 101 to 224 of the 225 live listings. So the landing reads the popular order AND the
 * live pool, and this pure helper puts the giftable, cute home and style things first: a small title/category keyword
 * score on top of the popular order (popular rank breaks ties, so within a tier the most-viewed still lead).
 *
 * It also drops test listings by title ("SEED TEST ..."). The server already leaves them out (declutter_popular_items
 * and the anon row policy both filter is_seed, and every prod "SEED TEST" row is is_seed, checked 11-18); this is the
 * belt to that, so a mis-flagged test row can never reach the landing.
 *
 * Guard: src/components/landing/cuteDeclutterPicks.test.ts.
 */

/** Title words that mark a cute, giftable home or style piece (each matched as a whole word or phrase). */
const CUTE: { re: RegExp; w: number }[] = [
  { re: /\bvera bradley\b/i, w: 4 },
  { re: /\b(?:purse|handbag|tote|duffel|crossbody|clutch|wristlet)s?\b/i, w: 3 },
  { re: /\blamps?\b/i, w: 3 },
  { re: /\bsunglasses\b/i, w: 3 },
  { re: /\bpillow covers?\b|\bthrow pillows?\b|\bpillow shams?\b/i, w: 3 },
  { re: /\bbaskets?\b/i, w: 3 },
  { re: /\bstockings?\b/i, w: 3 },
  { re: /\b(?:christmas|holiday|ornaments?|wreaths?|garlands?|nativity|nutcrackers?)\b/i, w: 2 },
  { re: /\bcandles?\b|\bcandle holders?\b/i, w: 2 },
  { re: /\b(?:jewelry|necklaces?|earrings?|bracelets?|rings?)\b/i, w: 2 },
  { re: /\bsigns?\b|\bwall (?:art|decor)\b|\bvases?\b|\bmirrors?\b|\bpicture frames?\b|\bplanters?\b/i, w: 2 },
  { re: /\b(?:floral|scalloped|ruffle|quilted|woven|seagrass|rattan|wicker|velvet|knit|brass|marble|pleated|gold)\b/i, w: 1 },
];
/** Categories that hold most of the cute things. */
const CUTE_CATEGORY: Record<string, number> = { home_decor: 2, holiday_seasonal: 2, jewelry_accessories: 1 };
/** Plain boxed products and utilitarian items (owner's examples: a heating pad, a sealed toy box, an acrylic number stand). */
const PLAIN: RegExp[] = [
  /\bin (?:the )?(?:box|package|packaging)\b|\bboxed\b|\bsealed\b|\b\d+\s?oz box\b/i,
  /\bheating pad\b|\bmassage\b|\bhospital\b|\bpatient\b|\bwheelchair\b|\bwalker\b|\bcommode\b/i,
  /\bacrylic\b.*\bstand\b|\bnumber \d+ stand\b/i,
  /\bneck pillow\b|\bbed pillow\b|\bdesk lamp\b|\bgooseneck\b/i,
  /\b(?:filter|sifter|cutter|mold tray|stepper|lift|sling|charger|cable|cord set)\b/i,
];

/** A test listing by its title: the seed script's "SEED TEST ..." prefix, or a "(TEST ...)" marker. */
export function isTestListingTitle(title: string): boolean {
  const t = title.trim();
  return /^seed\s*test\b/i.test(t) || /\(\s*test\b[^)]*\)/i.test(t);
}

/** How cute and giftable a listing reads from its title and category; 0 or less is plain. */
export function cuteScore(title: string, category: string | null | undefined): number {
  let s = 0;
  for (const { re, w } of CUTE) if (re.test(title)) s += w;
  s += CUTE_CATEGORY[category ?? ""] ?? 0;
  for (const re of PLAIN) if (re.test(title)) s -= 4;
  return s;
}

/** The first five words of a title, lowercased: two listings of the same thing ("..., Green and Teal" / "... Floral") show once. */
function sameThingKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
}

/**
 * `rows` in popular order (best first). Returns them without test listings or repeats of the same thing, cute pieces
 * first (higher cuteScore first; the popular order breaks ties, so the sort is stable within a tier).
 */
export function pickCuteFirst<T extends { title: string; category: string | null | undefined }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const kept: { row: T; score: number; rank: number }[] = [];
  rows.forEach((row, rank) => {
    if (isTestListingTitle(row.title)) return;
    const key = sameThingKey(row.title);
    if (seen.has(key)) return;
    seen.add(key);
    kept.push({ row, score: cuteScore(row.title, row.category), rank });
  });
  kept.sort((a, b) => b.score - a.score || a.rank - b.rank);
  return kept.map((k) => k.row);
}
