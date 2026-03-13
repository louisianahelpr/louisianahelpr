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
