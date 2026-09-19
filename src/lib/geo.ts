export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function parseNearbyFilter(value: string): number | null {
  if (!value) return null;
  const m = value.match(/^nearby:(\d+(?:\.\d+)?)$/);
  return m ? parseFloat(m[1]) : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * TRUST AND BOUNDS FOR A DISTANCE OR ETA SHOWN TO A USER
 *
 * Owner report, 2026-09-19, /dashboard: the browse cards read
 * "27h 6m · 1634 mi", "29h 52m · 1813 mi", "29h 28m · 1797 mi",
 * "28h 23m · 1731 mi" for jobs in Shreveport, New Iberia, Lafayette and Lake
 * Charles. Every job row was correct. The ORIGIN was not.
 *
 * REPRODUCED EXACTLY. `profiles` for the reporting account on prod
 * (fncmgoasalhdgfwzhsqa) held
 *     latitude  37.47282350893211
 *     longitude -122.2443517921565
 *     location_captured_at 2026-09-19 21:00:08+00
 *     zip_code 70528 (Erath, LA)   parish Vermilion
 * i.e. Menlo Park, California, written THAT DAY by persistUserLocation from a
 * `navigator.geolocation` "success". haversineMiles from that point to the
 * four parish centroids returns 1633.74 / 1813.15 / 1796.52 / 1731.37 — the
 * four numbers on the owner's screen, to the mile. The maths was never wrong.
 *
 * So there are two separate defects, and both are closed here:
 *
 *   1. AN ORIGIN THE APP HAD NO BUSINESS TRUSTING. A browser that cannot see
 *      GPS, Wi-Fi or cell (VPN, iCloud Private Relay, location services
 *      degraded) does not fail — it succeeds, with an IP-derived guess.
 *      `useUserLocation` accepted it, cached it, and persistUserLocation wrote
 *      it into the two columns whose own header says "A PRECISE DEVICE FIX,
 *      and nothing else". From then on it was re-read as `source: "profile",
 *      approximate: false` forever. `isWithinServiceArea` is the gate.
 *
 *   2. A NUMBER NOTHING BOUNDED. Nowhere between the haversine and the pixels
 *      did anything ask whether the answer was possible. A Louisiana
 *      marketplace cannot produce a 27-hour commute, and a chip that says it
 *      does is worse than no chip. `plausibleTripMiles` / -`Minutes` are that
 *      bound, and they are defence in depth: they hold even when a future
 *      origin goes wrong in a way the service-area gate does not catch.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Louisiana plus a border margin — the area a viewer of THIS app can be in
 * and still have "miles to this job" mean something.
 *
 * The state's own bounds are lat 28.9285…33.0195, lng -94.0430…-88.7581. The
 * margin is 2°, which is ~138 mi of latitude and ~120 mi of longitude at this
 * latitude, so the box reaches Houston, Little Rock, Jackson and Mobile: a
 * real helpr who is out of state for the week still gets a real distance.
 *
 * It does NOT reach Dallas, Memphis, Atlanta — or Menlo Park. A position
 * outside this box is not a helpr standing somewhere unusual, it is a fix the
 * app should not have believed, and the honest answer is to fall back to what
 * the account told us at signup (its ZIP → parish) and say the result is
 * approximate.
 */
export const SERVICE_AREA_BOUNDS = {
  minLat: 28.9285 - 2,
  maxLat: 33.0195 + 2,
  minLng: -94.043 - 2,
  maxLng: -88.7581 + 2,
} as const;

/** True when a coordinate could plausibly be a viewer of a Louisiana marketplace. */
export function isWithinServiceArea(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= SERVICE_AREA_BOUNDS.minLat &&
    lat <= SERVICE_AREA_BOUNDS.maxLat &&
    lng >= SERVICE_AREA_BOUNDS.minLng &&
    lng <= SERVICE_AREA_BOUNDS.maxLng
  );
}

/**
 * How coarse a positioning "success" may be and still be treated as a FIX.
 *
 * `GeolocationCoordinates.accuracy` is metres at 95% confidence. GPS lands
 * under 50, Wi-Fi trilateration 20–3,000, a cell tower 1,000–5,000. The
 * IP-address fallback — the branch that produced the Menlo Park coordinate —
 * is tens of kilometres at its very best and is routinely hundreds. 10 km
 * therefore sits above every radio-derived fix and below every IP one.
 *
 * A platform that reports NO accuracy is treated as UNKNOWN rather than
 * untrusted: it still has to pass `isWithinServiceArea`, but we do not throw
 * away a fix merely because the shim was terse.
 */
export const MAX_TRUSTED_FIX_ACCURACY_M = 10_000;

/** False only when the platform actually told us the fix is coarser than a fix. */
export function isPreciseFixAccuracy(accuracyMeters: number | null | undefined): boolean {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return true;
  return accuracyMeters <= MAX_TRUSTED_FIX_ACCURACY_M;
}

/**
 * The longest trip a browse-surface distance chip may claim, in miles.
 *
 * MEASURED, not guessed. Against src/lib/parishCentroids.ts, the widest pair
 * of Louisiana parish centroids — the widest trip this pill is CAPABLE of
 * describing, since the destination is always a parish centroid — is
 * Caddo ↔ Plaquemines at 329.4 mi. The state's own bounding-box diagonal is
 * 421.7 mi. 500 clears the widest real trip by ~170 mi and the diagonal by
 * ~78 mi, so a viewer up to roughly 80 mi outside the state line still sees a
 * pill for the farthest parish in it. Shreveport ↔ New Orleans (~275 mi), the
 * longest journey anyone would actually call a long job, is well inside.
 *
 * The reported values were 1634–1813 mi: 3.3–3.6× the bound.
 */
export const MAX_PLAUSIBLE_TRIP_MILES = 500;

/**
 * And in minutes, because the drive-time half has its own way of going wrong:
 * MapKit Directions returns a REAL route, so it does not have to agree with
 * the straight line beside it. 500 mi of driving is about 8 hours; 720 min
 * (12h) clears that at an average of 42 mph and still refuses the 27h 6m the
 * owner was shown.
 */
export const MAX_PLAUSIBLE_TRIP_MINUTES = 720;

/**
 * The miles a user may be shown, or null when the number cannot be right.
 *
 * Returning null rather than clamping is deliberate: a clamped "500 mi" is
 * still a claim, and it is still false. The chip's callers already render
 * nothing for null, so an impossible distance degrades to the same quiet
 * absence as an unknown one.
 */
export function plausibleTripMiles(miles: number | null | undefined): number | null {
  if (miles == null || !Number.isFinite(miles) || miles < 0) return null;
  return miles > MAX_PLAUSIBLE_TRIP_MILES ? null : miles;
}

/** Same rule for the drive-time half. */
export function plausibleTripMinutes(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return minutes > MAX_PLAUSIBLE_TRIP_MINUTES ? null : minutes;
}
