/**
 * DisputeLink visibility: drives the predicate through every branch
 * (completed = never, revision window, already filed, not completed) for both
 * customer and helper sides. The `<DisputeLink>` component and its render
 * tests were deleted with Q904 (it was rendered nowhere in app source).
 */
import { describe, it, expect } from "vitest";

import {
  shouldShowDisputeLink,
  type DisputeLinkJob,
} from "./DisputeLink";

const NOW = new Date("2026-05-20T12:00:00Z");
const HOURS = (n: number) => n * 60 * 60 * 1000;
const DAYS = (n: number) => n * 24 * HOURS(1);

function makeJob(overrides: Partial<DisputeLinkJob> = {}): DisputeLinkJob {
  return {
    status: "completed",
    poster_completed_at: new Date(NOW.getTime() - DAYS(1)).toISOString(),
    helper_completed_at: null,
    disputed_at: null,
    revision_requested_at: null,
    ...overrides,
  };
}

describe("shouldShowDisputeLink", () => {
  // Owner rule, 2026-09-14 (VN-28): "they can't report a job once it's done".
  // The issue-#113 7-day post-completion window is gone — a completed job
  // offers no dispute on either side, however recently it finished. These
  // two cases were `toBe(true)` before the rule; they fail on the old code.
  it("hides for the customer on a job completed an hour ago (no post-completion window)", () => {
    const job = makeJob({ poster_completed_at: new Date(NOW.getTime() - HOURS(1)).toISOString() });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
  });

  it("hides for the helper on a job completed an hour ago (no post-completion window)", () => {
    const job = makeJob({ poster_completed_at: new Date(NOW.getTime() - HOURS(1)).toISOString() });
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides on a completed job eight days out as well", () => {
    const job = makeJob({
      poster_completed_at: new Date(NOW.getTime() - DAYS(8)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides when a dispute has already been filed (disputed_at set)", () => {
    const job = makeJob({ disputed_at: new Date(NOW.getTime() - HOURS(1)).toISOString() });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides when status is 'disputed' (defensive against stale data)", () => {
    const job = makeJob({ status: "disputed" });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides when the job is not yet completed", () => {
    const job = makeJob({ status: "in_progress", poster_completed_at: null });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("is HIDDEN for the customer while the revision window is still open", () => {
    // Escalation happens in order (owner: "I don't want a dispute to be
    // [available] until revision is requested" and "once the time is up for
    // that then move to dispute"). Offering both at once put "open a dispute"
    // in front of a poster whose helpr was still actively fixing the thing.
    const job = makeJob({
      status: "revision_requested",
      poster_completed_at: null,
      revision_requested_at: new Date(NOW.getTime() - HOURS(2)).toISOString(),
      revision_deadline: new Date(NOW.getTime() + HOURS(22)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
  });

  it("shows for the customer once the revision window has run out", () => {
    const job = makeJob({
      status: "revision_requested",
      poster_completed_at: null,
      revision_requested_at: new Date(NOW.getTime() - HOURS(48)).toISOString(),
      revision_deadline: new Date(NOW.getTime() - HOURS(1)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(true);
  });

  it("stays hidden when no revision deadline was ever stamped", () => {
    // No clock to wait on means the window is treated as OPEN, not expired —
    // an unstamped row must not unlock a dispute the helpr never had a chance
    // to pre-empt.
    const job = makeJob({
      status: "revision_requested",
      poster_completed_at: null,
      revision_requested_at: new Date(NOW.getTime() - HOURS(48)).toISOString(),
      revision_deadline: null,
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
  });

  it("does NOT show for the helper while a revision is pending (helper has its own path)", () => {
    const job = makeJob({
      status: "revision_requested",
      poster_completed_at: null,
      revision_requested_at: new Date(NOW.getTime() - HOURS(2)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides on an auto-released completed job too (poster never tapped approve)", () => {
    const job = makeJob({
      poster_completed_at: null,
      helper_completed_at: new Date(NOW.getTime() - DAYS(2)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });

  it("hides when status is 'completed' but no completion timestamp exists", () => {
    // Should never happen in production, but the predicate must be safe.
    const job = makeJob({ poster_completed_at: null, helper_completed_at: null });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });
});

// Escalation is ordered: the dispute unlocks only once the helpr's revision
// window has actually run out. Flipping the comparison both hides it from the
// poster who has waited and offers it to the one whose helpr is still working.
// @mutate src/components/jobs/DisputeLink.tsx | return new Date(job.revision_deadline).getTime() <= now.getTime(); | return new Date(job.revision_deadline).getTime() >= now.getTime();
