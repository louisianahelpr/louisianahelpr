/**
 * Q1930 (road miles) + Q2485 (travel time): Apple Maps Server API ETAs, one
 * origin to up to 10 destinations, by car. Each answer carries the routed
 * distance (distanceMeters) and the expected drive time
 * (expectedTravelTimeSeconds), so one call serves both items.
 *
 * WIP (Builder 102/103, 11-04): the /v1/etas answer shape was read LIVE once
 * (2026-11-04, HTTP 200; replayed verbatim in src/test/appleRoutes.test.ts);
 * NOT yet called by any function. Next steps: ~/.lh-shots/handoffs-1104/b103.md.
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
 * Routed distance and drive time from `origin` to each destination (null for a
 * destination Apple could not route). At most MAX_ETA_DESTINATIONS.
 */
export async function appleEtas(
  origin: LatLng,
  destinations: LatLng[],
  apple: AppleMapsAccess,
  fetchImpl: typeof fetch = fetch,
): Promise<(RoutedLeg | null)[] | RouteMiss> {
  if (!validPoint(origin) || destinations.length === 0 || destinations.length > MAX_ETA_DESTINATIONS || !destinations.every(validPoint)) {
    return { miss: "unavailable", status: null, detail: "bad route request" };
  }
  let dev: string;
  try {
    dev = await apple.developerToken();
  } catch {
    // Never the signer's own text: a key-import error can quote parts of the private key (mapkit-token's rule).
    return { miss: "unavailable", status: null, detail: "the MapKit developer token could not be signed" };
  }
  let access: string;
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
    access = body.accessToken;
  } catch (e) {
    // Not silent: the miss carries the error's name (never its text) to the caller, which reports it and keeps its fallback.
    return { miss: "unavailable", status: null, detail: `Apple Maps token: ${thrownName(e)}` };
  }

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
