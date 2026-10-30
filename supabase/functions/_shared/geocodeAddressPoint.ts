// geocodeAddressPoint: one Apple Maps Server API lookup of a typed address, with how precise the match was.
// The key and the API are the ones geocodeDropoff.ts has used since Q2413, when the prod MapKit key was measured
// answering /v1/token and /v1/geocode with 200. Pure apart from the injected fetch and signer.
//
// Nothing here carries the address out: an "unavailable" answer holds only a status, never an error's text,
// because a fetch error can quote the request URL and the address is in its query string.
import { matchPrecision, parseUsAddress, type MatchPrecision } from "./addressMatch.ts";

export type AddressPointAnswer =
  | { result: "found"; lat: number; lng: number; precision: MatchPrecision }
  | { result: "not_found" }
  | { result: "unavailable"; status: number | null };

const TIMEOUT_MS = 8000;

export async function geocodeAddressPoint(
  address: string,
  developerToken: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<AddressPointAnswer> {
  let access: string;
  try {
    const dev = await developerToken();
    const t = await fetchImpl("https://maps-api.apple.com/v1/token", {
      headers: { Authorization: `Bearer ${dev}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!t.ok) return { result: "unavailable", status: t.status };
    const body = (await t.json()) as { accessToken?: unknown } | null;
    if (typeof body?.accessToken !== "string" || !body.accessToken) return { result: "unavailable", status: t.status };
    access = body.accessToken;
  } catch {
    return { result: "unavailable", status: null };
  }
  const url = new URL("https://maps-api.apple.com/v1/geocode");
  url.searchParams.set("q", address);
  url.searchParams.set("limitToCountries", "US");
  url.searchParams.set("lang", "en-US");
  let body: unknown;
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { result: "unavailable", status: res.status };
    body = await res.json();
  } catch {
    return { result: "unavailable", status: null };
  }
  const results = (body as { results?: unknown } | null)?.results;
  // An answer with no results list is Apple's error object, never "no such address".
  if (!Array.isArray(results)) return { result: "unavailable", status: null };
  const typed = parseUsAddress(address);
  let best: AddressPointAnswer = { result: "not_found" };
  const rank = { exact: 3, street: 2, town: 1 };
  for (const row of results as Array<{ coordinate?: { latitude?: unknown; longitude?: unknown }; structuredAddress?: Record<string, unknown> }>) {
    const lat = Number(row.coordinate?.latitude);
    const lng = Number(row.coordinate?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const a = row.structuredAddress ?? {};
    const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : null);
    const precision = matchPrecision(typed, {
      houseNumber: str("subThoroughfare"),
      street: str("thoroughfare"),
      city: str("locality"),
      state: str("administrativeAreaCode") ?? str("administrativeArea"),
      zip: str("postCode"),
    });
    if (!precision) continue;
    if (best.result !== "found" || rank[precision] > rank[best.precision]) best = { result: "found", lat, lng, precision };
  }
  return best;
}
