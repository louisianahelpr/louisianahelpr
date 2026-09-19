/**
 * ONE rule for "has this helper's arrival been established?", shared by every
 * surface that gates on it — the payout CTA (`completeJob`), the tracker's
 * Working and Done steps, and the arrival label on the tracking map's job pin.
 *
 * THE RULE ITSELF lives in `supabase/functions/_shared/arrivalRule.ts` so the
 * app and create-payment's helper release read the same predicate.
 *
 * OWNER, 2026-09-19 (pop-up, verbatim): "but they can not start working until
 * the poster confirms they are there. they shoud be aware of this so they dont
 * try to cheat the system. if gps is not on, they can mark themselves as
 * arrived but can not move on until the poster marks them arrived. so
 * encourgage to turn on gps. but even if gps does confirm they are there the
 * poster still needs ro cfnrm wither way"
 *
 * So: `poster_confirmed_arrival_at` ALONE establishes the arrival, and it is
 * required in EVERY case — a GPS-verified arrival included. GPS is evidence
 * and encouragement, never a gate. This SUPERSEDES VN-33 (owner, 2026-09-14,
 * "both required … no fallback"), whose enforcement — `mark_helper_arrival`
 * refusing a far or fix-less arrival and writing NOTHING — is what deadlocked
 * the job: with `helper_arrived_at` NULL the poster's "Confirm They Arrived"
 * control never rendered, while the Helpr's blocked CTA told them to go ask the
 * poster for exactly that tap.
 *
 * WHY IT GATES ON ARRIVAL AT ALL. Completion used to gate on a LIVE 500ft GPS
 * check taken at wrap-up time, with a fallback that read `job_checkins` — a
 * table with zero writers. A helper who had legitimately stepped away at the
 * end of the job was hard-blocked from getting paid. The arrival is captured
 * at the moment it is true, so that is what the gate reads.
 *
 * The display states below are about what the job row SAYS, not about whether
 * the gate is open:
 *
 *   confirmed — the poster tapped "Confirm They Arrived". THE GATE.
 *   verified  — the server verified the location; the poster has not yet.
 *   claimed   — `helper_arrived_at` with neither. Since 20260919155016 this is
 *               a first-class, expected state again: the RPC records a claim on
 *               every call, with or without a location fix.
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
 * Ordered strongest-first for DISPLAY, and since 2026-09-19 that order is also
 * the gate: the poster's confirmation is what `arrivalEstablished` reads.
 */
export function arrivalState(job: ArrivalEvidence | null | undefined): ArrivalState {
  if (!job) return "none";
  if (job.poster_confirmed_arrival_at) return "confirmed";
  if (job.helper_arrival_verified_at) return "verified";
  if (job.helper_arrived_at) return "claimed";
  return "none";
}

/**
 * THE CONTRACT FOR THE UI. The four evidence states the owner's rule needs to
 * be able to SEE, separating a claim with no location at all from a claim whose
 * location landed near the pin. `arrivalState` above cannot: both are
 * "claimed", and the Helpr needs different words for each ("turn Location on"
 * vs "your pin may be wrong").
 *
 * Only `"confirmed"` unlocks anything. The other three are corroboration the
 * poster can weigh while deciding whether to tap.
 */
export type ArrivalEvidenceState = "none" | "claimed" | "near_miss" | "verified" | "confirmed";

export function arrivalEvidenceState(job: ArrivalEvidence | null | undefined): ArrivalEvidenceState {
  if (!job) return "none";
  if (job.poster_confirmed_arrival_at) return "confirmed";
  if (job.helper_arrival_verified_at) return "verified";
  if (job.helper_arrival_near_miss_at) return "near_miss";
  if (job.helper_arrived_at) return "claimed";
  return "none";
}

/**
 * May this Helpr start working / mark the job done? Named for the two places
 * the UI asks, so a screen never has to re-derive the rule from the columns.
 * Both are the same predicate, on purpose (20260919155016).
 */
export const helperMayStartWorking = arrivalEstablished;
export const helperMayMarkDone = arrivalEstablished;

