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
 * TRUST AND PRESENTATION FOR A DISTANCE OR ETA SHOWN TO A USER
 *
 * ── THE REPORT ─────────────────────────────────────────────────────────────
 * Owner, 2026-09-19, /dashboard: the browse cards read "27h 6m · 1634 mi",
 * "29h 52m · 1813 mi", "29h 28m · 1797 mi", "28h 23m · 1731 mi" for jobs in
 * Shreveport, New Iberia, Lafayette and Lake Charles — "why is this showing
 * here it hasnt before".
 *
 * ── THE FIRST DIAGNOSIS, AND WHY IT WAS WRONG ──────────────────────────────
 * fecdbf6e7 concluded the ORIGIN was bad: `profiles` held
 * 37.47282350893211 / -122.2443517921565 — Menlo Park, California —
 * `location_captured_at` that same day, beside ZIP 70528 (Erath, LA). That
 * looked exactly like the known failure mode where a browser with no GPS,
 * Wi-Fi or cell answers the SUCCESS callback from the egress IP. So a
 * service-area gate (Louisiana + 2°) was added, and any fix outside it was
 * thrown away and replaced with the signup ZIP's parish centroid.
 *
 * THE OWNER WAS ACTUALLY IN MENLO PARK. "Yes I'm in Menlo Park rn."
 *
 * The coordinate was a correct fix from a real user who had travelled. The
 * 1,634 miles was TRUE. And the gate built on top of that misreading was
 * strictly worse than the bug it replaced: it discarded a real position and
 * substituted Erath, Louisiana — so the app would have told a user standing in
 * California that they were ~5 mi from a New Iberia job, and fed that
 * fabricated origin to server-side radius search, applicant proximity and
 * get_neighbor_hire_count. A false "we don't know where you are" is bad; a
 * confident wrong answer is worse.
 *
 * ── WHAT THE EVIDENCE ACTUALLY SUPPORTS ────────────────────────────────────
 * Geography is not evidence about a fix. Travelling helprs, relocating users
 * and out-of-state owners of Louisiana property are all legitimate viewers,
 * and none of them can be distinguished from an IP guess by looking at a
 * latitude. `isWithinServiceArea` is therefore DELETED, not relaxed — a
 * threshold on the wrong signal has no correct value.
 *
 * Two things survive, and they are different in kind:
 *
 *   ACCURACY (`isPreciseFixAccuracy`) is a real signal, because the platform
 *   is telling us about its own confidence rather than us inferring from the
 *   answer. But it no longer DISCARDS anything: a coarse fix is still the best
 *   information we have about where the viewer is. It is demoted — flagged
 *   `approximate` and kept out of the precise-fix columns — never dropped.
 *
 *   COMMUTE RANGE (`isCommutableDistance`) is not a truth claim at all. The
 *   real defect in the owner's screenshot was PRESENTATION: a 27-hour drive is
 *   not a commute, and printing it on every card in a feed is noise whether or
 *   not it is accurate. The number is true and stays available where the user
 *   asks for it; what it must not do is masquerade as a commute estimate.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How coarse a positioning "success" may be and still be called a FIX.
 *
 * `GeolocationCoordinates.accuracy` is metres at 95% confidence. GPS lands
 * under 50, Wi-Fi trilateration 20–3,000, a cell tower 1,000–5,000. An
 * IP-derived answer is tens of kilometres at best and routinely hundreds. 10km
 * sits above every radio-derived fix and below every IP one.
 *
 * WHAT FAILING THIS NOW COSTS, and why the ceiling is safe to keep. It used to
 * mean "throw the coordinates away", which made a false negative catastrophic:
 * the viewer's true position was replaced by a ZIP centroid a thousand miles
 * off. It now means only "do not call this precise" — the position is still
 * used, still measured against, still shown; it is flagged `approximate`, and
 * it is not written to `profiles.latitude/longitude`. That write gate is the
 * point. Those columns are documented in persistUserLocation.ts as "A PRECISE
 * DEVICE FIX, and nothing else", and `get_neighbor_hire_count` runs a SUB-MILE
 * test against them — a 40 km-accurate point stored there would report half a
 * city as one another's neighbours. So the cost of a false negative is now a
 * flag, and the cost of a false positive is a broken neighbour test.
 *
 * NOTE ON VERIFICATION: `profiles` stores no accuracy column, so the owner's
 * stored row cannot tell us what accuracy its fix carried. The ceiling is
 * therefore justified by what failing it now costs, not by that row.
 *
 * A platform that reports NO accuracy is treated as precise rather than
 * coarse: a terse shim is not evidence of a bad fix either.
 */
