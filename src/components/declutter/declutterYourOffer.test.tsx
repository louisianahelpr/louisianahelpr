/**
 * Deep audit 2026-10-28 #3 and #4: the item page knows when the buyer already has something going on it.
 *   #3 Buy now (or an accepted offer) reserves the item to THIS buyer; the page then said "Someone is buying this
 *      item." with no way to the cart. Now: "Reserved for you, not paid yet", the time left and Go to checkout.
 *      A free item the buyer claimed says "It's yours" with Choose a pickup.
 *   #4 With an offer of theirs open, the page still offered "Make an offer", which the server refuses
 *      (offer_already_open). Now: "Your offer $25", whose turn it is, and Change my offer (take it back after an
 *      in-app confirm, then the amount field) or, when the seller answered, Answer it in Buying.
 *   #24 The free cart's button no longer repeats the item page's "Get it free".
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (item.status === "reserved" && myHold) { |   if (false) {
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |   if (item.status === "reserved" && myHold) { |   if (false) {
 * @mutate src/components/declutter/DeclutterYourOffer.tsx |   return offers?.find((o) => o.item_id === itemId && o.my_side === "buyer" && o.status === "open") ?? null; |   return null;
 * @mutate src/components/declutter/DeclutterYourOffer.tsx |   return cart?.find((l) => l.item_id === itemId && l.my_side === "buyer" && l.status === "in_cart") ?? null; |   return cart?.find((l) => l.item_id === itemId) ?? null;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |         {!myOffer && !offersOff && ( |         {!offersOff && (
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const offersOff = item.accepts_offers === false; |   const offersOff = false;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |         {!myOffer && !offersOff && ( |         {!myOffer && (
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;\n | \n
 * @mutate src/components/declutter/DeclutterYourOffer.tsx |       onChange();\n | \n
 * @mutate src/components/declutter/DeclutterYourOffer.tsx | onClick={() => setAsking(true)} | onClick={() => takeBack.mutate()}
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |       navigate("/declutter?tab=buying"); |       navigate("/declutter?view=cart");
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | "Confirming…" : "Confirm and pick a time" | "Confirming…" : "Get it free"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  cart: [] as unknown[],
  offers: [] as unknown[],
  responded: [] as { offerId: string; action: string }[],
  claimed: 0,
  /** useFirstPayoutFeeCents: the one-time setup fee still owed on this account (0 once paid). */
  setupFeeCents: 0,
  /** useFirstPayoutFeeKnown: false while that answer is not in. */
  setupFeeKnown: true,
};

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => state.setupFeeCents, useFirstPayoutFeeKnown: () => state.setupFeeKnown }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/mobileNav/useDockYield", () => ({ useDockYield: () => undefined }));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => null,
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyCard: async () => ({ brand: "visa", last4: "4242" }),
  fetchMyCart: async () => state.cart,
  fetchMyOffers: async () => state.offers,
  makeOffer: async () => "o9",
  buyNow: async () => "l1",
  startCardSave: async () => "https://checkout.stripe.test/setup",
  respondOffer: async (offerId: string, action: string) => {
    state.responded.push({ offerId, action });
    return "withdrawn";
  },
  claimFree: async () => {
    state.claimed++;
    return "l2";
  },
  checkoutFree: async () => "ord1",
}));

import { OfferPanel } from "./DeclutterOfferPanel";
import { FreeCheckoutForSeller, FreeClaimPanel } from "./DeclutterFreeClaim";
import type { DeclutterItem } from "@/lib/declutter/api";

const ITEM = {
  id: "i1", seller_id: "s1", title: "Oak desk", status: "live", current_price_cents: 4000, price_cents: 4000,
  category: "furniture", condition_stars: 4, porch_ok: true,
} as unknown as DeclutterItem;
const HOURS = 3_600_000;
const LINE = {
  line_id: "l1", item_id: "i1", item_title: "Oak desk", my_side: "buyer", seller_id: "s1", price_cents: 4000,
  status: "in_cart", checkout_by: new Date(Date.now() + 30 * HOURS).toISOString(), order_id: null, order_status: null,
  handover: null, premium_cents: null, total_cents: null, porch_ok: true,
};
const OFFER = {
  offer_id: "o1", item_id: "i1", item_title: "Oak desk", my_side: "buyer", amount_cents: 2500, awaiting: "seller",
  status: "open", respond_by: new Date(Date.now() + 40 * HOURS).toISOString(), counter_count: 0,
  current_price_cents: 4000, floor_price_cents: null, updated_at: "2026-10-28T00:00:00Z",
};

let where = "";
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}
function show(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter/item/i1"]}>
        {ui}
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.cart = [];
  state.offers = [];
  state.responded = [];
  state.claimed = 0;
  state.setupFeeCents = 0;
  state.setupFeeKnown = true;
  where = "";
});

