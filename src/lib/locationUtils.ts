import { haversineMiles } from "@/lib/geo";

/**
 * Extracts city and state from a full address string.
 * E.g. "123 Main St, Baton Rouge, LA 70801" → "Baton Rouge, LA"
 * Falls back to the original string if parsing fails.
 */
export function getCityState(location: string): string {
  if (!location) return "";
  const parts = location.split(",").map(s => s.trim());
  if (parts.length >= 2) {
    const state = parts[parts.length - 1].replace(/\d{5}(-\d{4})?/, "").trim();
    const city = parts[parts.length - 2];
    return `${city}, ${state}`;
  }
  return location;
}

/**
 * City-only label from a free-text location. Drops a leading neighborhood
 * ("Garden District, New Orleans" → "New Orleans") and any trailing state
 * code / ZIP ("New Orleans, LA 70130" → "New Orleans"). Used on job cards
 * where only the city is wanted (no neighborhood/area prefix).
 */
export function getCity(location: string): string {
  if (!location) return "";
  let parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  // Drop a trailing state-code / ZIP token, e.g. "LA", "LA 70130", "70130".
  const last = parts[parts.length - 1];
  const isStateOrZip =
    /^\d{5}(-\d{4})?$/.test(last) || /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last);
  if (isStateOrZip && parts.length > 1) parts = parts.slice(0, -1);
  // The city is the last remaining part; anything before it is a neighborhood.
  return parts[parts.length - 1] ?? "";
}

/**
 * Calculate distance in feet between two lat/lng coordinates.
 * Delegates to the canonical haversineMiles() in geo.ts (1 mi = 5280 ft)
 * so the Haversine math lives in exactly one place.
 */
export function distanceInFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineMiles(lat1, lng1, lat2, lng2) * 5280;
}
