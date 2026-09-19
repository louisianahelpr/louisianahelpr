// arrivalRule — THE rule for "has this Helpr's arrival been established?", in
// one place for the app (src/lib/arrivalGate.ts re-exports it) and for the
// Deno edge runtime (create-payment's helper release). ZERO imports, so vitest
// and the edge-function harness load it straight from disk.
//
// OWNER, 2026-09-19 (pop-up, verbatim): "but they can not start working until
// the poster confirms they are there. they shoud be aware of this so they dont
// try to cheat the system. if gps is not on, they can mark themselves as
// arrived but can not move on until the poster marks them arrived. so
// encourgage to turn on gps. but even if gps does confirm they are there the
// poster still needs ro cfnrm wither way"
//
// So arrival is established by ONE stamp:
//
//   poster_confirmed_arrival_at — the poster's "Confirm They Arrived" tap. The
//                                 half that cannot be faked, and the owner
//                                 requires it in EVERY case.
//
// GPS is EVIDENCE, not a gate:
//
//   helper_arrived_at           — the Helpr's claim. `mark_helper_arrival` now
//                                 stamps it on every call (20260919155016), GPS
//                                 or no GPS, near or far. It is what makes the
//                                 poster's Confirm They Arrived control appear.
//   helper_arrival_verified_at  — the server measured the coordinates the phone
//                                 sent within 500 ft of the job. Shown to both
//                                 parties as corroboration; unlocks nothing on
//                                 its own.
//   helper_arrival_near_miss_at — >500 ft but within a mile: the map pin is the
//   helper_arrival_near_miss_ft   likely culprit. Evidence too; unlocks nothing.
//
// --- WHAT THIS REPLACED, AND WHY THE HISTORY MATTERS ------------------------
// VN-33 (owner, 2026-09-14) had made it "verified AND confirmed. No fallback",
// and `mark_helper_arrival` enforced the GPS half by REFUSING a far or fix-less
// arrival and writing nothing at all. That is what deadlocked the job: with
// helper_arrived_at NULL the poster's Confirm They Arrived never rendered,
// while the Helpr's blocked CTA told them to ask the poster for exactly that
// tap. VN-33(b) (20260915074058) patched only the within-a-mile case by letting
// a near miss stand in for the GPS half.
//
// Before VN-33 the rule was "verified OR confirmed", where GPS alone unlocked
// wrap-up. That is NOT what this is: GPS alone unlocks nothing now, and never
// will — the owner's reversal removed the GPS requirement, not the poster's.
// The anti-cheat concern VN-33 was written for (a Helpr can send any
// coordinates) is answered by requiring the human attestation every time.

export type ArrivalEvidence = {
  helper_arrived_at?: string | null;
  helper_arrival_verified_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  /** >500 ft but within a mile of the job's map pin. Evidence, never a gate. */
  helper_arrival_near_miss_at?: string | null;
};

/**
 * Does this job satisfy the arrival requirement for Working and for completion?
 *
 * ONE stamp, by the owner's 2026-09-19 decision. The same predicate is enforced
 * server-side by `enforce_job_tracking_arrival_gate` (the tracker's Working
 * step), `enforce_helper_completion_gates` and `rpc_helper_mark_done`
 * (20260919155016). `src/test/jobsGuardRpcParity.test.ts` pins that agreement.
 */
export function arrivalEstablished(job: ArrivalEvidence | null | undefined): boolean {
  return !!job?.poster_confirmed_arrival_at;
}

/** Which door the message is for: the payout request, or the tracker's next step. */
export type ArrivalGateDoor = "wrap-up" | "tracker";

/**
 * What to tell a Helpr blocked on the arrival rule.
 *
 * EVERY branch names the poster's tap as the one thing still missing — because
 * after 2026-09-19 it always is. The branches differ only in what the Helpr's
 * own location did or did not corroborate, and in whether they still owe an
 * arrival at all. None of them offers the Helpr's location as a way round the
 * poster, because there is no way round the poster.
 */
export function arrivalGateMessage(
  job: ArrivalEvidence | null | undefined,
  door: ArrivalGateDoor = "wrap-up",
): string {
  const unlocks = door === "wrap-up" ? "before you can mark the job complete" : "before you can start working";
  const gps = !!job?.helper_arrival_verified_at;
  const poster = !!job?.poster_confirmed_arrival_at;
  const nearMiss = !!job?.helper_arrival_near_miss_at;

  if (poster) {
    return gps
      ? "Arrival confirmed by your location and by the person who posted this job."
      : "The person who posted this job confirmed you arrived.";
  }
  if (gps) {
    return `Your location is confirmed at the job. The person who posted this job still has to tap "Confirm They Arrived" ${unlocks}.`;
  }
  if (nearMiss) {
    return `Your location was a little way from the job's map pin. You're checked in either way — the person who posted this job has to tap "Confirm They Arrived" ${unlocks}.`;
  }
  if (job?.helper_arrived_at) {
    return `You're checked in, but we couldn't confirm your location. Turn Location on and tap "Try My Location Again" so they can see you're here — either way, the person who posted this job has to tap "Confirm They Arrived" ${unlocks}.`;
  }
  return `Mark yourself arrived at the job site first. The person who posted this job then taps "Confirm They Arrived" ${unlocks} — that's required whether or not your location confirms you.`;
}
