/**
 * Declutter trades slice 3 (owner 10-31): the trade cards. Selling shows each open trade offer with Accept / Decline
 * and counts it under "To answer"; Buying shows the member's trade offers with Take it back while open; an accepted
 * trade points to the pickup choice only while the member's own $0 line still waits for it.
 * Server: src/test/declutterTrades.test.ts, src/test/pglite/declutterTrades.pglite.mjs.
 *
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |       {open && t.my_side === "seller" && ( |       {open && (
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |       {open && t.my_side === "buyer" && ( |       {t.my_side === "buyer" && (
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |       {t.status === "accepted" && t.my_line_status === "in_cart" && ( |       {t.status === "accepted" && (
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |   return (useMyTrades("seller", userId).data ?? []).filter((t) => t.status === "open").length; |   return 0;
 * @mutate src/components/declutter/DeclutterMineViews.tsx | + bundleAsks + tradeAsks + freeAsks.length; | + bundleAsks + freeAsks.length;
 * @mutate src/lib/declutter/trades.ts |     my_line_status: (side === "seller" ? seller_line : buyer_line)?.status ?? null, |     my_line_status: (side === "seller" ? buyer_line : seller_line)?.status ?? null,
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |       {t.talk_order_id && <TradeTalkButton orderId={t.talk_order_id} />}\n |
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx |     next.set("order_talk", orderId); |     next.set("talk", orderId);
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx | "Answer by" : "Waiting on the seller until" | "Answer:" : "Waiting on the seller until"
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx | variant="outline" data-trade-decline="" | variant="ghost" data-trade-decline=""
 * Audit 11-10 F360c: the accepted trade's link opens the cart's trade checkout (the one pickup step), not a reload.
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx | if (goToTradeCheckout((t.my_side === "seller" ? t.offered : t.item)?.id)) e.preventDefault(); | void e;
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import type { MyTrade } from "@/lib/declutter/trades";
import { orderWhen } from "@/lib/declutter/timeLeft";

const later = new Date(Date.now() + 10 * 3_600_000).toISOString();
const lamp = { id: "lamp", title: "Lamp", current_price_cents: 2000 };
const chair = { id: "chair", title: "Chair", current_price_cents: 3000 };
const row = (over: Partial<MyTrade>): MyTrade => ({
  id: "t1", status: "open", respond_by: later, created_at: later, my_side: "seller", item: lamp, offered: chair, my_line_status: null, talk_order_id: null, buyer_display: null, ...over,
});

const state = { rows: [] as MyTrade[], sent: [] as [string, string][] };

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  fetchMyTrades: async (side: string) => state.rows.map((r) => ({ ...r, my_side: side })),
  respondSwap: async (id: string, a: string) => {
    state.sent.push([id, a]);
    return a;
  },
}));

// fetchMyTrades' own mapping (the talk test below): the Supabase read answers these rows.
const supa = { rows: [] as unknown[], select: "", names: [] as unknown[], rpcs: [] as string[] };
vi.mock("@/integrations/supabase/client", () => {
  const chain = { eq: () => chain, in: () => chain, gte: () => chain, order: () => chain, limit: async () => ({ data: supa.rows, error: null }) };
  return { supabase: {
    from: () => ({ select: (cols: string) => { supa.select = cols; return chain; } }),
    // F356 follow-up: declutter_my_trade_buyer_names (20261112004253).
    rpc: async (fn: string) => { supa.rpcs.push(fn); return { data: supa.names, error: null }; },
  } };
});

const { TradeOffersSection } = await import("@/components/declutter/DeclutterTradeOffers");
const { useLocation } = await import("react-router-dom");
function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.search}</span>;
}

let client: QueryClient;
/** Every query this render started has settled: the "nothing shows" asserts below wait for the DATA, not first paint. */
const settled = (c: QueryClient) => c.getQueryCache().getAll().some((q) => q.state.status === "success") && c.getQueryCache().getAll().every((q) => q.state.fetchStatus === "idle");

