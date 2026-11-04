/**
 * Q1930 (road miles) + Q2485 (travel time): Apple Maps Server API ETAs, one
 * origin to up to 10 destinations, by car. Each answer carries the routed
 * distance (distanceMeters) and the expected drive time
 * (expectedTravelTimeSeconds), so one call serves both items.
 *
 * Builder 102/103, 11-04: the /v1/etas answer shape was read LIVE once
 * (2026-11-04, HTTP 200; replayed verbatim in src/test/appleRoutes.test.ts);
 * called by declutter-checkout (storeRoutedMiles, below) when a delivery drop-off is quoted.
 *
 * Access is the same two steps geocodeDropoff.ts uses: a MapKit developer
 * token (_shared/mapkitJwt.ts) exchanged at /v1/token for a short access
 * token. Never throws for the network: a miss says why, and the caller keeps
 * its fallback (straight line x 1.3 for miles; 30 minutes before start for
 * the head-out reminder).
 */
import type { AppleMapsAccess } from "./geocodeDropoff.ts";

const ROUTE_TIMEOUT_MS = 8000;
/** Apple's limit on destinations per /v1/etas request. */
export const MAX_ETA_DESTINATIONS = 10;

export interface LatLng {
  lat: number;
  lng: number;
}

/** One destination's routed answer, in the destination's order. */
export interface RoutedLeg {
  meters: number;
  /** Whole road miles, rounded UP (the unit declutter_road_miles prices in). */
  miles: number;
  /** Expected drive time in whole minutes, rounded up; null when Apple gave none. */
  minutes: number | null;
}

export type RouteMiss = { miss: "unavailable"; status: number | null; detail: string };

const validPoint = (p: LatLng): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

const thrownName = (e: unknown): string => (e instanceof Error && e.name ? e.name : "error");

/**
 * The short Apple Maps access token: the MapKit developer token exchanged at /v1/token. One per batch of routes
 * (storeRoutedMiles asks once and hands it to every appleEtas call). Never throws.
 */
