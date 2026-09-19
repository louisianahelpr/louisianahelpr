/**
 * VN-16 (owner, 2026-09-14): "you've worked together however many times can be
 * a 5th box next to review, jobs posted, completed etc. order in most important
 * to least".
 *
 * Before: the card was capped at four tiles (Rating · Jobs posted · Jobs
 * completed · Cancelled) and "worked together" was a line in the header.
 *
 * ORDER CHANGED 2026-09-19 (owner, verbatim): "the correct order for the
 * profile should be review, jobs completed, jobs posted, worked together,
 * cancelled."
 *
 * The order this test asserted until then, and which it must NOT drift back
 * to: Rating · Worked together · Jobs completed · Jobs posted · Cancelled.
 * "Worked together" moved 2nd → 4th; nothing else moved.
 *
 * Asserting the exact sequence IS this test's job — it is the guard that
 * catches the next accidental reshuffle — so it is never weakened to a
 * set-membership check.
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
      cancellationRate={{ total: 20, cancelled: 11, rate: 55 }}
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

describe("AtAGlanceCard — five tiles, most to least important (VN-16)", () => {
  it("orders Rating · Jobs completed · Jobs posted · Worked together · Cancelled", () => {
    renderCard();
    expect(tileLabels()).toEqual([
      "1 review",
      "Jobs completed",
      "Jobs posted",
      "Worked together",
      "Cancelled · 11 of 20 jobs",
    ]);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("hides the Worked together tile at 0 and on your own profile", () => {
    const { unmount } = renderCard({ mutualJobsCount: 0 });
    expect(tileLabels()).not.toContain("Worked together");
    expect(tileLabels()).toHaveLength(4);
    unmount();
    renderCard({ isOwnProfile: true, mutualJobsCount: 3 });
    expect(tileLabels()).not.toContain("Worked together");
  });

  it("five tiles wrap two-up on a phone with the fifth spanning the last row, one row from md", () => {
    renderCard();
    const grid = screen.getByRole("region", { name: "At a glance" }).querySelector(".grid")!;
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("md:grid-cols-5");
    const last = grid.lastElementChild!;
    expect(last.className).toContain("col-span-2");
    expect(last.className).toContain("md:col-span-1");
  });
});
