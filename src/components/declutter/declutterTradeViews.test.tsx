/**
 * The Declutter screens added by slice 3 (docs/specs/declutter-auctions.md rows 13, 16-22,
 * 36, 38, 53, 56-59; B25-B38): what each STATE renders, in plain words. The
 * API module is stubbed; the backend proof is
 * src/test/pglite/declutterSlice3.pglite.mjs and scripts/declutter/race-accept.mjs.
 *
 * Owner 2026-10-19: Buy now and Make an offer always show; with no saved card either one asks for a
 * card (AddCardStep) and comes back to itself (src/lib/declutter/afterCard.ts).
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (card.data) {\n      setNeedCard(null); |     if (true) {\n      setNeedCard(null);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |               rememberAfterCard(itemId, action);\n | \n
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (item.status === "live" && !underAge) run(resume); |     if (false) run(resume);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | useState<AfterCardAction \| null>(() => afterCardFromState(location.state)); | useState<AfterCardAction \| null>(() => null);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     refetchInterval: resume ? CARD_POLL_MS : false, |     refetchInterval: false,
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       setNeedCard(resume);\n    }, CARD_WAIT_MS); |     }, CARD_WAIT_MS);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null }); |       void navigate;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       {!showCardStep && <p className="text-xs | {true && <p className="text-xs
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (underAge) { |   if (false) {
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | o.floor_price_cents !== null && o.amount_cents < o.floor_price_cents; | o.floor_price_cents !== null;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   if (n === 0) return null; |   if (n === 0) return <p>You have 0 of 3 strikes.</p>;
 * Slice 3b (B39, B44, B45): the working Save a card / Pay buttons and the switch-off view.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |               const url = await startCardSave(); |               const url = "https://example.invalid";
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |             const res = await startCheckoutPayment(sellerId, chosen, sellerDelivering ? slot : null, sellerDelivering ? handoff : null); |             const res = await startCheckoutPayment(sellerId, "pickup_home");
 * Row 101 (porch is the default; a seller can turn it off per item).
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const chosen = offered.includes(handover) ? handover : offered[0]; |   const chosen = handover;
 * Slice 5 (Helpr delivery, rows 29-30): offered while Declutter is open, priced by the server.
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const offered: Handover[] = deliveryOpen ? [...order, "delivery"] : order; |   const offered: Handover[] = [...order, "delivery"];
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |         disabled={opening \|\| (delivering && !liveQuote) \|\| (sellerDelivering && !sdReady)} |         disabled={opening \|\| (sellerDelivering && !sdReady)}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const payCents = delivering && liveQuote ? totalCents + liveQuote.delivery_cents : sdAmounts ? sdAmounts.totalCents : totalCents; |   const payCents = sdAmounts ? sdAmounts.totalCents : totalCents;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | porchOk={lines.every((l) => l.porch_ok !== false)} | porchOk={true}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |       <CartView />\n      <PaidOrders side="buyer" />\n      <SalesWaiting /> |       <PaidOrders side="buyer" />\n      <SalesWaiting />
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  underAge: false,
  card: null as unknown,
  bought: 0,
  /** When set, the next openExternalUrl comes straight back (the in-app browser sheet closing) with this card saved. */
  returnWithCard: null as unknown,
  strikes: 0,
  offers: [] as unknown[],
  cart: [] as unknown[],
  sent: [] as unknown[],
  paid: [] as unknown[],
  opened: [] as string[],
  deliveryOn: false,
  quotes: [] as unknown[],
  /** declutter_seller_delivery (20261023130254), read on its own. */
  sellerDeliveryOn: false,
  sdOffer: null as unknown,
};

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => (key === "declutter_seller_delivery" ? state.sellerDeliveryOn : state.deliveryOn) }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryOffer: async () => state.sdOffer,
  quoteSellerDelivery: async () => state.sdOffer,
}));
vi.mock("@/lib/declutter/delivery", () => ({
  fetchDeliveryQuote: async (sellerId: string, address: string) => {
    state.quotes.push({ sellerId, address });
    return { road_miles: 5, size: "large", delivery_cents: 4000, base_cents: 1000, per_mile_cents: 1000, size_cents: 2000, dropoff_area: "Baker, LA" };
  },
}));
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
  buyNow: async () => {
    state.bought++;
    return "l1";
  },
  sellerCancelSale: async () => 1,
  startCardSave: async () => "https://checkout.stripe.test/setup",
  startCheckoutPayment: async (sellerId: string, handover: string, slot?: string | null, handoff?: string | null) => {
    state.paid.push(handover === "seller_delivery" ? { sellerId, handover, slot, handoff } : { sellerId, handover });
    return { url: "https://checkout.stripe.test/pay", paid: false };
  },
}));
// Slice 4's paid-order cards have their own test (declutterHandoverViews.test.tsx).
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("@/lib/openExternalUrl", () => ({
  openExternalUrl: async (url: string, onReturn?: () => void) => {
    state.opened.push(url);
    if (state.returnWithCard && onReturn) {
      state.card = state.returnWithCard;
      onReturn();
    }
  },
}));
vi.mock("@/components/AppPage", () => ({ default: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main> }));

