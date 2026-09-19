/**
 * The tracker's step derivation, exercised as a pure function.
 *
 * The bug this pins down: with no `job_tracking` row the card fell all the way
 * back to step 0 and told the poster their job was "Offered" while the very
 * same card was asking them to "Approve & release payment". The jobs row knew
 * better the whole time — these cases are the proof it is now read.
 */
import { describe, it, expect } from "vitest";
import { deriveCurrentStatusIdx, trackingProofCaption, STATUS_IDX } from "./JobTracking";

const AT = "2026-08-18T12:00:00.000Z";

describe("deriveCurrentStatusIdx", () => {
  it("floors at Offered when nothing is known", () => {
    expect(deriveCurrentStatusIdx({})).toBe(STATUS_IDX.assigned);
  });

  it("shows Offered for an accepted job with no other evidence", () => {
    expect(deriveCurrentStatusIdx({ jobStatus: "accepted" })).toBe(STATUS_IDX.assigned);
  });

  it("shows Accepted when only the helper has confirmed", () => {
    expect(
      deriveCurrentStatusIdx({ jobStatus: "accepted", helperConfirmedAt: AT }),
    ).toBe(STATUS_IDX.confirmed);
  });

  it("shows Confirmed only once both parties have confirmed", () => {
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "accepted",
        helperConfirmedAt: AT,
        posterConfirmedAt: AT,
      }),
    ).toBe(STATUS_IDX.job_confirmed);
  });

  it("never paints Confirmed off jobs.status — that is a STAMP fact (owner, 2026-09-19)", () => {
    /* THE REPORTED PROD ROW. bb2c3732-476a-4f66-aae6-372cbdfcfdf6:
     * `in_progress` with helper_confirmed_at, poster_confirmed_at AND
     * helper_dayof_confirmed_at all NULL. This function used to floor any
     * `in_progress`/`revision_requested` job at `job_confirmed` on the reasoning
     * that a job cannot be underway without having been confirmed — so the rail
     * painted Confirmed complete, the next-step CTA became "I'm On My Way", and
     * `helper_mark_on_the_way` refused the tap with `helper_not_confirmed`
     * (its one predicate is `v_job.helper_confirmed_at IS NULL` — read live off
     * prod 2026-09-19). A control offered for an action that will be refused:
     * the bad-GPS deadlock's class, one step earlier on the same rail.
     *
     * The floor also SKIPPED THE GATE, which is the sharper half: the
     * helper's-confirmation check lived on the `job_confirmed` branch of the
     * CTA, and a rail already sitting at `job_confirmed` never reached it.
     * `JobTracking.onTheWayGate.test.tsx` holds the rendered half.
     */
    expect(deriveCurrentStatusIdx({ jobStatus: "in_progress" })).toBe(STATUS_IDX.assigned);
    expect(deriveCurrentStatusIdx({ jobStatus: "revision_requested" })).toBe(STATUS_IDX.assigned);
    // One stamp is still only worth its own step, however far the status has run.
    expect(deriveCurrentStatusIdx({ jobStatus: "in_progress", helperConfirmedAt: AT })).toBe(
      STATUS_IDX.confirmed,
    );
    // …and Confirmed still lights the moment the MUTUAL pair is there.
    expect(
      deriveCurrentStatusIdx({ jobStatus: "in_progress", helperConfirmedAt: AT, posterConfirmedAt: AT }),
    ).toBe(STATUS_IDX.job_confirmed);
  });

  it("advances to On the Way from the jobs-row stamp alone", () => {
    expect(
      deriveCurrentStatusIdx({ jobStatus: "in_progress", helperOnTheWayAt: AT }),
    ).toBe(STATUS_IDX.on_the_way);
  });

  it("shows Arrived when arrival is stamped but the job is not in progress yet", () => {
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "accepted",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });

  it("treats an ESTABLISHED arrival + in_progress as Working — there is no separate start stamp", () => {
    // Established = the poster tapped "Confirm They Arrived" (owner,
    // 2026-09-19). GPS alongside it is corroboration, not a second gate.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        helperArrivalVerifiedAt: AT,
        posterConfirmedArrivalAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("stops at Arrived on GPS ALONE — the poster's tap is the gate (supersedes VN-33)", () => {
    /* ── THE HISTORY, KEPT ON PURPOSE ─────────────────────────────────────
     * This case was "stops at Arrived on HALF an arrival — GPS alone, or the
     * poster alone (VN-33)": owner, 2026-09-14, had made it "verified AND
     * confirmed. No fallback", so BOTH halves were required and either one
     * alone stopped the rail at Arrived.
     *
     * OWNER, 2026-09-19 (verbatim): "they can not start working until the
     * poster confirms they are there … if gps is not on, they can mark
     * themselves as arrived but can not move on until the poster marks them
     * arrived … but even if gps does confirm they are there the poster still
     * needs ro cfnrm wither way".
     *
     * That REVERSES one half and one half only. The GPS requirement is gone —
     * it deadlocked jobs (`mark_helper_arrival` refused a fix-less arrival and
     * wrote nothing, so `helper_arrived_at` stayed NULL and the poster's
     * "Confirm They Arrived" control never rendered, while the Helpr's blocked
     * CTA told them to go ask for exactly that tap). The POSTER's requirement
     * is not just kept but widened: it now applies even to a GPS-verified
     * arrival. So the second half of the old assertion (poster alone → Arrived)
     * is deliberately deleted and replaced by the one directly below it, and
     * the first half — GPS alone is still not enough — stays exactly as it was.
     */
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        helperArrivalVerifiedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });

  it("paints Working on the POSTER'S TAP ALONE — no GPS anywhere on the row", () => {
    // The owner's reversal, stated as its own case: a Helpr whose phone never
    // produced a fix is unblocked by the human attestation and nothing else.
    // `helper_arrival_verified_at` and the near-miss columns are absent, which
    // is exactly the state a Location-off check-in leaves behind.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        posterConfirmedArrivalAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
    // …and a near miss (>500ft, wrong map pin) is the same story: evidence on
    // the row changes nothing, the tap does everything.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        helperArrivalNearMissAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        helperArrivalNearMissAt: AT,
        posterConfirmedArrivalAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("stops a CLAIMED-only arrival at Arrived — the rail must not lead the evidence", () => {
    // The reported bug. `mark_helper_arrival` flips the job to in_progress in
    // the same statement that decides whether the arrival was verified, so
    // `helperArrivedAt && in_progress` was satisfied by the claim itself and
    // the inference read its own side effect back as corroboration — painting
    // Working for a helper 1792 miles from the job.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });

  it("shows Done for a job awaiting payment release (the reported bug)", () => {
    // Exactly the failing state: in_progress, helper finished, poster is being
    // asked to approve, and there is no job_tracking row at all.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: undefined,
        jobStatus: "in_progress",
        helperConfirmedAt: AT,
        posterConfirmedAt: AT,
        helperCompletedAt: AT,
      }),
    ).toBe(STATUS_IDX.done);
  });

  it("shows Done once the poster has released payment", () => {
    expect(deriveCurrentStatusIdx({ jobStatus: "completed" })).toBe(STATUS_IDX.done);
    expect(deriveCurrentStatusIdx({ posterCompletedAt: AT })).toBe(STATUS_IDX.done);
  });

  it("keeps Arrived reachable — a live tracking row beats the working inference", () => {
    // Tapping "Arrived" also flips the job to in_progress. If the inference
    // applied here too, the Arrived step could never be shown at all.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: "arrived",
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });

  it("never regresses below what the jobs row proves", () => {
    // Stale tracking row still parked on "assigned" while the job row shows
    // the helper has arrived — the job row wins. It stops at Arrived rather
    // than Working: arrival is stamped fact, Working would only be a guess,
    // and a guess does not get to override the helper's own tracking row.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: "assigned",
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });

  it("lets a live tracking row lead when it is ahead of the jobs row", () => {
    // The helper has tapped "Working" but the jobs row has no arrival stamp.
    expect(
      deriveCurrentStatusIdx({ trackingStatus: "working", jobStatus: "in_progress" }),
    ).toBe(STATUS_IDX.working);
  });

  it("ignores an unrecognised tracking status instead of blanking the tracker", () => {
    // findIndex would hand back -1, which used to paint zero active steps.
    expect(
      deriveCurrentStatusIdx({ trackingStatus: "who_knows", jobStatus: "accepted" }),
    ).toBe(STATUS_IDX.assigned);
    expect(deriveCurrentStatusIdx({ trackingStatus: "who_knows" })).toBe(0);
  });

  it("keeps a disputed job at the furthest milestone its stamps evidence", () => {
    // The clamp below is a CEILING, not a floor — a dispute raised before the
    // work does not drag the rail forward to Working.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "disputed",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });
});


describe("a revision or a dispute undoes Done", () => {
  it("caps a revision-requested job at Working even with a completion stamp", () => {
    // `helper_completed_at` survives the poster sending the work back, so
    // without the cap the tracker showed a fully-green Done beside a card
    // reading "Revision requested" and a row offering Approve or Dispute.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "revision_requested",
        helperCompletedAt: "2026-08-01T00:00:00Z",
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("caps a DISPUTED job at Working even with a completion stamp", () => {
    // The reported bug. Owner: "Can't be marked done if it's in revision is
    // dispute." Their screenshot: Confirmed / On the Way / Arrived all green,
    // Working red, DONE GREEN — directly above "Escalated to Admin … nothing
    // is charged or released until then". Done on this rail is the completion
    // that releases the money; while an admin is still deciding whether that
    // completion stands, the rail must not spend a green on it.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "disputed",
        helperConfirmedAt: AT,
        posterConfirmedAt: AT,
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
        helperArrivalVerifiedAt: AT,
        helperCompletedAt: "2026-08-01T00:00:00Z",
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("refuses a STALE `done` in job_tracking on a disputed job", () => {
    // Persisted state must never lead reality (the standing rule in this
    // file). The helper really did tap Done before the poster disputed, so the
    // tracking row legitimately reads `done` and is NOT rewritten — the clamp
    // is a render-time refusal, and this is the case that proves the tracking
    // row cannot walk around it via `Math.max(trackingIdx, jobIdx)`.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: "done",
        jobStatus: "disputed",
        helperCompletedAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
    // Same guarantee on the revision path.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: "done",
        jobStatus: "revision_requested",
        helperCompletedAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("caps at Working even when the POSTER's completion stamp is the evidence", () => {
    // `posterCompletedAt` is the other route to `done`. A dispute opened from
    // `completed` (the state machine allows it — 20260825190000) carries it.
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "disputed",
        helperCompletedAt: AT,
        posterCompletedAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
  });

  it("still reaches Done once the job actually completes", () => {
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "completed",
        helperCompletedAt: "2026-08-01T00:00:00Z",
      }),
    ).toBe(STATUS_IDX.done);
    // The happy path with a live tracking row on it, too — the clamps must not
    // touch anything but the two unresolved states.
    expect(
      deriveCurrentStatusIdx({
        trackingStatus: "done",
        jobStatus: "completed",
        helperCompletedAt: AT,
        posterCompletedAt: AT,
      }),
    ).toBe(STATUS_IDX.done);
  });
});

/**
 * The caption under the step rail, which the owner screenshotted reading
 * "GPS confirmed · 1792 mi from job" directly beneath a toast saying we could
 * NOT confirm the arrival. Both are now derived from one `arrivalState()`, so
 * these cases are the proof they cannot disagree again.
 */
describe("trackingProofCaption", () => {
  it("never says confirmed for a bare CLAIM, however good the fix is", () => {
    const far = trackingProofCaption("claimed", 1792, true);
    expect(far.text).toBe("Arrival not confirmed · 1792 mi from job");
    // The exact strings the old caption used, none of which may survive here.
    expect(far.text).not.toMatch(/GPS confirmed|Poster confirmed|confirmed by the person who posted/);
    expect(far.tone).toBe("warn");

    // Even standing on the job site, a claim nothing corroborates is a claim.
    // The "at the job" clause itself is gone (owner, 2026-09-16: "remove the
    // at the job text") — a ping inside the radius says nothing about where,
    // and drops the separator with it rather than leaving a dangling "·".
    expect(trackingProofCaption("claimed", 0.02, true)).toEqual({
      text: "Arrival not confirmed",
      tone: "warn",
    });
  });

  it("spends the word 'confirmed' only on the poster's vouch", () => {
    expect(trackingProofCaption("confirmed", 1792, true)).toEqual({
      text: "Arrival confirmed by the person who posted it · last ping 1792 mi from job",
      tone: "ok",
    });
  });

  it("calls a server-verified arrival verified, and reports the ping separately", () => {
    // Verified is a statement about the moment of arrival — stepping away
    // mid-job is normal, so the distance is reported, not held against them.
    expect(trackingProofCaption("verified", 0.05, true)).toEqual({
      text: "Arrival GPS-verified",
      tone: "ok",
    });
    expect(trackingProofCaption("verified", 12, true).text).toBe(
      "Arrival GPS-verified · last ping 12 mi from job",
    );
  });

  it("states a position with no arrival claim as a position, not as proof", () => {
    expect(trackingProofCaption("none", 12, true)).toEqual({
      text: "Location shared · 12 mi from job",
      tone: "muted",
    });
  });

  it("states the ABSENCE of a fix rather than leaving it blank", () => {
    expect(trackingProofCaption("claimed", null, false)).toEqual({
      text: "Arrival not confirmed · no location shared",
      tone: "warn",
    });
    expect(trackingProofCaption("confirmed", null, false).tone).toBe("ok");
    expect(trackingProofCaption("none", null, false)).toEqual({
      text: "Location not shared",
      tone: "muted",
    });
  });

  it("drops the distance clause when there is nothing to measure against", () => {
    // The job never geocoded — a fix with no reference point proves nothing
    // about proximity, so no distance is invented.
    expect(trackingProofCaption("verified", null, true).text).toBe("Arrival GPS-verified");
    expect(trackingProofCaption("claimed", null, true).text).toBe("Arrival not confirmed");
  });

  it("renders sub-10-mile distances to one decimal, above that to whole miles", () => {
    expect(trackingProofCaption("none", 1.25, true).text).toBe("Location shared · 1.3 mi from job");
    expect(trackingProofCaption("none", 1792.4, true).text).toBe("Location shared · 1792 mi from job");
  });
});
