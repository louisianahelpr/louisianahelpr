// Free address geocoding via Nominatim (OpenStreetMap). Used to populate
// jobs.latitude / jobs.longitude after a job is posted so the row shows
// up on /browse?view=map.
//
// Nominatim TOS:
//   • Identify yourself with a User-Agent or Referer header — we lean on
//     the browser's automatic Referer (Helpr origin) for that.
//   • Bulk requests are throttled (1/sec), but a single per-post lookup
//     is well inside their fair-use window.
//
// Returns null on any failure — the caller treats geocoding as
// best-effort. Without coords the job still works, it just won't appear
// on the map until an admin or future re-geocoding pass fills in.

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/**
 * Geocode a free-text US address. Returns the first Nominatim match
 * scoped to the United States, or null if no result.
 *
 * Trims and URL-encodes the input; rejects empty or single-character
 * strings to avoid wasting Nominatim quota.
 */
export async function geocodeAddress(
  address: string | null | undefined,
): Promise<GeocodeResult | null> {
  if (!address) return null;
  const cleaned = address.trim();
  if (cleaned.length < 5) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", cleaned);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!rows.length) return null;
    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

/**
 * Compose the multi-field address shape PostJob collects into a single
 * geocoder-friendly string. Matches the format that worked for the
 * seed-data jobs: "<street>, <city>, <state> <zip>".
 */
export function composeJobAddress(parts: {
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}): string {
  const segments = [
    parts.streetAddress?.trim(),
    parts.city?.trim(),
    [parts.state?.trim(), parts.zipCode?.trim()].filter(Boolean).join(" "),
  ].filter(Boolean);
  return segments.join(", ");
}