/** Does the poster still owe this Helpr the tap that unblocks them? */
export function posterOwesArrivalConfirmation(job: ArrivalEvidence | null | undefined): boolean {
  return !!job?.helper_arrived_at && !job?.poster_confirmed_arrival_at;
}

/**
 * Caption under the tracker's Arrived step. NOW ALWAYS `null`.
 *
 * History: it used to label all three states, so "Poster confirmed" /
 * "Location confirmed" sat under the Arrived step. Owner, 2026-09-14 (VN-20):
 * "Location confirmed does not need to show on the tracker, it should be on
 * the map" — the settled facts moved to the map's job pin
 * (`arrivalMapLabel`), or to the status line under the rail when no map is
 * drawn, leaving only the open question here.
 *
 * OWNER, 2026-09-16: "remove awaiting confirmedation from under confirmation.
 * tehy can click arrived or toggle to see why its yellow" — the caption itself
 * goes; the AMBER STEP COLOUR STAYS. The step's own colour is the signal now,
 * and tapping the step tells the reader why.
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

/* -------------------------------------------------------------------------
 * THE RPC VERDICT. `mark_helper_arrival` no longer refuses anything about the
 * location (20260919155016): it RECORDS the arrival on every call and returns
 * a jsonb verdict describing what the location proved. The `basis` field is the
 * only thing a caller needs to switch on.
 * ---------------------------------------------------------------------- */

/** What the Helpr's coordinates proved, as reported by `mark_helper_arrival`. */
export type ArrivalBasis =
  /** Within 500 ft of the job. `helper_arrival_verified_at` was stamped. */
  | "gps_verified"
  /** The job never geocoded, so there was nothing to measure against; the fix was accepted. */
  | "no_job_coordinates"
  /** >500 ft but within a mile — the map pin is the likely culprit. Near-miss columns recorded. */
  | "near_miss"
  /** More than a mile from the pin. Claim recorded, nothing verified. */
  | "too_far"
  /** No coordinates sent: Location off, denied, or no fix. Claim recorded. */
  | "no_location"
  /** Coordinates out of range. Claim recorded, nothing verified. */
  | "location_invalid"
  /** A repeat call on an already-verified arrival. Nothing re-stamped, nothing downgraded. */
  | "already_verified"
  /** A repeat call after the poster already confirmed. The arrival stands. */
  | "already_confirmed";

export type ArrivalVerdict = {
  /** Always true on a successful call: `helper_arrived_at` is set. */
  arrivalRecorded: boolean;
  /** `helper_arrival_verified_at` is set on the row. */
  verified: boolean;
  basis: ArrivalBasis;
  /** Distance to the job's map pin, when one could be measured. */
  distanceFt: number | null;
  /** The poster has tapped "Confirm They Arrived". */
  posterConfirmed: boolean;
  /**
   * The poster STILL has to tap. True on every path but `already_confirmed` —
   * that is the owner's rule, and the sentence the Helpr must see.
   */
  posterConfirmationRequired: boolean;
  /** Arrival established: Working and Done are unblocked. Equals `posterConfirmed`. */
  arrivalEstablished: boolean;
};

const BASES: readonly ArrivalBasis[] = [
  "gps_verified",
  "no_job_coordinates",
  "near_miss",
  "too_far",
  "no_location",
  "location_invalid",
  "already_verified",
  "already_confirmed",
];

/**
 * Read the RPC's jsonb into a verdict. `null` when the body is absent or
 * unrecognisable — a null Supabase `error` is not a write, so a caller must
 * treat `null` here as "something silently did nothing", not as a success.
 */
export function arrivalVerdictFromRpc(data: unknown): ArrivalVerdict | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const basis = d.basis;
  if (typeof basis !== "string" || !BASES.includes(basis as ArrivalBasis)) return null;
  const ft = Number(d.distance_ft);
  return {
    arrivalRecorded: d.arrival_recorded === true,
    verified: d.verified === true,
    basis: basis as ArrivalBasis,
    distanceFt: Number.isFinite(ft) ? ft : null,
    posterConfirmed: d.poster_confirmed === true,
    posterConfirmationRequired: d.poster_confirmation_required === true,
    arrivalEstablished: d.arrival_established === true,
  };
}

