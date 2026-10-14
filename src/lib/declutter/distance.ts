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

export function milesLabel(miles: number | null): string | null {
  if (miles === null || !Number.isFinite(miles)) return null;
  if (miles < 1) return "Less than 1 mi away";
  return `${Math.round(miles)} mi away`;
}

/** The distance-filter choices on Browse; null = any distance. */
export const DISTANCE_CHOICES: readonly (number | null)[] = [5, 10, 25, 50, null];

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
): { item: T; miles: number | null }[] {
  if (!from) return items.map((item) => ({ item, miles: null }));
  return items
    .map((item) => ({ item, miles: milesBetween(from, { lat: Number(item.area_lat), lng: Number(item.area_lng) }) }))
    .filter((r) => maxMiles === null || (r.miles as number) <= maxMiles)
    .sort((x, y) => (x.miles as number) - (y.miles as number));
}

export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
