/**
 * DisputeLink visibility — drives the predicate through every branch
 * (in-window / out-of-window / already filed / not completed) for both
 * customer and helper sides, plus a smoke render to confirm the click
 * handler fires when the link is visible.
 *
 * Notes:
 *   - We exercise the predicate directly (`shouldShowDisputeLink`) so
 *     the rules are tested without rendering noise, then render once
 *     end-to-end to confirm the JSX wires the same predicate and the
 *     click handler actually fires.
 *   - Haptics calls Capacitor under the hood — stub it so jsdom
 *     doesn't try to load native bindings.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn().mockResolvedValue(undefined),
    notification: vi.fn().mockResolvedValue(undefined),
  },
  ImpactStyle: { Light: "Light", Medium: "Medium", Heavy: "Heavy" },
  NotificationType: { Success: "Success", Warning: "Warning", Error: "Error" },
}));

import {
  DisputeLink,
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
  it("shows for the customer within the 7-day window", () => {
    expect(shouldShowDisputeLink(makeJob(), "customer", NOW)).toBe(true);
  });

  it("shows for the helper within the 7-day window", () => {
    expect(shouldShowDisputeLink(makeJob(), "helper", NOW)).toBe(true);
  });

  it("hides once the 7-day window has closed", () => {
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

  it("falls back to helper_completed_at when poster_completed_at is missing", () => {
    // Edge case: auto-release path where poster never tapped "approve".
    const job = makeJob({
      poster_completed_at: null,
      helper_completed_at: new Date(NOW.getTime() - DAYS(2)).toISOString(),
    });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(true);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(true);
  });

  it("hides when status is 'completed' but no completion timestamp exists", () => {
    // Should never happen in production, but the predicate must be safe.
    const job = makeJob({ poster_completed_at: null, helper_completed_at: null });
    expect(shouldShowDisputeLink(job, "customer", NOW)).toBe(false);
    expect(shouldShowDisputeLink(job, "helper", NOW)).toBe(false);
  });
});

describe("<DisputeLink />", () => {
  it("renders the muted link and fires onOpenDispute on click", () => {
    const onOpenDispute = vi.fn();
    render(
      <DisputeLink
        job={makeJob()}
        side="customer"
        onOpenDispute={onOpenDispute}
        now={NOW}
      />,
    );
    const button = screen.getByRole("button", { name: /open a dispute about this job/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenDispute).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when visibility rules don't hold", () => {
    const { container } = render(
      <DisputeLink
        job={makeJob({ disputed_at: new Date().toISOString() })}
        side="customer"
        onOpenDispute={vi.fn()}
        now={NOW}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
