// arrivalRule — THE rule for "has this Helpr's arrival been established?", in
// one place for the app (src/lib/arrivalGate.ts re-exports it) and for the
// Deno edge runtime (create-payment's helper release). ZERO imports, so vitest
// and the edge-function harness load it straight from disk.
//
// OWNER, 2026-09-14 (VN-33): "both required: nearby by GPS AND poster
// confirms. No fallback." Arrival is established only when BOTH are on the
// job row:
//
//   helper_arrival_verified_at  — stamped only by mark_helper_arrival after the
//                                 SERVER computed the coordinates the phone
//                                 sent within 500ft of the job. (A Helpr can
//                                 send any coordinates; the poster's tap is the
//                                 half that cannot be faked.) Since
//                                 20260915044137 that RPC refuses (and writes
//                                 nothing) when they are further away or have
//                                 no location, and it stamps helper_arrived_at
//                                 in the same statement.
//   poster_confirmed_arrival_at — the poster's "Confirm They Arrived" tap.
//
// This replaced "verified OR confirmed", where either one alone unlocked wrap-up
// and the poster's tap was the recourse for a Helpr whose phone had no fix.
// That recourse is gone by the owner's decision. The same AND is enforced by
// enforce_helper_completion_gates (the helper's completion write) and by the
// job_tracking trigger (the tracker's Working step).

export type ArrivalEvidence = {
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  /** VN-33(b): mark_helper_arrival found the Helpr >500ft but <=1 mile from the
   *  pin. Stands in for the GPS half ONLY beside the poster's confirmation. */
  helper_arrival_near_miss_at?: string | null;
};

/** Does this job satisfy the arrival requirement for Working and for completion? */
export function arrivalEstablished(job: ArrivalEvidence | null | undefined): boolean {
  // VN-33(b), owner 2026-09-14 ("poster can confirm anyway" when the map pin is
  // wrong): a recorded near miss counts in place of the GPS stamp, never alone.
  // Same rule as enforce_helper_completion_gates / the tracker trigger
  // (20260915074058).
  return (!!job?.helper_arrival_verified_at || !!job?.helper_arrival_near_miss_at) && !!job?.poster_confirmed_arrival_at;
}

/** Which door the message is for: the payout request, or the tracker's next step. */
export type ArrivalGateDoor = "wrap-up" | "tracker";

/**
 * What to tell a Helpr blocked on the arrival rule. Every branch says that
 * BOTH are needed and names the half that is still missing, so the message is
 * never a dead end.
 */
export function arrivalGateMessage(
  job: ArrivalEvidence | null | undefined,
  door: ArrivalGateDoor = "wrap-up",
): string {
  const unlocks = door === "wrap-up" ? "before you can mark the job complete" : "before you can start working";
  const gps = !!job?.helper_arrival_verified_at;
  const poster = !!job?.poster_confirmed_arrival_at;
  const nearMiss = !!job?.helper_arrival_near_miss_at;
  if (gps && poster) return "Arrival confirmed by your location and by the person who posted this job.";
  if (nearMiss && poster) return "The poster confirmed you arrived.";
  if (nearMiss && !gps) {
    return `Your location was a little way from the job's map pin. If you're at the door, the poster can tap "Confirm They Arrived" ${unlocks}.`;
  }
  if (gps) {
    return `Your location is confirmed. The person who posted this job also needs to tap "Confirm They Arrived" — both are needed ${unlocks}.`;
  }
  if (poster) {
    return `The person who posted this job confirmed you arrived, but your location hasn't. Tap "Try My Location Again" at the job site — both are needed ${unlocks}.`;
  }
  if (job?.helper_arrived_at) {
    return `We couldn't confirm your location. Tap "Try My Location Again" at the job site, and the person who posted this job needs to tap "Confirm They Arrived" — both are needed ${unlocks}.`;
  }
  return `Mark yourself arrived at the job site first. Your location has to show you there, and the person who posted this job confirms you arrived — both are needed ${unlocks}.`;
}