export async function appleAccessToken(apple: AppleMapsAccess, fetchImpl: typeof fetch = fetch): Promise<string | RouteMiss> {
  let dev: string;
  try {
    dev = await apple.developerToken();
  } catch {
    // Never the signer's own text: a key-import error can quote parts of the private key (mapkit-token's rule).
    return { miss: "unavailable", status: null, detail: "the MapKit developer token could not be signed" };
  }
  try {
    const t = await fetchImpl("https://maps-api.apple.com/v1/token", {
      headers: { Authorization: `Bearer ${dev}` },
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    if (!t.ok) return { miss: "unavailable", status: t.status, detail: `Apple Maps token HTTP ${t.status}` };
    const body = (await t.json()) as { accessToken?: unknown } | null;
    if (typeof body?.accessToken !== "string" || !body.accessToken) {
      return { miss: "unavailable", status: t.status, detail: "the Apple Maps token answer had no accessToken" };
    }
    return body.accessToken;
  } catch (e) {
    // Not silent: the miss carries the error's name (never its text) to the caller, which reports it and keeps its fallback.
    return { miss: "unavailable", status: null, detail: `Apple Maps token: ${thrownName(e)}` };
  }
}

/**
 * Routed distance and drive time from `origin` to each destination (null for a
 * destination Apple could not route). At most MAX_ETA_DESTINATIONS. `accessToken`:
 * one already fetched with appleAccessToken (else this fetches its own).
 */
export async function appleEtas(
  origin: LatLng,
  destinations: LatLng[],
  apple: AppleMapsAccess,
  fetchImpl: typeof fetch = fetch,
  accessToken?: string,
): Promise<(RoutedLeg | null)[] | RouteMiss> {
  if (!validPoint(origin) || destinations.length === 0 || destinations.length > MAX_ETA_DESTINATIONS || !destinations.every(validPoint)) {
    return { miss: "unavailable", status: null, detail: "bad route request" };
  }
  const access = accessToken ?? (await appleAccessToken(apple, fetchImpl));
  if (typeof access !== "string") return access;

  const url = new URL("https://maps-api.apple.com/v1/etas");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destinations", destinations.map((d) => `${d.lat},${d.lng}`).join("|"));
  url.searchParams.set("transportType", "Automobile");
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
  } catch (e) {
    // Not silent: the miss carries the error's name to the caller, which reports it and keeps its fallback.
    return { miss: "unavailable", status: null, detail: `Apple Maps ETAs: ${thrownName(e)}` };
  }
  if (!res.ok) return { miss: "unavailable", status: res.status, detail: `Apple Maps ETAs HTTP ${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Not silent: a non-JSON answer is a miss the caller reports; the fallback estimate stays.
    return { miss: "unavailable", status: res.status, detail: "the Apple Maps ETAs answer was not JSON" };
  }
  const etas = (body as { etas?: unknown } | null)?.etas;
  if (!Array.isArray(etas)) return { miss: "unavailable", status: res.status, detail: "the Apple Maps answer had no etas list" };

  // Apple answers each destination with its coordinate; match by coordinate, never by position alone.
  const key = (lat: unknown, lng: unknown) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
  const byPoint = new Map<string, { distanceMeters?: unknown; expectedTravelTimeSeconds?: unknown }>();
  for (const e of etas as { destination?: { latitude?: unknown; longitude?: unknown } }[]) {
    if (e?.destination) byPoint.set(key(e.destination.latitude, e.destination.longitude), e as never);
  }
  return destinations.map((d) => {
    const e = byPoint.get(key(d.lat, d.lng));
    const meters = Number(e?.distanceMeters);
    if (!e || !Number.isFinite(meters) || meters < 0) return null;
    const secs = Number(e.expectedTravelTimeSeconds);
    return {
      meters,
      miles: Math.max(1, Math.ceil(meters / 1609.344)),
      minutes: Number.isFinite(secs) && secs >= 0 ? Math.ceil(secs / 60) : null,
    };
  });
}

/** One (origin, drop-off) pair exactly as declutter_route_pairs returns it (the key declutter_road_miles reads). */
export interface RoutePair {
  o_lat: number;
  o_lng: number;
  d_lat: number;
  d_lng: number;
}

/** The service-role calls storeRoutedMiles makes (the edge function's admin client satisfies it). */
export interface RouteStore {
  rpc(fn: "declutter_route_pairs", args: { p_buyer: string; p_seller: string }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(fn: "declutter_route_outage", args: { p_minutes: number }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: "declutter_route_miles"): {
    upsert(rows: Record<string, unknown>[], opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
  };
}

/** Apple's longest believable delivery route; above it the row would break the table's CHECK (miles <= 2000). */
const MAX_ROUTED_MILES = 2000;
/** After an Apple outage, no quote asks Apple again for this long (declutter_route_pairs answers no pairs meanwhile). */
export const ROUTE_OUTAGE_PAUSE_MINUTES = 10;

/** Says once a day (the alert's own oncePerDayKey) that routing is down; quotes keep the 1.3x estimate meanwhile. */
export type RouteOutageAlert = (detail: string, status: number | null) => Promise<unknown>;

/**
 * Q1930: Apple-routed road miles (and drive minutes) for every (origin, drop-off) pair a buyer's delivery quote from
 * one seller measures, upserted into declutter_route_miles under the EXACT key the pairs RPC returned, so
 * declutter_road_miles answers them instead of the straight line x 1.3. ONE access token per call; origins are routed
 * in parallel. An Apple outage pauses routing for ROUTE_OUTAGE_PAUSE_MINUTES (declutter_route_outage) and alerts.
 * Never throws: every miss is logged and that pair keeps the estimate. Returns how many pairs were stored.
 * Run it in the background (routeInBackground): the quote never waits for Apple.
 */
export async function storeRoutedMiles(
  admin: RouteStore,
  buyerId: string,
  sellerId: string,
  apple: AppleMapsAccess | null,
  alertOutage: RouteOutageAlert,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<number> {
  if (!apple) return 0;
  const { data, error } = await admin.rpc("declutter_route_pairs", { p_buyer: buyerId, p_seller: sellerId });
  if (error) {
    console.error(JSON.stringify({ event: "route_pairs_read_failed", detail: String(error.message).slice(0, 200) }));
    return 0;
  }
  const byOrigin = new Map<string, RoutePair[]>();
  for (const p of (Array.isArray(data) ? data : []) as RoutePair[]) {
    const k = `${p.o_lat},${p.o_lng}`;
    byOrigin.set(k, [...(byOrigin.get(k) ?? []), p]);
  }
  if (byOrigin.size === 0) return 0;

  const outage = async (miss: RouteMiss) => {
    console.error(JSON.stringify({ event: "route_etas_miss", status: miss.status, detail: miss.detail }));
    const { error: pauseErr } = await admin.rpc("declutter_route_outage", { p_minutes: ROUTE_OUTAGE_PAUSE_MINUTES });
    if (pauseErr) console.error(JSON.stringify({ event: "route_outage_record_failed", detail: String(pauseErr.message).slice(0, 200) }));
    await alertOutage(miss.detail, miss.status).catch((e) =>
      console.error(JSON.stringify({ event: "route_outage_alert_failed", detail: String(e).slice(0, 200) })));
  };

  const access = await appleAccessToken(apple, fetchImpl);
  if (typeof access !== "string") {
    await outage(access);
    return 0;
  }
  const chunks: RoutePair[][] = [];
  for (const group of byOrigin.values()) {
    for (let i = 0; i < group.length; i += MAX_ETA_DESTINATIONS) chunks.push(group.slice(i, i + MAX_ETA_DESTINATIONS));
  }
  const answers = await Promise.all(chunks.map((chunk) => appleEtas(
    { lat: Number(chunk[0].o_lat), lng: Number(chunk[0].o_lng) },
    chunk.map((p) => ({ lat: Number(p.d_lat), lng: Number(p.d_lng) })),
    apple,
    fetchImpl,
    access,
  )));
  const rows: Record<string, unknown>[] = [];
  let firstMiss: RouteMiss | null = null;
  answers.forEach((legs, c) => {
    if (!Array.isArray(legs)) {
      firstMiss ??= legs;
      return;
    }
    legs.forEach((leg, k) => {
      if (!leg || leg.miles > MAX_ROUTED_MILES) return;
      const p = chunks[c][k];
      rows.push({
        o_lat: p.o_lat, o_lng: p.o_lng, d_lat: p.d_lat, d_lng: p.d_lng, miles: leg.miles,
        minutes: leg.minutes === null ? null : Math.min(leg.minutes, 6000), source: "apple", routed_at: now().toISOString(),
      });
    });
  });
  if (firstMiss) await outage(firstMiss);
  if (rows.length === 0) return 0;
  const { error: upErr } = await admin.from("declutter_route_miles").upsert(rows, { onConflict: "o_lat,o_lng,d_lat,d_lng" });
  if (upErr) {
    console.error(JSON.stringify({ event: "route_miles_store_failed", detail: String(upErr.message).slice(0, 200) }));
    return 0;
  }
  return rows.length;
}

/** The edge runtime's background hook (EdgeRuntime.waitUntil), when it offers one. */
export type WaitUntil = ((p: Promise<unknown>) => void) | undefined;

/**
 * Starts `work` and returns AT ONCE (never awaits it), handing it to `waitUntil` so the runtime keeps the worker
 * alive until it settles. A throw is logged, never raised. The delivery quote answers with the stored miles or the
 * 1.3x estimate right away; the next quote and the checkout re-quote read what this stored.
 */
export function routeInBackground(work: () => Promise<unknown>, waitUntil: WaitUntil): void {
  const run = Promise.resolve()
    .then(work)
    .catch((e) => console.error(JSON.stringify({ event: "route_background_failed", detail: String(e).slice(0, 200) })));
  if (waitUntil) waitUntil(run);
}