describe("the item page knows the buyer's own hold (#3)", () => {
  it("reserved to this buyer: Reserved for you, not paid yet, the time left, and Go to checkout", async () => {
    state.cart = [LINE];
    show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    // While the cart read is in flight it never says someone else is buying it.
    expect(screen.queryByText("Someone is buying this item.")).toBeNull();
    expect(await screen.findByText("Reserved for you, not paid yet.")).toBeInTheDocument();
    expect(screen.getByText("29 hours left")).toBeInTheDocument();
    expect(screen.queryByText("Someone is buying this item.")).toBeNull();
    expect(screen.getByRole("link", { name: "Go to checkout" })).toHaveAttribute("href", "/declutter?tab=buying");
  });

  it("reserved to someone else (or this buyer's line already paid): someone is buying it", async () => {
    state.cart = [{ ...LINE, item_id: "other" }, { ...LINE, status: "paid" }, { ...LINE, my_side: "seller" }];
    show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    expect(await screen.findByText("Someone is buying this item.")).toBeInTheDocument();
    expect(screen.queryByText("Reserved for you, not paid yet.")).toBeNull();
  });

  it("a free item this buyer claimed: It's yours, Choose a pickup", async () => {
    state.cart = [{ ...LINE, price_cents: 0 }];
    show(<FreeClaimPanel item={{ ...ITEM, status: "reserved", current_price_cents: 0, price_cents: 0 }} />);
    expect(await screen.findByText("It's yours. Choose how you'll pick it up.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a pickup" })).toHaveAttribute("href", "/declutter?tab=buying");
    expect(screen.queryByText("Someone claimed this item.")).toBeNull();
  });

  it("claiming a free item opens Buying (never the retired ?view=cart), and the cart says Confirm and pick a time", async () => {
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Get it free" }));
    await waitFor(() => expect(where).toBe("/declutter?tab=buying"));
    expect(state.claimed).toBe(1);
    show(<FreeCheckoutForSeller sellerId="s1" porchOk onDone={() => undefined} />);
    expect(screen.getByRole("button", { name: "Confirm and pick a time" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Get it free" })).toHaveLength(1);
  });
});

describe("the item page knows the buyer's own open offer (#4)", () => {
  it("waiting for the seller: Your offer $25, no Make an offer, and Change my offer asks first, then opens the amount", async () => {
    state.offers = [OFFER, { ...OFFER, offer_id: "o2", item_id: "other" }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("Your offer")).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the seller, 39 hours left.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make an offer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change my offer" }));
    expect(state.responded).toEqual([]);
    expect(await screen.findByText("Take back your $25 offer?")).toBeInTheDocument();
    state.offers = [];
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.responded).toEqual([{ offerId: "o1", action: "withdraw" }]));
    expect(await screen.findByLabelText("Your offer")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Make an offer" })).toBeInTheDocument();
  });

  it("the seller answered with a price: their price and Answer it in Buying", async () => {
    state.offers = [{ ...OFFER, amount_cents: 3200, awaiting: "buyer", counter_count: 1 }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("The seller answered")).toBeInTheDocument();
    expect(screen.getByText("$32")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Answer it" })).toHaveAttribute("href", "/declutter?tab=buying");
    expect(screen.queryByRole("button", { name: "Make an offer" })).toBeNull();
  });

  it("an offer that closed (declined, taken back) leaves Make an offer as it was", async () => {
    state.offers = [{ ...OFFER, status: "declined" }, { ...OFFER, offer_id: "o3", status: "withdrawn" }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Make an offer" })).toBeEnabled());
    expect(screen.queryByText("Change my offer")).toBeNull();
  });
});

// A1-B2 (Declutter audit, prod 2026-10-29): the button said "Buy now · $32.20 total" while Stripe charged $34.20,
// because a first purchase also carries the one-time account setup fee. The button names what will be charged.
describe("Buy now names the charge, setup fee included (A1-B2)", () => {
  it("an account that still owes the setup fee sees it in the Buy now total", async () => {
    state.setupFeeCents = 200;
    show(<OfferPanel item={ITEM} userId="u1" />);
    // $40 price -> $42.70 checkout total (5% + 70c) -> $44.70 with the $2 setup fee: the Stripe charge.
    expect((await screen.findAllByText("$44.70 total")).length).toBeGreaterThan(0);
    expect(screen.queryByText("$42.70 total")).toBeNull();
    expect(screen.queryByText("+ any one-time setup fee")).toBeNull();
  });

  it("once paid it is the checkout total alone", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect((await screen.findAllByText("$42.70 total")).length).toBeGreaterThan(0);
  });

  it("while the fee answer is not in, it says a setup fee may be added, never a figure $2 low on its own", async () => {
    state.setupFeeKnown = false;
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect((await screen.findAllByText("+ any one-time setup fee")).length).toBeGreaterThan(0);
  });
});

// Smart offers (owner 2026-10-29): a seller who turned offers off sells Buy only. The item page shows no
// "Make an offer" (panel or phone bar) and says so; an item read before the column existed counts as offers on.
describe("offers off = Buy only (smart offers)", () => {
  it("no Make an offer when the seller turned offers off", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: false }} userId="u1" />);
    expect((await screen.findAllByText("$42.70 total")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Make an offer" })).toBeNull();
    expect(screen.getByText("The seller isn't taking offers on this one.")).toBeTruthy();
  });

  it("offers on (or not yet known) keeps Make an offer", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: true }} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Make an offer" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("The seller isn't taking offers on this one.")).toBeNull();
  });
});
