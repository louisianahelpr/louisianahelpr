/**
 * Declutter distance (rows 5 and 27: nearest first, area + miles only).
 * Straight-line miles between the buyer and the item's PUBLIC coarse point
 * (2 decimals, ~1 km, B7), so the figure is approximate by design and never
 * locates the seller's door. Shown rounded: "< 1 mi", then whole miles.
 */
const EARTH_RADIUS_MI = 3958.8;

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Past this, a miles figure is not shown (lead walkthrough 2026-10-28: a Baton Rouge item read "1835 mi away"). The
 * figure was TRUE: the viewer's saved position was Menlo Park, CA (profiles.latitude/longitude, a real past device
 * fix, which deriveFallbackLocation rightly never second-guesses). But Declutter is pickup-local in Louisiana: Louisiana
 * is about 380 mi corner to corner, and an item farther than this from the viewer is not one a figure helps them
 * judge. The card and the item page show the area alone; sorting and the distance filter still use the real miles.
 */
export const MAX_SHOWN_MILES = 300;

/**
 * `approximate` = the buyer's end is itself rough (a ZIP or parish centre, or
 * a coarse device fix): the figure then says "About", and never "Less than
 * 1 mi", which a centre point cannot know.
 */
export function milesLabel(miles: number | null, approximate = false): string | null {
  if (miles === null || !Number.isFinite(miles)) return null;
  if (miles > MAX_SHOWN_MILES) return null;
  if (approximate) return `About ${Math.max(1, Math.round(miles))} mi away`;
  if (miles < 1) return "Less than 1 mi away";
  return `${Math.round(miles)} mi away`;
}

/**
 * Audit 11-10 F321: the Browse card's one "condition · distance" line (owner pick 4, 11-08) cut the condition to
 * "Lightly u..." beside "About 1 mi away" at 375. The card gets the short form ("About 1 mi", "Under 1 mi", "3 mi"):
 * the same figure and the same "About" for a rough origin, without the words "away" that cost the condition its room.
 */
export function milesLabelShort(miles: number | null, approximate = false): string | null {
  const long = milesLabel(miles, approximate);
  if (long === null) return null;
  if (long === "Less than 1 mi away") return "Under 1 mi";
  return long.replace(/ away$/, "");
}

/** The distance-filter choices on Browse; null = any distance, first because it is the default (owner, 2026-10-19). */
export const DISTANCE_CHOICES: readonly (number | null)[] = [null, 5, 10, 25, 50];

export interface Located {
  area_lat: number;
  area_lng: number;
}

/**
 * Items with their miles from `from`, nearest first, within `maxMiles`
 * (null = all). With no `from` (location unknown) the order is kept and no
 * miles are shown; the distance filter cannot apply and is ignored.
 */
export function nearestFirst<T extends Located>(
  items: T[],
  from: { lat: number; lng: number } | null,
  maxMiles: number | null,
  /** The cold load's first answer's order (item id -> place), for ties (F205, below). */
  firstOrder?: ReadonlyMap<string, number>,
): { item: T; miles: number | null }[] {
  const tie = sameSpotOrder(firstOrder);
  if (!from) return [...items].sort(tie).map((item) => ({ item, miles: null }));
  return items
    .map((item) => ({ item, miles: milesBetween(from, { lat: Number(item.area_lat), lng: Number(item.area_lng) }) }))
    .filter((r) => maxMiles === null || (r.miles as number) <= maxMiles)
    .sort((x, y) => (x.miles as number) - (y.miles as number) || tie(x.item, y.item));
}

/**
 * F205 (UI audit 11-09, /declutter CLS 0.15 for a member): items the same miles away (one seller's listings share a
 * coarse point) went in whatever order their read returned them. The cold load's first answer (declutter_first_screen
 * and the guest preview: miles, then live_at) and the full list (live_at only) return a tie in different orders, so
 * thirteen listings put live in one moment (one live_at) swapped places when the full list replaced the first answer,
 * and a card from below the fold jumped to the top. Ties go newest first; a tie on that too goes in the first answer's
 * order (`firstOrder`: item id -> its place there), the order index.html's skeleton drew its photos in, with the
 * first answer's items ahead of the rest. Without one, a tie keeps the order it came in (a full list that IS the first
 * answer keeps the server's order). Guard: src/lib/declutter/distance.test.ts.
 */
function sameSpotOrder(firstOrder?: ReadonlyMap<string, number>) {
  return (a: unknown, b: unknown): number => {
    const x = a as { live_at?: string | null; id?: string };
    const y = b as { live_at?: string | null; id?: string };
    if (!x.live_at || !y.live_at) return 0;
    const byTime = Date.parse(y.live_at) - Date.parse(x.live_at);
    if (byTime) return byTime;
    if (!firstOrder || !x.id || !y.id) return 0;
    const rx = firstOrder.get(x.id) ?? Number.MAX_SAFE_INTEGER;
    const ry = firstOrder.get(y.id) ?? Number.MAX_SAFE_INTEGER;
    return rx - ry;
  };
}

/** An item's price as a member reads it: "Free" for a free item (20261027170717), else "$40" / "$40.50". */
export function itemPriceLabel(cents: number): string {
  return cents === 0 ? "Free" : formatPrice(cents);
}

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
