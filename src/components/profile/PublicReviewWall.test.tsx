import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { queryKeys } from "@/lib/queryKeys";
import { PublicReviewWall, truncateFeedback } from "./PublicReviewWall";

/**
 * Supabase mock — mirrors the same chain shape HelperStreakBadge.test uses.
 *
 * The component's queryFn has TWO paths:
 *
 *   PREFERRED — `supabase.rpc("get_public_profile_reviews", …)`, which applies
 *   the reveal window, the `published` status, the cancelled-job exclusion and
 *   reviewer-name masking in SQL, and returns the job category.
 *
 *   FALLBACK — taken only when that RPC answers PGRST202 (not deployed yet):
 *     1. supabase.from("reviews")...limit() → review rows
 *     2. supabase.rpc("get_safe_profiles", …) → reviewer names
 *
 * `publicReviewsRpcResult` defaults to PGRST202 so the bulk of the suite
 * exercises the fallback; the RPC path has its own describe block.
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

/** `get_public_profile_reviews`. Defaults to "migration not deployed yet". */
const publicReviewsRpcResult = {
  data: null as Array<{
    id: string;
    rating: number;
    feedback: string | null;
    created_at: string;
    reviewer_name: string | null;
    job_category: string | null;
  }> | null,
  error: { code: "PGRST202", message: "function not found" } as
    | { code: string; message: string }
    | null,
};

/**
 * THE FILTERS THE FALLBACK QUERY APPLIED — recorded, because a chainable
 * no-op mock cannot otherwise tell a filtered read from an unfiltered one.
 *
 * MEASURED 2026-09-21: with `.eq`/`.lte` returning the builder and ignoring
 * their arguments, DELETING `.eq("status", "published")` — the operator-takedown
 * filter — or `.lte("feedback_visible_at", …)` — the anti-retaliation reveal
 * window — from PublicReviewWall.tsx left this whole suite GREEN. Every test
 * that asserts on the fallback path reads `reviewQueryResult`, which the mock
 * hands back whatever was asked for, so a hidden review leaking onto a public
 * profile was invisible here by construction. The chain now records, and
 * `describe("the fallback query's own filters")` grades what it recorded.
 */
const reviewFilters: Array<[string, string, unknown]> = [];

