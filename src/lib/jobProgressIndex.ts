/**
 * The job tracker's step index and its derivation, without the tracker itself.
 *
 * Split out of JobTracking.tsx (2026-10-29) so the chat job card (DealCard, via
 * helperProgress) can read a job's step without pulling the whole tracker, and
 * with it the en-route location code, into the signed-in first screen
 * (bootReach). JobTracking re-exports both; jobProgressIndex.test.ts pins
 * STATUS_IDX to the order of the tracker's STATUSES.
 */
/** Index of each step in `STATUSES`, by key. Keeps the derivation below
    readable and stops a re-ordering of the array from silently changing
    what "on the way" means. */
export const STATUS_IDX = {
  assigned: 0,
  confirmed: 1,
  job_confirmed: 2,
  on_the_way: 3,
  arrived: 4,
  working: 5,
  done: 6,
} as const;

/** Everything the tracker can learn about how far along a job is. All
    optional: a caller that knows nothing still gets a sane step 0. */
export type JobProgressEvidence = {
  /** `status` from the latest `job_tracking` row, when one exists. */
  trackingStatus?: string | null;
  /** `jobs.status`. */
  jobStatus?: string | null;
  helperConfirmedAt?: string | null;
  /** Day-before re-confirmation stamp (migration 20260824213000); see the
   *  gate below for how it composes with the accept-time stamp. */
  helperDayofConfirmedAt?: string | null;
  /** Job date (YYYY-MM-DD) — lets the mutual gate honour an accept that
   *  itself happened inside the 24h window. Optional; absent = lenient. */
  jobDateNeeded?: string;
  /** `jobs.start_time` ("HH:MM:SS"). Lets the day-of grace window measure from
   *  the job's real START in the job's zone — the same instant JobConfirmation
   *  opens against — rather than from midnight in the reader's zone. Optional;
   *  absent = midnight, which is the lenient direction. */
  jobStartTime?: string | null;
  posterConfirmedAt?: string | null;
  helperOnTheWayAt?: string | null;
  helperArrivedAt?: string | null;
  /** The two-party arrival evidence (`src/lib/arrivalGate.ts`). Optional, but
   *  without them a bare CLAIM is the only thing the working-inference below
   *  can see — which is how the rail ran ahead of the arrival it was drawn
   *  from. See the inference for why they are load-bearing. */
  helperArrivalVerifiedAt?: string | null;
  posterConfirmedArrivalAt?: string | null;
  /** VN-33(b) near miss — counts for the working inference only beside the poster's confirmation. */
  helperArrivalNearMissAt?: string | null;
  helperCompletedAt?: string | null;
  posterCompletedAt?: string | null;
};

/**
 * Which step of `STATUSES` a job is actually on.
 *
 * This used to read the `job_tracking` row FIRST and, if there wasn't one,
 * fall all the way back to 0 — so a job whose helper had finished and whose
 * poster was staring at "Approve & release payment" rendered as "Offered"
 * with the bar at 1/7. The jobs row already carried the truth (the
 * `helper_on_the_way_at` / `helper_arrived_at` / `helper_completed_at`
 * stamps); it just wasn't being read.
 *
 * So: score the job row for the FURTHEST milestone it can evidence, score the
 * tracking row, and take the max. A missing or stale tracking row can then
 * never drag the tracker backwards, while a live tracking row (the helper
 * tapping through the steps) still leads the way when it's ahead.
 */
