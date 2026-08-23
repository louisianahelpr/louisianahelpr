/**
 * The tracker's step derivation, exercised as a pure function.
 *
 * The bug this pins down: with no `job_tracking` row the card fell all the way
 * back to step 0 and told the poster their job was "Offered" while the very
 * same card was asking them to "Approve & release payment". The jobs row knew
 * better the whole time — these cases are the proof it is now read.
 */
import { describe, it, expect } from "vitest";
import { deriveCurrentStatusIdx, STATUS_IDX } from "./JobTracking";

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

  it("treats arrived + in_progress as Working — there is no separate start stamp", () => {
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "in_progress",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.working);
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
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "disputed",
        helperOnTheWayAt: AT,
        helperArrivedAt: AT,
      }),
    ).toBe(STATUS_IDX.arrived);
  });
});


describe("a revision undoes Done", () => {
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

  it("still reaches Done once the job actually completes", () => {
    expect(
      deriveCurrentStatusIdx({
        jobStatus: "completed",
        helperCompletedAt: "2026-08-01T00:00:00Z",
      }),
    ).toBe(STATUS_IDX.done);
  });
});
