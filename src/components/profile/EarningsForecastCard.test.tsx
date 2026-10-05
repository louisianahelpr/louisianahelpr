import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { EarningsForecastCard } from "./EarningsForecastCard";

/**
 * The card talks to Supabase via the project client. We mock the whole
 * client surface so each test can shape the row set returned by the
 * chained query builder without spinning up a real network layer.
 */
const mockQueryResult = { data: [] as unknown[], error: null as { message: string } | null };

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 })); // Q753: these cards now read the viewer's first-payout fee; no QueryClient here
vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  // Each chained call returns the same builder so we can `await` the
  // tail of the chain and get our prepared result. The terminal `.lte`
  // call is awaited inside the queryFn.
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.gte = vi.fn(chain);
  builder.lte = vi.fn(() => Promise.resolve(mockQueryResult));
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
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return { wrapper };
}

describe("EarningsForecastCard", () => {
  beforeEach(() => {
    mockQueryResult.data = [];
    mockQueryResult.error = null;
  });

  it("renders nothing when enabled is false", () => {
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={false} feeFallbackPercent={10} />
      </Wrapper>,
    );
    // Card is fully unmounted — no skeleton, no heading.
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the skeleton while the forecast query is in flight", () => {
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={true} feeFallbackPercent={10} />
      </Wrapper>,
    );
    // Synchronously rendered before the promise resolves.
    expect(screen.getByTestId("earnings-forecast-skeleton")).toBeInTheDocument();
  });

  // One-page Earnings (Q1177, owner 2026-10-01): a forecast of nothing is not
  // a card. With no in-progress earnings the card renders NOTHING — no "no jobs
  // lined up yet" empty state, no Browse-jobs button.
  it("renders nothing when there are no in-progress earnings", async () => {
    mockQueryResult.data = [];
    const { wrapper: Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={true} feeFallbackPercent={10} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("earnings-forecast-skeleton")).not.toBeInTheDocument();
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/no jobs lined up yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /browse jobs/i })).not.toBeInTheDocument();
  });

  it("renders the projected total + caveat when in-progress earnings exist", async () => {
    // One accepted job + one in_progress job, each with a $100 budget,
    // default 10% commission, no urgent fee → $90 net each = $180 total.
    mockQueryResult.data = [
      {
        budget: 100,
        helpers_needed: null,
        is_group_job: false,
        helper_fee_percent: 10,
        urgent_fee: null,
        status: "accepted",
      },
      {
        budget: 100,
        helpers_needed: null,
        is_group_job: false,
        helper_fee_percent: 10,
        urgent_fee: null,
        status: "in_progress",
      },
    ];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={true} feeFallbackPercent={10} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("$180")).toBeInTheDocument();
    });
    expect(screen.getByText(/by Sunday/i)).toBeInTheDocument();
    expect(
      screen.getByText(/estimate — assumes all 2 scheduled jobs complete/i),
    ).toBeInTheDocument();
    // Progress bar shows because in-progress count > 0.
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("includes already-completed jobs in 'earned so far' and the projected total", async () => {
    mockQueryResult.data = [
      // $90 already earned this week.
      {
        budget: 100,
        helpers_needed: null,
        is_group_job: false,
        helper_fee_percent: 10,
        urgent_fee: null,
        status: "completed",
      },
      // $90 still scheduled.
      {
        budget: 100,
        helpers_needed: null,
        is_group_job: false,
        helper_fee_percent: 10,
        urgent_fee: null,
        status: "in_progress",
      },
    ];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={true} feeFallbackPercent={10} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("$180")).toBeInTheDocument();
    });
    // 90 / 180 = 50%
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/earned so far · \$90/i)).toBeInTheDocument();
  });
});
// ── Shown able to fail ─────────────────────────────────────────────────────
// The money figure, not the chrome: "earned so far" is the only number on this
// card the helper can reconcile against their bank, and it is the one the
// projected total is built on top of. Zeroing its accumulator leaves the card
// rendering perfectly — skeleton, heading, CTA, progress bar all intact — and
// only the dollars wrong, which is exactly the failure a screenshot pass
// cannot see.
// @mutate src/components/profile/EarningsForecastCard.tsx | earnedSoFar += net; | earnedSoFar += 0;
// @mutate src/components/profile/EarningsForecastCard.tsx |   if (projectedTotal <= 0) return null;\n |