export function deriveCurrentStatusIdx({
  trackingStatus,
  jobStatus,
  helperConfirmedAt,
  helperDayofConfirmedAt,
  posterConfirmedAt,
  helperOnTheWayAt,
  helperArrivedAt,
  posterConfirmedArrivalAt,
  helperCompletedAt,
  posterCompletedAt,
}: JobProgressEvidence): number {
  // An unrecognised tracking status yields -1 from findIndex — treat that as
  // "no evidence" rather than letting it blank out the whole tracker.
  const trackingIdx = trackingStatus
    ? ((STATUS_IDX as Record<string, number>)[trackingStatus] ?? -1)
    : -1;

  let jobIdx = -1;
  const atLeast = (idx: number) => { if (idx > jobIdx) jobIdx = idx; };

  if (jobStatus === "accepted") atLeast(STATUS_IDX.assigned);
  // STATUS IS NOT A CONFIRMATION (owner, 2026-09-19).
  //
  // This used to read `in_progress`/`revision_requested` as evidence of at
  // least "Confirmed" (STATUS_IDX.job_confirmed), on the reasoning that a job
  // cannot BE in progress without having been confirmed. That reasoning was
  // wrong on the only rows it was written for. FOUND LIVE on prod job
  // bb2c3732: `in_progress` with `helper_confirmed_at`, `poster_confirmed_at`
  // AND `helper_dayof_confirmed_at` all NULL. The rail painted Confirmed
  // complete, the next-step CTA therefore became "I'm on my way" — and
  // `helper_mark_on_the_way` refused the tap with `helper_not_confirmed`,
  // because its one predicate is `v_job.helper_confirmed_at IS NULL`
  // (verified live on prod, 2026-09-19, and pinned by
  // src/test/jobsGuardRpcParity.test.ts).
  //
  // That is the bad-GPS deadlock's class, one step earlier on the same rail: a
  // control offered for an action the server will refuse. The floor did not
  // just mislabel a step, it SKIPPED THE GATE — the helper's-confirmation
  // check below lives on the `job_confirmed` branch of the next-step CTA, and
  // a rail already sitting at `job_confirmed` never reaches that branch.
  //
  // So the Confirmed step is derived from the STAMPS and nothing else (the
  // mutual day-of rule a dozen lines down). What `in_progress` still evidences
  // is that somebody was assigned and the job is underway — the Offered step,
  // which is also the rail's floor. An in-progress job with no confirmation
  // stamp at all now reads "Offered", and that is not the old lie in a new
  // place: it is the honest rendering of a row that evidences no confirmation.
  // (Every such row on prod today is `is_seed = true` — see the report in the
  // handoff; no organic job has ever reached this state.)
  if (jobStatus === "in_progress" || jobStatus === "revision_requested") {
    atLeast(STATUS_IDX.assigned);
  }
  if (helperConfirmedAt || posterConfirmedAt) atLeast(STATUS_IDX.confirmed);
  // The MUTUAL step wants the helper's DAY-BEFORE stamp, not the accept-time
  // one — accepting a job five days out says nothing about the day itself
  // (2026-08-24 lifecycle review). An accept that itself happened inside the
  // 24h window counts (same grace as JobConfirmation), as does any row where
  // no job date is known to measure against.
  // Accepting never counts as this tap (owner, 2026-10-08, Q1570).
  const helperAnsweredDayOf = !!helperDayofConfirmedAt;
  if (helperAnsweredDayOf && posterConfirmedAt) {
    atLeast(STATUS_IDX.job_confirmed);
  }
  if (helperOnTheWayAt) atLeast(STATUS_IDX.on_the_way);
  if (helperArrivedAt) {
    atLeast(STATUS_IDX.arrived);
    // Arrived + still `in_progress` almost certainly means on site and
    // working — there is no "started working" stamp on the jobs row. But
    // that is an INFERENCE, and applying it unconditionally would make the
    // Arrived step unreachable: the helper tapping Arrived also flips the job
    // to `in_progress`, so every arrival would skip straight to Working. So
    // it only fills a gap: when a tracking row exists it is the helper's own
    // statement of where they are, and it wins.
    //
    // AND THE INFERENCE NEEDS AN ESTABLISHED ARRIVAL, not a bare claim. A
    // claim alone flips the job to `in_progress` (mark_helper_arrival does the
    // accepted → in_progress transition in the same statement that decides
    // whether the arrival was verified), so `helperArrivedAt && in_progress`
    // was satisfied by the claim ITSELF — the inference was reading its own
    // side effect back as corroboration and painting Working off a helper who
    // was 1792 miles away. With an established arrival — since the owner's
    // 2026-09-19 reversal that is the POSTER'S CONFIRMATION, on its own and in
    // every case (`arrivalEstablished`, supabase/functions/_shared/arrivalRule.ts)
    // — it is a sound inference and stays; without, the rail stops at Arrived,
    // which is exactly what is known. VN-33's "verified AND confirmed" is gone:
    // GPS alone still paints Arrived, the poster's tap alone now paints Working
    // (JobTracking.test.tsx holds both halves).
    // ONLY THE POSTER'S TAP infers Working (2026-10-08): GPS now unlocks Start
    // Working on its own, but a verified arrival is not proof anyone started,
    // and the tracker marks a step done only when it truly happened.
    if (trackingIdx < 0 && jobStatus === "in_progress" && !!posterConfirmedArrivalAt) {
      atLeast(STATUS_IDX.working);
    }
  }
  if (helperCompletedAt || posterCompletedAt || jobStatus === "completed") {
    atLeast(STATUS_IDX.done);
  }

  // Floor at 0: the tracker always shows at least "Offered".
  const idx = Math.max(0, trackingIdx, jobIdx);

  // A REVISION OR A DISPUTE UNDOES "Done".
  //
  // REVISION: `helper_completed_at` stays stamped when the poster sends the
  // work back, so the tracker sat on a fully-green Done — beside a card that
  // said "Revision requested" and an action row offering Approve or Dispute.
  // Owner: "all of these things can't be true at once." The work is back with
  // the helpr, which is what Working means, and the stamp is not cleared
  // because it is a record of what happened; the tracker just stops treating
  // it as the final word while the job is in revision.
  //
  // DISPUTE: the same stamp, the same lie, one state later. Owner: "Can't be
  // marked done if it's in revision is dispute." Their screenshot was a
  // disputed job whose rail read Confirmed → On the way → Arrived → Working
  // (red) → DONE (green), sitting directly on top of a panel reading
  // "Escalated to Admin … nothing is charged or released until then". Done on
  // this rail is not "the helpr pressed a button"; it is the completion that
  // releases the money, and under an open dispute a human has not yet decided
  // whether that completion stands. So the rail must not spend a green on it.
  //
  // Both clamp to Working — the step the job is genuinely stuck at. The work
  // was performed and is contested, which is exactly "Working": begun, not
  // accepted. Working is also where the alarm colour is pinned for a dispute
  // (`disputedStep` in the step row below), so the clamp and the colour rule
  // land on the SAME step — one red dot that is also the current step, no
  // second amber "current" elsewhere, and Done left inactive-grey rather than
  // green. It is deliberately a CEILING, not a floor: a dispute raised from
  // `accepted` (the state machine allows it — 20260825190000) still shows the
  // earlier step it really reached.
  //
  // This is a RENDER-TIME REFUSAL, not a rewrite. If `job_tracking.status`
  // carries a stale `done` from before the dispute, that row is left exactly
  // as it is — it is a true record of a tap that happened — and the clamp
  // simply stops it being the final word. Nothing here writes.
  if (jobStatus === "revision_requested" || jobStatus === "disputed") {
    return Math.min(idx, STATUS_IDX.working);
  }
  return idx;
}
