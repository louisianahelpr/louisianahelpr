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
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |         {myOffer ? ( |         {false ? (
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const offersOff = item.accepts_offers === false; |   const offersOff = false;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | ) : offersOff ? null : ( | ) : false ? null : (
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (item.status === "reserved" && cart.isLoading) return <HoldChecking />;\n | \n
 * @mutate src/components/declutter/DeclutterYourOffer.tsx |       onChange();\n | \n
 * @mutate src/components/declutter/DeclutterYourOffer.tsx | onClick={() => setAsking(true)} | onClick={() => takeBack.mutate()}
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx |   if (myAsk) { |   if (false) {
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | t("free.confirming") : t("free.confirmPick") | t("free.confirming") : t("free.askForIt")
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
  asks: [] as { id: string; item_id: string; status: string; created_at: string; pickup_at?: string | null }[],
  giverAsks: undefined as unknown[] | undefined,
  withdrawn: [] as string[],
  /** fetchItemHandovers: the ways the giver ticked (null = an older item with none recorded). DA-5. */
  ticks: null as string[] | null,
  /** useFirstPayoutFeeCents: the one-time setup fee still owed on this account (0 once paid). */
  setupFeeCents: 0,
  /** useFirstPayoutFeeKnown: false while that answer is not in. */
  setupFeeKnown: true,
  /** useCurrentUser's profile (11-07): undefined = not read; onboarding_fee_paid false = a first-timer. */
  profile: undefined as { onboarding_fee_paid?: boolean } | undefined,
};

// The porch places reads (D-NEW14; proved in porchPlacesUi.test.tsx): none saved.
// Q2471: the offer box asks declutter-ai-reply for a suggested amount; no suggestion here (the box works without it).
vi.mock("@/lib/declutter/aiReply", async (orig) => ({ ...(await orig<object>()), requestSuggestedOffer: async () => null }));
// The Ask sheet's read (owner 11-01, Mockup 3): one place, open 7 AM to 9 PM every day.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({
  ...(await orig<object>()), fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null,
  fetchItemPickupPlaces: async () => [{
    id: "p1", label: "Home", area: "New Iberia", weekdays: [0, 1, 2, 3, 4, 5, 6],
    windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "07:00", ends: "21:00" })),
  }],
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: state.profile }) }));
// The ID check is on (prod 11-07: identity_check is 'everyone'); with no profile read the panel reads as before.
vi.mock("@/lib/identityCheckSwitch", () => ({ useIdentityCheckOnStore: () => true, identityCheckOn: () => true }));
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
import { minOfferCents, offerChipCents } from "@/lib/declutter/money";

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
  state.profile = undefined;
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

  // Audit 1110 F359e: an accepted trade read as a purchase ("Reserved for you, not paid yet ... Pay by ... Go to checkout").
  // @mutate src/components/declutter/DeclutterYourOffer.tsx |   const trade = isTradeLine(line); |   const trade = false;
  it("F359e: an accepted trade says Trade accepted and Choose a pickup, never pay or checkout", async () => {
    state.cart = [{ ...LINE, source: "swap", price_cents: 0 }];
    show(<OfferPanel item={{ ...ITEM, status: "reserved" }} userId="u1" />);
    expect(await screen.findByText("Trade accepted. Choose how you'll pick it up.")).toBeInTheDocument();
    expect(screen.getByText(/^Choose it by .+\. If you don't, the trade ends\. No strike\.$/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a pickup" })).toHaveAttribute("href", "/declutter?tab=buying&checkout=s1");
    expect(screen.queryByText(/not paid yet|Pay by/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Go to checkout" })).toBeNull();
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
    // @mutate src/lib/i18n/enFreeAsk.ts |   "fask.noteTail": " is already set, and you'll get the address.", |   "fask.noteTail": ". If it's you, you'll confirm the pickup and get the address.",
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

  // 11-07 free-claim trace (owner posting free items in local groups): a first-timer's ask sheet said "Free, nothing is
  // charged" and "If it's you, <time> is already set, and you'll get the address". For them the pick holds the item and
  // the one-time ID check comes first (declutter_free_claim_gate), then they choose the time (the asked time is booked
  // only for a verified member, declutter_pick_free_request). The sheet and How it works now say so.
  // @mutate src/components/declutter/FreeAskSheet.tsx |           {oneTimeCheckAhead ? ( |           {false ? (
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |   const ifYou = oneTimeCheckAhead ? `${firstPickSteps()}${how}` : | const ifYou =
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx | open={asking} onClose={() => setAsking(false)} oneTimeCheckAhead={oneTimeCheckAhead} /> | open={asking} onClose={() => setAsking(false)} />
  it("a first-timer's ask sheet and How it works never say nothing is charged or that the time is already set", async () => {
    state.profile = { onboarding_fee_paid: false };
    state.ticks = ["porch"];
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "How it works" }));
    const rules = (await waitFor(() => { const el = document.querySelector("[data-free-rules]"); expect(el).not.toBeNull(); return el!; })).textContent!;
    expect(rules).toMatch(/if it's you, your first free item has a one-time ID check first \(we show you the cost before you pay\), then you choose your pickup time and get the address to collect it from their porch\./);
    expect(rules).not.toMatch(/nothing is charged|already set/i);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const ask = screen.getAllByRole("button", { name: "Ask for it" })[0];
    await waitFor(() => expect(ask).not.toBeDisabled());
    fireEvent.click(ask);
    const times = await screen.findByRole("group", { name: /^Pickup time on / });
    fireEvent.click(within(times).getAllByRole("button")[0]);
    const note = document.querySelector("[data-sheet-note]")!;
    expect(note.textContent).toBe("Asking is free. Lexi picks who gets it. If it's you, your first free item has a one-time ID check first (we show you the cost before you pay), then you choose your pickup time and get the address.");
    // Asking itself is unchanged: the time still rides the ask.
    fireEvent.click(screen.getByRole("button", { name: /^Ask for it · / }));
    await waitFor(() => expect(state.claimed).toBe(1));
  });

  // identityCheckOffEntryPoints (c2): the ID check is named only while the identity_check switch is on.
  // @mutate src/lib/i18n/enFree.ts |   "free.stepsNoId": "you choose your pickup time and get the address", |   "free.stepsNoId": "your first free item has a one-time ID check first, then you choose your pickup time and get the address",
  it("with the ID check switch off, the first-pick steps never name an ID check", async () => {
    const { firstPickSteps } = await import("@/lib/declutter/freePickSteps");
    expect(firstPickSteps(false)).toBe("you choose your pickup time and get the address");
    expect(firstPickSteps(false)).not.toMatch(/ID check/i);
    expect(firstPickSteps(true)).toMatch(/one-time ID check/);
  });

  it("a member who already paid the one-time fee still reads that the time is set and nothing is charged", async () => {
    state.profile = { onboarding_fee_paid: true };
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    const ask = await screen.findByRole("button", { name: "Ask for it" });
    await waitFor(() => expect(ask).not.toBeDisabled());
    fireEvent.click(ask);
    const times = await screen.findByRole("group", { name: /^Pickup time on / });
    fireEvent.click(within(times).getAllByRole("button")[0]);
    expect(document.querySelector("[data-sheet-note]")!.textContent).toMatch(/^Free, nothing is charged\. Lexi picks who gets it\. If it's you, .+ is already set, and you'll get the address\.$/);
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

  // @mutate src/components/declutter/DeclutterFreeClaim.tsx | value={{ who: "them", text: giverFirstName ? t("free.waitingOn", { name: giverFirstName }) : t("free.waitingOnGiver") }} | value={{ who: "info", text: "The giver picks who gets it. We'll tell you either way." }}
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
    // Audit 1110 F359c: it asks first, like Take back my offer; nothing is withdrawn until Take it back.
    fireEvent.click(screen.getByRole("button", { name: "Take back my ask" }));
    expect(await screen.findByText("Take back your ask?")).toBeInTheDocument();
    expect(screen.getByText(/your ask ends\. Nothing is charged\./)).toBeInTheDocument();
    expect(state.withdrawn).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.withdrawn).toEqual(["r1"]));
  });

  // Audit 1110 F359c: the asker sees the pickup time they chose (the giver already sees it beside their name).
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |         {myAsk.pickup_at && ( |         {false && (
  it("F359c: with the member's ask open, the page shows the pickup time they asked for", async () => {
    // 2027-11-13 16:00Z is Sat 10 AM in Lafayette (a year out, so never "Today").
    state.asks = [{ id: "r1", item_id: "i1", status: "open", created_at: "2026-10-30T00:00:00Z", pickup_at: "2027-11-13T16:00:00Z" }];
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    expect(await screen.findByText("You asked for this.")).toBeInTheDocument();
    expect(document.querySelector("[data-my-ask-time]")?.textContent).toBe("Pickup Sat, 11/13, 10 AM");
  });

  // Audit 1110 F359c: Change time opens the same sheet; the new time goes to declutter_request_free_at, which moves the
  // open ask's pickup_at (20261101174857).
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |         {changing && ( |         {false && (
  // @mutate src/components/declutter/FreeAskSheet.tsx | {slot ? t(change ? "fask.changeTo" : "fask.askAt", | {slot ? t("fask.askAt",
  it("F359c: Change time on the member's open ask sends the new time and says Change to", async () => {
    state.asks = [{ id: "r1", item_id: "i1", status: "open", created_at: "2026-10-30T00:00:00Z", pickup_at: "2027-11-13T16:00:00Z" }];
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change time" }));
    expect(await screen.findByText("Change your pickup time")).toBeInTheDocument();
    const times = await screen.findByRole("group", { name: /^Pickup time on / });
    fireEvent.click(within(times).getAllByRole("button")[0]);
    const send = screen.getByRole("button", { name: /^Change to / });
    expect(state.claimed).toBe(0);
    fireEvent.click(send);
    await waitFor(() => expect(state.claimed).toBe(1));
    expect(new Date(state.askedAt!).getTime()).toBeGreaterThan(Date.now());
  });

  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |           onClick={() => setTakingBack(true)}> |           onClick={() => takeBack.mutate(myAsk.id)}>
  it("Keep my ask closes the confirm and withdraws nothing", async () => {
    state.asks = [{ id: "r1", item_id: "i1", status: "open", created_at: "2026-10-30T00:00:00Z" }];
    show(<FreeClaimPanel item={{ ...ITEM, current_price_cents: 0, price_cents: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Take back my ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep my ask" }));
    expect(await screen.findByRole("button", { name: "Take back my ask" })).toBeInTheDocument();
    expect(screen.queryByText("Take back your ask?")).toBeNull();
    expect(state.withdrawn).toEqual([]);
  });
});

// The giver's request list says the giver's move once someone asked (owner 11-01 12:02 PM: the shared next-step line).
// @mutate src/components/declutter/DeclutterFreeClaim.tsx |         <NextStep className="!text-sm" value={{ who: "you", text: t("free.pickWho"), by: t("free.nAsked", { n: rows.length }) }} /> |         null
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
    // The sticky bar's "Your offer" button points at the box; the box itself says "Your offer" too.
    await waitFor(() => expect(document.querySelector("[data-your-offer]")?.textContent).toContain("Your offer"));
    expect(screen.getByRole("button", { name: "Your offer" })).toBeInTheDocument();
    expect(screen.getByText("$25")).toBeInTheDocument();
    // The shared next-step line (owner 11-01): who it waits on, with the time left.
    // @mutate src/components/declutter/DeclutterYourOffer.tsx |           : { who: "them", text: "Waiting on the seller to answer", by: timeLeft(offer.respond_by) }} |           : { who: "them", text: "Waiting on the seller to answer" }}
    expect(document.querySelector("[data-your-offer] [data-next-step]")?.textContent).toBe("Waiting on the seller to answer · 39 hours left");
    expect(screen.queryByRole("button", { name: "Make offer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change my offer" }));
    expect(state.responded).toEqual([]);
    expect(await screen.findByText("Take back your $25 offer?")).toBeInTheDocument();
    state.offers = [];
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    await waitFor(() => expect(state.responded).toEqual([{ offerId: "o1", action: "withdraw" }]));
    expect(await screen.findByLabelText("Your offer")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Make offer" })).toBeInTheDocument();
  });

  it("the seller answered with a price: their price and Answer it in Buying", async () => {
    state.offers = [{ ...OFFER, amount_cents: 3200, awaiting: "buyer", counter_count: 1 }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("The seller answered")).toBeInTheDocument();
    expect(screen.getByText("$32")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Answer it" })).toHaveAttribute("href", "/declutter?tab=buying");
    expect(screen.queryByRole("button", { name: "Make offer" })).toBeNull();
  });

  it("an offer that closed (declined, taken back) leaves Make an offer as it was", async () => {
    state.offers = [{ ...OFFER, status: "declined" }, { ...OFFER, offer_id: "o3", status: "withdrawn" }];
    show(<OfferPanel item={ITEM} userId="u1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Make offer" })).toBeEnabled());
    expect(screen.queryByText("Change my offer")).toBeNull();
  });
});

// A1-B2 (Declutter audit, prod 2026-10-29): the button said "Buy now · $32.20 total" while Stripe charged $34.20,
// because a first purchase also carries the one-time account setup fee. Owner pick 2 (11-08, one price story)
// settles it the other way round: the button names NO figure, so it can never disagree with the charge; the price
// block's "$42.70 incl. fee" is the price, and the one-time fee is its own line in the checkout summary
// (DeclutterCheckoutSummary "One-time setup fee", guarded in declutterCheckoutSummary tests).
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (way !== "none") return <span className="whitespace-nowrap font-semibold" data-buy-label="">{t("decl.buy.now")}</span>; |
describe("Buy now names no second figure; the setup fee is a checkout line (A1-B2, owner pick 2 11-08)", () => {
  it("an account that still owes the setup fee sees plain Buy now: no $44.70, no setup-fee words on the bar", async () => {
    state.setupFeeCents = 200;
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now" });
    expect(buy.textContent).toBe("Buy now");
    expect(screen.queryByRole("button", { name: /\$/ })).toBeNull();
    expect(screen.queryByText(/setup fee/)).toBeNull();
  });

  it("once paid it is the same plain Buy now", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect((await screen.findByRole("button", { name: "Buy now" })).textContent).toBe("Buy now");
  });

  it("while the fee answer is not in, nothing hedges a figure the button no longer shows", async () => {
    state.setupFeeKnown = false;
    show(<OfferPanel item={ITEM} userId="u1" />);
    await screen.findByRole("button", { name: "Buy now" });
    expect(screen.queryByText("+ any one-time setup fee")).toBeNull();
  });
});

// Owner pick 1 (11-08, replacing 11-01's bar-only pair and 11-07's stacked three): ONE sticky bar with Make offer (an
// outline, left) and Buy now (the one filled button, right), side by side, one line each. Message is on the seller
// row (declutterItemPage.test.tsx), not in this bar.
// @mutate src/components/declutter/DeclutterOfferPanel.tsx |             <span data-offer-label="">{t("decl.buy.makeOffer")}</span> |             <span data-offer-label="">Make an offer to the seller now</span>
// @mutate src/components/ui/StickyActionBar.tsx | className="mx-auto flex w-full max-w-xl gap-2 [&>*]:min-w-0 [&>*]:flex-1" | className="mx-auto grid w-full max-w-xl gap-2"
describe("one sticky bar: Make offer then Buy now, side by side (owner pick 1, 11-08)", () => {
  it("two buttons in one row, the secondary first and the one primary last, no Ask the seller", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const region = await screen.findByRole("region", { name: "Buy or make an offer" });
    const group = within(region).getByRole("group", { name: "Buy or make an offer" });
    const buy = within(group).getByRole("button", { name: "Buy now" });
    const offer = within(group).getByRole("button", { name: "Make offer" });
    expect([...group.querySelectorAll("button")]).toEqual([offer, buy]);
    expect(group.className).toMatch(/\bflex\b/);
    expect(group.className).not.toMatch(/grid/);
    expect(offer.textContent).toBe("Make offer");
    expect(within(region).queryByRole("button", { name: "Ask the seller" })).toBeNull();
    // ONE filled button: Buy now is the primary, Make offer an outline.
    expect(offer.className).toMatch(/ctl-tint/);
    expect(buy.className).not.toMatch(/ctl-tint/);
  });
});

// Smart offers (owner 2026-10-29): a seller who turned offers off sells Buy only. The item page shows no
// "Make an offer" (panel or phone bar) and says so; an item read before the column existed counts as offers on.
describe("offers off = Buy only (smart offers)", () => {
  it("no Make an offer when the seller turned offers off", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: false }} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Buy now" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Make offer" })).toBeNull();
    expect(screen.getByText("The seller isn't taking offers on this one.")).toBeTruthy();
  });

  it("offers on (or not yet known) keeps Make an offer", async () => {
    show(<OfferPanel item={{ ...ITEM, accepts_offers: true }} userId="u1" />);
    expect((await screen.findAllByRole("button", { name: "Make offer" })).length).toBeGreaterThan(0);
    expect(screen.queryByText("The seller isn't taking offers on this one.")).toBeNull();
  });
});

