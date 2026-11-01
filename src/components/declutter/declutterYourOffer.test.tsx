/**
 * Deep audit 2026-10-28 #3 and #4: the item page knows when the buyer already has something going on it.
 *   #3 Buy now (or an accepted offer) reserves the item to THIS buyer; the page then said "Someone is buying this
 *      item." with no way to the cart. Now: "Reserved for you, not paid yet", the time left and Go to checkout.
 *      A free item the buyer claimed says "It's yours" with Choose a pickup.
 *   #4 With an offer of theirs open, the page still offered "Make an offer", which the server refuses
 *      (offer_already_open). Now: "Your offer $25", whose turn it is, and Change my offer (take it back after an
 *      in-app confirm, then the amount field) or, when the seller answered, Answer it in Buying.
 *   #24 The free cart's button no longer repeats the item page's button (now "Ask for it", the Free change Q2487).
 *   Q2487 (owner 2026-10-29): a free item is ASKED for; the page stays put, then says "You asked for this." with
 *      Take back my ask.
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
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |   if (myAsk) { |   if (false) {
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | "Confirming…" : "Confirm and pick a time" | "Confirming…" : "Ask for it"
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {freeAskLine(offered, oneTimeCheckAhead)} | {freeAskLine(["porch", "pickup_home"], oneTimeCheckAhead)}
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | .filter((h) => wayAllowed(ways, h)); | ;
 *   DA-5 (Declutter audit 2026-10-30): the free ask line names only the ways the giver ticked, by the same rule
 *   (freeWaysOffered) as the free checkout.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  cart: [] as unknown[],
  offers: [] as unknown[],
  responded: [] as { offerId: string; action: string }[],
  claimed: 0,
  /** requestFreeAt: the pickup time the asker picked in the Ask sheet (owner 11-01, Mockup 3). */
  askedAt: null as string | null,
  /** The member's own open asks for free items (the Free change, Q2487). */
  asks: [] as { id: string; item_id: string; status: string; created_at: string }[],
  giverAsks: undefined as unknown[] | undefined,
  withdrawn: [] as string[],
  /** fetchItemHandovers: the ways the giver ticked (null = an older item with none recorded). DA-5. */
  ticks: null as string[] | null,
  /** useFirstPayoutFeeCents: the one-time setup fee still owed on this account (0 once paid). */
  setupFeeCents: 0,
  /** useFirstPayoutFeeKnown: false while that answer is not in. */
  setupFeeKnown: true,
};

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
// The Ask sheet's read (owner 11-01, Mockup 3): one place, open 7 AM to 9 PM every day.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null,
  fetchItemPickupPlaces: async () => [{
    id: "p1", label: "Home", area: "New Iberia", weekdays: [0, 1, 2, 3, 4, 5, 6],
    windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "07:00", ends: "21:00" })),
  }],
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => state.setupFeeCents, useFirstPayoutFeeKnown: () => state.setupFeeKnown }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
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
  requestFreeAt: async (_item: string, at: string) => {
    state.claimed++;
    state.askedAt = at;
    return "r2";
  },
  fetchSellerCard: async () => ({ name: "Lexi Lombas" }),
  fetchMyFreeRequests: async () => state.asks,
  fetchFreeRequestsForItem: async () => state.giverAsks ?? [],
  pickFreeRequest: async () => undefined,
  withdrawFreeRequest: async (id: string) => {
    state.withdrawn.push(id);
  },
  checkoutFree: async () => "ord1",
  fetchItemHandovers: async () => state.ticks,
}));