const show = (side: "buyer" | "seller") =>
  render(
    <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
      <MemoryRouter>
        <TradeOffersSection side={side} userId="u1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const src = (f: string) => blankComments(readFileSync(f, "utf8"));

beforeEach(() => {
  state.rows = [];
  state.sent = [];
});

describe("Declutter trade cards (slice 3)", () => {
  it("the seller accepts or declines an open trade offer; nothing shows with none", async () => {
    const { container, unmount } = show("seller");
    await waitFor(() => {
      expect(settled(client)).toBe(true);
      expect(container.querySelector("[data-trade-offers]")).toBeNull();
    });
    unmount();
    state.rows = [row({})];
    show("seller");
    fireEvent.click(await screen.findByRole("button", { name: "Accept trade" }));
    await waitFor(() => expect(state.sent).toEqual([["t1", "accept"]]));
    // Audit 11-10 F401: a sentence with the deadline, not "Answer: 119 hours left"; Decline is an outlined button.
    expect(screen.getByText(`Answer by ${orderWhen(later)}. No money changes hands.`)).toBeTruthy();
    expect(screen.queryByText(/Answer:/)).toBeNull();
    const decline = screen.getByRole("button", { name: "Decline" });
    expect(decline.className).toContain("border");
    fireEvent.click(decline);
    await waitFor(() => expect(state.sent).toEqual([["t1", "accept"], ["t1", "decline"]]));
    expect(screen.queryByRole("button", { name: "Take it back" })).toBeNull();
    // The seller gives their own listing and gets the buyer's.
    expect(screen.getByText("You give").parentElement?.textContent).toContain("Lamp");
    expect(screen.getByText("You get").parentElement?.textContent).toContain("Chair");
  });

  it("the buyer takes back an open offer and can't answer it; a closed one says what became of it", async () => {
    state.rows = [row({})];
    const { unmount } = show("buyer");
    fireEvent.click(await screen.findByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.sent).toEqual([["t1", "withdraw"]]));
    expect(screen.queryByRole("button", { name: "Accept trade" })).toBeNull();
    unmount();
    state.rows = [row({ status: "declined" })];
    show("buyer");
    expect(await screen.findByText(/Declined\. Nothing changed hands\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take it back" })).toBeNull();
  });

  it("an accepted trade points to the pickup only while the member's own line waits for it", async () => {
    state.rows = [row({ id: "a", status: "accepted", my_line_status: "in_cart" }), row({ id: "b", status: "accepted", my_line_status: "paid" })];
    const { container } = show("seller");
    await screen.findAllByText(/Accepted\./);
    const links = container.querySelectorAll("[data-trade-pickup]");
    expect(links.length).toBe(1);
    expect(links[0].closest("[data-trade-card]")?.getAttribute("data-trade-card")).toBe("a");
  });

  it("F360c: the accepted trade's link opens the cart's trade checkout and focuses it", async () => {
    state.rows = [row({ id: "a", status: "accepted", my_line_status: "in_cart" })];
    const { container } = show("seller");
    // The seller gets the buyer's chair; the cart's trade checkout holds it (DeclutterTradeViews' markers).
    const box = document.createElement("section");
    box.setAttribute("data-checkout-seller", "u-buyer");
    box.setAttribute("data-checkout-kind", "trade");
    box.innerHTML = `<ul><li data-cart-line="" data-cart-item="${chair.id}">Chair</li></ul>`;
    document.body.appendChild(box);
    const link = await screen.findByText("Go to my trade in the cart");
    expect(link.closest("[data-trade-card]")).toBe(container.querySelector('[data-trade-card="a"]'));
    fireEvent.click(link);
    expect(document.activeElement).toBe(box);
    box.remove();
  });

  // Trades audit 11-08 #10: both trade cards open the trade's one existing order chat (?order_talk=, DeclutterPage).
  it("both trade cards open the trade's one order chat once a side has checked out; none before", async () => {
    state.rows = [row({ id: "a", status: "accepted", my_line_status: "in_cart", talk_order_id: null }),
      row({ id: "b", status: "accepted", my_line_status: "paid", talk_order_id: "order-1" })];
    for (const side of ["seller", "buyer"] as const) {
      const r = render(
        <QueryClientProvider client={(client = new QueryClient({ defaultOptions: { queries: { retry: false } } }))}>
          <MemoryRouter initialEntries={["/declutter?tab=selling"]}>
            <TradeOffersSection side={side} userId="u1" />
            <Where />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const buttons = await screen.findAllByRole("button", { name: "Message about the trade" });
      expect(buttons).toHaveLength(1);
      expect(buttons[0].closest("[data-trade-card]")?.getAttribute("data-trade-card")).toBe("b");
      fireEvent.click(buttons[0]);
      expect(screen.getByTestId("where").textContent).toBe("?tab=selling&order_talk=order-1");
      r.unmount();
    }
  });

  it("the chat is the checked-out line's order, the wanted item's first, and only on an accepted or done trade", async () => {
    const { fetchMyTrades } = await vi.importActual<typeof import("@/lib/declutter/trades")>("@/lib/declutter/trades");
    const line = (status: string, order_id: string | null) => ({ status, order_id });
    const base = { id: "t", respond_by: later, created_at: later, item: lamp, offered: chair };
    supa.rows = [
      { ...base, id: "both", status: "accepted", buyer_line: line("paid", "o-want"), seller_line: line("paid", "o-offered") },
      { ...base, id: "second", status: "accepted", buyer_line: line("in_cart", null), seller_line: line("paid", "o-offered") },
      { ...base, id: "none", status: "accepted", buyer_line: line("in_cart", null), seller_line: line("in_cart", null) },
      { ...base, id: "ended", status: "lapsed", buyer_line: line("missed", "o-old"), seller_line: line("paid", "o-old2") },
      { ...base, id: "open", status: "open", buyer_line: null, seller_line: null },
    ];
    const got = await fetchMyTrades("seller", "u1");
    expect(Object.fromEntries(got.map((t) => [t.id, t.talk_order_id]))).toEqual({ both: "o-want", second: "o-offered", none: null, ended: null, open: null });
    expect(supa.select).toMatch(/buyer_line:declutter_cart_items!declutter_swap_offers_buyer_line_id_fkey\(status, order_id\)/);
  });

  // F356 follow-up (owner 11-11 "everywhere"; lead: the trade list counts): the seller's trade card names the trader as
  // first name + last initial, from the server; the buyer's card never names anyone new, and never asks for names.
  // @mutate src/lib/declutter/trades.ts |   const names = side === "seller" && rows.length > 0 ? await fetchTradeBuyerNames() : new Map<string, string>(); |   const names = new Map<string, string>();
  // @mutate src/components/declutter/DeclutterTradeOffers.tsx |       {t.my_side === "seller" && t.buyer_display && <p | {t.buyer_display && <p
  it("F356 follow-up: the seller's trade card says From Ann S.; the buyer's names nobody", async () => {
    const { fetchMyTrades } = await vi.importActual<typeof import("@/lib/declutter/trades")>("@/lib/declutter/trades");
    const base = { respond_by: later, created_at: later, item: lamp, offered: chair, buyer_line: null, seller_line: null, status: "open" };
    supa.rows = [{ ...base, id: "a" }, { ...base, id: "b" }];
    supa.names = [{ swap_id: "a", buyer_display: "Ann S." }, { swap_id: "b", buyer_display: null }];
    supa.rpcs = [];
    const seller = await fetchMyTrades("seller", "u1");
    expect(Object.fromEntries(seller.map((t) => [t.id, t.buyer_display]))).toEqual({ a: "Ann S.", b: null });
    expect(supa.rpcs).toEqual(["declutter_my_trade_buyer_names"]);
    supa.rpcs = [];
    const buyer = await fetchMyTrades("buyer", "u1");
    expect(buyer.map((t) => t.buyer_display)).toEqual([null, null]);
    expect(supa.rpcs).toEqual([]);

    state.rows = [row({ id: "a", buyer_display: "Ann S." })];
    const r = show("seller");
    expect((await screen.findByText("From Ann S.")).closest("[data-trade-card]")?.getAttribute("data-trade-card")).toBe("a");
    r.unmount();
    show("buyer");
    await waitFor(() => expect(settled(client)).toBe(true));
    expect(document.querySelector("[data-trade-card]")).not.toBeNull();
    expect(screen.queryByText(/^From /)).toBeNull();
  });

  it("Selling's To answer counts the open trade offers, and both tabs show the section", () => {
    const views = src("src/components/declutter/DeclutterMineViews.tsx");
    expect(views).toMatch(/\+ bundleAsks \+ tradeAsks \+ freeAsks\.length;/);
    expect(views).toMatch(/const tradeAsks = useTradeOffersToAnswer\(userId\)/);
    expect(views).toMatch(/<TradeOffersSection side="seller" userId=\{userId\} \/>/);
    expect(views).toMatch(/<TradeOffersSection side="buyer" userId=\{user\?\.id \?\? null\}[^>]*\/>/);
    const cards = src("src/components/declutter/DeclutterTradeOffers.tsx");
    expect(cards).toMatch(/\.filter\(\(t\) => t\.status === "open"\)\.length/);
  });

  it("each side reads its OWN line (the seller gets the buyer's item on seller_line)", async () => {
    const lib = src("src/lib/declutter/trades.ts");
    expect(lib).toMatch(/my_line_status: \(side === "seller" \? seller_line : buyer_line\)\?\.status \?\? null/);
    const n = (lib.match(/declutter_swap_offers_[a-z_]+_fkey/g) ?? []).length;
    expect(n).toBeGreaterThan(3);
  });

  it("every respond_swap refusal has words", async () => {
    const { rpcErrorMessage } = await import("@/lib/declutter/tradeErrors");
    for (const code of ["trade_not_open", "trade_expired", "trade_not_found", "invalid_action", "item_not_available"]) {
      expect(rpcErrorMessage("declutter_respond_swap", new Error(code)), code).toBeTruthy();
    }
  });
});
