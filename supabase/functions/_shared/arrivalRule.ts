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
 * What to tell a Helpr blocked on the arrival rule. THE AMBER LINE.
 *
 * OWNER, 2026-09-19 (final browser gate): "amber says what is BLOCKING; muted
 * says why GPS helps. Nothing else."
 *
 * WHAT WAS MEASURED. On the claimed-no-GPS card this line and the muted GPS
 * nudge under it ran to TEN lines of prose at 375 — six here, four there — and
 * they overlapped: both said "turn Location on", both named "Try My Location
 * Again". The separation the design rests on (amber = something is stopping
 * you, muted = advice) was blurred by the duplication, and this half LED with
 * the GPS ask rather than with the blocker.
 *
 * So every blocked branch is now the SAME sentence: the poster's tap, which is
 * the only thing that is ever actually blocking. No GPS ask lives here — not
 * the instruction, not the button's name, not the reason. That is the muted
 * line's whole job (`gpsBenefitEl` in src/components/JobTracking.tsx), and the
 * one-tap control sits on the row beside it.
 *
 * The evidence the branches used to recite — "your location is confirmed at
 * the job", "a little way from the map pin" — is not lost and was never a
 * blocker: it is already on the tracker's own proof caption
 * (`trackingProofCaption`) and, when a map is drawn, on its job pin
 * (`arrivalMapLabel`). Saying it a third time here is what made this six lines.
 *
 * The two CONFIRMED branches are unchanged: they are not blocking anything, so
 * they are not amber — they report a settled fact and stop asking.
 */
export function arrivalGateMessage(
  job: ArrivalEvidence | null | undefined,
  door: ArrivalGateDoor = "wrap-up",
): string {
  const unlocks = door === "wrap-up" ? "before you can mark the job complete" : "before you can start working";
  const gps = !!job?.helper_arrival_verified_at;
  const poster = !!job?.poster_confirmed_arrival_at;

  if (poster) {
    return gps
      ? "Arrival confirmed by your location and by the person who posted this job."
      : "The person who posted this job confirmed you arrived.";
  }
  // THE ONE BLOCKER, whatever the location evidence says — that is the owner's
  // 2026-09-19 rule, and it is why the branches collapsed into one sentence.
  //
  // WRITTEN OUT IN BOTH RETURNS, not hoisted into a `const blocker` the two
  // interpolate. `src/test/controlReachability.test.ts` harvests the control
  // names this function promises by reading the STRING LITERALS IT RETURNS
  // (AST, not text) — a name that lives only in a local variable is invisible
  // to it, this function drops out of COPY_PRODUCERS entirely, and CHECK 3's
  // arrivalGateMessage↔posterConfirmationRung pair — the very pair the
  // 2026-09-19 deadlock lived in — goes vacuously green. Caught by that guard's
  // own "the inventories are real" assertion while this rewrite was in flight.
  // The duplication is the price of the scanner being able to see the promise.
  // ANY evidence of an arrival IS an arrival for this sentence's purposes. A
  // verified or near-miss stamp is only ever written in the same statement that
  // writes `helper_arrived_at`, so the extra reads change nothing on a healthy
  // row — but they stop the branch below telling a Helpr who is demonstrably
  // at the job to go and mark themselves arrived, on a row where one column
  // went missing. `controlReachability.test.ts` also needs this function to
  // read the near-miss column: it pairs copy with the control that offers the
  // way out, and the poster's "Confirm They Arrived" is enabled off a near miss
  // on the in-progress step (`recentArrivalNearMiss`, posterStepContract.ts).
  // Drop the read and the pair's state space loses that path, which is how the
  // guard found this edit's first draft.
  const arrivalOnRecord = !!job?.helper_arrived_at || gps || !!job?.helper_arrival_near_miss_at;
  if (!arrivalOnRecord) {
    // The one state where the poster's tap is NOT the next thing to happen:
    // there is no arrival for them to confirm yet, and marking it is the
    // Helpr's own move. Naming both, in order, is the blocker — not an aside.
    // The poster's tap is still named, because the Helpr has to know it is
    // coming before they are anywhere near it (owner: "they shoud be aware of
    // this so they dont try to cheat the system").
    return `Mark yourself arrived at the job site first. The person who posted this job has to tap "Confirm They Arrived" ${unlocks}.`;
  }
  return `The person who posted this job has to tap "Confirm They Arrived" ${unlocks}.`;
}
