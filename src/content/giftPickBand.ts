/**
 * What a gift pick costs, for a budget (owner 11-20: a Secret Santa set to $25 showed "all expensive gifts"). Never
 * shown: Amazon allows no price outside its own site, so an Amazon pick's cost is only ever its budget section.
 * Guard: src/test/secretSantaIdeas1120.test.tsx.
 */
import type { CatalogPick } from "@/content/giftGuideCatalog";

type Band = 25 | 50 | 100 | 500;
/** A budget guide section's ceiling: its anchor ("under-25", "100-and-up") or its heading ("Under $25", "$100 & Up"). */
const SECTION_BANDS: Record<string, Band> = { "under-25": 25, "under-50": 50, "under-100": 100, "100-and-up": 500 };
const toBand = (n: number): Band => (n <= 25 ? 25 : n <= 50 ? 50 : n <= 100 ? 100 : 500);
const sectionBand = (p: CatalogPick): Band | undefined => {
  if (p.sectionId && SECTION_BANDS[p.sectionId]) return SECTION_BANDS[p.sectionId];
  const heading = p.section?.trim() ?? "";
  const m = /^under \$(\d+)$/i.exec(heading);
  if (m) return toBand(Number(m[1]));
  return /^\$100 (&|and) up$/i.test(heading) ? 500 : undefined;
};

/** A checked price, never an Amazon one. */
const knownPrice = (p: CatalogPick) => (p.price !== undefined && p.store !== "amazon" ? p.price : undefined);

/** The pick's band ($25, $50, $100; 500 = over $100): its own band, else its checked price, else its budget section. */
export const pickBand = (p: CatalogPick): Band | undefined => p.band ?? (knownPrice(p) !== undefined ? toBand(knownPrice(p)!) : sectionBand(p));

/**
 * The most the pick may cost: its checked price, else its band's ceiling ("under $25" = at most 25). Undefined = not
 * known, which never fits a budget (a pick with no price could be anything).
 */
export const pickCeiling = (p: CatalogPick): number | undefined => knownPrice(p) ?? pickBand(p);

/** Whether a pick is known to cost at most `budget` dollars (0 = any budget: everything fits). */
export const fitsBudget = (p: CatalogPick, budget: number) => {
  if (budget <= 0) return true;
  const c = pickCeiling(p);
  return c !== undefined && c <= budget;
};

/** The guides whose sections are budgets ("Under $25", "Under $100"): a budget round borrows from them. */
export const BUDGET_GUIDES = ["gifts-by-budget", "splurge"] as const;
