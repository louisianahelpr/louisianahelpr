import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { JobStatusStrip } from "../../../components/job-card/JobStatusStrip";
import { posterStatusLine } from "../../../components/job-card/jobStatusLine";
import type { Job } from "../../../components/job-card/activityConstants";

/**
 * THE COLLAPSED CARD'S SIGNAL THAT A CONFIRMATION IS OWED (owner, 2026-09-19).
 *
 * The confirmation controls stay inside the EXPANDED card; a collapsed one has
 * to say that one is waiting. Every action block on PostedJobCard is behind the
 * expand, so a poster scrolling their list had no way to learn a decision was
 * theirs — the likeliest reason the owner saw "no button" at all.
 *
 * ── WHAT CHANGED, AND WHY THE CLAIM DID NOT ───────────────────────────────
 * This used to render `PosterConfirmationBadge`, a bark-green band that existed
 * for this one state. Later the same day the owner asked for a line on EVERY
 * collapsed card saying what it is waiting on, "similar to how dispute open
 * displays" — so that badge and the sienna dispute badge were folded into one
 * `JobStatusStrip`, and "you owe a confirmation" became one of its values.
 *
 * The assertions are therefore about the same fact against the component that
 * actually renders it: the strip carries `data-poster-owes-confirmation` when,
 * and only when, `posterConfirmationRung` says the poster can confirm RIGHT
 * NOW — never for a box that is merely disabled or already taken. The strip
 * itself is always present now (that is the new rule), so "silent" means the
 * ATTRIBUTE is absent and the sentence is about something else.
 *
 * The RULE is checked against the whole state matrix in
 * `steps/posterConfirmationLadder.test.ts` (`posterOwesConfirmation`), and the
 * whole sentence inventory in `src/test/collapsedStatusSentence.test.tsx`.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | owesConfirmation: id === "confirm_arrival" \|\| id === "confirm_working", | owesConfirmation: true,
 * @mutate src/components/job-card/jobStatusLine.ts | if (rung?.enabled) return rung.action === "working" ? "confirm_working" : "confirm_arrival"; | if (rung) return rung.action === "working" ? "confirm_working" : "confirm_arrival";
 */

const T = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const job = (over: Record<string, unknown>): Job =>
  ({
    id: "job-1",
    status: "in_progress",
    date_needed: "2999-01-01",
    helper_id: "helper-1",
    helper_confirmed_at: T(48),
    helper_on_the_way_at: T(3),
    helper_arrived_at: null,
    poster_confirmed_arrival_at: null,
    poster_confirmed_working_at: null,
    helper_completed_at: null,
    ...over,
  }) as unknown as Job;

const renderFor = (j: Job) => render(<JobStatusStrip line={posterStatusLine(j)} />);

describe("the collapsed posted card's confirmation signal", () => {
  it("flags it, naming the action, when the poster can confirm right now", () => {
    const { container } = renderFor(job({ helper_arrived_at: T(1) }));
    expect(container.querySelector("[data-poster-owes-confirmation]")).not.toBeNull();
    // The words the box inside will wear, so the collapsed card and the
    // expanded one name the same action rather than describing it twice.
    expect(container.textContent).toContain("Confirm they arrived");
    expect(container.textContent, "it does not say whose move it is").toContain("Needs You");
  });

  it("flags the SECOND rung too, once the first is taken", () => {
    const { container } = renderFor(
      job({ helper_arrived_at: T(2), poster_confirmed_arrival_at: T(1) }),
    );
    expect(container.querySelector("[data-poster-owes-confirmation]")).not.toBeNull();
    expect(container.textContent).toContain("Confirm they're working");
  });

  it("stays silent while the box inside is merely DISABLED", () => {
    // The Helpr has not marked themselves arrived yet: the expanded card shows
    // the box with its reason, but nothing is owed, so the collapsed card must
    // not cry wolf. It still says what IS happening.
    const { container } = renderFor(job({}));
    expect(container.querySelector("[data-poster-owes-confirmation]")).toBeNull();
    expect(container.textContent).toContain("Your Helpr is on the way");
    expect(container.textContent, "it claims the poster's move anyway").not.toContain("Needs You");
  });

  it("stays silent once both vouches are in", () => {
    const { container } = renderFor(
      job({ helper_arrived_at: T(3), poster_confirmed_arrival_at: T(2), poster_confirmed_working_at: T(1) }),
    );
    expect(container.querySelector("[data-poster-owes-confirmation]")).toBeNull();
    expect(container.textContent).toContain("Work is underway");
  });

  it("stays silent on a state with no ladder at all", () => {
    const { container } = renderFor(job({ status: "open", helper_id: null, payment_status: "escrow" }));
    expect(container.querySelector("[data-poster-owes-confirmation]")).toBeNull();
  });

  it("is not a control — the card's own expand gesture is what the poster taps", () => {
    const { container } = renderFor(job({ helper_arrived_at: T(1) }));
    expect(container.querySelectorAll("button, a[href]").length).toBe(0);
  });
});
