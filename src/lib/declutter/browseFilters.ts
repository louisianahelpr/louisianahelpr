/**
 * Declutter Browse's filters and sort (boards 25 + 39, HELPR-DESIGN-SPEC v2
 * §3 "Filter sheet": Sort · Distance · the section block · Category · toggles).
 * Pure: the screen holds the state, this file decides which rows show and in
 * what order, so the chip row, the phone sheet and the desktop column all
 * agree on one answer (and on the live "Show N items" count).
 *
 * Every filter reads a real column (truth rule): price = current_price_cents,
 * condition = condition_stars, porch pickup = porch_ok, category = category,
 * "Price drops" = the real nightly drop rule (priceDrop.ts) from the item's
 * sale_mode + last_price_drop_on. Nothing here is a guess about an item.
 */
import { nextPriceDrop, type PriceDropFields } from "@/lib/declutter/priceDrop";

export type DeclutterSort = "closest" | "newest" | "price_low";

export interface DeclutterFilters {
  sort: DeclutterSort;
  /** Whole dollars; null = no bound. */
  minDollars: number | null;
  maxDollars: number | null;
  /** condition_stars values the member picked; empty = any condition. */
  conditions: number[];
  category: string | null;
  porchOnly: boolean;
  dropsOnly: boolean;
}

export const NO_FILTERS: DeclutterFilters = {
  sort: "closest",
  minDollars: null,
  maxDollars: null,
  conditions: [],
  category: null,
  porchOnly: false,
  dropsOnly: false,
};

export const SORT_LABEL: Record<DeclutterSort, string> = {
  closest: "Closest first",
  newest: "Newest",
  price_low: "Lowest price",
};

/** The drop columns Browse reads per item (fetchDropStates). */
export type DropState = Pick<PriceDropFields, "sale_mode" | "last_price_drop_on">;

interface BrowseItem {
  status: string;
  category: string;
  condition_stars: number;
  current_price_cents: number;
  porch_ok: boolean;
  live_at: string | null;
  created_at: string;
}

/** The Louisiana calendar day an instant falls on. */
function chicagoDay(at: Date): string {
  return at.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/**
 * Whether the real nightly sweep could lower this item at all (it is on the
 * drop plan and not passed over at its stop), and whether that next chance is
 * TONIGHT, Louisiana time. The stop is private, so "could": a card says "May
 * drop tonight", never "Drops tonight" (money review, design-b-1020 #1).
 */
export function dropOutlook(item: BrowseItem, state: DropState | undefined, now: Date = new Date()): { planned: boolean; tonight: boolean } {
  if (!state) return { planned: false, tonight: false };
  const next = nextPriceDrop({ ...item, ...state }, now);
  if (!next) return { planned: false, tonight: false };
  return { planned: true, tonight: chicagoDay(next.at) === chicagoDay(now) };
}

/** How many filters (beyond the sort) are on: the filter button's count dot. */
export function activeFilterCount(f: DeclutterFilters, maxMiles: number | null): number {
  return (
    (maxMiles !== null ? 1 : 0)
    + (f.minDollars !== null || f.maxDollars !== null ? 1 : 0)
    + (f.conditions.length > 0 ? 1 : 0)
    + (f.category ? 1 : 0)
    + (f.porchOnly ? 1 : 0)
    + (f.dropsOnly ? 1 : 0)
  );
}

/**
 * The rows that pass every filter, in the chosen order. `rows` come from
 * nearestFirst (closest first when the member's location is known, else
 * newest first as fetched); "closest" with no location keeps that order.
 */
export function applyBrowseFilters<T extends BrowseItem & { id: string; title: string }>(
  rows: { item: T; miles: number | null }[],
  f: DeclutterFilters,
  query: string,
  drops: Map<string, DropState> | undefined,
  now: Date = new Date(),
): { item: T; miles: number | null }[] {
  const q = query.trim().toLowerCase();
  const minC = f.minDollars !== null ? f.minDollars * 100 : null;
  const maxC = f.maxDollars !== null ? f.maxDollars * 100 : null;
  const kept = rows.filter(({ item }) => {
    if (q && !item.title.toLowerCase().includes(q)) return false;
    if (f.category && item.category !== f.category) return false;
    if (minC !== null && item.current_price_cents < minC) return false;
    if (maxC !== null && item.current_price_cents > maxC) return false;
    if (f.conditions.length > 0 && !f.conditions.includes(item.condition_stars)) return false;
    if (f.porchOnly && !item.porch_ok) return false;
    if (f.dropsOnly && !dropOutlook(item, drops?.get(item.id), now).planned) return false;
    return true;
  });
  if (f.sort === "price_low") return [...kept].sort((a, b) => a.item.current_price_cents - b.item.current_price_cents);
  if (f.sort === "newest") {
    const at = (i: BrowseItem) => new Date(i.live_at ?? i.created_at).getTime() || 0;
    return [...kept].sort((a, b) => at(b.item) - at(a.item));
  }
  return kept;
}
