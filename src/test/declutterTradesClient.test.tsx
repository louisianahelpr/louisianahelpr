/**
 * Declutter trades slice 2 (owner 10-31): "Open to trades" in Settings > Listing defaults and per listing in Manage
 * listing, a new listing taking the default, and "Offer a trade" with its picker on the item page.
 * The server side: src/test/declutterTrades.test.ts and src/test/pglite/declutterTrades.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx |   if (item.accepts_trades !== true) return null; |   if (item.accepts_trades === undefined) return null;
 * @mutate src/lib/declutter/trades.ts | it.status === "live" && it.current_price_cents > 0 && it.id !== excludeId | it.status === "live" && it.id !== excludeId
 * @mutate src/lib/declutter/tradesOnPost.ts |   if (!wanted) return "off"; |
 * @mutate src/lib/declutter/sellerDefaults.ts |   const trades = d.acceptsTrades === undefined ? {} : { accepts_trades: d.acceptsTrades }; |   const trades = { accepts_trades: d.acceptsTrades === true };
 * @mutate src/components/declutter/DeclutterManageListing.tsx |               <DeclutterTradeRules itemId={item.id} rowClassName={ROW} />\n |
 * @mutate src/components/declutter/DeclutterItemView.tsx |     {canAct && user && !free && it.status === "live" && <Suspense fallback={null}><OfferTradeButton item={it} userId={user.id} /></Suspense>}\n |
 * Audit 1110 F359g: one line under Offer a trade says what a trade is.
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx |         {t("dp.tradeWhat")}\n |
 * Audit 1110 F359f: the buyer's open trade offer on this item shows in place of Offer a trade.
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx |   if (myOpen) { |   if (false) {
 * @mutate src/components/declutter/DeclutterOfferTrade.tsx | t.status === "open" && t.item?.id === item.id | t.status === "open"
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { tradeableListings } from "@/lib/declutter/trades";
import { tradesOnIfChosen } from "@/lib/declutter/tradesOnPost";

const state = {
  takes: true,
  mine: [] as { id: string; title: string; status: string; current_price_cents: number }[],
  sent: [] as [string, string][],
  /** Audit 1110 F359f: the buyer's own trade offers (Buying's read). */
  trades: [] as unknown[],
};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  offerSwap: async (item: string, offered: string) => {
    state.sent.push([item, offered]);
    return "swap-1";
  },
  fetchMyTrades: async () => state.trades,
}));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyItems: async () => state.mine,
}));

const { OfferTradeButton } = await import("@/components/declutter/DeclutterOfferTrade");

let client: QueryClient;

const renderButton = () =>
  render(
    <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
      <MemoryRouter>
        <OfferTradeButton item={{ id: "want", title: "Lamp", accepts_trades: state.takes }} userId="u1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

beforeEach(() => {
  state.takes = true;
  state.mine = [];
  state.sent = [];
  state.trades = [];
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

  it("a new listing is opened to trades only when the posting row is on", async () => {
    const set = vi.fn(async () => {});
    expect(await tradesOnIfChosen("i1", false, set)).toBe("off");
    expect(set).not.toHaveBeenCalled();
    expect(await tradesOnIfChosen("i1", true, set)).toBe("on");
    expect(set).toHaveBeenCalledWith("i1", true);
  });

  it("no Offer a trade on a listing that is not open to trades", async () => {
    state.takes = false;
    // Trades audit 11-08 #22: no read of its own any more; the item read's accepts_trades decides at once.
    const { container } = renderButton();
    expect(container.querySelector("[data-offer-trade]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Offer a trade" })).toBeNull();
    expect(client.getQueryCache().getAll().filter((q) => q.state.fetchStatus !== "idle")).toEqual([]);
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

  it("F359g: under Offer a trade, one line says what a trade is (no money, each picks up the other's item)", async () => {
    const { container } = renderButton();
    await screen.findByRole("button", { name: "Offer a trade" });
    expect(container.querySelector("[data-offer-trade-what]")?.textContent?.trim())
      .toBe("Swap one of your listings for this. No money changes hands, and each of you picks up the other's item.");
  });

  it("F359f: the buyer's open trade offer on this item replaces Offer a trade; one on another item does not", async () => {
    const trade = (id: string, itemId: string) => ({ id, status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), created_at: "2026-11-10T00:00:00Z",
      my_side: "buyer", item: { id: itemId, title: "Lamp", current_price_cents: 2000 }, offered: { id: "spk", title: "Bluetooth speaker", current_price_cents: 2500 }, my_line_status: null, talk_order_id: null });
    state.trades = [trade("t-other", "elsewhere")];
    const first = renderButton();
    await waitFor(() => expect(client.getQueryCache().getAll().every((q) => q.state.fetchStatus === "idle")).toBe(true));
    expect(screen.getByRole("button", { name: "Offer a trade" })).toBeTruthy();
    first.unmount();
    state.trades = [trade("t-other", "elsewhere"), trade("t1", "want")];
    const { container } = renderButton();
    const box = await waitFor(() => {
      const el = container.querySelector("[data-my-open-trade]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(box.textContent).toContain("You offered your Bluetooth speaker in trade");
    expect(box.textContent).toContain("Waiting on the seller.");
    expect(screen.getByRole("link", { name: "See it in Buying" }).getAttribute("href")).toBe("/declutter?tab=buying");
    expect(screen.queryByRole("button", { name: "Offer a trade" })).toBeNull();
  });

  it("a buyer with nothing to trade is told how to list one", async () => {
    renderButton();
    fireEvent.click(await screen.findByRole("button", { name: "Offer a trade" }));
    expect(await screen.findByText(/You have no listings up to trade/)).toBeTruthy();
  });

  it("the switches and the picker are wired in (Settings default, Manage listing, item page, new listing)", () => {
    expect(src("src/components/declutter/DeclutterListingDefaults.tsx")).toMatch(/change\(\{ acceptsTrades: v === true \}\)/);
    expect(src("src/components/declutter/DeclutterManageListing.tsx")).toMatch(/<DeclutterTradeRules itemId=\{item\.id\}/);
    expect(src("src/components/declutter/DeclutterItemView.tsx")).toMatch(/canAct && user && !free && it\.status === "live" && <Suspense fallback=\{null\}><OfferTradeButton/);
    expect(src("src/components/declutter/useSellFlowState.ts")).toMatch(/tradesOnIfChosen\(id, tradesWanted\)/);
    // A save that leaves the choice out (Sell a bunch) never turns trades off.
    expect(src("src/lib/declutter/sellerDefaults.ts")).toMatch(/d\.acceptsTrades === undefined \? \{\} : \{ accepts_trades: d\.acceptsTrades \}/);
  });
});
