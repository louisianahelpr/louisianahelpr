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
import { matchesSearch } from "@/lib/declutter/searchMatch";

export type DeclutterSort = "closest" | "newest" | "price_low";

/**
 * A3-109: the ways besides porch pickup a buyer can narrow to, in checkout's words (handoverCopy HANDOVER_TITLE). Porch
 * stays `porchOnly` (saved searches keep it as porch_only); these ride in the URL as `ways=`.
 */
export const OTHER_WAYS = ["meetup", "seller_delivery", "delivery"] as const;
export type OtherWay = (typeof OTHER_WAYS)[number];
/** The ways an item's seller ticked (declutter_items.handovers), by id; read only while a way filter is on. */
export type ItemWays = Map<string, string[] | null>;

export interface DeclutterFilters {
  sort: DeclutterSort;
  /** Whole dollars; null = no bound. */
  minDollars: number | null;
  maxDollars: number | null;
  /** condition_stars values the member picked; empty = any condition. */
  conditions: number[];
  category: string | null;
  porchOnly: boolean;
  /** A3-109: meet up, seller delivers, Helpr delivery. With porchOnly these are one group: an item offering ANY passes. */
  ways: OtherWay[];
  dropsOnly: boolean;
  /** The Free section (20261027170717): only items given away free (current_price_cents = 0). */
  freeOnly: boolean;
}

export const NO_FILTERS: DeclutterFilters = {
  sort: "closest",
  minDollars: null,
  maxDollars: null,
  conditions: [],
  category: null,
  porchOnly: false,
  ways: [],
  dropsOnly: false,
  freeOnly: false,
};

export const SORT_LABEL: Record<DeclutterSort, string> = {
  closest: "Closest first",
  newest: "Newest",
  price_low: "Lowest price",
};

/** The drop columns Browse reads per item (fetchDropStates). */
export type DropState = Pick<PriceDropFields, "sale_mode" | "last_price_drop_on" | "drop_pct" | "drops_stopped">;

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

