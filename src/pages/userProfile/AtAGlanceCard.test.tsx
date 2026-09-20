/**
 * THE TILE SET AND ITS ORDER, asserted exactly.
 *
 * TODAY (owner, 2026-09-19): Rating · Jobs completed · Jobs posted · Worked
 * together. FOUR tiles, ALWAYS — zeros included, on a stranger's view and on
 * your own preview alike ("this should display 4 boxes always. even if it has
 * zero data yet bc rn it looks empty"). Two assertions in this file used to
 * say the opposite (a hidden Worked-together tile, an odd-count span); both
 * are replaced below with a note naming what changed and why.
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
type Over = {
  isOwnProfile?: boolean;
  mutualJobsCount?: number;
  postedJobsCount?: number;
  workedJobsCount?: number;
  stats?: { completedJobs: number; avgRating: number; reviewCount: number };
};
function renderCard(over: Over = {}) {
  return render(
    <AtAGlanceCard
      isOwnProfile={over.isOwnProfile ?? false}
      displayName="Hallie H."
      memberSinceLabel="Aug 2026"
      stats={over.stats ?? { completedJobs: 16, avgRating: 5, reviewCount: 1 }}
      postedJobsCount={over.postedJobsCount ?? 4}
      workedJobsCount={over.workedJobsCount ?? 16}
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

  /**
   * REPLACES "hides the Worked together tile at 0 and on your own profile"
   * (2026-09-19). That assertion is now the DEFECT, not the contract: owner,
   * "this should display 4 boxes always. even if it has zero data yet bc rn it
   * looks empty", and, in the pop-up choosing what the fourth tile says at
   * zero, that 0 is what almost everyone sees — anyone who has not hired you
   * yet — so it is the honest default and needs no preview-only wording.
   *
   * The own-profile case is the same assertion inverted for the same reason:
   * /user/<your own id> exists to show what a STRANGER sees, so a tile that
   * disappears because you are looking at yourself is a lie about the page.
   * `mutualJobsCount` is already 0 by construction there (`wantsMutual` in
   * useUserProfileData.ts), so the honest answer renders with no branch.
   */
  it("shows Worked together at 0, and on your own profile", () => {
    const { unmount } = renderCard({ mutualJobsCount: 0 });
    expect(tileLabels()).toEqual([
      "1 review",
      "Jobs completed",
      "Jobs posted",
      "Worked together",
    ]);
    unmount();
    renderCard({ isOwnProfile: true, mutualJobsCount: 0 });
    expect(tileLabels()).toContain("Worked together");
  });

  /**
   * THE OWNER'S ACTUAL SCREENSHOT, as a test: a member with a zero somewhere
   * still gets four boxes, never three and a dead column. Every count zeroed
   * is the hardest version of it — a brand-new account.
   */
  it("renders FOUR tiles with every count at zero — no empty scaffold", () => {
    renderCard({ stats: { completedJobs: 0, avgRating: 0, reviewCount: 0 }, postedJobsCount: 0, workedJobsCount: 0, mutualJobsCount: 0 });
    expect(tileLabels()).toEqual([
      "No reviews yet",
      "Jobs completed",
      "Jobs posted",
      "Worked together",
    ]);
    // The zeros are printed, not withheld.
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(screen.getByText("New")).toBeInTheDocument();
    // And no separate new-member panel replaces the grid (that fallback is
    // deleted — with four cells always emitted it was unreachable).
    expect(screen.queryByText(/New to Helpr|You're new here/)).toBeNull();
  });

  /**
   * A zero tile expands nothing, so it must not be a control — the rule
   * MetricCell has carried since the old grid left zero-count tiles in the tab
   * order doing nothing. Only the tiles with a panel behind them are buttons.
   */
  it("zero tiles are not buttons; populated ones are", () => {
    const { unmount } = renderCard({ stats: { completedJobs: 0, avgRating: 0, reviewCount: 0 }, postedJobsCount: 0, workedJobsCount: 0, mutualJobsCount: 0 });
    const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
    expect(Array.from(grid.children).map((el) => el.tagName)).toEqual(["DIV", "DIV", "DIV", "DIV"]);
    unmount();
    renderCard();                       // rating 1 review, worked 16, posted 4, together 3
    const grid2 = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
    expect(Array.from(grid2.children).map((el) => el.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "DIV"]);
  });

  /**
   * REPLACES "an ODD count spans its last tile…" (2026-09-19). `cells` is a
   * fixed four-element array now, so no odd count is reachable and the
   * `col-span-2` rule it asserted was deleted as an unreachable branch. The
   * assertion that replaces it is the reason the rule is safe to delete:
   * the count is ALWAYS four, whatever the data.
   */
  it("is always four tiles, two-up on a phone and one row of four from sm", () => {
    for (const over of [
      {},
      { mutualJobsCount: 0 },
      { postedJobsCount: 0, workedJobsCount: 0 },
      { stats: { completedJobs: 0, avgRating: 0, reviewCount: 0 }, postedJobsCount: 0, workedJobsCount: 0, mutualJobsCount: 0 },
    ]) {
      const { unmount } = renderCard(over);
      const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
      expect(grid.children).toHaveLength(4);
      expect(grid.className).toContain("grid-cols-2");
      expect(grid.className).toContain("sm:grid-cols-4");
      // `auto-rows-fr` is load-bearing: equal tile heights two-up at 375,
      // pinned by e2e/journeys/stat-tile-heights.spec.ts.
      expect(grid.className).toContain("auto-rows-fr");
      // Nothing spans: an even, fixed count strands nothing.
      for (const el of Array.from(grid.children)) expect(el.className).not.toContain("col-span-2");
      // No five-column track survives — a five-tile row is unreachable.
      expect(grid.className).not.toContain("grid-cols-5");
      unmount();
    }
  });
});
