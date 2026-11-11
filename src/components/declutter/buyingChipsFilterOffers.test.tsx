/**
 * Audit 11-10 F374: on the Buying tab the chips (Needs you / Waiting / Done / Cancelled) narrowed only the orders;
 * "Your offers" and "Your trade offers" kept every row whatever chip was on. The sections now take the chip (`only`)
 * and keep just the rows it files (buyingBucket), and drop out of the page when none of theirs fit.
 *
 * @mutate src/lib/declutter/buyingBucket.ts |  return only ? rows.filter((r) => bucketOf(r) === only) : rows; |  return rows;
 * @mutate src/lib/declutter/buyingBucket.ts |  if (o.status === "accepted") return "done"; |  if (o.status === "accepted") return "cancelled";
 * @mutate src/lib/declutter/buyingBucket.ts |  if (t.status === "open") return side === "seller" ? "needs_you" : "waiting"; |  if (t.status === "open") return "needs_you";
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |  if (only && mine.length === 0) return null; |  if (false) return null;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { offerBucket, tradeBucket } from "@/lib/declutter/buyingBucket";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
const offer = (offer_id: string, status: string, awaiting: "buyer" | "seller" = "seller") => ({
  offer_id, item_id: `i-${offer_id}`, item_title: `Item ${offer_id}`, my_side: "buyer", amount_cents: 600, awaiting, status,
  respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 0, current_price_cents: 1000, floor_price_cents: null, updated_at: "2026-11-10",
});
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyOffers: async () => [offer("open", "open"), offer("won", "accepted"), offer("lost", "declined")],
  fetchItemHandovers: async () => [],
}));
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  fetchMyTrades: async () => [
    { id: "t-open", status: "open", respond_by: "2026-11-12T00:00:00Z", created_at: "2026-11-10T00:00:00Z", my_side: "buyer", item: { id: "a", title: "Lamp", current_price_cents: 1000 }, offered: { id: "b", title: "Rug", current_price_cents: 1000 }, my_line_status: null, talk_order_id: null },
    { id: "t-lapsed", status: "lapsed", respond_by: "2026-11-09T00:00:00Z", created_at: "2026-11-07T00:00:00Z", my_side: "buyer", item: { id: "c", title: "Chair", current_price_cents: 1000 }, offered: { id: "d", title: "Desk", current_price_cents: 1000 }, my_line_status: null, talk_order_id: null },
  ],
}));

import { OffersSection } from "./DeclutterOffersSection";
import { TradeOffersSection } from "./DeclutterTradeOffers";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("the Buying chips file offers and trade offers like orders (F374)", () => {
  it("offerBucket / tradeBucket", () => {
    expect(offerBucket({ status: "open", awaiting: "buyer" }, "buyer")).toBe("needs_you");
    expect(offerBucket({ status: "open", awaiting: "seller" }, "buyer")).toBe("waiting");
    expect(offerBucket({ status: "accepted", awaiting: "buyer" }, "buyer")).toBe("done");
    for (const status of ["declined", "expired", "withdrawn", "voided"] as const) expect(offerBucket({ status, awaiting: "buyer" }, "buyer")).toBe("cancelled");
    expect(tradeBucket({ status: "open", my_line_status: null }, "buyer")).toBe("waiting");
    expect(tradeBucket({ status: "open", my_line_status: null }, "seller")).toBe("needs_you");
    expect(tradeBucket({ status: "accepted", my_line_status: "in_cart" }, "buyer")).toBe("needs_you");
    expect(tradeBucket({ status: "accepted", my_line_status: "paid" }, "buyer")).toBe("done");
    expect(tradeBucket({ status: "completed", my_line_status: "paid" }, "buyer")).toBe("done");
    expect(tradeBucket({ status: "lapsed", my_line_status: null }, "buyer")).toBe("cancelled");
  });

  it("Your offers keeps only the chip's rows, every row with no chip, and goes away when none fit", async () => {
    const all = wrap(<OffersSection side="buyer" />);
    await screen.findByText("Item open");
    expect(screen.getByText("Item won")).toBeInTheDocument();
    expect(screen.getByText("Item lost")).toBeInTheDocument();
    all.unmount();

    const cancelled = wrap(<OffersSection side="buyer" only="cancelled" />);
    await screen.findByText("Item lost");
    expect(screen.queryByText("Item open")).toBeNull();
    expect(screen.queryByText("Item won")).toBeNull();
    cancelled.unmount();

    const upcoming = wrap(<OffersSection side="buyer" only="upcoming" />);
    await vi.waitFor(() => expect(upcoming.container.querySelector("section")).toBeNull());
    expect(screen.queryByText("Your offers")).toBeNull();
  });

  it("Your trade offers keeps only the chip's rows and goes away when none fit", async () => {
    const waiting = wrap(<TradeOffersSection side="buyer" userId="u1" only="waiting" />);
    await screen.findByText(/Lamp/);
    expect(screen.queryByText(/Chair/)).toBeNull();
    waiting.unmount();

    const done = wrap(<TradeOffersSection side="buyer" userId="u1" only="done" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(done.container.querySelector("[data-trade-offers]")).toBeNull();
  });
});
