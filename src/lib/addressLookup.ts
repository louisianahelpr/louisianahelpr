/**
 * The one address lookup for the Declutter pickup and return forms: it says how precise the match was and tells
 * "no such place" from "the lookup could not answer", which geocodeAddress (src/lib/geocode.ts) cannot.
 *
 * Apple Maps on the server first (geocode-address). Then, unless that matched the house, OpenStreetMap from the
 * browser, which is also the fallback while the server cannot answer: Nominatim refuses our servers (Q2413), so its
 * searches stay here. The first is the typed address; the second, only when nothing has matched yet, is the town or
 * ZIP, which gives the point a shared location is checked against. There is no street-without-a-number search: only
 * a house-level point is ever saved, so it would add a request and change nothing.
 *
 * Loaded on demand (useExactAddressPoint): the callers import() it when a lookup is really made.
 * Never logs or reports the address; the count of misses carries only the outcome and the source.
 */
import { track } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { matchPrecision, parseUsAddress, type AddressParts, type MatchPrecision } from "../../supabase/functions/_shared/addressMatch";

export type AddressLookup =
  | { status: "exact"; lat: number; lng: number }
  /** The area was found but not the house. The point is only for checking a shared location; never save it. */
  | { status: "approximate"; lat: number; lng: number; precision: Exclude<MatchPrecision, "exact"> }
  | { status: "not_found" }
  | { status: "unavailable" };

type Hit = { lat: number; lng: number; precision: MatchPrecision };
type Answer = Hit | "none" | "failed";

const SERVER_TIMEOUT_MS = 18_000;
const NOMINATIM_TIMEOUT_MS = 8000;
/** Nominatim's usage policy: at most one request a second. */
const NOMINATIM_GAP_MS = 1100;

async function askServer(address: string): Promise<Answer> {
  try {
    const { data, error } = await supabase.functions.invoke("geocode-address", { body: { address }, timeout: SERVER_TIMEOUT_MS });
    if (error) return "failed";
    const d = data as { result?: unknown; lat?: unknown; lng?: unknown; precision?: unknown } | null;
    if (d?.result === "not_found") return "none";
    if (d?.result === "found" && typeof d.lat === "number" && typeof d.lng === "number" && (d.precision === "exact" || d.precision === "street" || d.precision === "town")) {
      return { lat: d.lat, lng: d.lng, precision: d.precision };
    }
    return "failed";
  } catch (e) {
    // The browser search below still answers; the error text is not read because it can quote the request.
    console.warn("[addressLookup] the server lookup threw", e instanceof Error ? e.name : "unknown");
    return "failed";
  }
}

async function askNominatim(params: Record<string, string>, typed: AddressParts): Promise<Answer> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "us");
  url.searchParams.set("addressdetails", "1");
  let rows: unknown;
  try {
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS) });
    if (!res.ok) return "failed";
    rows = await res.json();
  } catch (e) {
    console.warn("[addressLookup] the browser lookup threw", e instanceof Error ? e.name : "unknown");
    return "failed";
  }
  // A JSON answer that is not a list is the geocoder's own error object, never "no such address".
  if (!Array.isArray(rows)) return "failed";
  let best: Hit | null = null;
  const rank = { exact: 3, street: 2, town: 1 };
  for (const row of rows as Array<{ lat?: unknown; lon?: unknown; address?: Record<string, unknown> }>) {
    const lat = Number.parseFloat(String(row.lat));
    const lng = Number.parseFloat(String(row.lon));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const a = row.address ?? {};
    const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : null);
    const precision = matchPrecision(typed, {
      houseNumber: str("house_number"),
      street: str("road"),
      city: str("city") ?? str("town") ?? str("village") ?? str("hamlet"),
      state: str("state"),
      zip: str("postcode"),
    });
    if (!precision) continue;
    if (!best || rank[precision] > rank[best.precision]) best = { lat, lng, precision };
  }
  return best ?? "none";
}

/** The typed address: structured when it has a town or ZIP to search in, else as typed. */
function addressSearch(address: string, p: AddressParts): Record<string, string> {
  if (!p.street || (!p.city && !p.zip)) return { q: address };
  const params: Record<string, string> = { street: p.street };
  if (p.city) params.city = p.city;
  else if (p.zip) params.postalcode = p.zip;
  if (p.state) params.state = p.state;
  return params;
}

/** Only the town or the ZIP, or null when neither was typed. */
function areaSearch(p: AddressParts): Record<string, string> | null {
  if (p.city) return p.state ? { city: p.city, state: p.state } : { city: p.city };
  if (p.zip) return { postalcode: p.zip };
  return null;
}

const finish = (out: AddressLookup, source: "apple" | "openstreetmap" | "none"): AddressLookup => {
  track("address_lookup_result", { outcome: out.status === "approximate" ? out.precision : out.status, source });
  return out;
};

export async function lookUpAddress(
  raw: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<AddressLookup> {
  const address = raw.replace(/\s+/g, " ").trim();
  if (address.length < 5) return { status: "not_found" };
  const typed = parseUsAddress(address);

  const server = await askServer(address);
  if (typeof server === "object" && server.precision === "exact") return finish({ status: "exact", lat: server.lat, lng: server.lng }, "apple");

  const first = await askNominatim(addressSearch(address, typed), typed);
  if (typeof first === "object" && first.precision === "exact") return finish({ status: "exact", lat: first.lat, lng: first.lng }, "openstreetmap");

  let area: Answer = "none";
  const areaParams = areaSearch(typed);
  if (typeof server !== "object" && typeof first !== "object" && first !== "failed" && areaParams) {
    await wait(NOMINATIM_GAP_MS);
    area = await askNominatim(areaParams, typed);
  }
  const hit = [server, first, area].find((a): a is Hit => typeof a === "object");
  if (hit && hit.precision !== "exact") {
    return finish({ status: "approximate", lat: hit.lat, lng: hit.lng, precision: hit.precision }, hit === server ? "apple" : "openstreetmap");
  }
  // Nothing placed it. If anything could not answer, that is all we know: never "check your address".
  if (server === "failed" || first === "failed" || area === "failed") return finish({ status: "unavailable" }, "none");
  return finish({ status: "not_found" }, "none");
}
