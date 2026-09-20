/**
 * THE TILE SET AND ITS ORDER, asserted exactly.
 *
 * TODAY (owner, 2026-09-19): Rating · Jobs completed · Jobs posted · Worked
 * together. FOUR tiles.
 *
 * ── WHAT WAS REMOVED, AND WHY, so nobody re-adds it ────────────────────────
 *
 * **Cancelled** ("50% · Cancelled · 35 of 70 jobs") was DELETED on 2026-09-19
 * by the owner — not relabelled, not recomputed. Reconciled against prod, 32
 * of those 35 cancellations were made BY THE POSTER and every one was counted
 * against the HELPER whose profile printed the 50%. That is the same defect
 * "accept rate" was deleted for and which AtAGlanceCard's own comment already
 * records: "a tally of other people's decisions rendered as a property of this
 * person."
 *
 * It also made the row unreconcilable with itself — `Jobs completed` counted
 * helper-side only, `Jobs posted` poster-side and every status, `Cancelled`
 * BOTH sides and every status — so "35 of 70" shared a denominator with
 * nothing beside it.
 *
 * A corrected cancelled-by-this-person rate would be a NEW metric with a new
 * definition and needs the owner's sign-off. Restoring this one does not.
 *
 * ── EARLIER STATES, kept so the history reads ──────────────────────────────
 *
 * VN-16 (owner, 2026-09-14): "you've worked together however many times can be
 * a 5th box next to review, jobs posted, completed etc. order in most
 * important to least" — before that the card was four tiles (Rating · Jobs
 * posted · Jobs completed · Cancelled) and "worked together" was a header line.
 *
 * ORDER CHANGED 2026-09-19 (owner, verbatim): "the correct order for the
 * profile should be review, jobs completed, jobs posted, worked together,
 * cancelled." The order it asserted until then, and must NOT drift back to:
 * Rating · Worked together · Jobs completed · Jobs posted · Cancelled.
 *
 * Asserting the EXACT sequence IS this test's job — it is the guard that
 * catches the next accidental reshuffle, and the guard that catches Cancelled
 * coming back — so it is never weakened to a set-membership check.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AtAGlanceCard } from "./AtAGlanceCard";

const noop = () => {};
function renderCard(over: { isOwnProfile?: boolean; mutualJobsCount?: number } = {}) {
  return render(
    <AtAGlanceCard
      isOwnProfile={over.isOwnProfile ?? false}
      displayName="Hallie H."
      memberSinceLabel="Aug 2026"
      stats={{ completedJobs: 16, avgRating: 5, reviewCount: 1 }}
      postedJobsCount={4}
      workedJobsCount={16}
      replyLatency={{ medianReplyMinutes: null, replySample: 0, measured: false }}
      onTimeArrivalRate={null}
      revisionFrequency={null}
      repeatHirePercent={null}
      mutualJobsCount={over.mutualJobsCount ?? 3}
      showReviews={false}
      showPostedJobs={false}
      showWorkedJobs={false}
      onToggleReviews={noop}
      onTogglePosted={noop}
      onToggleWorked={noop}
    />,
  );
}

const tileLabels = () => {
  const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
  return Array.from(grid.children).map((el) => el.lastElementChild?.textContent ?? "");
};

describe("AtAGlanceCard — four tiles, most to least important", () => {
  it("orders Rating · Jobs completed · Jobs posted · Worked together", () => {
    renderCard();
    expect(tileLabels()).toEqual([
      "1 review",
      "Jobs completed",
      "Jobs posted",
      "Worked together",
    ]);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  /**
   * The removal, asserted as a NEGATIVE so it cannot creep back in behind a
   * passing order check. Props that would have produced a 50% tile at its
   * loudest (11 of 20, over the 30% alarm threshold) are fed in above and
   * nothing renders: no percentage, no "Cancelled", no XCircle tile.
   */
  it("never renders a Cancelled tile, for a visitor or for you", () => {
    const { unmount } = renderCard();
    expect(tileLabels().some((l) => /cancel/i.test(l))).toBe(false);
    expect(screen.queryByText(/%$/)).toBeNull();
    unmount();
    renderCard({ isOwnProfile: true });
    expect(tileLabels().some((l) => /cancel/i.test(l))).toBe(false);
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it("hides the Worked together tile at 0 and on your own profile", () => {
    const { unmount } = renderCard({ mutualJobsCount: 0 });
    expect(tileLabels()).not.toContain("Worked together");
    expect(tileLabels()).toHaveLength(3);
    unmount();
    renderCard({ isOwnProfile: true, mutualJobsCount: 3 });
    expect(tileLabels()).not.toContain("Worked together");
  });

  it("four tiles wrap two-up on a phone, one row of four from sm", () => {
    renderCard();
    const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("sm:grid-cols-4");
    // Even count: nothing spans, because nothing is stranded.
    expect(grid.lastElementChild!.className).not.toContain("col-span-2");
    // No five-column track survives — a five-tile row is unreachable now.
    expect(grid.className).not.toContain("grid-cols-5");
  });

  it("an ODD count spans its last tile so no tile is stranded half-width", () => {
    renderCard({ mutualJobsCount: 0 });      // rating + completed + posted = 3
    const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
    expect(grid.children).toHaveLength(3);
    const last = grid.lastElementChild!;
    expect(last.className).toContain("col-span-2");
    expect(last.className).toContain("sm:col-span-1");
  });
});
