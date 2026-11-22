/**
 * Owner 2026-11-20 (ease batch, item 1): the fair price hint on Budget. A real range says where it came from ("near
 * you" / "on Helpr", with its count); the server's typical fallback says it is typical and never claims Helpr jobs; the
 * member's saved point goes to the server; a failed read shows nothing (never a guess).
 * Audit 11-21 (P24, S37): "Start at $low" at $0, and the nudge's Use outlined.
 * @mutate src/components/postjob/PriceGuidance.tsx |       {budget <= 0 && ( |       {false && (
 * @mutate src/components/postjob/PriceGuidance.tsx |           <Button type="button" size="sm" variant="outline" onClick={() => onUse(g.low)}> |           <Button type="button" size="sm" className="btn-grad-primary" onClick={() => onUse(g.low)}>
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
  it("near: the real range near the member, its band (never an exact count) and the poster's price; the saved point is sent (rounded)", async () => {
    state.rows = [{ scope: "near", sample_band: "5+", low_dollars: 40, high_dollars: 80 }];
    wrap(<PriceGuidanceCard category="yard_work" budget={60} onUse={() => {}} />);
    expect(await screen.findByText("$40–$80")).toBeInTheDocument();
    expect(screen.getByText(/Most yard work jobs near you$/i)).toBeInTheDocument();
    // A price is set, so no "Start at" button (audit 11-21 P24).
    expect(screen.queryByRole("button", { name: /^Start at/ })).toBeNull();
    expect(screen.getByText("From 5+ recent jobs posted on Helpr. You're at $60.")).toBeInTheDocument();
    expect(state.calls).toEqual([{ fn: "get_fair_price_hint", args: { p_category: "yard_work", p_lat: 30.22, p_lng: -92.02 } }]);
  });

  it("typical (thin data, or a guest): says typical, never 'on Helpr' or 'near you'; no point when none is saved", async () => {
    state.profile = null;
    state.rows = [{ scope: "typical", sample_band: null, low_dollars: 40, high_dollars: 80 }];
    wrap(<PriceGuidanceCard category="yard_work" budget={0} onUse={() => {}} />);
    expect(await screen.findByText("$40–$80")).toBeInTheDocument();
    expect(screen.getByText(/^Fair start for yard work$/i)).toBeInTheDocument();
    expect(screen.getByText("A typical Louisiana range. You set the price.")).toBeInTheDocument();
    expect(screen.queryByText(/near you|on Helpr/i)).toBeNull();
    expect(state.calls).toEqual([{ fn: "get_fair_price_hint", args: { p_category: "yard_work" } }]);
  });

  it("below the range: a gentle nudge; Use $40 sets the price, Keep hides the nudge", async () => {
    state.rows = [{ scope: "state", sample_band: "5+", low_dollars: 40, high_dollars: 80 }];
    const onUse = vi.fn();
    wrap(<PriceGuidanceCard category="yard_work" budget={25} onUse={onUse} />);
    expect(await screen.findByText("That's below the usual range")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use $40" }));
    expect(onUse).toHaveBeenCalledWith(40);
    fireEvent.click(screen.getByRole("button", { name: "Keep $25" }));
    expect(await screen.findByTestId("price-guidance")).toBeInTheDocument();
    expect(screen.queryByText("That's below the usual range")).toBeNull();
  });

  // Audit 11-21 (P24, S37): at $0 one tap starts the price at the range's low end; never filled in by itself. The
  // below-range nudge's "Use $40" is outlined (the page's one olive button is Review).
  it("no price yet: Start at $40 sets the low end on a tap; the nudge's Use is outlined", async () => {
    state.rows = [{ scope: "typical", sample_band: null, low_dollars: 40, high_dollars: 80 }];
    const onUse = vi.fn();
    const first = wrap(<PriceGuidanceCard category="yard_work" budget={0} onUse={onUse} />);
    const start = await screen.findByRole("button", { name: "Start at $40" });
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(start);
    expect(onUse).toHaveBeenCalledWith(40);
    first.unmount();
    wrap(<PriceGuidanceCard category="yard_work" budget={25} onUse={onUse} />);
    const use = await screen.findByRole("button", { name: "Use $40" });
    expect(use.className).not.toContain("btn-grad-primary");
  });

  it("a failed read or no row shows nothing (never a guess)", async () => {
    state.error = { code: "XX000", message: "boom" };
    const { container } = wrap(<PriceGuidanceCard category="yard_work" budget={90} onUse={() => {}} />);
    await waitFor(() => expect(state.calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // let the answer render, if it would
    expect(container).toBeEmptyDOMElement();
  });
});
