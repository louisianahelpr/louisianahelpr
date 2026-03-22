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
 * Calculate distance in feet between two lat/lng coordinates using Haversine formula.
 */
export function distanceInFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth's radius in feet
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const PROXIMITY_THRESHOLD_FEET = 500;

/**
 * Check if the user is within 500ft of the job site.
 * Returns { allowed: true } or { allowed: false, distance: number }.
 * If the job has no coordinates or geolocation fails, allows the action (graceful fallback).
 */
export async function checkProximity(
  jobLat: number | null | undefined,
  jobLng: number | null | undefined
): Promise<{ allowed: boolean; distance?: number }> {
  // If job has no coordinates, allow (can't validate)
  if (!jobLat || !jobLng) return { allowed: true };

  if (!navigator.geolocation) return { allowed: true };

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dist = distanceInFeet(pos.coords.latitude, pos.coords.longitude, jobLat, jobLng);
        if (dist <= PROXIMITY_THRESHOLD_FEET) {
          resolve({ allowed: true, distance: dist });
        } else {
          resolve({ allowed: false, distance: Math.round(dist) });
        }
      },
      () => {
        // Geolocation denied/failed — allow gracefully
        resolve({ allowed: true });
      },
      { timeout: 10000 }
    );
  });
}
