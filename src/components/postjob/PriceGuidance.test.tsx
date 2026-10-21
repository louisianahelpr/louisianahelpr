/**
 * Board 190: price guidance on the price screen. Every number is real or hidden: no range from the server
 * (below the floor set 2026-10-21: 30 real jobs from 3 posters), the switch off, or a failed read shows nothing at all.
 * @mutate src/components/postjob/PriceGuidance.tsx |       if (!r \|\| r.low_dollars == null \|\| r.high_dollars == null \|\| !(r.sample_count > 0)) return null; |       if (!r) return null;
 * @mutate src/components/postjob/PriceGuidance.tsx |   const below = budget > 0 && budget < g.low && kept !== budget; |   const below = false;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PriceGuidanceCard } from "./PriceGuidance";

const state = {
  on: true,
  rows: [] as unknown,
  error: null as null | { code?: string; message: string },
  calls: [] as unknown[],
};
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ fn, args });
      return state.error ? { data: null, error: state.error } : { data: state.rows, error: null };
    },
  },
}));

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  state.on = true;
  state.rows = [];
  state.error = null;
  state.calls = [];
});

describe("price guidance (board 190)", () => {
  it("shows the real range, the count and the poster's price", async () => {
    state.rows = [{ sample_count: 32, low_dollars: 80, high_dollars: 120 }];
    wrap(<PriceGuidanceCard category="pressure_washing" budget={90} onUse={() => {}} />);
    expect(await screen.findByText("$80–$120")).toBeInTheDocument();
    expect(screen.getByText(/Most pressure washing jobs paid/i)).toBeInTheDocument();
    expect(screen.getByText("From 32 completed jobs on Helpr in the last 90 days. You're at $90.")).toBeInTheDocument();
    expect(state.calls).toEqual([{ fn: "get_price_guidance", args: { p_category: "pressure_washing" } }]);
  });

  it("below the range: a gentle nudge; Use $80 sets the price, Keep hides the nudge", async () => {
    state.rows = [{ sample_count: 32, low_dollars: 80, high_dollars: 120 }];
    const onUse = vi.fn();
    wrap(<PriceGuidanceCard category="pressure_washing" budget={40} onUse={onUse} />);
    expect(await screen.findByText("That's below what most jobs paid")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use $80" }));
    expect(onUse).toHaveBeenCalledWith(80);
    fireEvent.click(screen.getByRole("button", { name: "Keep $40" }));
    expect(await screen.findByTestId("price-guidance")).toBeInTheDocument();
    expect(screen.queryByText("That's below what most jobs paid")).toBeNull();
  });

  it("fewer than 30 real jobs (no range from the server): nothing at all", async () => {
    state.rows = [{ sample_count: 12, low_dollars: null, high_dollars: null }];
    const { container } = wrap(<PriceGuidanceCard category="pressure_washing" budget={90} onUse={() => {}} />);
    await waitFor(() => expect(state.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // let the answer render, if it would
    expect(container).toBeEmptyDOMElement();
  });

  it("switch off: no read and nothing shown", async () => {
    state.on = false;
    const { container } = wrap(<PriceGuidanceCard category="pressure_washing" budget={90} onUse={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.calls).toEqual([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("a failed read shows nothing (never a guess)", async () => {
    state.error = { code: "XX000", message: "boom" };
    const { container } = wrap(<PriceGuidanceCard category="pressure_washing" budget={90} onUse={() => {}} />);
    await waitFor(() => expect(state.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // let the answer render, if it would
    expect(container).toBeEmptyDOMElement();
  });
});