/**
 * The sentence shown to the Helpr the moment they tap Arrived.
 *
 * EVERY branch that is not already confirmed ends on the poster's tap, because
 * the owner's whole point is that the Helpr must know up front it is coming —
 * "they shoud be aware of this so they dont try to cheat the system". The
 * unverified branches also encourage Location, because that is what makes the
 * poster's decision easy; none of them presents Location as an alternative to
 * the poster, because it is not one.
 */
export function arrivalVerdictMessage(v: ArrivalVerdict): string {
  const thenPoster = 'The person who posted this job now taps "Confirm They Arrived" so you can start working.';
  switch (v.basis) {
    case "already_confirmed":
      return "You're checked in — the person who posted this job confirmed you arrived.";
    case "gps_verified":
    case "no_job_coordinates":
    case "already_verified":
      return `You're checked in and your location is confirmed at the job. ${thenPoster}`;
    case "near_miss":
      return v.distanceFt != null
        ? `You're checked in. Your location is about ${formatArrivalDistance(v.distanceFt)} from the job's map pin, which often just means the pin is off. ${thenPoster}`
        : `You're checked in. Your location is a little way from the job's map pin, which often just means the pin is off. ${thenPoster}`;
    case "too_far":
      return v.distanceFt != null
        ? `You're checked in, but your location is about ${formatArrivalDistance(v.distanceFt)} from the job. ${thenPoster}`
        : `You're checked in, but your location doesn't look like the job site. ${thenPoster}`;
    case "no_location":
      return `You're checked in. We couldn't read your location — turning Location on makes it obvious you're here. ${thenPoster}`;
    case "location_invalid":
      return `You're checked in, but we couldn't read your location. Try again with Location on so they can see you're here. ${thenPoster}`;
  }
}

/**
 * LEGACY. Why `mark_helper_arrival` refused, read off its error.
 *
 * The RPC no longer raises any of these (20260919155016 — it records the
 * arrival instead and returns a verdict; see `arrivalVerdictFromRpc`). Kept
 * because a client build in the wild can still be talking to it, and because a
 * queued request can still carry an error from the previous definition:
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
 * The sentence shown when `mark_helper_arrival` REFUSED and wrote nothing.
 *
 * THIS IS THE DEPLOY-GAP PATH, and it must tell the truth about that gap.
 * Since 20260919155016 the live RPC refuses nothing — a Helpr can always
 * record an arrival. But Vercel ships this bundle independently of
 * `db-deploy.yml`, so between a push and the migration landing, prod still
 * runs the VN-33 definition that raises `arrival_too_far` /
 * `arrival_location_required` and writes NOTHING.
 *
 * Browser verification on 2026-09-19 caught this copy promising the opposite:
 * "You're still checked in" and "the person who posted this job has to tap
 * Confirm They Arrived" — while `helper_arrived_at` stayed NULL, so the
 * poster's control rendered DISABLED ("You'll be able to confirm this once
 * your Helpr is at the job"). Each side was told to wait for the other: the
 * very deadlock this batch removed, rebuilt out of reassuring words, and worse
 * than the pre-batch copy which at least refused honestly.
 *
 * So every branch below says the check-in did NOT happen and names the one
 * thing that fixes it. No branch may promise a poster confirmation, because in
 * this state there is nothing for the poster to confirm.
 */
export function arrivalRefusalMessage(
  refusal: ArrivalRefusal | { kind: "denied" },
): string {
  // Named once so no branch can drift into implying the check-in landed.
  const notRecorded = "We couldn't check you in yet.";
  const retry = 'Tap "Try My Location Again".';
  switch (refusal.kind) {
    case "too_far":
      return refusal.distanceFt != null
        ? `${notRecorded} Your location is about ${formatArrivalDistance(refusal.distanceFt)} from the job's map pin. If you're at the job, ${retry}`
        : `${notRecorded} Your location is a little way from the job's map pin. If you're at the job, ${retry}`;
    case "denied":
      return `${notRecorded} Location is turned off for Louisiana Helpr — allow it in Settings, then ${retry}`;
    default:
      return `${notRecorded} We couldn't get your location. Turn Location on, then ${retry}`;
  }
}
