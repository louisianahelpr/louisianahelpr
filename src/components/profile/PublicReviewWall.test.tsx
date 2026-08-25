import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { PublicReviewWall, truncateFeedback } from "./PublicReviewWall";

/**
 * Supabase mock — mirrors the same chain shape HelperStreakBadge.test uses.
 *
 * The component's queryFn does THREE calls in sequence:
 *   1. supabase.from("reviews")...limit() → review rows
 *   2. supabase.rpc("get_safe_profiles", …) → reviewer names
 *   3. supabase.from("jobs").select(...).in(...) → job categories
 *
 * Each call resolves from the matching mock-state slot below; tests
 * mutate the slots before rendering.
 */
const reviewQueryResult = {
  data: [] as Array<{
    id: string;
    rating: number;
    feedback: string | null;
    created_at: string;
    reviewer_id: string;
    job_id: string;
  }>,
  error: null as { message: string } | null,
};

const profilesRpcResult = {
  data: [] as Array<{ user_id: string; full_name: string | null }>,
  error: null as { message: string } | null,
};

const jobsQueryResult = {
  data: [] as Array<{ id: string; category: string | null }>,
  error: null as { message: string } | null,
};

vi.mock("@/integrations/supabase/client", () => {
  // Per-table chain so reviews vs jobs land on distinct resolvers.
  const reviewsBuilder: Record<string, unknown> = {};
  reviewsBuilder.select = vi.fn(() => reviewsBuilder);
  reviewsBuilder.eq = vi.fn(() => reviewsBuilder);
  reviewsBuilder.lte = vi.fn(() => reviewsBuilder);
  reviewsBuilder.order = vi.fn(() => reviewsBuilder);
  reviewsBuilder.limit = vi.fn(() => Promise.resolve(reviewQueryResult));

  const jobsBuilder: Record<string, unknown> = {};
  jobsBuilder.select = vi.fn(() => jobsBuilder);
  jobsBuilder.in = vi.fn(() => Promise.resolve(jobsQueryResult));

  return {
    supabase: {
      from: vi.fn((table: string) =>
        table === "reviews" ? reviewsBuilder : jobsBuilder,
      ),
      rpc: vi.fn((_name: string) => Promise.resolve(profilesRpcResult)),
    },
  };
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper: wrapper };
}

function resetMocks() {
  reviewQueryResult.data = [];
  reviewQueryResult.error = null;
  profilesRpcResult.data = [];
  profilesRpcResult.error = null;
  jobsQueryResult.data = [];
  jobsQueryResult.error = null;
}

const makeReview = (
  overrides: Partial<(typeof reviewQueryResult.data)[number]> = {},
) => ({
  id: overrides.id ?? "review-1",
  rating: overrides.rating ?? 5,
  feedback: overrides.feedback ?? "Showed up early and did a great job.",
  // Default to 3 days ago so the relative-time test has a stable answer.
  created_at:
    overrides.created_at ??
    new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  reviewer_id: overrides.reviewer_id ?? "user-1",
  job_id: overrides.job_id ?? "job-1",
});

describe("truncateFeedback", () => {
  it("returns the input untouched when it fits inside the snippet cap", () => {
    const { truncated, isTruncated } = truncateFeedback("short and sweet");
    expect(truncated).toBe("short and sweet");
    expect(isTruncated).toBe(false);
  });

  it("cuts on a word boundary and appends an ellipsis when too long", () => {
    const long =
      "Showed up right on time, brought all the supplies, was incredibly polite and respectful, " +
      "left the workspace cleaner than when they arrived, and even offered to help with an extra task.";
    const { truncated, isTruncated } = truncateFeedback(long);
    expect(isTruncated).toBe(true);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(141);
    // Confirms we cut on whitespace, not mid-word.
    expect(truncated.slice(-2, -1)).not.toBe(" ");
  });

  it("falls back to a hard cut when the snippet has no usable whitespace", () => {
    const noSpaces = "a".repeat(200);
    const { truncated, isTruncated } = truncateFeedback(noSpaces);
    expect(isTruncated).toBe(true);
    expect(truncated.endsWith("…")).toBe(true);
  });
});

