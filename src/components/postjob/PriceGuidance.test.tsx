/**
 * Owner 2026-11-20 (ease batch, item 1): the fair price hint on Budget. A real range says where it came from ("near
 * you" / "on Helpr", with its count); the server's typical fallback says it is typical and never claims Helpr jobs; the
 * member's saved point goes to the server; a failed read shows nothing (never a guess).
 * @mutate src/components/postjob/PriceGuidance.tsx |   const headline = t(g.scope === "near" ? "postJob.hint.near" : g.scope === "state" ? "postJob.hint.state" : "postJob.hint.typical", { what }); |   const headline = t("postJob.hint.near", { what });
 * @mutate src/components/postjob/PriceGuidance.tsx |   const below = budget > 0 && budget < g.low && kept !== budget; |   const below = false;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PriceGuidanceCard } from "./PriceGuidance";

const state = {
  rows: [] as unknown,
  error: null as null | { code?: string; message: string },
  calls: [] as unknown[],
  profile: { latitude: 30.2241, longitude: -92.0198 } as null | { latitude: number | null; longitude: number | null },
};
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: state.profile }) }));
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
  state.rows = [];
  state.error = null;
  state.calls = [];
  state.profile = { latitude: 30.2241, longitude: -92.0198 };
});

describe("fair price hint (owner 11-20)", () => {
  it("near: the real range near the member, its count and the poster's price; the saved point is sent (rounded)", async () => {
    state.rows = [{ scope: "near", sample_count: 7, low_dollars: 40, high_dollars: 80 }];
    wrap(<PriceGuidanceCard category="yard_work" budget={60} onUse={() => {}} />);
    expect(await screen.findByText("$40–$80")).toBeInTheDocument();
    expect(screen.getByText(/Most yard work jobs near you are/i)).toBeInTheDocument();
    expect(screen.getByText("From 7 recent jobs posted on Helpr. You're at $60.")).toBeInTheDocument();
    expect(state.calls).toEqual([{ fn: "get_fair_price_hint", args: { p_category: "yard_work", p_lat: 30.22, p_lng: -92.02 } }]);
  });

  it("typical (thin data, or a guest): says typical, never 'on Helpr' or 'near you'; no point when none is saved", async () => {
    state.profile = null;
    state.rows = [{ scope: "typical", sample_count: null, low_dollars: 40, high_dollars: 80 }];
    wrap(<PriceGuidanceCard category="yard_work" budget={0} onUse={() => {}} />);
    expect(await screen.findByText("$40–$80")).toBeInTheDocument();
    expect(screen.getByText(/A fair start for yard work is/i)).toBeInTheDocument();
    expect(screen.getByText("A typical Louisiana range. You set the price.")).toBeInTheDocument();
    expect(screen.queryByText(/near you|on Helpr/i)).toBeNull();
    expect(state.calls).toEqual([{ fn: "get_fair_price_hint", args: { p_category: "yard_work" } }]);
  });

  it("below the range: a gentle nudge; Use $40 sets the price, Keep hides the nudge", async () => {
    state.rows = [{ scope: "state", sample_count: 9, low_dollars: 40, high_dollars: 80 }];
    const onUse = vi.fn();
    wrap(<PriceGuidanceCard category="yard_work" budget={25} onUse={onUse} />);
    expect(await screen.findByText("That's below the usual range")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use $40" }));
    expect(onUse).toHaveBeenCalledWith(40);
    fireEvent.click(screen.getByRole("button", { name: "Keep $25" }));
    expect(await screen.findByTestId("price-guidance")).toBeInTheDocument();
    expect(screen.queryByText("That's below the usual range")).toBeNull();
  });

  it("a failed read or no row shows nothing (never a guess)", async () => {
    state.error = { code: "XX000", message: "boom" };
    const { container } = wrap(<PriceGuidanceCard category="yard_work" budget={90} onUse={() => {}} />);
    await waitFor(() => expect(state.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // let the answer render, if it would
    expect(container).toBeEmptyDOMElement();
  });
});
