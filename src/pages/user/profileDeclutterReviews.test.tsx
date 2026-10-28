/**
 * #61 / #28 (Declutter deep audit, 2026-10-28): a member's Declutter reviews
 * show on their profile (builder 2's DeclutterProfileSection, mounted right
 * under SellingNowRow), and the hero's rating tile, which counts job reviews
 * only, no longer says "No reviews yet" over a profile that has Declutter
 * reviews: it says "No job reviews yet".
 *
 * @mutate src/pages/user/AtAGlanceCard.tsx | label: declutterReviewCount > 0 ? "No job reviews yet" : "No reviews yet" | label: "No reviews yet"
 * @mutate src/pages/user/UserProfile.tsx |           <DeclutterProfileSection userId={userId!} />\n |
 * @mutate src/pages/user/UserProfile.tsx |                 declutterReviewCount={declutterReviewCount} |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { AtAGlanceCard } from "./AtAGlanceCard";
import { blankComments } from "@/test/helpers/blankNonCode";

const noop = () => {};
function renderTile(declutterReviewCount: number | undefined, reviewCount = 0) {
  return render(
    <AtAGlanceCard
      isOwnProfile={false}
      displayName="Sam S."
      memberSinceLabel="Aug 2026"
      stats={{ completedJobs: 0, avgRating: reviewCount ? 5 : 0, reviewCount }}
      postedJobsCount={0}
      workedJobsCount={0}
      replyLatency={{ medianReplyMinutes: null, replySample: 0, measured: false }}
      onTimeArrivalRate={null}
      revisionFrequency={null}
      repeatHirePercent={null}
      mutualJobsCount={0}
      declutterReviewCount={declutterReviewCount}
      showReviews={false}
      showPostedJobs={false}
      showWorkedJobs={false}
      onToggleReviews={noop}
      onTogglePosted={noop}
      onToggleWorked={noop}
    />,
  );
}

describe("the profile hero and Declutter reviews (#28)", () => {
  it("no job reviews but Declutter reviews: the tile says 'No job reviews yet', never 'No reviews yet'", () => {
    renderTile(3);
    expect(screen.getByText("No job reviews yet")).toBeInTheDocument();
    expect(screen.queryByText("No reviews yet")).toBeNull();
  });

  it("no reviews anywhere: 'No reviews yet' as before", () => {
    renderTile(0);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
  });

  it("job reviews: the count, whatever Declutter has", () => {
    renderTile(3, 2);
    expect(screen.getByText("2 reviews")).toBeInTheDocument();
  });

  it("UserProfile mounts the Declutter section right under SellingNowRow and feeds the tile its count", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/user/UserProfile.tsx"), "utf8"));
    expect(src).toMatch(/<SellingNowRow sellerId=\{userId!\} \/>\s*<DeclutterProfileSection userId=\{userId!\} \/>/);
    expect(src).toMatch(/declutterReviewCount=\{declutterReviewCount\}/);
  });
});
