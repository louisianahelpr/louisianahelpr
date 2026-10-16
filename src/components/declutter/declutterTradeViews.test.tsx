/**
 * The Declutter screens added by slice 3 (docs/specs/declutter-auctions.md rows 13, 16-22,
 * 36, 38, 53, 56-59; B25-B38): what each STATE renders, in plain words. The
 * API module is stubbed; the backend proof is
 * src/test/pglite/declutterSlice3.pglite.mjs and scripts/declutter/race-accept.mjs.
 *
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   if (!card.data) return <SaveCardPrompt |   if (false) return <SaveCardPrompt
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   if (underAge) { |   if (false) {
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | o.floor_price_cents !== null && o.amount_cents < o.floor_price_cents; | o.floor_price_cents !== null;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   if (n === 0) return null; |   if (n === 0) return <p>You have 0 of 3 strikes.</p>;
 * Slice 3b (B39, B44, B45): the working Save a card / Pay buttons and the switch-off view.
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |             await openExternalUrl(await startCardSave(), | await openExternalUrl("https://example.invalid",
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |             const res = await startCheckoutPayment(sellerId, chosen); |             const res = await startCheckoutPayment(sellerId, "pickup_home");
 * Row 101 (porch is the default; a seller can turn it off per item).
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const chosen = order.includes(handover) ? handover : order[0]; |   const chosen = handover;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | porchOk={lines.every((l) => l.porch_ok !== false)} | porchOk={true}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |       <CartView />\n      <SalesWaiting />\n    </AppPage> |       <SalesWaiting />\n    </AppPage>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  underAge: false,
  card: null as unknown,
  strikes: 0,
  offers: [] as unknown[],
  cart: [] as unknown[],
  sent: [] as unknown[],
  paid: [] as unknown[],
  opened: [] as string[],
};

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyCard: async () => state.card,
  fetchMyActiveStrikes: async () => state.strikes,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  makeOffer: async (itemId: string, cents: number) => {
    state.sent.push({ itemId, cents });
    return "o1";
  },
  respondOffer: async () => "declined",
  buyNow: async () => "l1",
  sellerCancelSale: async () => 1,
  startCardSave: async () => "https://checkout.stripe.test/setup",
  startCheckoutPayment: async (sellerId: string, handover: string) => {
    state.paid.push({ sellerId, handover });
    return { url: "https://checkout.stripe.test/pay", paid: false };
  },
}));
// Slice 4's paid-order cards have their own test (declutterHandoverViews.test.tsx).
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (url: string) => { state.opened.push(url); } }));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main> }));

import { CartView, FinishSalesView, OfferPanel, OffersView, StrikeCount, dollarsInputToCents } from "./DeclutterTradeViews";

function show(el: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const ITEM = {
  id: "i1", seller_id: "s1", status: "live" as const, title: "Oak rocking chair", description: "", category: "furniture",
  condition_stars: 4, delivery_size: "large" as const, price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: "2026-10-14",
};
const OFFER = {
  offer_id: "o1", item_id: "i1", item_title: "Oak rocking chair", my_side: "seller", amount_cents: 2500, awaiting: "seller",
  status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(), counter_count: 0, current_price_cents: 4000,
  floor_price_cents: 3000, updated_at: "2026-10-14",
};

describe("Declutter slice 3 screens", () => {
  beforeEach(() => {
    state.underAge = false;
    state.card = null;
    state.strikes = 0;
    state.offers = [];
    state.cart = [];
    state.sent = [];
    state.paid = [];
    state.opened = [];
  });

  it("no saved card: says why, shows no Buy or offer button, and Save a card opens Stripe's page (row 36)", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("Save a card to buy or make offers.")).toBeInTheDocument();
    expect(screen.getByText(/never charged until you check out/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy for/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save a card" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.test/setup"]));
  });

  it("under 18: buying is a plain block (row 53)", async () => {
    state.underAge = true;
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("You must be 18 or older to buy on Declutter.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy for/ })).toBeNull();
  });

  it("with a card: Buy at the price and an offer of at least half (rows 57-58)", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByRole("button", { name: "Buy for $40" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make an offer" }));
    const input = screen.getByLabelText("Your offer");
    fireEvent.change(input, { target: { value: "19.99" } });
    expect(screen.getByText("Offers must be at least $20 (half the price).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send offer" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    await waitFor(() => expect(state.sent).toEqual([{ itemId: "i1", cents: 2500 }]));
  });

  it("a reserved item says someone is buying it", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    expect(await screen.findByText("Someone is buying this item.")).toBeInTheDocument();
  });

  it("seller's inbox: accept / answer with a price / say no, and the under-floor note only the seller sees", async () => {
    state.offers = [
      OFFER,
      { ...OFFER, offer_id: "o3", amount_cents: 3500, item_title: "Desk" },
      { ...OFFER, offer_id: "o2", my_side: "buyer", awaiting: "seller", floor_price_cents: null, item_title: "Lamp" },
    ];
    show(<OffersView />);
    expect(await screen.findByText("Offers on your items")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Answer with a price" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Say no" })).toHaveLength(2);
    expect(screen.getByText(/under your lowest price \(\$30\)/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the seller/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take back my offer" })).toBeInTheDocument();
    expect(screen.getAllByText(/under your lowest price/)).toHaveLength(1);
  });

  it("cart: one checkout per seller with one 5% + 70c fee (F1), delivery later, and a Pay button for the total (rows 22, 24, 38)", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", price_cents: 400 }];
    show(<CartView />);
    expect(await screen.findByText("From one seller · one checkout")).toBeInTheDocument();
    expect(screen.getByText("$7")).toBeInTheDocument();
    expect(screen.getByText("$1.05")).toBeInTheDocument();
    expect(screen.getByText("$8.05")).toBeInTheDocument();
    expect(screen.getByText("Delivery by a Helpr is coming later.")).toBeInTheDocument();
    expect(screen.queryByText(/next test round/)).toBeNull();
    // Row 101: porch is listed first and already chosen; no tap needed.
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home"]);
    expect(screen.getByLabelText(/Porch pickup/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Pay $8.05" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "porch" }]));
    expect(state.opened).toEqual(["https://checkout.stripe.test/pay"]);
  });

  it("row 101: the buyer can still choose to meet at the seller's home", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    show(<CartView />);
    fireEvent.click(await screen.findByLabelText(/Meet at the seller's home/));
    fireEvent.click(screen.getByRole("button", { name: "Pay $3.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "pickup_home" }]));
  });

  it("row 101: a porch-off item joining the cart while porch is chosen moves the choice to the seller's home", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><CartView /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByLabelText(/Porch pickup/)).toBeChecked();
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Mirror", price_cents: 400, porch_ok: false }];
    await qc.invalidateQueries();
    await screen.findByRole("button", { name: "Pay $8.05" });
    fireEvent.click(screen.getByRole("button", { name: "Pay $8.05" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "pickup_home" }]));
  });

  it("row 101: one item with porch off means only pickup at the seller's home is offered", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Mirror", price_cents: 400, porch_ok: false }];
    show(<CartView />);
    expect(await screen.findByText(/asked buyers to meet at their home for this order/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Porch pickup/)).toBeNull();
    expect(screen.getByLabelText(/Meet at the seller's home/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Pay $8.05" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "pickup_home" }]));
  });

  it("switch off with a sale agreed: the cart and the member's sales, nothing new (row 62)", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line, { ...line, line_id: "l9", item_id: "i9", item_title: "Chair", my_side: "seller", seller_id: "me" }];
    show(<FinishSalesView />);
    expect(await screen.findByText("Declutter is closed for now.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pay $3.85" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel sale" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy for|Make an offer|Sell an item/ })).toBeNull();
  });

  it("strike count reads 'You have N of 3 strikes' and is absent at 0", async () => {
    state.strikes = 2;
    const { unmount } = show(<StrikeCount userId="u1" />);
    expect(await screen.findByText("You have 2 of 3 strikes.")).toBeInTheDocument();
    unmount();
    state.strikes = 0;
    show(<StrikeCount userId="u1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/of 3 strikes/)).toBeNull();
  });

  it("parses dollar amounts strictly", () => {
    expect(dollarsInputToCents("25")).toBe(2500);
    expect(dollarsInputToCents("$25.5")).toBe(2550);
    expect(dollarsInputToCents("25.555")).toBeNull();
    expect(dollarsInputToCents("0")).toBeNull();
    expect(dollarsInputToCents("abc")).toBeNull();
  });
});
