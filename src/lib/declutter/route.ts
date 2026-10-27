/**
 * "My route" helpers (owner request 2026-10-27, multi-stop Declutter delivery): the Open in Maps
 * link for the whole ordered route, and the in-app map's "next step" from MapKit JS Directions.
 * Pure functions, so the rules are tested without a map.
 */

/** A stop as these helpers need it: its address only where helpr_my_route shows one. */
interface AddressedStop {
  address: string | null;
}

/**
 * Google Maps' documented multi-stop directions URL (developers.google.com/maps/documentation/urls:
 * /maps/dir/?api=1, destination + `|`-separated waypoints, no origin = "from here"). Apple Maps has no
 * documented multi-stop URL, and Google's opens in the Google Maps app or the browser on every
 * device. Addresses, never points (src/lib/mapsLink.ts: "stop sending coordinates to Google").
 * At most MAX_MAPS_STOPS stops: mobile Maps handles three waypoints and a destination; the rest
 * open from the next tap once these are done; `left_out` says how many. A stop with no address (a
 * new Helpr's drop-off before 2 hours ahead of its pickup: owner decided issue #3684) is left out too.
 */
export const MAX_MAPS_STOPS = 4;

export function routeMapsUrl(stops: AddressedStop[]): { href: string; count: number; left_out: number } | null {
  const addressed = stops.map((s) => s.address?.trim() ?? "").filter((a) => a.length > 0);
  if (addressed.length === 0) return null;
  const trip = addressed.slice(0, MAX_MAPS_STOPS);
  const destination = trip[trip.length - 1];
  const waypoints = trip.slice(0, -1);
  const params = [`api=1`, `destination=${encodeURIComponent(destination)}`, `travelmode=driving`];
  if (waypoints.length > 0) params.push(`waypoints=${waypoints.map(encodeURIComponent).join("%7C")}`);
  return {
    href: `https://www.google.com/maps/dir/?${params.join("&")}`,
    count: trip.length,
    left_out: addressed.length - trip.length,
  };
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle metres (the same haversine as helpr_task_distance_m). */
function metersBetween(a: LatLng, b: LatLng): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "500 ft" under a tenth of a mile, else "0.4 mi" / "12 mi". */
function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  if (miles < 0.1) return `${Math.max(50, Math.round((meters * 3.28084) / 50) * 50)} ft`;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** One Directions step: what to do, and where it starts (the first point of its polyline). */
export interface NavStep {
  instructions: string;
  start: LatLng;
}

/** Within this many metres of a turn, the turn counts as reached and the next one shows. */
const STEP_REACHED_M = 30;

/**
 * The next turn from where the Helpr is. `from` is the index of the next turn not yet reached
 * (1 at the start: step 0 is "head off"). Returns the advanced index, and the line to show:
 * "In 0.4 mi, turn right on Main St", or null once every turn of the leg is behind them.
 */
export function nextStep(steps: NavStep[], from: number, here: LatLng): { index: number; line: string | null } {
  let i = Math.max(1, from);
  while (i < steps.length && metersBetween(here, steps[i].start) < STEP_REACHED_M) i++;
  if (i >= steps.length) return { index: i, line: null };
  const turn = steps[i].instructions.trim().replace(/\.$/, "");
  const lower = turn.charAt(0).toLowerCase() + turn.slice(1);
  return { index: i, line: `In ${formatDistance(metersBetween(here, steps[i].start))}, ${lower}` };
}
