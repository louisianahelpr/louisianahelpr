/**
 * BUDGET CAPS (gg-live-1120, live check 11-20): a budget section never shows a pick whose checked price is over its cap.
 * The live Under $25 showed the Rainbow Loom Mighty Loom (~$35), Loomi-Pals Glow (~$44) and Malbon socks ($28), and
 * Stocking Stuffers showed a $66 Rare Beauty set. scripts/gift-guide-picks.mjs runs this LAST, after the late price
 * fill, so a price that arrives in any pass is checked:
 *   1. an over-cap pick moves to the cheapest budget section on the same page whose cap fits and has room (under
 *      SECTION_ROOM), else it leaves the page;
 *   2. scripts/gift-guide-budget-1120.json `adds` refill each section with hand-picked in-budget picks, each copied with
 *      its photo, link and checked price from the store page that already shows it (a row over the cap, or one no
 *      longer shown on a store page, is reported and skipped).
 * Every rule that finds nothing is reported. Guard: src/test/giftGuideBudgetCaps1120.test.ts.
 */

/** Section id -> the most a pick in it may cost (USD). Stocking Stuffers: little gifts, $30 at most (gg-live-1120; holiday audit A #56: a $45 cocotte and a $48 jewelry case are no stocking stuffers). */
export const BUDGET_SECTION_CAPS = { "under-25": 25, "stocking-stuffers": 30, "secret-santa": 30, "under-50": 50, "under-100": 100 };
const SECTION_ROOM = 25;

const rate = (p) => (typeof p.commission === "number" ? p.commission : -1);
/** Puts a pick into its section in commission order (owner 11-19 ~6:40 PM): before the first that pays less, else last. */
const placeByRate = (list, row) => {
  const idx = list.map((p, i) => ({ p, i })).filter((x) => x.p.sectionId === row.sectionId);
  const before = idx.find((x) => rate(x.p) < rate(row));
  list.splice(before ? before.i : idx.length ? idx[idx.length - 1].i + 1 : list.length, 0, row);
};

export function applyBudgetCaps(pageList, spec = {}) {
  const counts = { moved: 0, out: 0, added: 0 };
  const missing = [];
  const capOf = (p) => BUDGET_SECTION_CAPS[p.sectionId];
  const over = (p) => typeof p.price === "number" && capOf(p) != null && p.price > capOf(p);
  for (const slug of Object.keys(pageList)) {
    const list = pageList[slug];
    if (!list.some(over)) continue;
    const order = [...new Set(list.map((p) => p.sectionId))];
    const budget = order.filter((id) => BUDGET_SECTION_CAPS[id] != null)
      // Cheapest cap first; on a tie a plain "Under $X" section before a themed one (Stocking Stuffers, Secret Santa).
      .sort((a, b) => BUDGET_SECTION_CAPS[a] - BUDGET_SECTION_CAPS[b] || Number(!a.startsWith("under-")) - Number(!b.startsWith("under-")));
    const titleOf = new Map(list.map((p) => [p.sectionId, p.section]));
    const out = list.filter((p) => !over(p));
    const size = (id) => out.filter((p) => p.sectionId === id).length;
    for (const p of list.filter(over)) {
      const to = budget.find((id) => BUDGET_SECTION_CAPS[id] >= p.price && size(id) < SECTION_ROOM);
      if (!to) { counts.out += 1; continue; }
      placeByRate(out, { ...p, sectionId: to, section: titleOf.get(to) });
      counts.moved += 1;
    }
    pageList[slug] = out;
  }
  const shownOnStores = new Map();
  for (const [slug, l] of Object.entries(pageList)) if (slug.startsWith("store-")) for (const p of l) if (!shownOnStores.has(p.href)) shownOnStores.set(p.href, p);
  for (const a of spec.adds ?? []) {
    const list = pageList[a.guide];
    const src = shownOnStores.get(a.href);
    const cap = BUDGET_SECTION_CAPS[a.section];
    const title = list?.find((p) => p.sectionId === a.section)?.section;
    if (!list || !title) { missing.push(`add ${a.href}: no section ${a.guide}/${a.section}`); continue; }
    if (!src) { missing.push(`add ${a.href}: not on a store page`); continue; }
    if (typeof src.price !== "number" || src.price > cap) { missing.push(`add ${a.href}: price ${src.price ?? "none"} over ${cap}`); continue; }
    if (Object.entries(pageList).some(([s, l]) => !s.startsWith("store-") && l.some((p) => p.href === a.href))) { missing.push(`add ${a.href}: already on a guide`); continue; }
    if (list.filter((p) => p.sectionId === a.section).length >= SECTION_ROOM) { missing.push(`add ${a.href}: ${a.section} full`); continue; }
    // The spec names the rate and gift type a store-page row lacks (the network's rate, as on the brand's other picks).
    const row = { ...src, commission: src.commission ?? a.commission, type: src.type ?? a.type, section: title, sectionId: a.section, from: a.from ?? a.section };
    placeByRate(list, row);
    counts.added += 1;
  }
  return { counts, missing };
}