export const MAX_TRUSTED_FIX_ACCURACY_M = 10_000;

/** False only when the platform actually told us the fix is coarser than a fix. */
export function isPreciseFixAccuracy(accuracyMeters: number | null | undefined): boolean {
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return true;
  return accuracyMeters <= MAX_TRUSTED_FIX_ACCURACY_M;
}

/**
 * The longest straight-line trip a browse card may describe as a commute.
 *
 * This is NOT a claim that a larger number is false. The viewer may be
 * anywhere on earth and the distance to a Louisiana job may legitimately be
 * 1,634 miles. It is a claim about USEFULNESS: past this, "how far" stops
 * being a thing a helpr weighs against a $120 job and starts being trivia,
 * and the drive-time estimate beside it stops describing a drive anyone takes.
 *
 * 500 mi is chosen so that it can never suppress a trip inside this
 * marketplace, from any viewer who could plausibly take it. Measured against
 * src/lib/parishCentroids.ts, the widest pair of Louisiana parish centroids —
 * the widest trip this pill is CAPABLE of describing, since the destination is
 * always a centroid — is Caddo ↔ Plaquemines at 329.4 mi, and the state's own
 * bounding-box diagonal is 421.7 mi. So a viewer up to ~80 mi outside the
 * state line still gets a number for the farthest parish in it, and a viewer
 * in Houston, Jackson or Mobile keeps every card they had.
 *
 * Unlike the deleted service-area gate, this threshold is applied to the TRIP,
 * not to the viewer. It never decides that a user is illegitimate, never
 * discards a coordinate, and never makes the app claim it does not know where
 * someone is.
 */
export const COMMUTE_RANGE_MILES = 500;

/** True when "X mi away" is a commute a helpr might actually weigh. */
export function isCommutableDistance(miles: number | null | undefined): boolean {
  const m = tripMiles(miles);
  return m != null && m <= COMMUTE_RANGE_MILES;
}

/**
 * A usable mileage, or null.
 *
 * Rejects only what is not a number — null, NaN, Infinity, negative. It does
 * NOT reject large values: that was the mistake. 1,634 mi is a number, and the
 * job detail renders it.
 */
export function tripMiles(miles: number | null | undefined): number | null {
  if (miles == null || !Number.isFinite(miles) || miles < 0) return null;
  return miles;
}

/**
 * A drive time is only ever shown for a trip already inside COMMUTE_RANGE_MILES
 * (useDrivingTime enforces that first), so this is the second axis of the same
 * question: given a straight line under 500 mi, no honest road route takes
 * longer than this.
 *
 * MapKit Directions answers with a REAL route, which can disagree wildly with
 * the straight line beside it — a ferry leg, a seasonal closure, a routing
 * error. 500 mi of driving is about 8 hours; 12h clears that at an average of
 * 42 mph. This bound is safe to keep knowing the viewer may be anywhere,
 * because it is conditioned on a distance that is already commutable — it can
 * only ever fire on a route that contradicts its own straight line.
 */
export const MAX_COMMUTE_MINUTES = 720;

/** The minutes half of the same rule. */
export function commuteMinutes(minutes: number | null | undefined): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return minutes > MAX_COMMUTE_MINUTES ? null : minutes;
}