/** A whole-dollar or mile URL value, or null when absent or not a positive number. */
function positive(v: string | null): number | null {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const SORTS: readonly DeclutterSort[] = ["closest", "newest", "price_low"];

export type BrowseState = { query: string; filters: DeclutterFilters; maxMiles: number | null };

/**
 * Browse's starting state from the URL: the one a saved search opens (Q2275:
 * /declutter?q=&cat=&min=&max=&mi=, src/lib/savedSearches.ts resultsPath), or the one Browse itself keeps up to date
 * (browseStateInParams), so Back from an item finds the search again.
 */
export function browseStateFromParams(p: URLSearchParams): BrowseState {
  const sort = p.get("sort") as DeclutterSort | null;
  return {
    query: p.get("q") ?? "",
    filters: { ...NO_FILTERS, category: p.get("cat") || null, minDollars: positive(p.get("min")), maxDollars: positive(p.get("max")),
      freeOnly: p.get("free") === "1", porchOnly: p.get("porch") === "1", dropsOnly: p.get("drops") === "1",
      ways: OTHER_WAYS.filter((w) => (p.get("ways") ?? "").split(",").includes(w)),
      sort: sort && SORTS.includes(sort) ? sort : NO_FILTERS.sort,
      conditions: (p.get("cond") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5) },
    maxMiles: positive(p.get("mi")),
  };
}

/**
 * BUY-53: a saved search opens Browse with `new=<when the member last looked>` (resultsPath). An item that went live
 * after it is one of the search's "N new" and wears the New tag. No param, or a bad one, marks nothing.
 */
export function newSinceFromParams(p: URLSearchParams): number | null {
  const at = Date.parse(p.get("new") ?? "");
  return Number.isFinite(at) ? at : null;
}

/**
 * New since the member last looked: went live after it, or (BUY-52) its price dropped into the search's top price after
 * it (`dropped`, the ids declutter_dropped_into_budget gives, the same rule as saved_search_new_counts).
 */
export function isNewSince(item: { id?: string; live_at: string | null }, since: number | null, dropped?: ReadonlySet<string>): boolean {
  if (since === null) return false;
  if (item.id !== undefined && dropped?.has(item.id)) return true;
  return !!item.live_at && Date.parse(item.live_at) > since;
}

/**
 * BUY-52: what Browse asks for the price drops a saved search counted: the `new=` time as sent and the search's `max=`
 * (whole dollars). Null without both: with no top price, a drop never makes a listing new.
 */
export function droppedQueryFromParams(p: URLSearchParams): { since: string; maxDollars: number } | null {
  const since = p.get("new") ?? "";
  const maxDollars = positive(p.get("max"));
  return Number.isFinite(Date.parse(since)) && maxDollars !== null ? { since, maxDollars } : null;
}

/**
 * Audit item 4 / BUY-35: Back from an item lost the search, because Browse read the URL once and never wrote it (Jobs
 * keeps its search in the URL, useDashboardFilters). A copy of `current` with Browse's state in it; a default is left
 * out, and every other param (tab, card and so on) is kept.
 */
export function browseStateInParams(current: URLSearchParams, s: BrowseState): URLSearchParams {
  const next = new URLSearchParams(current);
  const put = (key: string, value: string | number | null) => {
    if (value === null || value === "") next.delete(key);
    else next.set(key, String(value));
  };
  put("q", s.query.trim() === "" ? null : s.query);
  put("cat", s.filters.category);
  put("min", s.filters.minDollars);
  put("max", s.filters.maxDollars);
  put("mi", s.maxMiles);
  put("free", s.filters.freeOnly ? "1" : null);
  put("porch", s.filters.porchOnly ? "1" : null);
  put("ways", s.filters.ways.length ? s.filters.ways.join(",") : null);
  put("drops", s.filters.dropsOnly ? "1" : null);
  put("sort", s.filters.sort === NO_FILTERS.sort ? null : s.filters.sort);
  put("cond", s.filters.conditions.length ? s.filters.conditions.join(",") : null);
  return next;
}

/** How many filters (beyond the sort) are on: the filter button's count dot. */
export function activeFilterCount(f: DeclutterFilters, maxMiles: number | null): number {
  return (
    (maxMiles !== null ? 1 : 0)
    + (f.minDollars !== null || f.maxDollars !== null ? 1 : 0)
    + (f.conditions.length > 0 ? 1 : 0)
    + (f.category ? 1 : 0)
    + (f.porchOnly || f.ways.length > 0 ? 1 : 0)
    + (f.dropsOnly ? 1 : 0)
    + (f.freeOnly ? 1 : 0)
  );
}

/**
 * A3-109: whether a buyer can get this item that way, the checkout's rule (handovers.ts wayAllowed): porch reads
 * porch_ok (declutter_set_handovers keeps it in step); Helpr delivery is open on every PAID item whatever the seller
 * ticked (DC-4), never on a free claim; meet up and seller delivers need the seller's tick, and an older item that
 * recorded no ticks allows every way. Ticks not read yet (undefined) count as not offered, never as a guess.
 */
export function offersWay(item: BrowseItem, way: "porch" | OtherWay, ticks: string[] | null | undefined): boolean {
  if (way === "porch") return item.porch_ok;
  if (way === "delivery") return item.current_price_cents > 0;
  if (ticks === undefined) return false;
  return ticks === null || ticks.includes(way);
}

/** Whether the "How you get it" group is on and this item offers none of the ways picked. */
function failsWays(item: BrowseItem & { id: string }, f: DeclutterFilters, ways: ItemWays | undefined): boolean {
  const picked: ("porch" | OtherWay)[] = [...(f.porchOnly ? (["porch"] as const) : []), ...f.ways];
  if (picked.length === 0) return false;
  return !picked.some((w) => offersWay(item, w, ways?.get(item.id)));
}

/**
 * The rows that pass every filter, in the chosen order. `rows` come from
 * nearestFirst (closest first when the member's location is known, else
 * newest first as fetched); "closest" with no location keeps that order.
 */
export function applyBrowseFilters<T extends BrowseItem & { id: string; title: string; description?: string | null }>(
  rows: { item: T; miles: number | null }[],
  f: DeclutterFilters,
  query: string,
  drops: Map<string, DropState> | undefined,
  now: Date = new Date(),
  ways?: ItemWays,
): { item: T; miles: number | null }[] {
  const minC = f.minDollars !== null ? f.minDollars * 100 : null;
  const maxC = f.maxDollars !== null ? f.maxDollars * 100 : null;
  const kept = rows.filter(({ item }) => {
    // Every word, in the title, description or category, plurals folded (DA-1; the server's alerts use the same rule).
    if (!matchesSearch(query, item)) return false;
    if (f.category && item.category !== f.category) return false;
    if (minC !== null && item.current_price_cents < minC) return false;
    if (maxC !== null && item.current_price_cents > maxC) return false;
    if (f.conditions.length > 0 && !f.conditions.includes(item.condition_stars)) return false;
    if (failsWays(item, f, ways)) return false;
    if (f.freeOnly && item.current_price_cents !== 0) return false;
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