import { CartView, FinishSalesView, OffersSection, StrikeCount, dollarsInputToCents } from "./DeclutterTradeViews";
import { OfferPanel } from "./DeclutterOfferPanel";

/** The router's history state, shown so a test can see OfferPanel clear it. */
function RouterState() {
  const loc = useLocation();
  return <output data-testid="router-state">{JSON.stringify(loc.state ?? null)}</output>;
}

function show(el: React.ReactNode, entry: string | { pathname: string; state: unknown } = "/declutter/item/i1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        {el}
        <RouterState />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ITEM = {
  id: "i1", seller_id: "s1", status: "live" as const, title: "Oak rocking chair", description: "", category: "furniture",
  condition_stars: 4, delivery_size: "large" as const, price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: "2026-10-14", porch_ok: true,
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
    state.bought = 0;
    state.returnWithCard = null;
    sessionStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.strikes = 0;
    state.offers = [];
    state.cart = [];
    state.sent = [];
    state.paid = [];
    state.opened = [];
    state.deliveryOn = false;
    state.quotes = [];
    state.sellerDeliveryOn = false;
    state.sdOffer = null;
  });

  it("no saved card: Buy now and Make an offer still show; Buy asks for a card first and remembers where to come back (row 36)", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now · $42.70 total with fee" });
    expect(screen.getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
    // The reassurance is a line under the buttons, not a box in their place.
    expect(screen.getByText("You're only charged when you buy.")).toBeInTheDocument();
    expect(screen.queryByText("Save a card to buy or make offers.")).toBeNull();
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    expect(await screen.findByText("Add a card to finish.")).toBeInTheDocument();
    expect(screen.getByText(/You're only charged when you buy\. Then you confirm the buy\./)).toBeInTheDocument();
    // Said once: the line under the buttons steps aside while the card step says it.
    expect(screen.getAllByText(/You're only charged when you buy\./)).toHaveLength(1);
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.test/setup"]));
    // The web returns to /declutter?card=saved: this is how it finds the way back.
    expect(JSON.parse(sessionStorage.getItem("declutter.afterCard") ?? "{}")).toMatchObject({ itemId: "i1", action: "buy" });
    expect(state.bought).toBe(0);
  });

  it("no saved card: Make an offer asks for a card, and Not now puts the buttons back", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const offer = await screen.findByRole("button", { name: "Make an offer" });
    await waitFor(() => expect(offer).toBeEnabled());
    fireEvent.click(offer);
    expect(await screen.findByText(/Then you enter your offer\./)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your offer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
  });

  it("back from saving a card in the app (the sheet closes): Buy goes straight to its confirm", async () => {
    state.returnWithCard = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now · $42.70 total with fee" });
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    fireEvent.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Buy "Oak rocking chair" for \$42\.70 \(\$40 \+ \$2\.70 buyer.s fee\)\? Delivery, if you choose it, is added at checkout\./)));
    await waitFor(() => expect(state.bought).toBe(1));
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
  });

  it("back from Stripe's page on the web (router state, set by /declutter?card=saved): the offer box opens and the state is cleared", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "offer" } });
    expect(await screen.findByLabelText("Your offer")).toBeInTheDocument();
    // A reload or Back never replays it.
    await waitFor(() => expect(screen.getByTestId("router-state")).toHaveTextContent("null"));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("board 67: the offer box shows what the buyer pays if the seller says yes, from the real fee rule (5% + 70c)", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "offer" } });
    fireEvent.change(await screen.findByLabelText("Your offer"), { target: { value: "30" } });
    // $30 + round($30 x 5%) + 70c = $30 + $2.20 = $32.20 (checkoutAmounts, the rule declutter_start_checkout charges).
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx | {formatPrice(buyNowTotalCents(cents))}</dd> | {formatPrice(cents)}</dd>
    const bill = document.querySelector("[data-offer-bill]")!;
    expect(bill.textContent).toMatch(/Your offer\$30/);
    expect(bill.textContent).toMatch(/Buyer's fee \(5% \+ 70¢\)\$2\.20/);
    expect(bill.textContent).toMatch(/You pay if the seller says yes\$32\.20/);
    // Under half the price: no bill, the rule instead.
    fireEvent.change(screen.getByLabelText("Your offer"), { target: { value: "5" } });
    expect(document.querySelector("[data-offer-bill]")).toBeNull();
  });

  it("a link with ?after_card=buy does nothing by itself: only the router state resumes", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />, "/declutter/item/i1?after_card=buy");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy now · $42.70 total with fee" })).toBeEnabled());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Your offer")).toBeNull();
  });

  it("back before Stripe's webhook filed the card: it keeps looking, then Buy goes to its confirm", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "buy" } });
    expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
    state.card = { brand: "visa", last4: "4242" };
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1), { timeout: 4_000 });
    await waitFor(() => expect(state.bought).toBe(1));
    expect(screen.queryByText("Checking for your card…")).toBeNull();
  });

  it("back with no card after the wait (closed Stripe's page): the card step shows again for the same action", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "offer" } });
      expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(10_001);
      });
      expect(await screen.findByText(/Then you enter your offer\./)).toBeInTheDocument();
      expect(screen.queryByText("Checking for your card…")).toBeNull();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("under 18: buying is a plain block (row 53)", async () => {
    state.underAge = true;
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("You must be 18 or older to buy on Declutter.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buy now/ })).toBeNull();
  });

  it("with a card: Buy at the price and an offer of at least half (rows 57-58)", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByRole("button", { name: "Buy now · $42.70 total with fee" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Make an offer" })).toBeEnabled());
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
    // Selling holds the offers on your items, Buying the ones you sent (tabs, 2026-10-18).
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    expect(await screen.findByRole("heading", { name: /^Offers on your items\s*· 2 to answer$/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your offers" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Answer with a price" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Say no" })).toHaveLength(2);
    expect(screen.getByText(/under your lowest price \(\$30\)/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the seller/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take back my offer" })).toBeInTheDocument();
    expect(screen.getAllByText(/under your lowest price/)).toHaveLength(1);
  });

  it("board 160: a buyer's declined or expired offer says nothing was charged and links the item; never 'Offer again'", async () => {
    state.offers = [
      { ...OFFER, offer_id: "d1", my_side: "buyer", status: "declined", floor_price_cents: null, item_title: "Porch swing" },
      { ...OFFER, offer_id: "e1", my_side: "buyer", status: "expired", floor_price_cents: null, item_title: "Rug" },
      { ...OFFER, offer_id: "s9", status: "declined", item_title: "Desk" },
    ];
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    // @mutate src/components/declutter/DeclutterTradeViews.tsx | {o.my_side === "buyer" && (o.status === "declined" \|\| o.status === "expired") && ( | {false && (
    const ended = await screen.findAllByText(/^Nothing was charged\./);
    expect(ended).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "See the item" })[0].getAttribute("href")).toBe(`/declutter/item/${OFFER.item_id}`);
    expect(screen.queryByText(/Offer again/)).toBeNull();
  });

  it("boards 68-70: an offer card's money lines use what accepting really charges, least(offer, price now)", async () => {
    state.offers = [
      // The seller dropped the price to $22 below the buyer's $25 offer: accepting sells for $22.
      { ...OFFER, offer_id: "s1", current_price_cents: 2200, floor_price_cents: 1000, item_title: "Desk" },
      // The seller countered $30 to this buyer: their price $30, fee $2.20, $32.20 with pickup.
      { ...OFFER, offer_id: "b1", my_side: "buyer", awaiting: "buyer", amount_cents: 3000, floor_price_cents: null, item_title: "Lamp", counter_count: 1 },
    ];
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const takeCents = Math.min(o.amount_cents, o.current_price_cents); |   const takeCents = o.amount_cents;
    expect((await screen.findByText(/If you accept and the buyer pays/)).textContent).toMatch(/you keep the whole \$22\./);
    expect(screen.getByText("their offer")).toBeInTheDocument();
    expect(screen.getByText("their counter")).toBeInTheDocument();
    const bill = document.querySelector("[data-offer-bill]")!;
    expect(bill.textContent).toMatch(/Their price\$30/);
    expect(bill.textContent).toMatch(/Buyer's fee \(5% \+ 70¢\)\$2\.20/);
    expect(bill.textContent).toMatch(/You pay with pickup\$32\.20/);
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
    // Board 30: the breakdown ends in "You pay" = the real checkout total, the seller keeps the whole item price,
    // and no vendor is named (spec §1.7).
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |             {formatPrice(payCents)}\n |             {formatPrice(itemsTotalCents)}\n
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/You pay\$8\.05/);
    // Board 161: two items, one checkout, the fee once on their total.
    // @mutate src/components/declutter/DeclutterTradeViews.tsx | <dt>{itemCount > 1 ? "Buyer's fee (5% + 70¢, once)" : "Buyer's fee (5% + 70¢)"}</dt> | <dt>Buyer's fee (5% + 70¢)</dt>
    expect(bill.textContent).toMatch(/^2 items\$7Buyer's fee \(5% \+ 70¢, once\)\$1\.05/);
    expect(screen.getByText("One checkout, one pickup, one fee.")).toBeInTheDocument();
    const note = document.querySelector("[data-checkout-note]")!;
    // The real payout rule (declutter_handover_sweep, read live 2026-10-20): handover done, or 24 h after the slot
    // unless a problem is open.
    // @mutate src/components/declutter/DeclutterTradeViews.tsx | or 24 hours after your pickup time unless you report a problem. | once you have your items.
    expect(note.textContent).toMatch(/The seller keeps the whole \$7\. It's paid to the seller when the handover is done, or 24 hours after your pickup time unless you report a problem\./);
    // Owner: no codes or QR for Declutter pickup.
    expect(document.body.textContent).not.toMatch(/\bcode\b|QR/i);
    // Never the false promise the money review found (the sweep can pay the seller with no buyer step).
    expect(document.body.textContent).not.toMatch(/until you have your items/);
    expect(document.body.textContent).not.toMatch(/Stripe/);
    // Declutter is not open for this member (the switch reads false): no Helpr delivery to choose.
    expect(screen.queryByLabelText(/Helpr delivery/)).toBeNull();
    expect(screen.queryByText(/next test round/)).toBeNull();
    // Row 101: porch is listed first and already chosen; no tap needed.
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home"]);
    expect(screen.getByLabelText(/Porch pickup/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Pay $8.05" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "porch" }]));
    expect(state.opened).toEqual(["https://checkout.stripe.test/pay"]);
  });

  it("slice 5: Helpr delivery is offered, priced by the server for the typed address, and Pay carries the delivery fee", async () => {
    state.deliveryOn = true;
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    show(<CartView />);
    const radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home", "delivery"]);
    expect(screen.getByLabelText(/Porch pickup/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Helpr delivery/));
    // No price yet: Pay waits for the server's quote.
    expect(screen.getByRole("button", { name: "Pay $3.85" })).toBeDisabled();
    // ...and the bill says the total is not complete yet (money review #4).
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |             {delivering && !liveQuote && <span | {false && <span
    expect(document.querySelector("[data-checkout-breakdown]")!.textContent).toMatch(/You pay\$3\.85\+ delivery/);
    fireEvent.change(screen.getByLabelText(/Deliver to/), { target: { value: "900 Far Rd, Baker, LA" } });
    fireEvent.click(screen.getByRole("button", { name: "Get price" }));
    expect(await screen.findByText(/Helpr delivery, about 5 miles/)).toBeInTheDocument();
    // The quote joins the bill as its own line, outside the 5% base: $3 item + $0.85 fee + $40 delivery.
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |         {delivering && liveQuote && ( |         {false && (
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/Helpr delivery\$40/);
    expect(bill.textContent).toMatch(/Buyer's fee \(5% \+ 70¢\)\$0\.85/);
    expect(bill.textContent).toMatch(/You pay\$43\.85/);
    expect(state.quotes).toEqual([{ sellerId: "s2", address: "900 Far Rd, Baker, LA" }]);
    fireEvent.click(screen.getByRole("button", { name: "Pay $43.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "delivery" }]));
    state.deliveryOn = false;
  });

  it("seller delivery (20261023130254): after pickup at the home, with the seller's rate, a time and the door choice; the fee counts the rate", async () => {
    state.sellerDeliveryOn = true;
    const slots = ["2026-11-03T15:00:00.000Z", "2026-11-03T16:00:00.000Z", "2026-11-04T15:00:00.000Z"];
    state.sdOffer = { available: true, reason: null, rate_cents: 2000, radius_miles: 10, dropoff_area: "Mid-City", slot_minutes: 60, slots, held_slot: null };
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    show(<CartView />);
    await screen.findByLabelText(/Seller delivers/);
    const radios = screen.getAllByRole("radio").filter((r) => r.tagName === "INPUT");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home", "seller_delivery"]);
    expect(screen.getByLabelText(/Porch or safe place/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Seller delivers/));
    // Pay waits for a time AND the door choice.
    fireEvent.click((await screen.findAllByRole("radio", { name: /AM|PM/ }))[0]);
    // $3 item + $20 rate: the fee is 5% of $23 + 70c = $1.85; total $24.85.
    expect(screen.getByRole("button", { name: "Pay $24.85" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Leave it at my door/ }));
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/Seller delivery\$20/);
    expect(bill.textContent).toMatch(/Buyer's fee \(5% \+ 70¢\)\$1\.85/);
    fireEvent.click(screen.getByRole("button", { name: "Pay $24.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "seller_delivery", slot: slots[0], handoff: "leave" }]));
  });

  it("seller delivery: no open times shows the rate's place as 'No delivery times open'; a stored out-of-range address hides it", async () => {
    state.sellerDeliveryOn = true;
    state.sdOffer = { available: false, reason: "no_times", rate_cents: 2000, radius_miles: 10, dropoff_area: null, slot_minutes: 60, slots: [], held_slot: null };
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    const first = show(<CartView />);
    expect(await screen.findByText("No delivery times open")).toBeInTheDocument();
    first.unmount();
    state.sdOffer = { ...(state.sdOffer as object), reason: "out_of_range" };
    show(<CartView />);
    await screen.findByLabelText(/Porch or safe place/);
    expect(screen.queryByLabelText(/Seller delivers/)).toBeNull();
  });

  it("slice 5: changing the address drops the old price until it is priced again", async () => {
    state.deliveryOn = true;
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    show(<CartView />);
    fireEvent.click(await screen.findByLabelText(/Helpr delivery/));
    fireEvent.change(screen.getByLabelText(/Deliver to/), { target: { value: "900 Far Rd, Baker, LA" } });
    fireEvent.click(screen.getByRole("button", { name: "Get price" }));
    await screen.findByRole("button", { name: "Pay $43.85" });
    fireEvent.change(screen.getByLabelText(/Deliver to/), { target: { value: "12 Other St, Zachary, LA" } });
    expect(screen.getByRole("button", { name: "Pay $3.85" })).toBeDisabled();
    state.deliveryOn = false;
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
    expect(screen.queryByRole("button", { name: /Buy now|Make an offer|Sell an item/ })).toBeNull();
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
