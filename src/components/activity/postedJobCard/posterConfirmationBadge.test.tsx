import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PosterConfirmationBadge } from "./PosterConfirmationBadge";
import type { Job } from "../activityConstants";

/**
 * THE COLLAPSED CARD'S SIGNAL (owner decision, 2026-09-19).
 *
 * The confirmation controls stay inside the EXPANDED card; a collapsed one has
 * to say that one is waiting. Every action block on PostedJobCard is behind the
 * expand, so a poster scrolling their list had no way to learn a decision was
 * theirs — the likeliest reason the owner saw "no button" at all.
 *
 * The RULE is checked against the whole state matrix in
 * `steps/posterConfirmationLadder.test.ts` (`posterOwesConfirmation`); what
 * this file pins is that the badge is silent unless the rule says so, and that
 * it names the same action the box inside will.
 */

const T = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const job = (over: Record<string, unknown>): Job =>
  ({
    id: "job-1",
    status: "in_progress",
    helper_confirmed_at: T(48),
    helper_on_the_way_at: T(3),
    helper_arrived_at: null,
    poster_confirmed_arrival_at: null,
    poster_confirmed_working_at: null,
    helper_completed_at: null,
    ...over,
  }) as unknown as Job;

describe("the collapsed posted card's confirmation signal", () => {
  it("shows, naming the action, when the poster can confirm right now", () => {
    const { container } = render(<PosterConfirmationBadge job={job({ helper_arrived_at: T(1) })} />);
    expect(container.querySelector("[data-poster-owes-confirmation]")).not.toBeNull();
    expect(container.textContent).toContain("Confirm They Arrived");
  });

  it("stays silent while the box inside is merely disabled", () => {
    // The Helpr's location check has not gone through: the expanded card shows
    // the box with its reason, but nothing is owed, so the collapsed card must
    // not cry wolf.
    const { container } = render(<PosterConfirmationBadge job={job({})} />);
    expect(container.innerHTML).toBe("");
  });

  it("stays silent once both vouches are in", () => {
    const { container } = render(
      <PosterConfirmationBadge job={job({ poster_confirmed_arrival_at: T(2), poster_confirmed_working_at: T(1) })} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("stays silent on a state with no ladder at all", () => {
    const { container } = render(<PosterConfirmationBadge job={job({ status: "open" })} />);
    expect(container.innerHTML).toBe("");
  });

  it("is not a control — the card's own expand gesture is what the poster taps", () => {
    const { container } = render(<PosterConfirmationBadge job={job({ helper_arrived_at: T(1) })} />);
    expect(container.querySelectorAll("button, a[href]").length).toBe(0);
  });
});