import { OfferPanel } from "./DeclutterOfferPanel";
import { FreeCheckoutForSeller, FreeClaimPanel, FreeRequestsForGiver } from "./DeclutterFreeClaim";
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
  state.ticks = null;
  state.cart = [];
  state.offers = [];
  state.responded = [];
  state.claimed = 0;
  state.asks = [];
  state.withdrawn = [];
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
    // DB-5: straight to this seller's checkout. LINE has no source (before the 20261030064929 deploy): the strike
    // words stay, because the server still gave one then.
    expect(screen.getByRole("link", { name: "Go to checkout" })).toHaveAttribute("href", "/declutter?tab=buying&checkout=s1");
    expect(screen.getByText(/If you don't, you get a strike and it goes back up for sale\./)).toBeInTheDocument();
  });

  // DB-5 (owner 2026-10-30): a Buy now hold is no strike; an accepted offer's hold still is.
  // @mutate src/components/declutter/DeclutterYourOffer.tsx |           : holdHasNoStrike([line]) ? `Pay by ${by}. |           : false ? `Pay by ${by}.
  // @mutate src/components/declutter/DeclutterYourOffer.tsx | <Link to={free ? CHECKOUT_LINK : checkoutLinkFor(line.seller_id)}> | <Link to={CHECKOUT_LINK}>
  it("DB-5: a Buy now hold says No strike; an accepted offer's still warns", async () => {
    state.cart = [{ ...LINE, source: "buy" }];
    const first = show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    expect(await screen.findByText(/^Pay by .+\. If you don't, it goes back up for sale\. No strike\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/you get a strike/)).toBeNull();
    first.unmount();
    state.cart = [{ ...LINE, source: "offer" }];
    show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    expect(await screen.findByText(/If you don't, you get a strike and it goes back up for sale\./)).toBeInTheDocument();
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
    expect(screen.queryByText("The giver picked someone for this item.")).toBeNull();
  });

  it("asking for a free item stays on the page (the giver picks), and the cart says Confirm and pick a time", async () => {
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    const ask = await screen.findByRole("button", { name: "Ask for it" });
    await waitFor(() => expect(ask).not.toBeDisabled());
    fireEvent.click(ask);
    // Owner 11-01 (Mockup 3): the button opens the sheet; the asker picks a time, and the ask carries it.
    // @mutate src/components/declutter/FreeAskSheet.tsx |     mutationFn: (iso: string) => requestFreeAt(item.id, iso), |     mutationFn: (iso: string) => requestFreeAt(item.id, new Date().toISOString()),
    // @mutate src/components/declutter/FreeAskSheet.tsx | : "the time you pick"} is already set, and you'll get the address. | : "the time you pick"}. If it's you, you'll confirm the pickup and get the address.
    const times = await screen.findByRole("group", { name: /^Pickup time on / });
    const firstTime = within(times).getAllByRole("button")[0];
    fireEvent.click(firstTime);
    const note = document.querySelector("[data-sheet-note]")!;
    expect(note.textContent).toMatch(/^Free, nothing is charged\. Lexi picks who gets it\. If it's you, .+ is already set, and you'll get the address\.$/);
    expect(state.claimed).toBe(0);
    const send = screen.getByRole("button", { name: /^Ask for it · / });
    expect(send.textContent).toContain(note.querySelector("strong")!.textContent!);
    fireEvent.click(send);
    await waitFor(() => expect(state.claimed).toBe(1));
    const at = new Date(state.askedAt!);
    expect(at.getTime()).toBeGreaterThan(Date.now());
    expect(at.getUTCMinutes()).toBe(0);
    expect(where).not.toBe("/declutter?tab=buying");
    show(<FreeCheckoutForSeller sellerId="s1" porchOk onDone={() => undefined} />);
    // Porch comes first; it is picked by a time in the place's hours (LEAD-PLACE-TIMES; was a day, BUY-18).
    expect(screen.getByRole("button", { name: "Confirm and pick a time" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ask for it" })).toHaveLength(1);
  });

  // B106 (item page shots 11-01): the note under Ask for it had a tall gap between its two lines (noteH 60 for two
  // 16px lines at 375, measured ~/.lh-shots/b109): the inline "How it works" <Button> kept the global 44px button
  // min-height (index.css :where(button)). It is now a text-sized link button with the shared 44px tap overlay on touch.
  // @mutate src/components/ui/InlineTextButton.tsx | link-standard min-h-0 min-w-0 p-0 align-baseline | link-standard p-0 align-baseline
  it("the note under Ask for it reads as one paragraph: How it works flows inline, no 44px box", async () => {
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    const how = await screen.findByRole("button", { name: "How it works" });
    expect(how.closest("[data-free-ask-note]")).not.toBeNull();
    const cls = how.className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["min-h-0", "min-w-0"]));
    expect(how.className).toMatch(/\blink-[a-z]+\b/); // the shared text link (its 44px overlay on a touch screen)
    expect(cls).not.toEqual(expect.arrayContaining(["inline-flex"]));
    expect(cls.filter((c) => /^h-/.test(c))).toEqual([]);
  });

  // DA-5 (Declutter audit 2026-10-30): the ask line said "at their home or from their porch" whatever the giver ticked.
  it("the ask line names only the ways this free item offers (DA-5)", async () => {
    const FREE = { ...ITEM, current_price_cents: 0, price_cents: 0 };
    // Owner mockup 11-01: the rules sit behind "How it works"; the picked person's time is already set.
    const rules = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "How it works" }));
      return (await waitFor(() => { const el = document.querySelector("[data-free-rules]"); expect(el).not.toBeNull(); return el!; })).textContent!;
    };
    state.ticks = ["porch"];
    const one = show(<FreeClaimPanel item={FREE} />);
    await waitFor(async () => expect(document.querySelector("[data-free-claim]")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    let text = await rules();
    expect(text).toMatch(/that time is already set and you'll get the address to collect it from their porch\./);
    expect(text).not.toMatch(/their home|48 hours/);
    one.unmount();
    state.ticks = null;
    const two = show(<FreeClaimPanel item={{ ...FREE, porch_ok: false }} />);
    await new Promise((r) => setTimeout(r, 20));
    text = await rules();
    expect(text).toMatch(/you'll get the address to pick it up at their home\./);
    expect(text).not.toMatch(/porch/);
    two.unmount();
    show(<FreeClaimPanel item={FREE} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(await rules()).toMatch(/you'll get the address to pick it up at their home or from their porch\./);
  });

  // @mutate src/components/declutter/DeclutterFreeClaim.tsx | value={{ who: "them", text: `Waiting on ${giverFirstName === "The giver" ? "the giver" : giverFirstName} to pick who gets it. We'll tell you either way.` }} | value={{ who: "info", text: "The giver picks who gets it. We'll tell you either way." }}
  it("with the member's ask open: You asked for this, and Take back my ask withdraws that ask", async () => {
    state.asks = [
      { id: "r1", item_id: "i1", status: "open", created_at: "2026-10-30T00:00:00Z" },
      { id: "r9", item_id: "other", status: "open", created_at: "2026-10-30T00:00:00Z" },
    ];
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    expect(await screen.findByText("You asked for this.")).toBeInTheDocument();
    // The shared next-step line (owner 11-01): nothing is the asker's to do; it waits on the giver (named).
    await waitFor(() => expect(document.querySelector("[data-free-claim] [data-next-step]")?.textContent).toBe("Waiting on Lexi to pick who gets it. We'll tell you either way."));
    expect(document.querySelector("[data-free-claim] [data-next-step]")?.getAttribute("data-next-step")).toBe("them");
    expect(screen.queryByRole("button", { name: "Ask for it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take back my ask" }));
    await waitFor(() => expect(state.withdrawn).toEqual(["r1"]));
  });
});

// The giver's request list says the giver's move once someone asked (owner 11-01 12:02 PM: the shared next-step line).
// @mutate src/components/declutter/DeclutterFreeClaim.tsx |         <NextStep className="!text-sm" value={{ who: "you", text: "Pick who gets it" }} /> |         null
describe("the giver's request list: Next: pick who gets it", () => {
  it("with asks: 'Next: pick who gets it'; with none: it stays up, no step", async () => {
    state.giverAsks = [{ request_id: "r1", requester_id: "u1", display_name: "Kaci B.", avg_rating: 5, review_count: 3, created_at: "2026-10-30T00:00:00Z", pickup_at: null }];
    const one = show(<FreeRequestsForGiver item={{ ...ITEM, current_price_cents: 0, price_cents: 0 } as never} />);
    expect(await screen.findByText("Next: pick who gets it")).toBeInTheDocument();
    one.unmount();
    state.giverAsks = [];
    show(<FreeRequestsForGiver item={{ ...ITEM, current_price_cents: 0, price_cents: 0 } as never} />);
    expect(await screen.findByText("Nobody has asked yet. It stays up until you pick someone.")).toBeInTheDocument();
    expect(screen.queryByText(/^Next:/)).toBeNull();
    state.giverAsks = undefined;
  });
});

describe("the item page knows the buyer's own open offer (#4)", () => {
  it("waiting for the seller: Your offer $25, no Make an offer, and Change my offer asks first, then opens the amount", async () => {
    state.offers = [OFFER, { ...OFFER, offer_id: "o2", item_id: "other" }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("Your offer")).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    // The shared next-step line (owner 11-01): who it waits on, with the time left.
    // @mutate src/components/declutter/DeclutterYourOffer.tsx |           : { who: "them", text: "Waiting on the seller to answer", by: timeLeft(offer.respond_by) }} |           : { who: "them", text: "Waiting on the seller to answer" }}
    expect(document.querySelector("[data-your-offer] [data-next-step]")?.textContent).toBe("Waiting on the seller to answer · 39 hours left");
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
    expect((await screen.findAllByRole("button", { name: "Buy now · $44.70 total" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /\$42\.70/ })).toBeNull();
    expect(screen.queryByText("+ any one-time setup fee")).toBeNull();
  });

  it("once paid it is the checkout total alone", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Buy now · $42.70 total" })).length).toBeGreaterThan(0);
  });

  it("while the fee answer is not in, it says a setup fee may be added, never a figure $2 low on its own", async () => {
    state.setupFeeKnown = false;
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect((await screen.findAllByText("+ any one-time setup fee")).length).toBeGreaterThan(0);
  });
});

// Owner 11-01 (app-wide): side-by-side buttons are ONE line with short labels. At 375 "Make an offer" took 2 lines
// and Buy now 4 ("Buy now / $37.45 total + any one-time setup fee"). Now "Offer" (outline, left) and "Buy · $37.45"
// (filled, right), each nowrap, the setup-fee words a small line UNDER the pair. Screen readers keep the full names.
// The pixel half (each label inside its button at 320 and 375, one line tall) is measured in WebKit by
// ~/.lh-shots/b109/shots.mjs (measure-*.json).
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |       <span aria-hidden>Buy ·</span> |       <span aria-hidden>Buy now ·</span>
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |     <span className="whitespace-nowrap font-semibold" data-buy-label=""> |     <span className="font-semibold" data-buy-label="">
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |         pendingClassName="sr-only" |         pendingClassName="block text-xs"
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |             <span aria-hidden className="whitespace-nowrap" data-offer-label="">Offer</span> |             <span aria-hidden className="whitespace-nowrap" data-offer-label="">Make an offer</span>
describe("Offer and Buy are one line each, the setup fee under them (owner 11-01)", () => {
  /** What a sighted buyer reads on a button: its text without the screen-reader-only spans. */
  const seen = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll(".sr-only").forEach((n) => n.remove());
    return (c.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  for (const known of [true, false]) {
    it(`short nowrap labels, setup fee ${known ? "known" : "not yet known"}`, async () => {
      state.setupFeeKnown = known;
      show(<OfferPanel item={ITEM} userId="u1" />);
      const region = await screen.findByRole("region", { name: "Buy or make an offer" });
      const buy = await within(region).findByRole("button", { name: /^Buy now · \$42\.70 total/ });
      const offer = within(region).getByRole("button", { name: "Make an offer" });
      expect(seen(offer)).toBe("Offer");
      expect(seen(buy)).toBe("Buy · $42.70");
      // Fits the narrow column at 320 up to $999.99 ("Buy · $999.99", 13 characters).
      expect(seen(buy).length).toBeLessThanOrEqual(13);
      for (const b of [buy, offer]) {
        const label = b.querySelector("[data-buy-label], [data-offer-label]");
        expect(label?.className, seen(b)).toMatch(/whitespace-nowrap/);
        expect(seen(b)).not.toMatch(/setup fee|total/);
      }
      // Offer left, Buy right, in one row; the fee words are a line UNDER the row, never inside a button.
      const row = region.querySelector("[data-offer-buttons]")!;
      expect([...row.querySelectorAll("button")]).toEqual([offer, buy]);
      expect(row.className).toMatch(/grid-cols-\[/);
      const note = region.querySelector("[data-setup-fee-note]");
      if (known) expect(note).toBeNull();
      else {
        expect(note?.textContent).toBe("+ any one-time setup fee");
        expect(row.compareDocumentPosition(note!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(row.contains(note)).toBe(false);
        expect(buy.textContent).toContain("+ any one-time setup fee"); // heard by screen readers in the button
      }
    });
  }
});

// Smart offers (owner 2026-10-29): a seller who turned offers off sells Buy only. The item page shows no
// "Make an offer" (panel or phone bar) and says so; an item read before the column existed counts as offers on.
describe("offers off = Buy only (smart offers)", () => {
  it("no Make an offer when the seller turned offers off", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: false }} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Buy now · $42.70 total" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Make an offer" })).toBeNull();
    expect(screen.getByText("The seller isn't taking offers on this one.")).toBeTruthy();
  });

  it("offers on (or not yet known) keeps Make an offer", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: true }} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Make an offer" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("The seller isn't taking offers on this one.")).toBeNull();
  });
});
