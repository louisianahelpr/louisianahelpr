import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { HelperStreakBadge, computeFiveStarStreak } from "./HelperStreakBadge";
import { queryKeys } from "@/lib/queryKeys";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mock the Supabase client surface — same shape EarningsForecastCard uses.
 * The queryFn awaits the terminal `.limit()` call, so that's where we
 * resolve the mocked result.
 */
const mockQueryResult = {
  data: [] as { rating: number; created_at: string }[],
  error: null as { message: string } | null,
};

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.lte = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(() => Promise.resolve(mockQueryResult));
  return {
    supabase: {
      from: vi.fn(() => builder),
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
  return { wrapper, client };
}

/**
 * THE REASON THIS HELPER EXISTS, and why every "renders nothing" assertion
 * below goes through it.
 *
 * `await waitFor(() => expect(container).toBeEmptyDOMElement())` is VACUOUS
 * here: the badge's first paint is empty for EVERY input, because `useQuery`
 * has no data yet and `streak` falls back to 0. `waitFor` polls, so it is
 * satisfied on the first tick — before the mocked promise has resolved — and
 * the assertion never reaches the branch it claims to guard. Proven by
 * mutation: `MIN_STREAK = 3` → `1` left all three hidden-state tests GREEN
 * while a 2-streak pill rendered on screen.
 *
 * So we wait on the QUERY, not on the DOM: once the cache entry for this
 * helper reports `success`, the streak the component renders from is the real
 * computed one, and "still empty" is a statement about `streak < MIN_STREAK`.
 */
async function awaitStreakQuery(client: QueryClient, helperId: string) {
  await waitFor(() => {
    const entry = client
      .getQueryCache()
      .find({ queryKey: queryKeys.helperStreak.byHelper(helperId) });
    expect(entry?.state.status, "the streak query never settled").toBe("success");
  });
  return client.getQueryData<number>(queryKeys.helperStreak.byHelper(helperId));
}

const makeReviews = (ratings: number[]) =>
  ratings.map((rating, i) => ({
    rating,
    created_at: new Date(2026, 0, 50 - i).toISOString(),
  }));

describe("computeFiveStarStreak", () => {
  it("returns 0 when there are no reviews", () => {
    expect(computeFiveStarStreak([])).toBe(0);
  });

  it("counts the leading run of 5s and stops at the first non-5", () => {
    expect(computeFiveStarStreak([{ rating: 5 }, { rating: 5 }, { rating: 4 }, { rating: 5 }])).toBe(2);
  });

  it("returns 0 when the most recent review is below 5", () => {
    expect(computeFiveStarStreak([{ rating: 4 }, { rating: 5 }, { rating: 5 }])).toBe(0);
  });

  it("caps the count at 99 to keep the pill readable", () => {
    const huge = Array.from({ length: 250 }, () => ({ rating: 5 }));
    expect(computeFiveStarStreak(huge)).toBe(99);
  });
});

describe("HelperStreakBadge", () => {
  beforeEach(() => {
    mockQueryResult.data = [];
    mockQueryResult.error = null;
  });

  it("renders nothing when there are no reviews", async () => {
    mockQueryResult.data = [];
    const { wrapper: Wrapper, client } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    // The query really ran and really returned 0 — not "we looked before it
    // answered".
    expect(await awaitStreakQuery(client, "helper-1")).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden at a 2-streak (below the meaningful threshold)", async () => {
    mockQueryResult.data = makeReviews([5, 5, 4]);
    const { wrapper: Wrapper, client } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    // A REAL 2 reached the component, and it still drew nothing. This is the
    // threshold assertion; without the settle-wait it passed at MIN_STREAK=1.
    expect(await awaitStreakQuery(client, "helper-1")).toBe(2);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("helper-streak-badge")).toBeNull();
    expect(screen.queryByText(/5-star streak/i)).toBeNull();
  });

  it("renders the pill when the streak hits the 3-review threshold", async () => {
    mockQueryResult.data = makeReviews([5, 5, 5, 4]);
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("helper-streak-badge")).toBeInTheDocument();
    });
    expect(screen.getByText(/3 5-star streak/i)).toBeInTheDocument();
  });

  it("shows the count for a longer streak", async () => {
    mockQueryResult.data = makeReviews(Array.from({ length: 12 }, () => 5));
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/12 5-star streak/i)).toBeInTheDocument();
    });
  });

  it("caps the visible count at 99+ for legendary streaks", async () => {
    mockQueryResult.data = makeReviews(Array.from({ length: 150 }, () => 5));
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/99\+ 5-star streak/i)).toBeInTheDocument();
    });
  });

  it("gates the flame animation behind motion-safe: so reduced-motion users get a static icon", async () => {
    mockQueryResult.data = makeReviews([5, 5, 5]);
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    const badge = await waitFor(() => screen.getByTestId("helper-streak-badge"));
    const flame = badge.querySelector("svg");
    expect(flame).not.toBeNull();
    // The motion-safe: prefix makes the pulse a no-op when the user has
    // prefers-reduced-motion: reduce set. We assert the class is present
    // and that no unguarded `animate-pulse` is leaking through.
    expect(flame!.getAttribute("class") ?? "").toContain("motion-safe:animate-pulse");
    expect(flame!.getAttribute("class") ?? "").not.toMatch(/(^|\s)animate-pulse(\s|$)/);
  });

  it("does not query Supabase when helperId is falsy", () => {
    vi.mocked(supabase.from).mockClear();
    const { wrapper: Wrapper, client } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="" />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
    // The empty DOM alone proves nothing (it is empty on the first paint for
    // every input). The load-bearing fact is that `enabled: !!helperId` kept
    // the request off the wire entirely — no cache entry, no `from("reviews")`.
    expect(supabase.from).not.toHaveBeenCalled();
    expect(client.getQueryCache().find({ queryKey: queryKeys.helperStreak.byHelper("") })?.state.status)
      .not.toBe("success");
  });
});
// ── Shown able to fail ─────────────────────────────────────────────────────
// The threshold IS the feature: a "1 5-star streak" pill on every helper with
// one good review is the dilution MIN_STREAK exists to prevent. Before the
// settle-wait added to the hidden-state tests above, this mutation SURVIVED —
// the empty-DOM assertions were satisfied by the pre-resolution first paint.
// @mutate src/components/profile/HelperStreakBadge.tsx | const MIN_STREAK = 3; | const MIN_STREAK = 1;
