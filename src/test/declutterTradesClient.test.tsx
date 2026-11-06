/**
 * Declutter trades slice 2 (owner 10-31): "Open to trades" in Settings > Listing defaults and per listing in Manage
 * listing, a new listing taking the default, and "Offer a trade" with its picker on the item page.
 * The server side: src/test/declutterTrades.test.ts and src/test/pglite/declutterTrades.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx |   if (takes.data !== true) return null; |   if (takes.data === undefined) return null;
 * @mutate src/lib/declutter/trades.ts | it.status === "live" && it.current_price_cents > 0 && it.id !== excludeId | it.status === "live" && it.id !== excludeId
 * @mutate src/lib/declutter/tradesOnPost.ts |   if (saved?.acceptsTrades !== true) return "off"; |
 * @mutate src/lib/declutter/sellerDefaults.ts |   const trades = d.acceptsTrades === undefined ? {} : { accepts_trades: d.acceptsTrades }; |   const trades = { accepts_trades: d.acceptsTrades === true };
 * @mutate src/components/declutter/DeclutterManageListing.tsx |               <DeclutterTradeRules itemId={item.id} rowClassName={ROW} />\n |
 * @mutate src/components/declutter/DeclutterItemView.tsx |     {canAct && user && !free && it.status === "live" && <OfferTradeButton item={it} userId={user.id} />}\n |
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { tradeableListings } from "@/lib/declutter/trades";
import { tradesOnFromDefault } from "@/lib/declutter/tradesOnPost";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";

const state = {
  takes: true,
  mine: [] as { id: string; title: string; status: string; current_price_cents: number }[],
  sent: [] as [string, string][],
};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  fetchAcceptsTrades: async () => state.takes,
  offerSwap: async (item: string, offered: string) => {
    state.sent.push([item, offered]);
    return "swap-1";
  },
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyItems: async () => state.mine,
}));

const { OfferTradeButton } = await import("@/components/declutter/DeclutterOfferTrade");

const renderButton = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <OfferTradeButton item={{ id: "want", title: "Lamp" }} userId="u1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

beforeEach(() => {
  state.takes = true;
  state.mine = [];
  state.sent = [];
});

describe("Declutter trades, client (slice 2)", () => {
  it("only the buyer's own live, priced listings can be offered, never the wanted item itself", () => {
    const mine = [
      { id: "a", status: "live", current_price_cents: 1000 },
      { id: "b", status: "live", current_price_cents: 0 },
      { id: "c", status: "sold", current_price_cents: 1000 },
      { id: "want", status: "live", current_price_cents: 1000 },
    ];
    expect(tradeableListings(mine, "want").map((m) => m.id)).toEqual(["a"]);
  });

  it("a new listing is opened to trades only when the saved default is on", async () => {
    const set = vi.fn(async () => {});
    const base: SellerDefaults = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch"], acceptsOffers: true };
    expect(await tradesOnFromDefault("u1", "i1", { defaults: async () => null, set })).toBe("off");
    expect(await tradesOnFromDefault("u1", "i1", { defaults: async () => ({ ...base, acceptsTrades: false }), set })).toBe("off");
    expect(set).not.toHaveBeenCalled();
    expect(await tradesOnFromDefault("u1", "i1", { defaults: async () => ({ ...base, acceptsTrades: true }), set })).toBe("on");
    expect(set).toHaveBeenCalledWith("i1", true);
  });

  it("no Offer a trade on a listing that is not open to trades", async () => {
    state.takes = false;
    const { container } = renderButton();
    await waitFor(() => expect(container.querySelector("[data-offer-trade]")).toBeNull());
    expect(screen.queryByRole("button", { name: "Offer a trade" })).toBeNull();
  });

  it("the buyer picks one of their listings and sends it", async () => {
    state.mine = [
      { id: "chair", title: "Chair", status: "live", current_price_cents: 3000 },
      { id: "box", title: "Box", status: "live", current_price_cents: 0 },
    ];
    renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "Offer a trade" }));
    const chair = await screen.findByRole("radio", { name: /Chair/ });
    expect(screen.queryByRole("radio", { name: /Box/ })).toBeNull();
    const send = screen.getByRole("button", { name: "Send trade offer" });
    expect(send).toBeDisabled();
    fireEvent.click(chair);
    fireEvent.click(screen.getByRole("button", { name: "Send trade offer" }));
    await waitFor(() => expect(state.sent).toEqual([["want", "chair"]]));
  });

  it("a buyer with nothing to trade is told how to list one", async () => {
    renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "Offer a trade" }));
    expect(await screen.findByText(/You have no listings up to trade/)).toBeTruthy();
  });

  it("the switches and the picker are wired in (Settings default, Manage listing, item page, new listing)", () => {
    expect(src("src/components/declutter/DeclutterListingDefaults.tsx")).toMatch(/change\(\{ acceptsTrades: v === true \}\)/);
    expect(src("src/components/declutter/DeclutterManageListing.tsx")).toMatch(/<DeclutterTradeRules itemId=\{item\.id\}/);
    expect(src("src/components/declutter/DeclutterItemView.tsx")).toMatch(/canAct && user && !free && it\.status === "live" && <OfferTradeButton/);
    expect(src("src/components/declutter/useSellFlowState.ts")).toMatch(/tradesOnFromDefault\(user\.id, id\)/);
    // A save that leaves the choice out (Sell a bunch) never turns trades off.
    expect(src("src/lib/declutter/sellerDefaults.ts")).toMatch(/d\.acceptsTrades === undefined \? \{\} : \{ accepts_trades: d\.acceptsTrades \}/);
  });
});
