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

  it("renders the empty state with a Browse jobs CTA when there are no in-progress earnings", async () => {
    mockQueryResult.data = [];
    const { wrapper: Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <EarningsForecastCard helperId="helper-1" enabled={true} feeFallbackPercent={10} />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText(/no jobs lined up yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /browse jobs/i })).toBeInTheDocument();
    // The honest-framing caveat should NOT appear in the empty state.
    expect(screen.queryByText(/estimate — assumes/i)).not.toBeInTheDocument();
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
      expect(screen.getByText("$180.00")).toBeInTheDocument();
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
      expect(screen.getByText("$180.00")).toBeInTheDocument();
    });
    // 90 / 180 = 50%
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/earned so far · \$90\.00/i)).toBeInTheDocument();
  });
});