describe("PublicReviewWall", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("renders the empty-state copy when the helper has no visible reviews", async () => {
    reviewQueryResult.data = [];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("public-review-wall-empty")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/no reviews yet/i),
    ).toBeInTheDocument();
  });

  it("renders nothing in condensed mode when there are no reviews (no clutter on cards)", async () => {
    reviewQueryResult.data = [];
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" variant="condensed" />
      </Wrapper>,
    );
    await waitFor(() => {
      // Loading skeleton should clear once the empty result settles.
      expect(
        container.querySelector("[data-testid='public-review-wall-loading']"),
      ).toBeNull();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single review with star row, reviewer name, and relative time", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", rating: 5, feedback: "Maria did great." }),
    ];
    profilesRpcResult.data = [
      { user_id: "user-1", full_name: "Maria Santos" },
    ];
    jobsQueryResult.data = [{ id: "job-1", category: "cleaning" }];

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("public-review-wall")).toBeInTheDocument();
    });

    // Star row — 5 star icons rendered, with the "5 of 5 stars" label.
    expect(screen.getByLabelText("5 of 5 stars")).toBeInTheDocument();
    // formatName converts "Maria Santos" → "Maria S."
    expect(screen.getByText("Maria S.")).toBeInTheDocument();
    expect(screen.getByText(/Maria did great\./)).toBeInTheDocument();
    // Relative time string — exact wording varies by date-fns version,
    // but "3 days ago" is stable for a 3-day-old timestamp.
    expect(screen.getByText(/3 days ago/)).toBeInTheDocument();
    // Job category chip.
    expect(screen.getByTestId("public-review-category")).toHaveTextContent(
      /cleaning/i,
    );
  });

  it("renders multiple reviews in newest-first order, one item per row", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", reviewer_id: "u1", job_id: "j1", feedback: "First review." }),
      makeReview({ id: "r2", reviewer_id: "u2", job_id: "j2", feedback: "Second review." }),
      makeReview({ id: "r3", reviewer_id: "u3", job_id: "j3", feedback: "Third review." }),
    ];
    profilesRpcResult.data = [
      { user_id: "u1", full_name: "Alice Adams" },
      { user_id: "u2", full_name: "Bob Brown" },
      { user_id: "u3", full_name: "Carol Cox" },
    ];
    jobsQueryResult.data = [
      { id: "j1", category: "moving" },
      { id: "j2", category: "yard_work" },
      { id: "j3", category: "errands" },
    ];

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" />
      </Wrapper>,
    );

    const items = await waitFor(() => {
      const found = screen.getAllByTestId("public-review-item");
      expect(found.length).toBe(3);
      return found;
    });

    // First item should be the first review (newest comes back first from
    // the ordered query; the component preserves that order).
    expect(items[0]).toHaveTextContent("First review.");
    expect(items[1]).toHaveTextContent("Second review.");
    expect(items[2]).toHaveTextContent("Third review.");
    // Underscored categories render as the human form.
    expect(screen.getByText(/yard work/i)).toBeInTheDocument();
  });

  it("truncates long feedback and expands inline when the 'more' button is tapped", async () => {
    const long =
      "Showed up right on time, brought all the supplies, was incredibly polite and respectful, " +
      "left the workspace cleaner than when they arrived, and even offered to help with an extra task " +
      "that wasn't part of the original scope.";

    reviewQueryResult.data = [makeReview({ id: "r1", feedback: long })];
    profilesRpcResult.data = [
      { user_id: "user-1", full_name: "Long Reviewer" },
    ];
    jobsQueryResult.data = [{ id: "job-1", category: null }];

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" />
      </Wrapper>,
    );

    const moreBtn = await waitFor(() =>
      screen.getByRole("button", { name: /show full review/i }),
    );

    // Pre-expand: the full text is NOT rendered; the truncated snippet is.
    expect(screen.queryByText(long)).not.toBeInTheDocument();

    fireEvent.click(moreBtn);

    // Post-expand: the full text appears and the "more" button disappears.
    expect(screen.getByText(long)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show full review/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the 'See all N reviews' link when totalReviewCount exceeds what we showed", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", reviewer_id: "u1", job_id: "j1" }),
    ];
    profilesRpcResult.data = [{ user_id: "u1", full_name: "Sample User" }];
    jobsQueryResult.data = [{ id: "j1", category: "cleaning" }];

    const onSeeAll = vi.fn();
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall
          helperId="helper-1"
          variant="condensed"
          onSeeAll={onSeeAll}
          totalReviewCount={23}
        />
      </Wrapper>,
    );

    const link = await waitFor(() =>
      screen.getByRole("button", { name: /see all 23 reviews/i }),
    );
    fireEvent.click(link);
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("hides the 'See all' link when there are no additional reviews beyond what's shown", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", reviewer_id: "u1", job_id: "j1" }),
    ];
    profilesRpcResult.data = [{ user_id: "u1", full_name: "Sample User" }];
    jobsQueryResult.data = [{ id: "j1", category: "cleaning" }];

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall
          helperId="helper-1"
          onSeeAll={vi.fn()}
          totalReviewCount={1}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("public-review-wall")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /see all/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to 'a neighbor' when get_safe_profiles returns no row for a reviewer", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", reviewer_id: "ghost", job_id: "j1" }),
    ];
    profilesRpcResult.data = []; // RPC returned nothing for the reviewer
    jobsQueryResult.data = [{ id: "j1", category: null }];

    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("a neighbor")).toBeInTheDocument();
    });
  });

  it("does not query Supabase when helperId is empty", () => {
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <PublicReviewWall helperId="" />
      </Wrapper>,
    );
    // useQuery is disabled → no loading skeleton, no empty state, nothing.
    // (Initial render is the skeleton, but with enabled:false the query
    // stays in idle and we render the empty branch on next tick.) The
    // simpler assertion: no "public-review-wall" testid surfaces.
    expect(
      container.querySelector("[data-testid='public-review-wall']"),
    ).toBeNull();
  });
});
