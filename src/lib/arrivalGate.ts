/**
 * ONE rule for "has this helper's arrival been established?", shared by every
 * surface that gates on it — the payout CTA (`completeJob`), the tracker's
 * Done step, and the tracker's Arrived step caption.
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

/** Short label for the tracker's Arrived step. */
export function arrivalStateLabel(state: ArrivalState): string | null {
  switch (state) {
    case "confirmed":
      return "Poster confirmed";
    case "verified":
      return "Location confirmed";
    case "claimed":
      return "Awaiting poster";
    default:
      return null;
  }
}