vi.mock("@/integrations/supabase/client", () => {
  // Per-table chain so reviews vs jobs land on distinct resolvers.
  const reviewsBuilder: Record<string, unknown> = {};
  reviewsBuilder.select = vi.fn(() => reviewsBuilder);
  reviewsBuilder.eq = vi.fn((col: string, val: unknown) => {
    reviewFilters.push(["eq", col, val]);
    return reviewsBuilder;
  });
  reviewsBuilder.lte = vi.fn((col: string, val: unknown) => {
    reviewFilters.push(["lte", col, val]);
    return reviewsBuilder;
  });
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
      rpc: vi.fn((name: string) =>
        Promise.resolve(
          name === "get_public_profile_reviews"
            ? publicReviewsRpcResult
            : profilesRpcResult,
        ),
      ),
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
  return { wrapper: wrapper, client };
}

/**
 * WAIT ON THE QUERY, NOT ON THE DOM (the `waitForEmptyIsVacuous` class).
 *
 * `await waitFor(() => expect(container).toBeEmptyDOMElement())` is satisfied by
 * this component's FIRST paint for the condensed variant, and by every paint
 * once the wall hides itself — so it returned on poll #1, before the mocked
 * promise had resolved, and the branch each test is named after was never
 * reached. Both of those tests now settle the React Query cache entry first and
 * assert WHICH terminal state it reached; only then is "nothing rendered" a
 * statement about the branch rather than about mount order.
 */
async function settleWall(
  client: QueryClient,
  helperId: string,
  limit: number,
  expected: "success" | "error",
) {
  const key = queryKeys.publicReviewWall.byHelper(helperId, limit);
  await waitFor(() => {
    const entry = client.getQueryCache().find({ queryKey: key });
    expect(entry?.state.status, "the review-wall query never settled").toBe(expected);
  });
  return client.getQueryCache().find({ queryKey: key })!.state;
}

function resetMocks() {
  reviewFilters.length = 0;
  reviewQueryResult.data = [];
  reviewQueryResult.error = null;
  profilesRpcResult.data = [];
  profilesRpcResult.error = null;
  jobsQueryResult.data = [];
  jobsQueryResult.error = null;
  publicReviewsRpcResult.data = null;
  publicReviewsRpcResult.error = { code: "PGRST202", message: "function not found" };
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
    const { wrapper: Wrapper, client } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <PublicReviewWall helperId="helper-1" variant="condensed" />
      </Wrapper>,
    );
    // The fetch really RAN and really came back with zero rows — not "we looked
    // before it answered". CONDENSED_LIMIT is 2, and the key carries it.
    const state = await settleWall(client, "helper-1", 2, "success");
    expect(state.data).toEqual([]);
    expect(
      container.querySelector("[data-testid='public-review-wall-loading']"),
    ).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single review with star row, reviewer name, and relative time", async () => {
    reviewQueryResult.data = [
      makeReview({ id: "r1", rating: 5, feedback: "Maria did great." }),
    ];
    profilesRpcResult.data = [
      { user_id: "user-1", full_name: "Maria Santos" },
    ];

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
    // NO category chip on the fallback path. It used to be asserted here
    // against a mocked `from("jobs")` result the real database never
    // produces: `jobs` is unreadable to a non-party under RLS, so that query
    // returns zero rows for every visitor and the chip never appeared in
    // production. The chip belongs to the RPC path, and is asserted there.
    expect(screen.queryByTestId("public-review-category")).toBeNull();
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
  });

  describe("the get_public_profile_reviews path (once the migration is live)", () => {
    /**
     * The hand-rolled query this component used to run could not express the
     * cancelled-job exclusion (`jobs` is unreadable to a visitor) and did not
     * filter `status = 'published'` at all, so an operator takedown kept
     * showing. Both now live in SQL. These tests pin that the component
     * PREFERS that RPC and renders what it returns.
     */
    it("renders straight from the RPC, category chip included, without touching the reviews table", async () => {
      publicReviewsRpcResult.error = null;
      publicReviewsRpcResult.data = [
        {
          id: "r1",
          rating: 5,
          feedback: "Careful and quick.",
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          reviewer_name: "Maria Santos",
          job_category: "yard_work",
        },
      ];

      const { wrapper: Wrapper } = makeWrapper();
      render(
        <Wrapper>
          <PublicReviewWall helperId="helper-1" />
        </Wrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("public-review-wall")).toBeInTheDocument();
      });
      expect(screen.getByText("Maria S.")).toBeInTheDocument();
      expect(screen.getByText(/Careful and quick\./)).toBeInTheDocument();
      // The category the RPC emits — and it emits the category, never the
      // job title, which is free text that routinely carries an address.
      expect(screen.getByTestId("public-review-category")).toHaveTextContent(
        /yard work/i,
      );
    });

    it("renders 'a neighbor' when the RPC masks a banned reviewer's name to null", async () => {
      publicReviewsRpcResult.error = null;
      publicReviewsRpcResult.data = [
        {
          id: "r1",
          rating: 4,
          feedback: "Fine.",
          created_at: new Date().toISOString(),
          reviewer_name: null,
          job_category: null,
        },
      ];

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

    it("hides the wall on a real RPC error instead of claiming zero reviews", async () => {
      // Anything that is NOT PGRST202 is a genuine failure. Falling through to
      // the fallback there would paper over it; claiming "No reviews yet" on a
      // public profile makes a reviewed helper look unreviewed.
      publicReviewsRpcResult.error = { code: "42501", message: "denied" };
      publicReviewsRpcResult.data = null;

      const { wrapper: Wrapper, client } = makeWrapper();
      const { container } = render(
        <Wrapper>
          <PublicReviewWall helperId="helper-1" />
        </Wrapper>,
      );

      // THE BRANCH UNDER TEST, asserted directly: a non-PGRST202 error must
      // REJECT the queryFn. If the `throw rpcErr` line goes, the fallback runs,
      // the query settles `success` with [] — and the wall paints "No reviews
      // yet" on a helper who has them. Settling on `error` is what proves the
      // discrimination happened; the empty DOM is then its consequence.
      const state = await settleWall(client, "helper-1", 5, "error");
      expect((state.error as { code?: string } | null)?.code).toBe("42501");
      expect(screen.queryByTestId("public-review-wall-loading")).toBeNull();
      expect(screen.queryByTestId("public-review-wall-empty")).toBeNull();
      expect(container).toBeEmptyDOMElement();
    });
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

  /**
   * WHAT THE FALLBACK READ ACTUALLY ASKS THE DATABASE FOR.
   *
   * Not a mirror of the source — the three clauses each carry a distinct
   * promise to a person, and each was deletable with the rest of this file
   * green until the chain above started recording:
   *
   *   reviewee_id           this helper's reviews and nobody else's;
   *   status = 'published'  an operator takedown really is taken down;
   *   feedback_visible_at   the double-blind window (hidden until both sides
   *                         post or 14 days pass) — the anti-retaliation rule.
   *
   * The RPC path applies all three in SQL. This path is the deploy-lag
   * fallback, and it is the one a visitor gets if the migration ever rolls
   * back, so the clauses have to hold on both sides.
   */
  describe("the fallback query's own filters", () => {
    it("scopes to the helper, to published rows, and to the revealed window", async () => {
      reviewQueryResult.data = [makeReview({ id: "r1", reviewer_id: "u1", job_id: "j1" })];
      profilesRpcResult.data = [{ user_id: "u1", full_name: "Sample User" }];

      const before = Date.now();
      const { wrapper: Wrapper, client } = makeWrapper();
      render(
        <Wrapper>
          <PublicReviewWall helperId="helper-1" />
        </Wrapper>,
      );
      await settleWall(client, "helper-1", 5, "success");

      expect(reviewFilters).toContainEqual(["eq", "reviewee_id", "helper-1"]);
      expect(reviewFilters).toContainEqual(["eq", "status", "published"]);

      const reveal = reviewFilters.find(([op, col]) => op === "lte" && col === "feedback_visible_at");
      expect(reveal, "the anti-retaliation reveal window was never applied").toBeDefined();
      // …and it is bounded by NOW, not by a constant far in the future that
      // would let every hidden row through while still naming the column.
      const cutoff = Date.parse(String(reveal![2]));
      expect(cutoff).toBeGreaterThanOrEqual(before);
      expect(cutoff).toBeLessThanOrEqual(Date.now());
    });

    it("does not run that query at all on the RPC path", async () => {
      // Belt and braces: the preferred path must not also hit the table, or the
      // filters above would be graded on a read nobody makes in production.
      publicReviewsRpcResult.error = null;
      publicReviewsRpcResult.data = [];

      const { wrapper: Wrapper, client } = makeWrapper();
      render(
        <Wrapper>
          <PublicReviewWall helperId="helper-1" />
        </Wrapper>,
      );
      await settleWall(client, "helper-1", 5, "success");
      expect(reviewFilters).toEqual([]);
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

// ── VACUITY ─────────────────────────────────────────────────────────────────
// PROVEN RED 2026-09-21, twice.
//
// (1) Deleting the PGRST202 discrimination makes a REAL error (42501) fall
//     through to the fallback, which settles `success` with [] — so a helper
//     with reviews is painted "No reviews yet" on a public profile. Caught only
//     after the `waitFor(… toBeNull())` in that test was replaced by a wait on
//     the QUERY (see settleWall): the old wait returned on poll #1.
// (2) Deleting `status = 'published'` (the operator-takedown filter) used to
//     leave this whole file green, because the mocked `.eq`/`.lte` were
//     chainable no-ops that ignored their arguments and `reviewQueryResult` was
//     handed back whatever was asked for. The chain now records; "the fallback
//     query's own filters" grades what it recorded, and the reveal-window
//     `.lte` is pinned the same way.
//
// BLIND TO: the RPC's own SQL. `get_public_profile_reviews` applies the reveal
// window, the published filter, the cancelled-job exclusion and name masking
// server-side, and nothing here reads the database. Also: this component is
// currently mounted by NOTHING but this suite (reported, not fixed).
// @mutate src/components/profile/PublicReviewWall.tsx | if (rpcErr && (rpcErr as { code?: string }).code !== "PGRST202") throw rpcErr; |
// @mutate src/components/profile/PublicReviewWall.tsx | .eq("status", "published")\n |
