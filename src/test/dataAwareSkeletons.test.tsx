// @mutate src/components/ActivityPageSkeleton.tsx | const coldEmpty = tab === "posted" ? cachedPosts === 0 : cachedApps === 0; | const coldEmpty = tab === "posted" ? false : cachedApps === 0;
// @mutate src/components/ActivityPageSkeleton.tsx | const coldEmpty = tab === "posted" ? cachedPosts === 0 : cachedApps === 0; | const coldEmpty = tab === "posted" ? cachedPosts === 0 : false;
// @mutate src/components/profile/ProfileTabFallback.tsx |   if (tab === "notifications") return <NotificationsReserve />; |   // removed
// @mutate src/components/GuestBrowseSkeleton.tsx | const cold = cachedJobs === 0; | const cold = false;
// @mutate src/pages/home/DashboardGuest.tsx | ) : !feedReady && !(jobsStatus === "success" && baseJobs.length > 0) ? ( | ) : false ? (
// @mutate src/components/ui/skeletons/EmptyStateSkeleton.tsx | if (data != null) n = Math.max(n, count(data)); | n = 0;
// @mutate src/pages/post-job/EntryChoice.tsx | return ENTRY_BASE_CARD_COUNT + (known.draftCard ? 1 : 0) + (known.repostCard ? 1 : 0); | return 5;
// @mutate src/components/profile/ProfileTabFallback.tsx | reviews: [{ h: 307 }], | reviews: [{ h: 86 }, { h: "fill" }],
// @mutate src/components/profile/ProfileTabFallback.tsx | wrapped: [{ h: 333 }], | wrapped: [{ h: 744 }],
// @mutate src/components/profile/ReviewsTab.tsx | {loading ? (reviewCount === 0 ? ( | {loading ? (false ? (
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ActivityPageSkeleton } from "@/components/ActivityPageSkeleton";
import GuestBrowseSkeleton from "@/components/GuestBrowseSkeleton";
import { NOTIFICATION_ROWS, ProfileTabBodyReserve, TAB_SHAPES } from "@/components/profile/ProfileTabFallback";
import { ReviewsTab } from "@/components/profile/ReviewsTab";
import { entryCardCount, ENTRY_BASE_CARD_COUNT } from "@/pages/post-job/EntryChoice";

/**
 * DATA-AWARE SKELETONS (owner, 2026-10-03, Q722; the cold-visit outline for
 * My Posts and guest Browse decided 2026-10-05). A placeholder draws the state
 * the KNOWN data says will land, never the populated layout by default.
 * Measured at 375 on prod (2026-10-05) before this: reviews 3 rows/86px ->
 * the 307px "No reviews yet" card, wrapped 744 -> 419/510px (zero-activity card 333px), post-job 5 cards
 * -> 4, My Posts 52px card row -> the empty state, guest Browse 27px -> the
 * empty state. The measurement itself is scripts/check-loading-state-shape.mjs
 * (src/test/loadingStateShape.test.ts); this file pins each rule in source so
 * a refactor that drops one fails here, not a day later on prod.
 */

const withCache = (seed: (qc: QueryClient) => void, node: ReactNode) => {
  const qc = new QueryClient();
  seed(qc);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
};

afterEach(cleanup);

describe("cold visits draw the zero state, warm visits the list", () => {
  it("My Posts: no cached posts -> the empty-state outline; cached posts -> cards", () => {
    const cold = withCache(() => {}, <ActivityPageSkeleton tab="posted" />);
    expect(cold.queryByTestId("posts-empty-skeleton")).not.toBeNull();
    cleanup();
    const warm = withCache(
      (qc) => qc.setQueryData(["activity", "posted", "u1"], { postedJobs: [{ id: "j1" }], applicantCounts: {}, pendingApplicantCounts: {} }),
      <ActivityPageSkeleton tab="posted" />,
    );
    expect(warm.queryByTestId("posts-empty-skeleton")).toBeNull();
  });

  it("My Jobs: no cached applications -> the empty-state outline; cached ones -> cards (owner, 2026-10-07, Q201 b)", () => {
    const cold = withCache(() => {}, <ActivityPageSkeleton tab="applied" />);
    expect(cold.queryByTestId("jobs-empty-skeleton")).not.toBeNull();
    cleanup();
    const warm = withCache(
      (qc) => qc.setQueryData(["activity", "applied", "u1"], { appliedApps: [{ id: "a1" }] }),
      <ActivityPageSkeleton tab="applied" />,
    );
    expect(warm.queryByTestId("jobs-empty-skeleton")).toBeNull();
  });


  // Q1368 (owner at launch, 2026-10-07): real jobs are public, so a cold
  // guest visit draws card shapes too, never the empty outline that would
  // flash before a full list.
  it("guest Browse: cold or cached, the chunk skeleton draws job cards, never the empty outline (Q1368)", () => {
    const cold = withCache(() => {}, <GuestBrowseSkeleton />);
    expect(cold.container.querySelectorAll('[class*="w-[88px]"]').length).toBe(0);
    // Six JobCardSkeletons, counted by the card's own left rail (JOB_CARD_RAIL).
    expect(cold.container.querySelectorAll('[class*="left-0 top-0 bottom-0 w-1.5"]').length).toBe(6);
    expect(cold.container.textContent).not.toMatch(/Nothing today/);
    cleanup();
    const warm = withCache((qc) => qc.setQueryData(["guestDashboardJobs"], [{ id: "j1" }]), <GuestBrowseSkeleton />);
    expect(warm.container.querySelectorAll('[class*="w-[88px]"]').length).toBe(0);
  });

  it("guest Browse's own loading frame draws job cards until the feed is ready, cold visit included (Q1368)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8");
    expect(src).not.toMatch(/GuestFeedEmptySkeleton/);
    expect(src).toMatch(/\) : !feedReady \? \(\s*\/\*[^*]*\*\/\s*<div/);
  });

  it("post-job: four cards always, plus each conditional card only once its read says so", () => {
    expect(ENTRY_BASE_CARD_COUNT).toBe(4);
    expect(entryCardCount({ draftCard: false, repostCard: false })).toBe(4);
    expect(entryCardCount({ draftCard: true, repostCard: false })).toBe(5);
    expect(entryCardCount({ draftCard: true, repostCard: true })).toBe(6);
  });

  it("profile tabs reviews and wrapped reserve their ZERO state, one block each", () => {
    expect(TAB_SHAPES.reviews).toEqual([{ h: 307 }]);
    expect(TAB_SHAPES.wrapped).toEqual([{ h: 333 }]);
  });

  it("ReviewsTab draws the populated skeleton only when the count says there are reviews", () => {
    const zero = render(
      <MemoryRouter>
        <ReviewsTab reviews={[]} loading avgRating={null} reviewCount={0} onBack={() => {}} />
      </MemoryRouter>,
    );
    expect(zero.queryByTestId("profile-tab-fallback")).not.toBeNull();
    cleanup();
    const some = render(
      <MemoryRouter>
        <ReviewsTab reviews={[]} loading avgRating={4.5} reviewCount={3} onBack={() => {}} />
      </MemoryRouter>,
    );
    expect(some.queryByTestId("profile-tab-fallback")).toBeNull();
  });
});

describe("Notifications draws its icon rows (owner, 2026-10-07, Q201 a)", () => {
  it("one round icon bone per preference row: 17, the count measured on prod", () => {
    expect(NOTIFICATION_ROWS).toBe(17);
    const r = render(<ProfileTabBodyReserve tab="notifications" />);
    expect(r.container.querySelectorAll(".rounded-full.h-9.w-9").length).toBe(17);
  });
});