// Owner 11-07 (Vinted review, item 3): the offer sheet has quick chips "10% off" and "20% off" the price and Custom
// (the amount field), the buyer's total incl. fee under them, and ONE Send offer button. A chip shows only where the
// server's offer rule would take it (at least half the price, under the price; declutter_make_offer checks again).
// @mutate src/lib/declutter/money.ts |   return cents >= minOfferCents(currentPriceCents) && cents < currentPriceCents ? cents : null; |   return cents;
// @mutate src/components/declutter/DeclutterOfferPanel.tsx | onClick={() => setAmount(centsToDollars(chip))} | onClick={() => setAmount(centsToDollars(item.current_price_cents))}
// @mutate src/components/declutter/DeclutterOfferPanel.tsx | data-offer-chip="custom" className="justify-center px-2" onClick={() => { setAmount(""); offerBox.current?.focus(); }}> | data-offer-chip="custom" className="justify-center px-2" onClick={() => undefined}>
// @mutate src/components/declutter/DeclutterOfferPanel.tsx | <PriceInclFee priceCents={chip} className="block text-ds-11 font-normal tabular-nums text-muted-foreground" /> | <span className="tabular-nums">{formatPrice(chip)}</span>
// Owner 11-11 F358: the offer is the big figure, incl. fee small under it.
// @mutate src/components/declutter/DeclutterOfferPanel.tsx | <span className="block text-ds-13 font-bold tabular-nums" data-offer-chip-amount="">{formatPrice(chip)}</span> | <span className="block text-ds-11 tabular-nums" data-offer-chip-amount="">{formatPrice(chip)}</span>
describe("owner 11-07: offer chips, the total incl. fee, one Send offer", () => {
  it("offerChipCents: N% off to the cent, only inside the offer rule", () => {
    expect(offerChipCents(4000, 10)).toBe(3600);
    expect(offerChipCents(4000, 20)).toBe(3200);
    expect(offerChipCents(1999, 10)).toBe(1799);
    // $1.10: 10% off is 99c, under the $1 lowest offer: no chip.
    expect(minOfferCents(110)).toBe(100);
    expect(offerChipCents(110, 10)).toBeNull();
    expect(offerChipCents(100, 10)).toBeNull();
  });

  it("10% off fills $36 and shows $38.50 incl. fee; Custom clears and focuses the field; one Send offer", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const region = await screen.findByRole("region", { name: "Buy or make an offer" });
    const offerBtn = within(region).getByRole("button", { name: "Make offer" });
    await waitFor(() => expect(offerBtn).toBeEnabled());
    fireEvent.click(offerBtn);
    const chips = await within(region).findByRole("radiogroup", { name: "Quick offer amounts" });
    expect(within(chips).getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? r.textContent)).toEqual(["10% off, an offer of $36 ($38.50 incl. fee)", "20% off, an offer of $32 ($34.30 incl. fee)", "Custom"]);
    fireEvent.click(within(chips).getByRole("radio", { name: "10% off, an offer of $36 ($38.50 incl. fee)" }));
    const box = screen.getByLabelText("Your offer") as HTMLInputElement;
    expect(box.value).toBe("36");
    expect(within(chips).getByRole("radio", { name: "10% off, an offer of $36 ($38.50 incl. fee)" })).toHaveAttribute("aria-checked", "true");
    // F117 (UI audit 11-09): the chip itself shows what the buyer pays, incl. fee, and the offer under it.
    expect(within(chips).getByRole("radio", { name: /^10% off/ }).textContent).toBe("10% off$36$38.50 incl. fee");
    // Owner 11-11 F358: the offer is the big figure; incl. fee is the small line.
    const amt = within(chips).getByRole("radio", { name: /^10% off/ }).querySelector("[data-offer-chip-amount]")!;
    expect(amt.textContent).toBe("$36");
    expect(amt.className).toContain("text-ds-13 font-bold");
    // $36 + round($36 x 5%) + 70c = $38.50, from the same rule as checkout.
    expect(region.querySelector("[data-offer-bill]")?.textContent).toMatch(/You pay if the seller says yes\$38\.50incl\. fee/);
    expect(within(region).getAllByRole("button", { name: "Send offer" })).toHaveLength(1);
    fireEvent.click(within(chips).getByRole("radio", { name: "Custom" }));
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "30" } });
    expect(within(chips).getByRole("radio", { name: "Custom" })).toHaveAttribute("aria-checked", "true");
  });
});
