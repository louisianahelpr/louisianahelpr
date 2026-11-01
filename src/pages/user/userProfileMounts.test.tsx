/**
 * The public profile (/user/:userId) mounts its sections: the seller's moving sale (board 164), read for THAT
 * seller, and the masthead pieces each tested alone elsewhere (ProfileHeaderCard with its RecognitionRow and
 * AtAGlanceCard, Recent work, the reviews list, the loading masthead). The profile's own data hook and every
 * read are stubbed (no network); the sections render for real.
 *
 * @mutate src/pages/user/UserProfile.tsx |           <MovingSaleBanner sellerId={userId!} /> |
 * @mutate src/pages/user/UserProfile.tsx | <MovingSaleBanner sellerId={userId!} /> | <MovingSaleBanner sellerId={currentUserId!} />
 * @mutate src/pages/user/ProfileHeaderCard.tsx |         {recognition && <div className="mt-4">{recognition}</div>} |
 * @mutate src/pages/user/ProfileHeaderCard.tsx |           {atAGlance} |
 * @mutate src/pages/user/UserProfile.tsx |             {showReviews && (\n              <ReviewsSection |             {false && (\n              <ReviewsSection
 * @mutate src/pages/user/UserProfile.tsx |             <ProfileHeroSkeleton /> |
 *
 * Board 40: "Selling now · N" (the seller's items for sale, two then See all), "Helps with" over the
 * skills, and the bottom bar "Invite to a job" on everyone else's profile, a new member's too (app audit
 * A3-C9, 2026-10-29: it needed work on record; it was the ... menu's "Offer a job directly"; no Message
 * button, owner).
 * @mutate src/pages/user/UserProfile.tsx |           <SellingNowRow sellerId={userId!} /> |
 * @mutate src/components/declutter/SellingNowRow.tsx | const SELLING_NOW_FIRST = 2; | const SELLING_NOW_FIRST = 12;
 * @mutate src/pages/user/UserProfile.tsx |         {!isOwnProfile && currentUserId && <InviteToJobBar userId={userId!} />} |
 * @mutate src/pages/user/UserProfile.tsx |         {!isOwnProfile && currentUserId && <InviteToJobBar userId={userId!} />} |         {!isOwnProfile && currentUserId && workedJobs.length > 0 && <InviteToJobBar userId={userId!} />}
 * @mutate src/pages/user/InviteToJobBar.tsx |         onClick={() => navigate(`/post-job?offerTo=${userId}`)} |         onClick={() => navigate(`/post-job`)}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AT_A_GLANCE_GRID } from "./AtAGlanceCard";

const saleReads = vi.hoisted(() => [] as string[]);
const page = vi.hoisted(() => ({ loading: false, worked: [] as unknown[] }));
const sellerReads = vi.hoisted(() => [] as string[]);

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u9" }, profile: {}, isLoading: false }) }));
vi.mock("@/pages/user/useBlockedByMe", () => ({
  useBlockedByMe: () => ({ blockedByMeKey: ["blocked"], data: false, status: "success", isError: false, refetch: vi.fn() }),
}));
const review = {
  id: "r1", rating: 5, feedback: "Carried the sofa down three flights.", created_at: "2026-10-01T00:00:00Z",
  reviewerName: "Pat Poster", jobTitle: "Move a sofa", jobCategory: "moving", response_text: null, response_at: null,
};
vi.mock("@/pages/user/useUserProfileData", () => ({
  useUserProfileData: () => ({
    data: {
      profile: {
        user_id: "s1", full_name: "Sam Seller", created_at: "2026-01-01T00:00:00Z", subscription_tier: "free",
        portfolio_urls: ["https://example.com/work-1.jpg"],
        skills: "Furniture assembly, Yard work",
      },
      repeatHirePercent: null,
    },
    isError: false,
    refetch: vi.fn(),
    reviewsFromQuery: [review],
    setLocalReviews: vi.fn(),
    reviews: [review],
    stats: { completedJobs: 1, avgRating: 5, reviewCount: 1 },
    loadingMoreReviews: false,
    reviewsHasMore: false,
    reviewsTotalCount: 1,
    loadMoreReviews: vi.fn(),
    postedJobs: [],
    workedJobs: page.worked,
    completedWorkedJobs: [],
    completedWorkedCount: 1,
    badgeStats: {},
    credentialTier: null,
    canReadReviewText: true,
    replyLatency: null,
    mutualJobsCount: 0,
    onTimeArrivalRate: null,
    revisionFrequency: null,
    lastActiveAt: null,
    isIdVerified: true,
    backgroundCheckStatus: null,
    tierProfile: null,
    postedTotalCount: 0,
    loading: page.loading,
    offlineEmpty: false,
  }),
}));
// Stand-ins only for what reads or writes on its own and is not under test here.
vi.mock("@/components/PageHeader", () => ({
  default: ({ title, titleActions }: { title: string; titleActions?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {titleActions}
    </header>
  ),
}));
vi.mock("@/components/SaveHelperButton", () => ({ default: () => null }));
vi.mock("@/components/HelperPortfolio", () => ({ HelperPortfolio: () => null }));
vi.mock("@/components/profile/BackgroundCheckCard", () => ({ default: () => null }));
vi.mock("@/components/ReportDialog", () => ({ default: () => null }));
vi.mock("@/components/BlockUserDialog", () => ({ BlockUserDialog: () => null }));
// The banner's own reads (as in movingSaleBanner.test.tsx).
vi.mock("@/lib/declutter/api", () => ({
  fetchPhotos: async () => [],
  photoPublicUrl: (p: string) => p, photoCardUrl: (p: string) => p, CARD_PHOTO_PX: 480,
  // Board 40's Selling now row.
  fetchSellerItems: async (sellerId: string) => {
    sellerReads.push(sellerId);
    return sellerId === "s1"
      ? [
          { id: "i1", title: "Tool chest", current_price_cents: 4500, category: "tools", status: "live" },
          { id: "i2", title: "Shop vac", current_price_cents: 2000, category: "tools", status: "live" },
          { id: "i3", title: "Ladder", current_price_cents: 3000, category: "tools", status: "live" },
        ]
      : [];
  },
  fetchWatching: async () => new Set<string>(),
  setWatch: async () => "watching",
}));
vi.mock("@/lib/declutter/movingSale", () => ({
  fetchSellerMovingSale: async (sellerId: string) => {
    saleReads.push(sellerId);
    return sellerId === "s1"
      ? {
          moveOutOn: "2026-11-01",
          saleName: "Moving to Lafayette",
          startsOn: null,
          more: false,
          items: [{ id: "a", title: "Sofa, 3 seat", current_price_cents: 12000, area_label: "Delcambre", category: "furniture", status: "live" }],
        }
      : null;
  },
  louisianaToday: () => "2026-10-20",
  movingSaleWhen: () => "Moving out Nov 1. 1 item for sale.",
}));

import UserProfile from "./UserProfile";

let navigatedTo = "";
function Where() {
  const loc = useLocation();
  navigatedTo = `${loc.pathname}${loc.search}`;
  return null;
}

function renderProfile() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/user/s1"]}>
        <Routes>
          <Route path="/user/:userId" element={<UserProfile />} />
          <Route path="/post-job" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  saleReads.length = 0;
  sellerReads.length = 0;
  page.loading = false;
  page.worked = [];
  navigatedTo = "";
});

describe("board 40: selling now, helps with, invite to a job", () => {
  it("shows the seller's items for sale now, two at first, then See all", async () => {
    renderProfile();
    expect(await screen.findByText("Selling now · 3")).toBeInTheDocument();
    expect(sellerReads).toEqual(["s1"]);
    expect(screen.getByText("Tool chest")).toBeInTheDocument();
    expect(screen.getByText("Shop vac")).toBeInTheDocument();
    expect(screen.queryByText("Ladder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(screen.getByText("Ladder")).toBeInTheDocument();
  });

  it("labels the skills Helps with", () => {
    renderProfile();
    expect(screen.getByText("Helps with")).toBeInTheDocument();
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("someone who has done work gets the Invite to a job bar (no Message button); it opens a direct offer", () => {
    page.worked = [{ id: "j1" }];
    renderProfile();
    expect(screen.queryByRole("button", { name: /message/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invite to a job" }));
    expect(navigatedTo).toBe("/post-job?offerTo=s1");
  });

  it("a new member with no work on record gets the same bar (A3-C9)", () => {
    renderProfile();
    fireEvent.click(screen.getByRole("button", { name: "Invite to a job" }));
    expect(navigatedTo).toBe("/post-job?offerTo=s1");
  });
});

describe("the public profile mounts its sections", () => {
  it("shows the seller's moving sale, read for that seller (board 164)", async () => {
    renderProfile();
    expect(await screen.findByText("Moving to Lafayette")).toBeInTheDocument();
    expect(screen.getByText("Sofa, 3 seat")).toBeInTheDocument();
    expect(saleReads).toEqual(["s1"]);
  });

  it("the masthead carries the badges and the record strip; Recent work shows; the rating opens the reviews", () => {
    renderProfile();
    expect(screen.getByText("Sam S.")).toBeInTheDocument();
    expect(screen.getByText("ID verified")).toBeInTheDocument(); // RecognitionRow
    expect(screen.getByRole("region", { name: "At a glance" })).toBeInTheDocument(); // AtAGlanceCard
    expect(screen.getByRole("heading", { name: /Recent work/ })).toBeInTheDocument(); // HelperWorkPhotos
    expect(screen.queryByTestId("profile-review-card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /1 review/ }));
    expect(screen.getByTestId("profile-review-card")).toHaveTextContent("Carried the sofa down three flights."); // ReviewsSection
  });

  it("while loading, the masthead's skeleton holds its place", () => {
    page.loading = true;
    const { container } = renderProfile();
    expect(screen.queryByText("Sam S.")).toBeNull();
    expect([...container.querySelectorAll("div")].filter((d) => d.className === AT_A_GLANCE_GRID)).toHaveLength(1); // ProfileHeroSkeleton
  });
});
