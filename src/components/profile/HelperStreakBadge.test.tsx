import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { HelperStreakBadge, computeFiveStarStreak } from "./HelperStreakBadge";

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
  return { wrapper };
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
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      // queryFn resolved → useQuery flipped to settled with streak 0.
      expect(container).toBeEmptyDOMElement();
    });
  });

  it("stays hidden at a 2-streak (below the meaningful threshold)", async () => {
    mockQueryResult.data = makeReviews([5, 5, 4]);
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="helper-1" />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
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
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <HelperStreakBadge helperId="" />
      </Wrapper>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
