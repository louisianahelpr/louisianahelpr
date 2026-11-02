// geocodeDropoff — turn a typed drop-off address into a point ON THE SERVER
// (Declutter slice 5, Helpr delivery). The delivery price is measured from this
// point (declutter_road_miles), so the buyer never supplies coordinates
// (docs/specs/declutter-auctions.md build fact: "delivery pricing needs a
// server-side road distance so the price can't be tampered with").
//
// Apple Maps first, Nominatim second (Q2413, measured 2026-10-27): from the
// edge function's servers Nominatim answered HTTP 403 to every lookup (two
// quotes in a row; error_logs "geocode_unavailable"), while the same request
// from another network answered 200, so OpenStreetMap refuses our server's
// address and every Helpr delivery quote failed with "try again". The Apple
// Maps Server API takes the MapKit key the app already holds for its maps
// (Privacy: "Apple Maps (MapKit JS) — address search and maps"), so no new
// processor is added. Nominatim stays as the fallback when Apple cannot answer
// or the key is not set. One lookup per provider, bounded in time, US only.
// Pure apart from the injected fetch and signer, so vitest imports it directly.

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

/**
 * Only the thrown error's NAME (TimeoutError, TypeError, ...) goes into `detail`, which declutter-checkout logs and
 * sends in its ops alert: a fetch error's message can quote the request URL, whose query string is the buyer's typed
 * address (Q2493).
 */
export function thrownName(e: unknown): string {
  const name = e instanceof Error ? e.name : typeof e;
  return /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? `threw ${name}` : "threw an error";
}

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

/**
 * Apple Maps Server API access: `developerToken` signs a MapKit developer token
 * (_shared/mapkitJwt.ts), exchanged at /v1/token for a short access token.
 */
export interface AppleMapsAccess {
  developerToken: () => Promise<string>;
}

/** Apple's answer: a point, "not found", or why it could not answer. Never throws for the network. */
async function geocodeWithAppleMaps(
  address: string,
  apple: AppleMapsAccess,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodedDropoff | GeocodeMiss> {
  let access: string;
  let dev: string;
  try {
    dev = await apple.developerToken();
  } catch {
    // Never the signer's own text: a key-import error can quote parts of the private key
    // (mapkit-token's rule), and this detail reaches the logs and the ops alert.
    return { miss: "unavailable", status: null, detail: "the MapKit developer token could not be signed" };
  }
  try {
    const t = await fetchImpl("https://maps-api.apple.com/v1/token", {
      headers: { Authorization: `Bearer ${dev}` },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
    if (!t.ok) return { miss: "unavailable", status: t.status, detail: `Apple Maps token HTTP ${t.status}` };
    const body = (await t.json()) as { accessToken?: unknown } | null;
    if (typeof body?.accessToken !== "string" || !body.accessToken) {
      return { miss: "unavailable", status: t.status, detail: "the Apple Maps token answer had no accessToken" };
    }
    access = body.accessToken;
  } catch (e) {
    return { miss: "unavailable", status: null, detail: `Apple Maps token: ${thrownName(e)}` };
  }
  const url = new URL("https://maps-api.apple.com/v1/geocode");
  url.searchParams.set("q", address);
  url.searchParams.set("limitToCountries", "US");
  url.searchParams.set("lang", "en-US");
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
    });
  } catch (e) {
    return { miss: "unavailable", status: null, detail: `Apple Maps: ${thrownName(e)}` };
  }
  if (!res.ok) return { miss: "unavailable", status: res.status, detail: `Apple Maps HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { miss: "unavailable", status: res.status, detail: "the Apple Maps answer was not JSON" };
  }
  const results = (body as { results?: unknown } | null)?.results;
  // An answer with no results list is Apple's error object, never "no such address".
  if (!Array.isArray(results)) return { miss: "unavailable", status: res.status, detail: "the Apple Maps answer had no results list" };
  const top = results[0] as { coordinate?: { latitude?: unknown; longitude?: unknown }; structuredAddress?: Record<string, unknown> } | undefined;
  if (!top) return { miss: "not_found" };
  const lat = Number(top.coordinate?.latitude);
  const lng = Number(top.coordinate?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { miss: "not_found" };
  const a = top.structuredAddress ?? {};
  const str = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  // Town + state code only, never the street (the same rule as areaLabelFrom).
  const label = [str("locality") ?? str("subAdministrativeArea"), str("administrativeAreaCode") ?? str("administrativeArea")]
    .filter(Boolean).join(", ");
  return { lat, lng, areaLabel: label || "Drop-off area" };
}

/**
 * Look the address up: the point, or why there is none (GeocodeMiss). Never throws for the network.
 * With `apple`, Apple Maps answers first; Nominatim is asked only when Apple could not answer.
 * An Apple "not found" is final: a second geocoder guessing a point is worse than "check the address".
 */
export async function geocodeDropoff(
  address: string,
  fetchImpl: typeof fetch = fetch,
  apple: AppleMapsAccess | null = null,
): Promise<GeocodedDropoff | GeocodeMiss> {
  let appleMiss: string | null = null;
  if (apple) {
    const a = await geocodeWithAppleMaps(address, apple, fetchImpl);
    if (!("miss" in a) || a.miss === "not_found") return a;
    appleMiss = a.detail;
  }
  const n = await geocodeWithNominatim(address, fetchImpl);
  // Neither could answer: ops reads both reasons.
  if (appleMiss && "miss" in n && n.miss === "unavailable") return { ...n, detail: `${appleMiss}; Nominatim: ${n.detail}`.slice(0, 400) };
  return n;
}

async function geocodeWithNominatim(address: string, fetchImpl: typeof fetch): Promise<GeocodedDropoff | GeocodeMiss> {
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
    return { miss: "unavailable", status: null, detail: thrownName(e) };
  }
  if (!res.ok) return { miss: "unavailable", status: res.status, detail: `HTTP ${res.status}` };
  let rows: unknown;
  try {
    rows = await res.json();
  } catch {
    return { miss: "unavailable", status: res.status, detail: "the answer was not JSON" };
  }
  // A JSON answer that is not a list is the geocoder's own error object, never "no such address".
  if (!Array.isArray(rows)) return { miss: "unavailable", status: res.status, detail: "the answer was not a list" };
  const top = rows[0] as { lat?: string; lon?: string; address?: Record<string, unknown> } | undefined;
  if (!top) return { miss: "not_found" };
  const lat = Number.parseFloat(String(top.lat));
  const lng = Number.parseFloat(String(top.lon));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { miss: "not_found" };
  return { lat, lng, areaLabel: areaLabelFrom(top.address) };
}
