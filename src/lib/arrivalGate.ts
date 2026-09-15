/**
 * ONE rule for "has this helper's arrival been established?", shared by every
 * surface that gates on it — the payout CTA (`completeJob`), the tracker's
 * Done step, the tracker's Arrived step caption (the open "Awaiting poster"
 * question only), and the arrival label on the tracking map's job pin.
 *
 * WHY THIS EXISTS. Completion used to gate on a LIVE 500ft GPS check taken at
 * wrap-up time, with a fallback that read `job_checkins` — a table with zero
 * writers anywhere in the app (0 rows in prod). So the fallback could never
 * fire, and a helper who had legitimately stepped away at the end of the job
 * (to their van, off a large site, inside a metal building) was hard-blocked
 * from the write that gets them paid, and told to use a "Check In with Photo"
 * control that does not exist.
 *
 * The replacement gates on the ARRIVAL, which is a better piece of evidence
 * and is captured at the moment it is true rather than an hour later:
 *
 *   verified — `helper_arrival_verified_at`, stamped only by the
 *              `mark_helper_arrival` RPC after the SERVER computed the helper
 *              within 500ft. Not in the helper's column whitelist, so there
 *              is no client path that fakes it.
 *   vouched  — `poster_confirmed_arrival_at`, the poster's "Confirm They
 *              Arrived" tap. This is the RECOURSE PATH: a helper whose GPS
 *              never gets a fix is not stranded, because the person standing
 *              in front of them can vouch.
 *   claimed  — `helper_arrived_at` with neither of the above. The poster sees
 *              it (they need to know the helper says they're here) but it
 *              does NOT unlock completion on its own.
 */

export type ArrivalEvidence = {
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
};

export type ArrivalState = "none" | "claimed" | "verified" | "confirmed";

/**
 * Ordered strongest-first: the poster's vouch outranks a GPS fix because it is
 * a second party attesting, which is what a dispute actually turns on.
 */
export function arrivalState(job: ArrivalEvidence | null | undefined): ArrivalState {
  if (!job) return "none";
  if (job.poster_confirmed_arrival_at) return "confirmed";
  if (job.helper_arrival_verified_at) return "verified";
  if (job.helper_arrived_at) return "claimed";
  return "none";
}

/** Does this job satisfy the completion gate's arrival requirement? */
export function arrivalEstablished(job: ArrivalEvidence | null | undefined): boolean {
  const s = arrivalState(job);
  return s === "verified" || s === "confirmed";
}

/**
 * What to tell a helper who is blocked on the arrival gate. Never a dead end:
 * every branch names the next thing they can actually do.
 */
export function arrivalGateMessage(job: ArrivalEvidence | null | undefined): string {
  return arrivalState(job) === "claimed"
    ? "You marked yourself arrived, but we couldn't confirm your location. Ask the poster to tap \"Confirm They Arrived\" on their job — that unlocks wrap-up."
    : "Mark yourself arrived at the job site first. If your location won't work, ask the poster to confirm you arrived — that works too.";
}

/**
 * Caption under the tracker's Arrived step — the OPEN QUESTION only.
 *
 * It used to label all three states, so "Poster confirmed" / "Location
 * confirmed" sat under the Arrived step. Owner, 2026-09-14 (VN-20): "Location
 * confirmed does not need to show on the tracker, it should be on the map".
 * That reverses the earlier "light it when helpr says they arrived but poster
 * has to confirm" caption for the two SETTLED states, which now live on the
 * map's job pin (`arrivalMapLabel`) or, when no map is drawn, in the status
 * line under the rail. A bare claim still waiting on the poster keeps its
 * amber caption: it is not a fact about the location, it is a pending action.
 */
export function arrivalStateLabel(state: ArrivalState): string | null {
  return state === "claimed" ? "Awaiting poster" : null;
}

/**
 * The settled arrival fact, drawn as a label on the tracking map's job pin
 * (owner, 2026-09-14, VN-20). `null` for the states that settle nothing — a
 * claim is not a location, and no arrival has nothing to say.
 */
export function arrivalMapLabel(state: ArrivalState): string | null {
  switch (state) {
    case "confirmed":
      return "Poster confirmed arrival";
    case "verified":
      return "Location confirmed";
    default:
      return null;
  }
}
