/**
 * ONE rule for "has this helper's arrival been established?", shared by every
 * surface that gates on it — the payout CTA (`completeJob`), the tracker's
 * Working and Done steps, and the arrival label on the tracking map's job pin.
 * (The Arrived step's own caption is gone — owner, 2026-09-16; see
 * `arrivalStateLabel`.)
 *
 * THE RULE ITSELF lives in `supabase/functions/_shared/arrivalRule.ts` so the
 * app and create-payment's helper release read the same predicate. Owner,
 * 2026-09-14 (VN-33): BOTH are required — the server finds the Helpr within
 * 500ft (`helper_arrival_verified_at`) AND the poster taps "Confirm They
 * Arrived" (`poster_confirmed_arrival_at`). No fallback for a phone with no
 * location: the owner accepted that.
 *
 * WHY IT GATES ON ARRIVAL AT ALL. Completion used to gate on a LIVE 500ft GPS
 * check taken at wrap-up time, with a fallback that read `job_checkins` — a
 * table with zero writers. A helper who had legitimately stepped away at the
 * end of the job was hard-blocked from getting paid. The arrival is captured
 * at the moment it is true, so that is what the gate reads.
 *
 * The four display states below are about what the job row SAYS, not about
 * whether the gate is open:
 *
 *   confirmed — the poster tapped "Confirm They Arrived".
 *   verified  — the server verified the location; the poster has not yet.
 *   claimed   — `helper_arrived_at` with neither. Since 20260915044137 the
 *               server never writes a new one (a refused arrival writes
 *               nothing), so this only describes rows from before that.
 *   none      — no arrival.
 */
import {
  arrivalEstablished,
  arrivalGateMessage,
  type ArrivalEvidence,
} from "../../supabase/functions/_shared/arrivalRule";

export { arrivalEstablished, arrivalGateMessage };
export type { ArrivalEvidence };

export type ArrivalState = "none" | "claimed" | "verified" | "confirmed";

/**
 * Ordered strongest-first for DISPLAY: the poster's confirmation is a second
 * party attesting. It does not mean the gate is open — `arrivalEstablished`
 * needs both stamps.
 */
export function arrivalState(job: ArrivalEvidence | null | undefined): ArrivalState {
  if (!job) return "none";
  if (job.poster_confirmed_arrival_at) return "confirmed";
  if (job.helper_arrival_verified_at) return "verified";
  if (job.helper_arrived_at) return "claimed";
  return "none";
}

/**
 * Caption under the tracker's Arrived step. NOW ALWAYS `null`.
 *
 * History: it used to label all three states, so "Poster confirmed" /
 * "Location confirmed" sat under the Arrived step. Owner, 2026-09-14 (VN-20):
 * "Location confirmed does not need to show on the tracker, it should be on
 * the map" — the settled facts moved to the map's job pin
 * (`arrivalMapLabel`), or to the status line under the rail when no map is
 * drawn, leaving only the open question here. VN-33 then made a VERIFIED
 * arrival a pending action too, so both `claimed` and `verified` read
 * "Awaiting confirmation".
 *
 * OWNER, 2026-09-16: "remove awaiting confirmedation from under confirmation.
 * tehy can click arrived or toggle to see why its yellow" — the caption itself
 * goes; the AMBER STEP COLOUR STAYS. The step's own colour is the signal now,
 * and tapping the step tells the reader why. Nothing else about the arrival
 * gate changed: `arrivalEstablished` still needs both stamps, and
 * `arrivalMapLabel` still carries the settled fact on the map pin.
 *
 * Kept as a function (rather than deleted with its render branch) because the
 * Arrived step's caption SLOT is unchanged — this is the one place that
 * decides whether a label is owed, so a future label returns from here and
 * nowhere else.
 */
export function arrivalStateLabel(_state: ArrivalState): string | null {
  return null;
}

/**
 * The settled arrival fact, drawn as a label on the tracking map's job pin
 * (owner, 2026-09-14, VN-20). `null` for the states that settle nothing — a
 * claim is not a location, and no arrival has nothing to say.
 */
export function arrivalMapLabel(state: ArrivalState): string | null {
  switch (state) {
    case "confirmed":
      return "Arrival confirmed by the person who posted it";
    case "verified":
      return "Location confirmed";
    default:
      return null;
  }
}

/**
 * Why `mark_helper_arrival` refused, read off its error. The RPC RAISEs
 * (20260915044137) and writes nothing:
 *   arrival_too_far            DETAIL 'distance_ft=<n>'
 *   arrival_location_required  no coordinates sent
 *   arrival_location_invalid   coordinates out of range
 * `null` for any other error (network, not the assigned helper, …), which the
 * caller reports as a plain failure.
 */
export type ArrivalRefusal =
  | { kind: "too_far"; distanceFt: number | null; posterCanConfirm?: boolean }
  | { kind: "no_location" };

export function arrivalRefusalFromError(
  error: { message?: string | null; details?: string | null } | null | undefined,
): ArrivalRefusal | null {
  const message = error?.message ?? "";
  if (/arrival_too_far/.test(message)) {
    const ft = Number((error?.details ?? "").match(/distance_ft=(\d+)/)?.[1]);
    return { kind: "too_far", distanceFt: Number.isFinite(ft) && ft > 0 ? ft : null };
  }
  if (/arrival_location_(required|invalid)/.test(message)) return { kind: "no_location" };
  return null;
}

/** "about 640 ft" under a tenth of a mile, else "about 3.2 mi" / "about 2091 mi". */
export function formatArrivalDistance(distanceFt: number): string {
  const mi = distanceFt / 5280;
  if (mi < 0.1) return `${Math.round(distanceFt)} ft`;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/**
 * The sentence shown under the Arrived step's button after a refusal. It says
 * what blocked the tap and what to do; the button beside it offers
 * "Try My Location Again".
 */
export function arrivalRefusalMessage(
  refusal: ArrivalRefusal | { kind: "denied" },
): string {
  switch (refusal.kind) {
    case "too_far":
      if (refusal.posterCanConfirm) {
        return refusal.distanceFt != null
          ? `Your location is about ${formatArrivalDistance(refusal.distanceFt)} from the job's map pin. If you're at the door, the person who posted this job can tap "Confirm They Arrived" — we've let them know.`
          : `Your location is a little way from the job's map pin. If you're at the door, the person who posted this job can tap "Confirm They Arrived" — we've let them know.`;
      }
      return refusal.distanceFt != null
        ? `You're about ${formatArrivalDistance(refusal.distanceFt)} from the job — get closer to mark arrived.`
        : "You're too far from the job — get closer to mark arrived.";
    case "denied":
      return "Location is turned off for Louisiana Helpr. Allow it in Settings, then tap Try My Location Again — your location has to show you at the job to mark arrived.";
    default:
      return "We couldn't get your location. Your location has to show you at the job to mark arrived — step somewhere with a clearer sky and try again.";
  }
}
