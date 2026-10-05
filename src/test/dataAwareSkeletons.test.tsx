// @mutate src/components/ActivityPageSkeleton.tsx | tab === "posted" && cachedPosts === 0 ? ( | false ? (
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
import { TAB_SHAPES } from "@/components/profile/ProfileTabFallback";
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

  it("My Jobs keeps its cards (the decision covers My Posts only)", () => {
    const r = withCache(() => {}, <ActivityPageSkeleton tab="applied" />);
    expect(r.queryByTestId("posts-empty-skeleton")).toBeNull();
  });

  it("guest Browse: no cached feed -> the empty-state outline; a cached feed -> cards", () => {
    const cold = withCache(() => {}, <GuestBrowseSkeleton />);
    const coldBones = cold.container.querySelectorAll('[class*="w-[88px]"]').length;
    expect(coldBones).toBe(1);
    cleanup();
    const warm = withCache((qc) => qc.setQueryData(["guestDashboardJobs"], [{ id: "j1" }]), <GuestBrowseSkeleton />);
    expect(warm.container.querySelectorAll('[class*="w-[88px]"]').length).toBe(0);
  });

  it("guest Browse's own loading frame draws the same outline until a non-empty list is known", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../pages/home/DashboardGuest.tsx"), "utf8");
    expect(src).toMatch(/\) : !feedReady && !\(jobsStatus === "success" && baseJobs\.length > 0\) \? \(\s*\/\*[^*]*\*\/\s*<GuestFeedEmptySkeleton className={emptyWrapperClass} announce/);
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
