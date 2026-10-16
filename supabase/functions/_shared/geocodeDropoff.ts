// geocodeDropoff — turn a typed drop-off address into a point ON THE SERVER
// (Declutter slice 5, Helpr delivery). The delivery price is measured from this
// point (declutter_road_miles), so the buyer never supplies coordinates
// (docs/specs/declutter-auctions.md build fact: "delivery pricing needs a
// server-side road distance so the price can't be tampered with").
//
// Same geocoder the app already uses for job addresses (Nominatim; the
// client's src/lib/geocode.ts and the backfill-job-geocode cron), one lookup
// per request, bounded in time, US only. Pure apart from the injected fetch,
// so vitest imports it directly.

export interface GeocodedDropoff {
  lat: number;
  lng: number;
  /** Rough area words a Helpr may see before taking the job: town + state, never the street. */
  areaLabel: string;
}

/**
 * Why a lookup gave no point: the geocoder answered and found nothing usable
 * ("not_found": the buyer checks the address), or it could not answer at all
 * ("unavailable": a timeout, a refused connection, a non-2xx such as a 429
 * rate limit, or a body that is not JSON; the buyer tries again later and ops
 * is told). Never one for the other (lh-silent-failure review #1, 2026-10-16).
 */
export type GeocodeMiss = { miss: "not_found" } | { miss: "unavailable"; status: number | null; detail: string };

const GEOCODE_TIMEOUT_MS = 8000;

/** A typed address worth looking up: 5..300 characters with a letter and a digit. */
export function plausibleAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.replace(/\s+/g, " ").trim();
  if (a.length < 5 || a.length > 300) return null;
  if (!/[a-z]/i.test(a) || !/\d/.test(a)) return null;
  return a;
}

const STATE_CODES: Record<string, string> = {
  Louisiana: "LA", Mississippi: "MS", Texas: "TX", Arkansas: "AR", Alabama: "AL",
};

/** Town (or county) + state code from Nominatim's address details. */
function areaLabelFrom(details: Record<string, unknown> | null | undefined): string {
  const d = details ?? {};
  const pick = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string).trim() : null);
  const town = pick("city") ?? pick("town") ?? pick("village") ?? pick("hamlet") ?? pick("suburb") ?? pick("county");
  const state = pick("state");
  const st = state ? STATE_CODES[state] ?? state : null;
  const label = [town, st].filter(Boolean).join(", ");
  return label || "Drop-off area";
}

/** Look the address up: the point, or why there is none (GeocodeMiss). Never throws for the network. */
export async function geocodeDropoff(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodedDropoff | GeocodeMiss> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "LouisianaHelpr/1.0 (declutter-checkout delivery address)" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
  } catch (e) {
    return { miss: "unavailable", status: null, detail: String(e).slice(0, 200) };
  }
  if (!res.ok) return { miss: "unavailable", status: res.status, detail: `HTTP ${res.status}` };
  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    return { miss: "unavailable", status: res.status, detail: "the answer was not JSON" };
  }
  const top = Array.isArray(rows) ? (rows[0] as { lat?: string; lon?: string; address?: Record<string, unknown> } | undefined) : undefined;
  if (!top) return { miss: "not_found" };
  const lat = Number.parseFloat(String(top.lat));
  const lng = Number.parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { miss: "not_found" };
  return { lat, lng, areaLabel: areaLabelFrom(top.address) };
}
