import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { unwrapMutation } from "@/lib/mutationResult";

/**
 * persistUserLocation — give `profiles.latitude/longitude` the writer they
 * have never had.
 *
 * WHY THIS EXISTS AT ALL. Those two columns shipped with three readers (the
 * saved-search radius tier, applicant proximity, the neighbour count) and no
 * writer whatsoever: not signup, not CompleteProfile, not ProfileEditForm, not
 * any of the 66 edge functions, not any trigger. Measured on prod 2026-09-06,
 * 3 of 44 rows were non-null and all three were hand-seeded test accounts
 * sharing one Baton Rouge point. So all three features have been silently
 * inert for every real account since launch. The app already ASKS for
 * location and already receives a fix — `useUserLocation` — and then drops it
 * into a 5-minute module cache and forgets it. This closes that gap.
 *
 * WHY NOT A NEW PROMPT. iOS shows its system location alert exactly ONCE per
 * install. Spending that single shot on a signup screen, where the user has no
 * idea why they are being asked, is the worst available trade — it converts
 * badly and it is gone forever. The existing ask fires only when the user
 * themselves picks a "within X miles" filter, behind
 * `usePermissionRationale`'s soft pre-prompt. That is a better ask than any we
 * would add, so this persists the answer rather than asking again.
 *
 * WHAT MAY BE STORED HERE. A PRECISE DEVICE FIX, and nothing else. A ZIP
 * centroid is never written to these columns — centroids live on
 * `louisiana_zip_parishes` and are joined at read time. That split is what
 * lets `get_neighbor_hire_count` do a sub-mile test safely: it reads
 * `profiles.latitude` and finds NULL for a centroid user, so it cannot report
 * everyone in a ZIP as everyone else's neighbour. The rule is structural
 * rather than a flag every reader has to remember to check.
 */

/** Skip the write unless the fix moved at least this far. */
const MIN_MOVE_MILES = 0.5;
/** ...or unless the stored fix is at least this old. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Last value we wrote this session, to avoid a write per filter toggle. */
let lastWritten: { lat: number; lng: number; ts: number } | null = null;

/** Rough great-circle miles. Only ever used to decide "did this move enough". */
function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Exported for tests — clears the session-level write throttle. */
export function _resetPersistThrottle() {
  lastWritten = null;
}

/**
 * Store a granted device fix on the signed-in user's profile.
 *
 * Fire-and-forget by design: this runs inside the geolocation success path,
 * and a failed write must never break the "nearby" filter the user actually
 * asked for. It is NOT silent, though — the failure is `report()`ed to
 * `error_logs` / Sentry, and `unwrapMutation` turns a zero-row UPDATE (RLS
 * rejected it, the profile row is missing) into a real error rather than the
 * `{ data: [], error: null }` that would otherwise read as success.
 *
 * No-ops for signed-out visitors: a guest can still use the radius filter,
 * they simply have no row to write to.
 */
export async function persistUserLocation(lat: number, lng: number): Promise<void> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    // Debounce: the filter can re-run on every toggle, and a fix that has not
    // meaningfully moved is not worth a round trip or a row version.
    if (
      lastWritten &&
      Date.now() - lastWritten.ts < MAX_AGE_MS &&
      milesBetween(lastWritten.lat, lastWritten.lng, lat, lng) < MIN_MOVE_MILES
    ) {
      return;
    }

    // `getSession()` reads the cached session locally; `getUser()` would make
    // a network round trip to validate it on every granted fix, which is not
    // worth it to decide "is anyone signed in". If the token is stale the
    // UPDATE below fails on RLS and is reported, which is the correct place
    // for that to surface anyway.
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return; // guest — nothing to write to, not an error

    unwrapMutation(
      await supabase
        .from("profiles")
        .update({
          latitude: lat,
          longitude: lng,
          location_captured_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("user_id"),
      { action: "save your location" },
    );

    lastWritten = { lat, lng, ts: Date.now() };
  } catch (err) {
    // Never rethrow into the geolocation callback — the radius filter still
    // works from the in-memory fix. But do not swallow it either: a location
    // that never persists would otherwise look exactly like a user who never
    // granted permission, which is the failure mode this whole change exists
    // to end.
    report(err, { tags: { area: "location.persist" } });
  }
}
