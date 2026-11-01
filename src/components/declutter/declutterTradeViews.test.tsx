/**
 * The Declutter screens added by slice 3 (docs/specs/declutter-auctions.md rows 13, 16-22,
 * 36, 38, 53, 56-59; B25-B38): what each STATE renders, in plain words. The
 * API module is stubbed; the backend proof is
 * src/test/pglite/declutterSlice3.pglite.mjs and scripts/declutter/race-accept.mjs.
 *
 * Owner 2026-10-19: Buy now and Make an offer always show; with no saved card either one asks for a
 * card (AddCardStep) and comes back to itself (src/lib/declutter/afterCard.ts).
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (card.data) {\n      setNeedCard(null); |     if (true) {\n      setNeedCard(null);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |               rememberAfterCard(itemId, action, undefined, offerAmount);\n | \n
 * DA-11 (Declutter audit 2026-10-30): the amount first, the card at Send, and the typed amount survives the trip.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (action === "offer") {\n      setNeedCard(null);\n      setOpen(true);\n      return;\n    } |     void 0;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     else setNeedCard("offer"); |     else send.mutate();
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | offerAmount={action === "offer" ? amount.trim() : undefined} | offerAmount={undefined}
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | useState(() => offerAmountFromState(location.state) ?? ""); | useState("");
 * @mutate src/components/declutter/handoverCopy.ts |   porch: "Porch pickup", |   porch: "Porch or safe place",
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | useState(() => !!offerAmountFromState(location.state)); | useState(false);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | \|\| card.isLoading \|\| checkingCard} | }
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | variant={needCard === "offer" ? "outline" : undefined} | variant={undefined}
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (item.status === "live" && !underAge) { |     if (false) {
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | useState<AfterCardAction \| null>(() => afterCardFromState(location.state)); | useState<AfterCardAction \| null>(() => null);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     refetchInterval: resume ? CARD_POLL_MS : false, |     refetchInterval: false,
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       setNeedCard(resume);\n      showPanel();\n    }, CARD_WAIT_MS); |       showPanel();\n    }, CARD_WAIT_MS);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   useEffect(() => { if (resume) showPanel(); }, [resume]); |   useEffect(() => {}, [resume]);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       setNeedCard(resume);\n      showPanel(); |       setNeedCard(resume);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |         setCardSaved(true); |         setCardSaved(false);
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null }); |       void navigate;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       {!showCardStep && <p className="text-xs | {true && <p className="text-xs
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (underAge) { |   if (false) {
 * DB-5 (owner 2026-10-30): Buy now goes straight to that seller's checkout: no reserve sheet, never window.confirm.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (!buy.isPending) buy.mutate(); |     if (window.confirm("Buy?")) buy.mutate();
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |       navigate(checkoutLinkFor(item.seller_id)); |       void checkoutLinkFor;
 * @mutate src/lib/declutter/buyNowHold.ts |   return sellerId ? `/declutter?tab=buying&checkout=${encodeURIComponent(sellerId)}` : "/declutter?tab=buying"; |   return "/declutter?tab=buying";
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | && o.floor_price_cents < o.current_price_cents && o.amount_cents < o.floor_price_cents; | && o.floor_price_cents < o.current_price_cents;
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | disabled={act.isPending} onClick={() => setDeclining(true)}> | disabled={act.isPending} onClick={() => act.mutate({ action: "decline" })}>
 * @mutate src/components/declutter/DeclutterOffersSection.tsx |   const wantedReply = o.from_wanted === true && o.my_side === "buyer"; |   const wantedReply = false;
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | o.my_side === "buyer" && !(wantedReply && o.awaiting === "buyer") && ( | o.my_side === "buyer" && (
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | : wantedReply ? "their price" : "their counter") | : "their counter")
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | : wantedReply\n            ? `"${o.item_title}": this reply ends | : false\n            ? `"${o.item_title}": this reply ends
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   if (n === 0) return null; |   if (n === 0) return <p>You have 0 of 3 strikes.</p>;
 * Slice 3b (B39, B44, B45): the working Save a card / Pay buttons and the switch-off view.
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |               const url = await startCardSave(); |               const url = "https://example.invalid";
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |             const res = await startCheckoutPayment(sellerId, chosen, sellerDelivering ? slot : null, sellerDelivering ? handoff : null,\n              sellerDelivering ? sdRate : null); |             const res = await startCheckoutPayment(sellerId, "pickup_home");
 * Row 101 (porch is the default; a seller can turn it off per item).
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const chosen = picked && offered.includes(picked) ? picked : offered[0]; |   const chosen = picked ?? offered[0];
 * Slice 5 (Helpr delivery, rows 29-30): offered while Declutter is open, priced by the server.
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const ticked: Handover[] = deliveryOpen && wayAllowed(ways, "delivery", true) ? [...order, "delivery"] : order; |   const ticked: Handover[] = wayAllowed(ways, "delivery", true) ? [...order, "delivery"] : order;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |         disabled={held \|\| opening \|\| offered.length === 0 \|\| (delivering && !liveQuote) \|\| (sellerDelivering && !sdReady) \|\| !meetupReady \|\| !placeReady} |         disabled={held \|\| opening \|\| offered.length === 0 \|\| (sellerDelivering && !sdReady) \|\| !meetupReady \|\| !placeReady}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |   const payCents = (delivering && liveQuote ? totalCents + liveQuote.delivery_cents : sdAmounts ? sdAmounts.totalCents : totalCents) + setupFeeCents; |   const payCents = (sdAmounts ? sdAmounts.totalCents : totalCents) + setupFeeCents;
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | porchOk={lines.every((l) => l.porch_ok !== false)} onBack= | porchOk={true} onBack=
 * @mutate src/components/declutter/DeclutterTradeViews.tsx |       <CartView />\n      <PaidOrders side="buyer" />\n      <SalesWaiting /> |       <PaidOrders side="buyer" />\n      <SalesWaiting />
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within, waitForElementToBeRemoved } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const state = {
  underAge: false,
  handovers: null as string[] | null,
  card: null as unknown,
  /** NIGHT-BUYING0-5: the card read fails. */
  cardReadFails: false,
  /** NIGHT-BUYING0-6: declutter_buy_now refuses with this message (e.g. card_required). */
  buyRefusal: null as string | null,
  bought: 0,
  /** When set, the next openExternalUrl comes straight back (the in-app browser sheet closing) with this card saved. */
  returnWithCard: null as unknown,
  strikes: 0,
  /** BUY-9: the buyer's newest drop-off (declutter_delivery_dropoffs, theirs only); null = none. */
  lastDropoff: null as string | null,
  lastDropoffReads: 0,
  /** BUY-9: the signed-in buyer (null = none, as every other case here reads it). */
  me: null as string | null,
  offers: [] as unknown[],
  cart: [] as unknown[],
  /** A2-8: cart lines the buyer removed (declutter_remove_cart_item). */
  removed: [] as string[],
  sent: [] as unknown[],
  paid: [] as unknown[],
  opened: [] as string[],
  deliveryOn: false,
  quotes: [] as unknown[],
  /** Q2352: the one-time account setup fee still owed (useFirstPayoutFeeCents), 0 once paid. */
  setupFeeCents: 0,
  /** useFirstPayoutFeeKnown: false while the fee answer is not in (the total then says "+ any setup fee"). */
  setupFeeKnown: true,
  /** declutter_seller_delivery (20261027153244), read on its own. */
  sellerDeliveryOn: false,
  sdOffer: null as unknown,
  /** Q2425: the safe meetup spots near this cart (declutter_meetup_spots_near) and the chosen spot ids. */
  spots: [] as { id: string; name: string; address: string; parish: string; kind: "police" | "store" | "other"; note: string | null; miles: number | null; chosen: boolean }[],
  chosenSpots: [] as string[],
  /** Q2427: the server's bundle preview (cents off this cart) and a seller's rule. */
  bundleOff: 0,
  bundleRule: null as number | null,
  previewCalls: 0,
  /** Q2462: who "Message the seller" opened a handover chat with (declutter_open_handover_talk). */
  talksOpened: [] as string[],
  /** D4-9: the answers respondOffer was called with. */
  responded: [] as string[],
};

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => (key === "declutter_seller_delivery" ? state.sellerDeliveryOn : state.deliveryOn) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => state.setupFeeCents, useFirstPayoutFeeKnown: () => state.setupFeeKnown }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()),
  fetchSellerDeliveryOffer: async () => state.sdOffer,
  quoteSellerDelivery: async () => state.sdOffer,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: state.me ? { id: state.me } : null, profile: null, isLoading: false }) }));
vi.mock("@/lib/declutter/lastDropoff", () => ({ fetchMyLastDropoff: async () => { state.lastDropoffReads += 1; return state.lastDropoff; } }));
vi.mock("@/lib/declutter/delivery", () => ({
  fetchDeliveryQuote: async (sellerId: string, address: string) => {
    state.quotes.push({ sellerId, address });
    return { road_miles: 5, size: "large", delivery_cents: 4000, base_cents: 1000, per_mile_cents: 1000, size_cents: 2000, dropoff_area: "Baker, LA" };
  },
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => state.bundleRule,
  fetchBundlePreview: async () => { state.previewCalls++; return state.bundleOff; },
}));
vi.mock("@/lib/declutter/meetup", () => ({
  fetchMeetupSpotsNear: async () => state.spots.map((sp) => ({ ...sp, chosen: state.chosenSpots.includes(sp.id) })),
  chooseMeetupSpot: async (_seller: string, spotId: string) => { state.chosenSpots = [spotId]; },
}));
/** BUY-15: the photos the cart's thumbnails read (declutter_item_photos), set per case. */
const cartPhotos: { id: string; item_id: string; storage_path: string; position: number }[] = [];
vi.mock("@/lib/declutter/api", () => ({
  // Audit 1030 DB-4: the ways the seller ticked (null = an older item: "with pickup").
  fetchItemHandovers: async () => state.handovers,
  fetchMyCard: async () => {
    if (state.cardReadFails) throw new Error("read failed");
    return state.card;
  },
  fetchMyActiveStrikes: async () => state.strikes,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  // BUY-15: the cart's small photos (first photo per item).
  fetchPhotos: async (ids: string[]) => cartPhotos.filter((p) => ids.includes(p.item_id)),
  photoPublicUrl: (path: string) => `https://photos.test/${path}`, photoCardUrl: (path: string) => `https://photos.test/${path}`, CARD_PHOTO_PX: 480,
  makeOffer: async (itemId: string, cents: number) => {
    state.sent.push({ itemId, cents });
    return "o1";
  },
  respondOffer: async (_id: string, action: string) => { state.responded.push(action); return "declined"; },
  buyNow: async () => {
    state.bought++;
    if (state.buyRefusal) throw new Error(state.buyRefusal);
    return "l1";
  },
  sellerCancelSale: async () => 1,
  removeCartItem: async (lineId: string) => { state.removed.push(lineId); return "removed"; },
  startCardSave: async () => "https://checkout.stripe.test/setup",
  startCheckoutPayment: async (sellerId: string, handover: string, slot?: string | null, handoff?: string | null) => {
    state.paid.push(handover === "seller_delivery" ? { sellerId, handover, slot, handoff } : { sellerId, handover });
    return { url: "https://checkout.stripe.test/pay", paid: false };
  },
}));
// Slice 4's paid-order cards have their own test (declutterHandoverViews.test.tsx).
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
// The cart reads the seller's porch places (D-NEW14); these sellers have none. Places are proved in porchPlacesUi.test.tsx.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchSellerPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/handoverTalk", () => ({
  openHandoverTalk: async (other: string) => { state.talksOpened.push(other); return "t1"; },
  fetchMyOpenHandoverTalks: async () => [],
}));
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
import { afterCardReturnState } from "@/lib/declutter/afterCard";

/** The router's history state, shown so a test can see OfferPanel clear it. */
function RouterState() {
  const loc = useLocation();
  return (
    <>
      <output data-testid="router-state">{JSON.stringify(loc.state ?? null)}</output>
      <output data-testid="router-path">{loc.pathname + loc.search}</output>
    </>
  );
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
    state.responded = [];
    state.setupFeeCents = 0;
    state.setupFeeKnown = true;
    state.card = null;
    state.cardReadFails = false;
    state.buyRefusal = null;
    state.bought = 0;
    state.returnWithCard = null;
    sessionStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.strikes = 0;
    state.lastDropoff = null;
    state.lastDropoffReads = 0;
    state.me = null;
    state.offers = [];
    state.cart = [];
    state.sent = [];
    state.paid = [];
    state.opened = [];
    state.deliveryOn = false;
    state.quotes = [];
    state.sellerDeliveryOn = false;
    state.sdOffer = null;
    state.spots = [];
    state.chosenSpots = [];
    state.bundleOff = 0;
    state.bundleRule = null;
    state.previewCalls = 0;
  });

  it("no saved card: Buy now and Make an offer still show; Buy asks for a card first and remembers where to come back (row 36)", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now · $42.70 total" });
    expect(screen.getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
    // The reassurance is a line under the buttons, not a box in their place.
    expect(screen.getByText("You're only charged when you buy.")).toBeInTheDocument();
    expect(screen.queryByText("Save a card to buy or make offers.")).toBeNull();
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    expect(await screen.findByText("Add a card to finish.")).toBeInTheDocument();
    // #21 (owner chose C, 2026-10-28): two Stripe pages stay; before the first, one line says what it is for.
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx | We save your card now; you're only charged when you check out. | You're only charged when you buy.
    // NIGHT-BUYING0-4: after the card is saved the app holds the item and opens checkout (run("buy")); no confirm press.
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx | "Then checkout opens." | "Then you confirm the buy."
    expect(screen.getByText("We save your card now; you're only charged when you check out. Then checkout opens.")).toBeInTheDocument();
    // Said once: the line under the buttons steps aside while the card step says it.
    expect(screen.getAllByText(/only charged when/)).toHaveLength(1);
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.test/setup"]));
    // The web returns to /declutter?card=saved: this is how it finds the way back.
    expect(JSON.parse(sessionStorage.getItem("declutter.afterCard") ?? "{}")).toMatchObject({ itemId: "i1", action: "buy" });
    expect(state.bought).toBe(0);
  });

  it("DA-11, no saved card: Make an offer opens the amount box first; the card is asked for at Send and the amount stays", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />);
    const offer = await screen.findByRole("button", { name: "Make an offer" });
    await waitFor(() => expect(offer).toBeEnabled());
    fireEvent.click(offer);
    const input = await screen.findByLabelText("Your offer");
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
    fireEvent.change(input, { target: { value: "30" } });
    // What they would pay shows before any card is asked for.
    expect(document.querySelector("[data-offer-bill]")?.textContent).toMatch(/You pay if the seller says yes\$32\.20/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send offer" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    expect(await screen.findByText(/Then you send your offer\./)).toBeInTheDocument();
    // Nothing went to the server, the amount is still there, and "Add a card" is the one primary.
    expect(state.sent).toEqual([]);
    expect(screen.getByLabelText("Your offer")).toHaveValue("30");
    expect(document.querySelectorAll("[aria-label='Buy or make an offer'] button.btn-grad-primary").length).toBe(1);
    // Not now only closes the card step.
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
    expect(screen.getByLabelText("Your offer")).toHaveValue("30");
    // The trip to Stripe's page remembers the amount for the way back.
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(state.opened).toHaveLength(1));
    expect(JSON.parse(sessionStorage.getItem("declutter.afterCard") ?? "{}")).toMatchObject({ itemId: "i1", action: "offer", offerAmount: "30" });
    expect(state.sent).toEqual([]);
  });

  it("DA-11, in the app (the sheet closes with the card saved): the amount is still there and Send sends it", async () => {
    state.returnWithCard = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    const offer = await screen.findByRole("button", { name: "Make an offer" });
    await waitFor(() => expect(offer).toBeEnabled());
    fireEvent.click(offer);
    fireEvent.change(await screen.findByLabelText("Your offer"), { target: { value: "30" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send offer" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send offer" })).toBeEnabled();
      expect(screen.queryByText("Add a card to finish.")).toBeNull();
      expect(screen.queryByText("Checking for your card…")).toBeNull();
    });
    // Never sent on its own: the member's own press sends it.
    expect(state.sent).toEqual([]);
    expect(screen.getByLabelText("Your offer")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    await waitFor(() => expect(state.sent).toEqual([{ itemId: "i1", cents: 3000 }]));
  });

  it("DA-11, back on the web with the typed amount: Send waits for the card read, then the box is ready", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "offer", offerAmount: "30" } });
    expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
    expect(screen.getByLabelText("Your offer")).toHaveValue("30");
    expect(screen.getByRole("button", { name: "Send offer" })).toBeDisabled();
    state.card = { brand: "visa", last4: "4242" };
    await waitFor(() => expect(screen.getByRole("button", { name: "Send offer" })).toBeEnabled(), { timeout: 4_000 });
    expect(state.sent).toEqual([]);
    await waitFor(() => expect(screen.getByTestId("router-state")).toHaveTextContent("null"));
  });

  it("back from saving a card in the app (the sheet closes): Buy goes straight to that seller's checkout (DB-5)", async () => {
    state.returnWithCard = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now · $42.70 total" });
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    fireEvent.click(await screen.findByRole("button", { name: "Add a card" }));
    await waitFor(() => expect(state.bought).toBe(1));
    // No reserve sheet and no strike warning in between (owner 2026-10-30): the next screen is the checkout.
    await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent("/declutter?tab=buying&checkout=s1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Reserve it/)).toBeNull();
    expect(screen.queryByText(/strike/i)).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
  });

  it("DB-5: with a saved card, one tap on Buy now holds the item and opens that seller's checkout", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    const buy = await screen.findByRole("button", { name: "Buy now · $42.70 total" });
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent("/declutter?tab=buying&checkout=s1"));
    expect(state.bought).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
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
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx | <BuyerTotal priceCents={cents} /></dd> | {formatPrice(cents)}</dd>
    const bill = document.querySelector("[data-offer-bill]")!;
    expect(bill.textContent).toMatch(/Your offer\$30/);
    // Owner 2026-10-25 (issue #3672): the bill names what the buyer pays, never a fee line, name or number.
    expect(bill.textContent).not.toMatch(/fee|%|¢|\$2\.20/i);
    expect(bill.textContent).toMatch(/You pay if the seller says yes\$32\.20/);
    // Under half the price: no bill, the rule instead.
    fireEvent.change(screen.getByLabelText("Your offer"), { target: { value: "5" } });
    expect(document.querySelector("[data-offer-bill]")).toBeNull();
  });

  it("a link with ?after_card=buy does nothing by itself: only the router state resumes", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />, "/declutter/item/i1?after_card=buy");
    await waitFor(() => expect(screen.getByRole("button", { name: "Buy now · $42.70 total" })).toBeEnabled());
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Your offer")).toBeNull();
  });

  it("back before Stripe's webhook filed the card: it keeps looking, then Buy goes on to that seller's checkout (DB-5)", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "buy" } });
    expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
    expect(screen.queryByText("Add a card to finish.")).toBeNull();
    expect(state.bought).toBe(0);
    state.card = { brand: "visa", last4: "4242" };
    // The Buy now the member started carries on: the hold, then the checkout (Pay is still its own press there).
    await waitFor(() => expect(state.bought).toBe(1), { timeout: 4_000 });
    await waitFor(() => expect(screen.getByTestId("router-path")).toHaveTextContent("/declutter?tab=buying&checkout=s1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
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
      expect(await screen.findByText(/Then you send your offer\./)).toBeInTheDocument();
      expect(screen.queryByText("Checking for your card…")).toBeNull();
      expect(window.confirm).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // NIGHT-BUYING0-2 (audit 1030 night, d-375-31-webhook-late): the card filed after the 10-second wait; Buy now
  // still showed the Add a card step and never called declutter_buy_now.
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |     void card.refetch().then((r) => {\n      if (r.data \|\| r.isError) { |     void card.refetch().then((r) => {\n      if (false) {
  it("a card filed after the wait is noticed: Buy now goes on, not to a second card page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "buy" } });
      expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(10_001);
      });
      expect(await screen.findByRole("button", { name: "Add a card" })).toBeInTheDocument();
      // The webhook lands late; no poll is running now.
      state.card = { brand: "visa", last4: "4242" };
      fireEvent.click(screen.getAllByRole("button", { name: "Buy now · $42.70 total" })[0]);
      await waitFor(() => expect(state.bought).toBe(1));
      expect(screen.queryByRole("button", { name: "Add a card" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // NIGHT-BUYING0-5: with the card read failing, Buy now did nothing (no step, no call, no toast). The server decides.
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |       if (r.data \|\| r.isError) { |       if (r.data) {
  // NIGHT-BUYING0-6: the server's card_required left a toast and no way forward; its card step opens.
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |     onError: (err) => { if (!askCardIfRefused(err, "buy")) toast.error(declutterErrorMessage(err)); }, |     onError: (err) => toast.error(declutterErrorMessage(err)),
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const showCardStep = !!needCard && !resume && (!card.isError \|\| serverNoCard); |   const showCardStep = !!needCard && !resume && !card.isError;
  it("0-5/0-6: a failed card read lets Buy now go to the server, and its card_required opens the card step", async () => {
    state.cardReadFails = true;
    state.buyRefusal = "card_required";
    show(<OfferPanel item={ITEM} userId="u1" />);
    expect(await screen.findByText("We couldn't check your saved card.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Buy now · $42.70 total" })[0]);
    await waitFor(() => expect(state.bought).toBe(1));
    expect(await screen.findByRole("button", { name: "Add a card" })).toBeInTheDocument();
  });

  // NIGHT-BUYING0-7: cancelling on the card page came back with no words and the buy dropped.
  // @mutate src/lib/declutter/afterCard.ts |   return { cardCancelled: next.action, ...amount }; |   return next.offerAmount ? amount : null;
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |       note={cardCancelled === action ? CARD_NOT_SAVED : undefined} |       note={undefined}
  it("0-7: back from the card page with none saved, the card step opens again and says so", async () => {
    show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: afterCardReturnState(false, { action: "buy" }) });
    expect(await screen.findByText("No card was saved, so nothing happened yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    expect(state.bought).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("No card was saved, so nothing happened yet.")).toBeNull();
  });

  // NIGHT-BUYING0-1 (audit 1030 night, d-375-30-checking.png): back from the card page the panel sat below a phone's
  // screen ("Checking for your card…" at y 990 of 812, the card step at y 962 after the wait). It is brought into view.
  it("back from the card page: the panel is scrolled into view while checking, and again when the card step returns", async () => {
    const seen: Element[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { seen.push(this); });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "buy" } });
      expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
      const panelEl = screen.getByRole("region", { name: "Buy or make an offer" });
      await waitFor(() => expect(seen).toContain(panelEl));
      const before = seen.filter((e) => e === panelEl).length;
      await act(async () => {
        vi.advanceTimersByTime(10_001);
      });
      expect(await screen.findByRole("button", { name: "Add a card" })).toBeInTheDocument();
      expect(seen.filter((e) => e === panelEl).length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  // NIGHT-BUYING0-3 (audit 1030 night, e-375-41-offer-back.png): back with a card for an offer, the typed offer waited
  // off screen, unsent, with nothing saying so.
  it("back with a card for an offer: the panel comes into view and says the offer still needs Send", async () => {
    const seen: Element[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { seen.push(this); });
    try {
      show(<OfferPanel item={ITEM} userId="u1" />, { pathname: "/declutter/item/i1", state: { afterCard: "offer", offerAmount: "30" } });
      expect(await screen.findByText("Checking for your card…")).toBeInTheDocument();
      expect(screen.queryByText("Card saved. Now send your offer.")).toBeNull();
      state.card = { brand: "visa", last4: "4242" };
      expect(await screen.findByText("Card saved. Now send your offer.", {}, { timeout: 4_000 })).toBeInTheDocument();
      expect(seen).toContain(screen.getByRole("region", { name: "Buy or make an offer" }));
      expect(screen.getByLabelText("Your offer")).toHaveValue("30");
      expect(state.sent).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
      await waitFor(() => expect(state.sent).toEqual([{ itemId: "i1", cents: 3000 }]));
    } finally {
      spy.mockRestore();
    }
  });

  it("no 'Card saved' line on a plain Make an offer (no trip to the card page)", async () => {
    state.card = { brand: "visa", last4: "4242" };
    show(<OfferPanel item={ITEM} userId="u1" />);
    const offer = await screen.findByRole("button", { name: "Make an offer" });
    await waitFor(() => expect(offer).toBeEnabled());
    fireEvent.click(offer);
    expect(await screen.findByLabelText("Your offer")).toBeInTheDocument();
    expect(screen.queryByText("Card saved. Now send your offer.")).toBeNull();
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
    expect(await screen.findByRole("button", { name: "Buy now · $42.70 total" })).toBeInTheDocument();
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

  // Audit 1d D4-3 (2026-10-29, shot 1d-wmatch-1440-p2-1440.png): a seller's answer to the buyer's Wanted post read
  // "$12 their counter · Your turn to answer" with "Take back my offer", for an offer the buyer never made.
  it("a Wanted reply says so in Buying: no 'their counter', no 'Take back my offer'; an ordinary counter is unchanged", async () => {
    const counter = { ...OFFER, offer_id: "o5", my_side: "buyer", awaiting: "buyer", counter_count: 1, floor_price_cents: null, item_title: "Lamp" };
    state.offers = [{ ...counter, offer_id: "o4", item_title: "Blue enamel mug", amount_cents: 1200, from_wanted: true }, counter];
    show(<OffersSection side="buyer" />);
    const rows = await screen.findAllByRole("listitem");
    const reply = rows.find((r) => r.textContent?.includes("Blue enamel mug"))!;
    const plain = rows.find((r) => r.textContent?.includes("Lamp"))!;
    expect(within(reply).getByText("Reply to your Wanted")).toBeInTheDocument();
    expect(within(reply).getByText("their price")).toBeInTheDocument();
    expect(within(reply).queryByText("their counter")).toBeNull();
    expect(within(reply).queryByRole("button", { name: "Take back my offer" })).toBeNull();
    expect(within(reply).getByRole("button", { name: "Say no" })).toBeInTheDocument();
    expect(within(plain).queryByText("Reply to your Wanted")).toBeNull();
    expect(within(plain).getByText("their counter")).toBeInTheDocument();
    expect(within(plain).getByRole("button", { name: "Take back my offer" })).toBeInTheDocument();
  });

  // B11's read of D4-3 (2026-10-30): the Say no sheet said "this counter ends" on a card that says "Reply to your Wanted".
  it("Say no on a Wanted reply says the reply ends; an ordinary counter's sheet is unchanged", async () => {
    const counter = { ...OFFER, offer_id: "o5", my_side: "buyer", awaiting: "buyer", counter_count: 1, floor_price_cents: null, item_title: "Lamp" };
    state.offers = [{ ...counter, offer_id: "o4", item_title: "Blue enamel mug", amount_cents: 1200, from_wanted: true }, counter];
    show(<OffersSection side="buyer" />);
    const rows = await screen.findAllByRole("listitem");
    const openSheet = async (title: string) => {
      fireEvent.click(within(rows.find((r) => r.textContent?.includes(title))!).getByRole("button", { name: "Say no" }));
      return waitFor(() => {
        const sheet = document.querySelector<HTMLElement>('[data-confirm-sheet="decline-offer"]');
        expect(sheet?.textContent).toContain(title);
        return sheet!;
      });
    };
    const reply = await openSheet("Blue enamel mug");
    expect(reply.textContent).toContain("this reply ends, and the seller is told you said no. Nothing is charged.");
    expect(reply.textContent).not.toContain("counter");
    fireEvent.click(within(reply).getByRole("button", { name: "Not now" }));
    const plain = await openSheet("Lamp");
    expect(plain.textContent).toContain("this counter ends. Nothing is charged.");
  });

  // Audit 1d D4-9 (2026-10-29): "Say no" ended the offer at one tap with no "are you sure".
  it("Say no asks first; nothing is sent until the member confirms, and Not now sends nothing", async () => {
    state.offers = [OFFER];
    show(<OffersSection side="seller" />);
    const declineSheet = () => document.querySelector<HTMLElement>('[data-confirm-sheet="decline-offer"]');
    fireEvent.click(await screen.findByRole("button", { name: "Say no" }));
    await waitFor(() => expect(declineSheet()).not.toBeNull());
    const sheet = declineSheet()!;
    expect(sheet.textContent).toContain("Say no to $25?");
    expect(sheet.textContent).toContain("the buyer is told you said no");
    expect(state.responded).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Not now" }));
    await waitFor(() => {
      expect(declineSheet()).toBeNull();
      expect(screen.getByRole("button", { name: "Say no" })).toBeInTheDocument();
    });
    expect(state.responded).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Say no" }));
    await waitFor(() => expect(declineSheet()).not.toBeNull());
    fireEvent.click(within(declineSheet()!).getByRole("button", { name: "Say no" }));
    await waitFor(() => expect(state.responded).toEqual(["decline"]));
  });

  // Audit 1a #7 (prod 2026-10-29): a $30 listing with no lowest price stores $30 there, so a $20 offer AND the seller's
  // own $25 counter both read "This is under your lowest price ($30)". The note is for a buyer's amount waiting on the
  // seller, under a lowest price the seller set below the price.
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |   const underFloor = o.my_side === "seller" && myTurn && o.floor_price_cents !== null | const underFloor = o.my_side === "seller" && o.floor_price_cents !== null
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | null && o.floor_price_cents < o.current_price_cents && o.amount_cents | null && o.amount_cents
  it("audit 1a #7: no under-floor note when no lowest price was set, nor on the seller's own counter", async () => {
    state.offers = [
      { ...OFFER, offer_id: "n1", amount_cents: 2000, current_price_cents: 3000, floor_price_cents: 3000, item_title: "No floor lamp" },
      { ...OFFER, offer_id: "c1", amount_cents: 2500, awaiting: "buyer", current_price_cents: 4000, floor_price_cents: 3000, item_title: "Countered desk" },
      { ...OFFER, offer_id: "f1", amount_cents: 2000, current_price_cents: 4000, floor_price_cents: 3000, item_title: "Floor chair" },
    ];
    show(<OffersSection side="seller" />);
    expect(await screen.findByText("Floor chair")).toBeInTheDocument();
    const notes = screen.getAllByText(/under your lowest price/);
    expect(notes).toHaveLength(1);
    expect(notes[0].closest("[data-offer-row]")).toHaveTextContent("Floor chair");
  });

  it("board 160: a buyer's declined or expired offer says nothing was charged and links the item; never 'Offer again'", async () => {
    state.offers = [
      { ...OFFER, offer_id: "d1", my_side: "buyer", status: "declined", floor_price_cents: null, item_title: "Porch swing" },
      { ...OFFER, offer_id: "e1", my_side: "buyer", status: "expired", floor_price_cents: null, item_title: "Rug" },
      { ...OFFER, offer_id: "s9", status: "declined", item_title: "Desk" },
    ];
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    // @mutate src/components/declutter/DeclutterOffersSection.tsx | {o.my_side === "buyer" && (o.status === "declined" \|\| o.status === "expired") && ( | {false && (
    const ended = await screen.findAllByText(/^Nothing was charged\./);
    expect(ended).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "See the item" })[0].getAttribute("href")).toBe(`/declutter/item/${OFFER.item_id}`);
    expect(screen.queryByText(/Offer again/)).toBeNull();
  });

  // Deep audit #30 (2026-10-28, shot 125): "Offers on your items" kept every closed offer (Declined, Taken back,
  // Accepted) above the live ones. The seller sees the open offers; the closed ones fold under one dated button.
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |   const shown = seller ? mine.filter((o) => o.status === "open") : mine; |   const shown = mine;
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |       ) : shown.length === 0 ? ( |       ) : false ? (
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |           {showClosed && <ul className="space-y-3" data-closed-offers=""> |           {true && <ul className="space-y-3" data-closed-offers="">
  it("deep audit #30: the seller sees open offers; closed ones fold under one button, and open again on tap", async () => {
    const CLOSED = ["declined", "withdrawn", "accepted", "expired", "voided"] as const;
    state.offers = [
      { ...OFFER, offer_id: "open1", item_title: "Oak desk" },
      ...CLOSED.map((st, n) => ({ ...OFFER, offer_id: `c${n}`, status: st, item_title: `Closed ${st}` })),
      // A buyer's own closed offer stays in "Your offers" as before.
      { ...OFFER, offer_id: "b1", my_side: "buyer", status: "declined", floor_price_cents: null, item_title: "Porch swing" },
    ];
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    const selling = await screen.findByRole("region", { name: "Offers on your items" });
    expect(within(selling).getByText("Oak desk")).toBeInTheDocument();
    for (const st of CLOSED) expect(within(selling).queryByText(`Closed ${st}`), st).toBeNull();
    const toggle = within(selling).getByRole("button", { name: `Show ${CLOSED.length} closed offers from the last 30 days` });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    for (const st of CLOSED) expect(within(selling).getByText(`Closed ${st}`), st).toBeInTheDocument();
    expect(within(selling).getByRole("button", { name: "Hide closed offers" })).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("region", { name: "Your offers" })).getByText("Porch swing")).toBeInTheDocument();
  });

  it("deep audit #30: only closed offers left: 'No open offers.' and the fold, never the first-time empty state", async () => {
    state.offers = [{ ...OFFER, offer_id: "c1", status: "declined", item_title: "Old lamp" }];
    show(<OffersSection side="seller" />);
    expect(await screen.findByText("No open offers.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 closed offer from the last 30 days" })).toBeInTheDocument();
    expect(screen.queryByText("No offers yet")).toBeNull();
    expect(screen.queryByText("Old lamp")).toBeNull();
  });

  it("boards 68-70: an offer card's money lines use what accepting really charges, least(offer, price now)", async () => {
    state.offers = [
      // The seller dropped the price to $22 below the buyer's $25 offer: accepting sells for $22.
      { ...OFFER, offer_id: "s1", current_price_cents: 2200, floor_price_cents: 1000, item_title: "Desk" },
      // The seller countered $30 to this buyer: their price $30, fee $2.20, $32.20 with pickup.
      { ...OFFER, offer_id: "b1", my_side: "buyer", awaiting: "buyer", amount_cents: 3000, floor_price_cents: null, item_title: "Lamp", counter_count: 1 },
    ];
    show(<><OffersSection side="seller" /><OffersSection side="buyer" /></>);
    // @mutate src/components/declutter/DeclutterOffersSection.tsx |   const takeCents = Math.min(o.amount_cents, o.current_price_cents); |   const takeCents = o.amount_cents;
    expect((await screen.findByText(/If you accept and the buyer pays/)).textContent).toMatch(/you keep the whole \$22\./);
    expect(screen.getByText("their offer")).toBeInTheDocument();
    expect(screen.getByText("their counter")).toBeInTheDocument();
    const bill = document.querySelector("[data-offer-bill]")!;
    expect(bill.textContent).toMatch(/Their price\$30/);
    expect(bill.textContent).not.toMatch(/fee|%|¢|\$2\.20/i);
    expect(bill.textContent).toMatch(/You pay with pickup\$32\.20/);
  });

  // Audit 1030 DB-4: the counter said "You pay with pickup" on an item the seller offers no pickup for.
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | You pay {totalPhrase(noDeliveryWay(ways.data))}</dt> | You pay with pickup</dt>
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | queryFn: () => fetchItemHandovers(o.item_id), enabled: myTurn | queryFn: () => fetchItemHandovers(o.item_id), enabled: false && myTurn
  it("DB-4: the counter's total names the way the seller offers", async () => {
    for (const [ways, words] of [[["meetup", "seller_delivery"], "at a safe meetup"], [["delivery"], "before delivery"], [["porch"], "with porch pickup"]] as const) {
      state.handovers = [...ways];
      state.offers = [{ ...OFFER, offer_id: "b1", my_side: "buyer", awaiting: "buyer", amount_cents: 3000, floor_price_cents: null, item_title: "Lamp", counter_count: 1 }];
      const { unmount } = show(<OffersSection side="buyer" />);
      await waitFor(() => expect(document.querySelector("[data-offer-bill]")?.textContent).toContain(`You pay ${words}`));
      expect(document.querySelector("[data-offer-bill]")?.textContent).not.toMatch(/with pickup/);
      unmount();
    }
    state.handovers = null;
  });

  // Audit 1030 DB-15: accepting a counter asked "Buy it for $28?" with no total; the sheet now says what the buyer pays
  // with pickup, the bill's own figure (BuyerTotal on least(offer, price now)).
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | you pay at most `}<BuyerTotal priceCents={takeCents} />{` ${totalPhrase | you pay at most `}{` ${totalPhrase
  it("DB-15: the buyer's accept sheet says the total with pickup", async () => {
    state.offers = [{ ...OFFER, offer_id: "b1", my_side: "buyer", awaiting: "buyer", amount_cents: 3000, floor_price_cents: null, item_title: "Lamp", counter_count: 1 }];
    show(<OffersSection side="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    const sheet = await screen.findByText(/you pay at most/);
    expect(sheet.textContent).toBe('"Lamp": you pay at most $32.20 with pickup. You\'ll have 48 hours to check out and pay, or you get a strike. Nothing is charged until you do.');
  });

  // NIGHT-SELL-offers,sale-1 (audit 10-30 night, High): after a price drop to $40 a $48 offer's Accept asked "Sell it for
  // $48?" while the card said "you keep the whole $40"; declutter_respond_offer sells at least(offer, price now).
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | `Sell it for ${formatPrice(takeCents)}?` | `Sell it for ${formatPrice(o.amount_cents)}?`
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | `Buy it for ${formatPrice(takeCents)}?` | `Buy it for ${formatPrice(o.amount_cents)}?`
  // @mutate src/components/declutter/DeclutterOffersSection.tsx | ${takeCents < o.amount_cents ? `Their ${formatPrice(o.amount_cents)} offer is above your price now, so it sells at ${formatPrice(takeCents)}. ` : ""} |
  it("NIGHT-SELL-offers,sale-1: Accept on an offer above a dropped price names the price it sells at", async () => {
    state.offers = [{ ...OFFER, amount_cents: 4800, current_price_cents: 4000, floor_price_cents: null }];
    const seller = show(<OffersSection side="seller" />);
    expect(await screen.findByText(/you keep the whole/)).toHaveTextContent("you keep the whole $40.");
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    let sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Sell it for $40?");
    expect(sheet).not.toHaveTextContent("Sell it for $48?");
    expect(sheet).toHaveTextContent("Their $48 offer is above your price now, so it sells at $40.");
    seller.unmount();
    state.offers = [{ ...OFFER, offer_id: "b1", my_side: "buyer", awaiting: "buyer", amount_cents: 4800, current_price_cents: 4000, floor_price_cents: null, counter_count: 1 }];
    const buyer = show(<OffersSection side="buyer" />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Buy it for $40?");
    buyer.unmount();
    // An offer under the price: as before, no extra words.
    state.offers = [{ ...OFFER, amount_cents: 2500, current_price_cents: 4000, floor_price_cents: null }];
    show(<OffersSection side="seller" />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Sell it for $25?");
    expect(sheet).not.toHaveTextContent(/above your price/);
  });

  // Q2352 (owner 2026-10-22, terms #9): an account that never paid the one-time setup fee is told it and has it in
  // "You pay", exactly as declutter-checkout charges it; an account that paid it sees neither.
  // Audit 1a #6 (2026-10-29): "Item $12, setup fee $2, You pay $15.30" did not add up. Board 161: the bill is the items
  // and what you pay, never a fee line, so the setup fee is said in words under the total, like the service fee.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const payCents = (delivering && liveQuote ? totalCents + liveQuote.delivery_cents : sdAmounts ? sdAmounts.totalCents : totalCents) + setupFeeCents; |   const payCents = delivering && liveQuote ? totalCents + liveQuote.delivery_cents : totalCents;
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |         {setupFeeCents > 0 && ( |         {false && (
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |         <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2"> |         {setupFeeCents > 0 && <div className="flex justify-between gap-3"><dt>One-time account setup fee</dt><dd>{formatPrice(setupFeeCents)}</dd></div>}<div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
  it("Q2352 + audit 1a #6: the first purchase's setup fee is in the total and said in words, never a fee line", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", price_cents: 400 }];
    state.setupFeeCents = 200;
    show(<CartView />);
    expect(await screen.findByText("One checkout for 2 items")).toBeInTheDocument();
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/You pay\$10\.05/);
    expect(document.querySelector("[data-checkout-setup-fee]")?.textContent).toBe("Includes the one-time $2 account setup fee.");
    expect(document.querySelector("[data-service-fee-words]")?.textContent).toBe("Includes a small Louisiana Helpr service fee.");
    // BUY-34: a <dl> holds only its rows (axe definition-list); the notes sit beside it.
    expect(bill.querySelector("dl")?.querySelector("p")).toBeNull();
    expect(bill.querySelector("dl dd")).not.toBeNull();
    // Every priced line above "You pay" is something bought (items, a discount, a delivery), never a fee.
    const rows = Array.from(bill.querySelectorAll("dt")).map((dt) => dt.textContent ?? "");
    expect(rows).toEqual(["2 items", "You pay"]);
    expect(rows.filter((r) => /fee/i.test(r))).toEqual([]);
    expect(screen.getByRole("button", { name: "Pay $10.05" })).toBeInTheDocument();
    expect(document.querySelector("[data-setup-fee-pending]")).toBeNull();
    state.setupFeeCents = 0;
  });

  // #20: a total that is only the item and the one-time setup fee carries no service-fee words.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const includesServiceFee = payCents > listedCents; |   const includesServiceFee = false;
  it("#20: the service-fee words show only when the total holds the buyer's fee", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line];
    show(<CartView />);
    await screen.findByRole("button", { name: /^Pay \$/ });
    expect(document.querySelector("[data-service-fee-words]")?.textContent).toBe("Includes a small Louisiana Helpr service fee.");
  });

  // A2-8 (audit 2 B2-4): a buyer could not take an item out of the cart. Each line has Remove; it asks in the app first.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |                     <RemoveFromCart line={l} />\n |
  // @mutate src/components/declutter/DeclutterCartRemove.tsx |     mutationFn: () => removeCartItem(line.line_id), |     mutationFn: async () => "removed" as const,
  it("A2-8: each cart line has Remove; Keep it changes nothing, Remove takes that line out", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", price_cents: 400 }];
    state.removed = [];
    show(<CartView />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Rug from your cart" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(/"Rug" goes back on sale for everyone\. Nothing is charged, and you get no strike\./)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // the sheet closes on the press itself
    expect(state.removed).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Rug from your cart" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(state.removed).toEqual(["l2"]));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  // lh-money-escrow review of Q2352 #5: until the fee answer is in, the total never reads $2 low without saying so.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |             {!setupFeeKnown && <span | {false && <span
  it("Q2352: while the setup fee answer is not in, the total says '+ any setup fee'", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line];
    state.setupFeeKnown = false;
    show(<CartView />);
    expect(await screen.findByRole("heading", { name: "Checkout", level: 3 })).toBeInTheDocument();
    expect(document.querySelector("[data-checkout-breakdown]")!.textContent).toMatch(/You pay\$[0-9.]+\+ any setup fee/);
    state.setupFeeKnown = true;
  });

  it("lead 2026-10-28: a reserved line says \"Reserved for you, not paid yet\" with the time left; the bundle hint only when the seller has one", async () => {
    // @mutate src/components/declutter/DeclutterReserveSheet.tsx |         <span>{allFree ? "Reserved for you" : "Reserved for you, not paid yet"}</span> |         <span>{allFree ? "Reserved for you" : "Reserved for you"}</span>
    // @mutate src/components/declutter/DeclutterReserveSheet.tsx |         {!allFree && rule.data ? |         {!allFree ?
    // @mutate src/components/declutter/DeclutterReserveSheet.tsx |             <Link to={`/user/${sellerId}`} data-cart-bundle-more="" |             <Link to="/declutter" data-cart-bundle-more=""
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20.5 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line];
    const first = show(<CartView />);
    await waitFor(() => expect(document.querySelector("[data-cart-hold]")).not.toBeNull());
    const hold = document.querySelector("[data-cart-hold]") as HTMLElement;
    expect(hold.textContent).toMatch(/^Reserved for you, not paid yet20 hours left/);
    expect(hold.textContent).toMatch(/Check out by .+\. If you don't, you get a strike and the item goes back up for sale\.$/);
    expect(hold.textContent).not.toMatch(/bundle/i);
    first.unmount();
    state.bundleRule = 10;
    show(<CartView />);
    await waitFor(() => expect(document.querySelector("[data-cart-hold]")?.textContent).toMatch(/Add more from this seller first to save with their bundle discount\. See their other items$/));
    // BUY-12: the hint links to the seller's other items (their profile's "Selling now").
    expect(screen.getByRole("link", { name: "See their other items" })).toHaveAttribute("href", "/user/s2");
  });

  // DB-5 (owner 2026-10-30): a Buy now line (source "buy") is no strike; a checkout holding an accepted offer keeps it.
  // @mutate src/components/declutter/DeclutterReserveSheet.tsx |           : noStrike ? `Pay by ${by}. |           : false ? `Pay by ${by}.
  // @mutate src/lib/declutter/buyNowHold.ts |   return lines.length > 0 && lines.every((l) => l.price_cents === 0 \|\| l.source === "buy"); |   return lines.length > 0;
  // @mutate src/components/declutter/DeclutterTradeViews.tsx | allFree={allFree} lines={lines} timeLeft= | allFree={allFree} lines={[]} timeLeft=
  it("DB-5: a Buy now checkout says No strike; one with an accepted offer still warns of the strike", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20.5 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null,
      total_cents: null, source: "buy" };
    state.cart = [line];
    const first = show(<CartView />);
    await waitFor(() => expect(document.querySelector("[data-cart-hold]")).not.toBeNull());
    const hold = document.querySelector("[data-cart-hold]") as HTMLElement;
    expect(hold.textContent).toMatch(/Pay by .+\. If you don't, it goes back up for sale\. No strike\.$/);
    expect(hold.textContent).not.toMatch(/you get a strike/);
    first.unmount();
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", source: "offer" }];
    show(<CartView />);
    await waitFor(() => expect(document.querySelector("[data-cart-hold]")?.textContent).toMatch(/If you don't, you get a strike and the item goes back up for sale\.$/));
  });

  // DB-5: Buy now lands on /declutter?tab=buying&checkout=<seller>; that seller's checkout is scrolled into view.
  // @mutate src/components/declutter/DeclutterReserveSheet.tsx |   const focused = params.get("checkout") === sellerId; |   const focused = params.get("checkout") !== null;
  // @mutate src/components/declutter/DeclutterReserveSheet.tsx |     if (focused) ref.current |     if (false) ref.current
  it("DB-5: ?checkout=<seller> scrolls to that seller's checkout, not another's", async () => {
    const seen: string[] = [];
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: HTMLElement) { seen.push(this.dataset.checkoutSeller ?? ""); };
    try {
      const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
        checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null,
        total_cents: null, source: "buy" };
      state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", seller_id: "s3" }];
      show(<CartView />, "/declutter?tab=buying&checkout=s3");
      await waitFor(() => expect(seen).toEqual(["s3"]));
      expect(document.querySelectorAll("[data-checkout-seller]")).toHaveLength(2);
    } finally {
      Element.prototype.scrollIntoView = had;
    }
  });

  it("cart: one checkout per seller, the items and what you pay with no fee line (F1 total, issue #3672), delivery later, and a Pay button for the total (rows 22, 24, 38)", async () => {
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Rug", price_cents: 400 }];
    show(<CartView />);
    expect(await screen.findByText("One checkout for 2 items")).toBeInTheDocument();
    expect(screen.getByText("$7")).toBeInTheDocument();
    expect(screen.queryByText("$1.05")).toBeNull();
    expect(screen.getByText("$8.05")).toBeInTheDocument();
    // Board 30: the breakdown ends in "You pay" = the real checkout total, the seller keeps the whole item price,
    // and no vendor is named (spec §1.7).
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |             {formatPrice(payCents)}\n |             {formatPrice(itemsTotalCents)}\n
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/You pay\$8\.05/);
    // Q2352: an account that already paid the setup fee is never shown it.
    expect(document.querySelector("[data-checkout-setup-fee]")).toBeNull();
    // Board 161: two items, one checkout. Owner 2026-10-25 (issue #3672): the bill is the items and what you pay,
    // never a fee line, name or number.
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |         {setupFeeCents > 0 && ( |         <div><dt>Buyer's fee (5% + 70¢, once)</dt><dd>{formatPrice(totalCents - itemsTotalCents)}</dd></div>{setupFeeCents > 0 && (
    // #20 (owner 2026-10-28, "Words only"): the total says it holds a service fee, never how much.
    expect(bill.textContent).toMatch(/^2 items\$7You pay\$8\.05Includes a small Louisiana Helpr service fee\.$/);
    // Lead 2026-10-28: the card says it once, the heading the checkout, the line what the items share.
    // @mutate src/components/declutter/DeclutterCartWords.tsx | shared: "From the same seller: one pickup, one payment." }; | shared: "One checkout, one pickup, one payment." };
    expect(screen.getByText("From the same seller: one pickup, one payment.")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Checkout 1" });
    expect((card.textContent ?? "").match(/checkout/gi)?.length ?? 0).toBeLessThanOrEqual(2);
    const note = document.querySelector("[data-checkout-note]")!;
    // The real payout rule (declutter_handover_sweep, read live 2026-10-20): handover done, or 24 h after the slot
    // unless a problem is open.
    // @mutate src/components/declutter/DeclutterTradeViews.tsx | or about 48 hours after the seller says you do, unless you report a problem. | once you have your items.
    expect(note.textContent).toMatch(/The seller keeps the whole \$7\. It's paid to the seller when you say you have it, or about 48 hours after the seller says you do, unless you report a problem\./);
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
    // Pay waits for the seller's porch places to answer (D-NEW14).
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay $8.05" })).toBeEnabled());
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
    // The quote joins the bill as its own line: $3 item + $40 delivery, $43.85 in all (no fee line, issue #3672).
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |         {delivering && liveQuote && ( |         {false && (
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/Helpr delivery\$40/);
    expect(bill.textContent!.replace("Includes a small Louisiana Helpr service fee.", "")).not.toMatch(/fee|%|¢|\$0\.85/i);
    expect(bill.textContent).toMatch(/You pay\$43\.85/);
    expect(state.quotes).toEqual([{ sellerId: "s2", address: "900 Far Rd, Baker, LA" }]);
    fireEvent.click(screen.getByRole("button", { name: "Pay $43.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "delivery" }]));
    state.deliveryOn = false;
  });

  // BUY-9 (buying audit 10-30 #9): "Deliver to" was typed from nothing on every order. The buyer's newest drop-off
  // (their own rows only) fills it once; it is asked only when a way that delivers is chosen, and never over typing.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |     if (!addressTouched && lastDropoff.data && address === "") setAddress(lastDropoff.data); |     void 0;
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |     enabled: !!me?.id && (delivering \|\| sellerDelivering), staleTime: 5 * 60_000 }); |     enabled: !!me?.id, staleTime: 5 * 60_000 });
  // @mutate src/components/declutter/DeclutterTradeViews.tsx | onChange={(e) => { setAddressTouched(true); setAddress(e.target.value); setQuote(null); }} /> | onChange={(e) => { setAddress(e.target.value); setQuote(null); }} />
  it("BUY-9: Helpr delivery's Deliver to starts with the buyer's last drop-off, read only once delivery is chosen", async () => {
    state.deliveryOn = true;
    state.lastDropoff = "12 Oak St, Baton Rouge, LA";
    state.me = "b1";
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    show(<CartView />);
    expect(await screen.findByLabelText(/Porch pickup/)).toBeChecked();
    await new Promise((r) => setTimeout(r, 50));
    expect(state.lastDropoffReads).toBe(0);
    fireEvent.click(screen.getByLabelText(/Helpr delivery/));
    await waitFor(() => expect((screen.getByLabelText(/^Deliver to/) as HTMLInputElement).value).toBe("12 Oak St, Baton Rouge, LA"));
    fireEvent.click(screen.getByRole("button", { name: "Get price" }));
    await waitFor(() => expect(state.quotes).toEqual([{ sellerId: "s2", address: "12 Oak St, Baton Rouge, LA" }]));
    state.deliveryOn = false;
  });

  it("BUY-9: what the buyer types is never replaced, even emptied", async () => {
    state.deliveryOn = true;
    state.lastDropoff = "12 Oak St, Baton Rouge, LA";
    state.me = "b1";
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    show(<CartView />);
    fireEvent.click(await screen.findByLabelText(/Helpr delivery/));
    const box = () => screen.getByLabelText(/^Deliver to/) as HTMLInputElement;
    await waitFor(() => expect(box().value).toBe("12 Oak St, Baton Rouge, LA"));
    fireEvent.change(box(), { target: { value: "" } });
    await new Promise((r) => setTimeout(r, 50));
    expect(box().value).toBe("");
    state.deliveryOn = false;
  });

  // Owner 2026-10-28: checkout offers only the ways the seller ticked for EVERY item in it (20261028235247;
  // the server refuses the rest with handover_not_offered).
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |     ...(sdState !== "hidden" ? ["seller_delivery" as const] : [])] as Handover[]).filter((h) => wayAllowed(ways, h)); |     ...(sdState !== "hidden" ? ["seller_delivery" as const] : [])] as Handover[]);
  // DC-4 (owner 2026-10-29): Helpr delivery is offered on a paid checkout whatever was ticked.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const ticked: Handover[] = deliveryOpen && wayAllowed(ways, "delivery", true) ? [...order, "delivery"] : order; |   const ticked: Handover[] = deliveryOpen && wayAllowed(ways, "delivery") ? [...order, "delivery"] : order;
  // @mutate src/lib/declutter/handovers.ts |   return (paid && way === "delivery") \|\| ways === null \|\| ways.includes(way); |   return ways === null \|\| ways.includes(way);
  it("the seller's ticked ways: only those every item allows are offered (Helpr delivery always), and none shared says so", async () => {
    state.deliveryOn = true;
    const base = { my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart", checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(),
      order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [{ ...base, line_id: "l1", item_id: "i1", item_title: "Lamp", handovers: ["porch", "delivery"] }];
    const first = show(<CartView />);
    let radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "delivery"]);
    first.unmount();
    // DC-4: a porch-only listing still offers Helpr delivery (the buyer can always choose it for what they buy).
    state.cart = [{ ...base, line_id: "l1", item_id: "i1", item_title: "Lamp", handovers: ["porch"] }];
    const porchOnly = show(<CartView />);
    radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "delivery"]);
    porchOnly.unmount();
    // Two items: only the ways both allow.
    state.cart = [
      { ...base, line_id: "l1", item_id: "i1", item_title: "Lamp", handovers: ["porch", "delivery"] },
      { ...base, line_id: "l2", item_id: "i2", item_title: "Rug", handovers: ["delivery"], porch_ok: false },
    ];
    const second = show(<CartView />);
    radios = await screen.findAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["delivery"]);
    second.unmount();
    // Nothing shared: no fallback to the seller's door (owner 2026-10-28, Q2462 #3730): no way, no Pay, and
    // "Message the seller" opens the handover chat (?talk=<id>). Only while Helpr delivery itself is not open to
    // this buyer (its switch): when it is, it is always shared (DC-4).
    state.deliveryOn = false;
    // @mutate src/lib/declutter/handovers.ts |   return sets.reduce((acc, s) => acc.filter((w) => s.includes(w)));\n} |   const shared = sets.reduce((acc, s) => acc.filter((w) => s.includes(w)));\n  return shared.length > 0 ? shared : null;\n}
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |         {offered.length === 0 && <NoWayWorks sellerId={sellerId} />} |
    state.cart = [
      { ...base, line_id: "l1", item_id: "i1", item_title: "Lamp", handovers: ["porch"] },
      { ...base, line_id: "l2", item_id: "i2", item_title: "Rug", handovers: ["delivery"], porch_ok: false },
    ];
    const third = show(<CartView />);
    fireEvent.click(await screen.findByRole("button", { name: "Message the seller" }));
    await waitFor(() => expect(state.talksOpened).toEqual(["s2"]));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeDisabled();
    third.unmount();
    // Only a way not open to this buyer (a meetup with no spot near) and no porch: the same, never the home.
    state.talksOpened = [];
    state.cart = [{ ...base, line_id: "l1", item_id: "i1", item_title: "Lamp", handovers: ["meetup"], porch_ok: false }];
    show(<CartView />);
    expect(await screen.findByRole("button", { name: "Message the seller" })).toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(document.querySelector("[data-home-fallback]")).toBeNull();
    state.deliveryOn = false;
  });

  it("Q2425: a safe meetup spot is offered only when one is near; Pay waits for a spot; checkout sends 'meetup'", async () => {
    state.deliveryOn = true;
    const line = { line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true };
    state.cart = [line];
    state.spots = [
      { id: "sp1", name: "BRPD Safe Exchange Zone", address: "9000 Airline Hwy, Baton Rouge", parish: "East Baton Rouge", kind: "police", note: "Lit lot, cameras", miles: 0.9, chosen: false },
      { id: "sp2", name: "Busy grocery lot", address: "1 Main St, Baton Rouge", parish: "East Baton Rouge", kind: "store", note: null, miles: 2.4, chosen: false },
    ];
    show(<CartView />);
    await waitFor(async () => expect((await screen.findAllByRole("radio")).map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home", "meetup", "delivery"]));
    fireEvent.click(screen.getByLabelText(/Meet at a safe spot/));
    expect(screen.getByText("BRPD Safe Exchange Zone")).toBeInTheDocument();
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const meetupReady = !meetingUp \|\| spotsNear.some((s) => s.chosen); |   const meetupReady = true;
    expect(screen.getByRole("button", { name: "Pay $3.85" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/BRPD Safe Exchange Zone/));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay $3.85" })).toBeEnabled());
    expect(state.chosenSpots).toEqual(["sp1"]);
    fireEvent.click(screen.getByRole("button", { name: "Pay $3.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "meetup" }]));
    state.deliveryOn = false;
  });

  // Audit 1030 DB-15: a seller who allows only a safe spot and Helpr delivery. The spots load after the first render,
  // when Helpr delivery was the only way, and useState(offered[0]) froze it as the pick (Pay disabled until a quote).
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |   const chosen = picked && offered.includes(picked) ? picked : offered[0]; |   const [frozen] = useState(offered[0]); const chosen = picked && offered.includes(picked) ? picked : frozen;
  it("DB-15: nothing the buyer tapped is preselected from before the ways loaded; the first way offered once they have", async () => {
    state.deliveryOn = true;
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Mug", my_side: "buyer", seller_id: "s2", price_cents: 2800, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null,
      total_cents: null, porch_ok: false, handovers: ["meetup", "delivery"] }];
    state.spots = [{ id: "sp1", name: "BRPD Safe Exchange Zone", address: "9000 Airline Hwy, Baton Rouge", parish: "East Baton Rouge", kind: "police", note: null, miles: 0.9, chosen: false }];
    show(<CartView />);
    const ways = async () => (await screen.findAllByRole("radio")).map((r) => r as HTMLInputElement).filter((r) => r.name.startsWith("handover-")).map((r) => r.value);
    await waitFor(async () => expect(await ways()).toEqual(["meetup", "delivery"]));
    await waitFor(() => expect((screen.getByLabelText(/Meet at a safe spot/) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText(/Helpr delivery/) as HTMLInputElement).checked).toBe(false);
    // A tap is kept.
    fireEvent.click(screen.getByLabelText(/Helpr delivery/));
    expect((screen.getByLabelText(/Helpr delivery/) as HTMLInputElement).checked).toBe(true);
    // A tapped way the cart no longer offers falls back to the first way offered now: the spots go, after a meetup tap.
    fireEvent.click(screen.getByLabelText(/Meet at a safe spot/));
    state.spots = [];
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(async () => expect(await ways()).toEqual(["delivery"]));
    expect((screen.getByLabelText(/Helpr delivery/) as HTMLInputElement).checked).toBe(true);
    focusManager.setFocused(undefined);
    state.deliveryOn = false;
  });

  it("Q2427: two paid items with a bundle discount: the bill shows it and the total is after it; the seller keeps the discounted price", async () => {
    const mk = (id: string, price: number) => ({ line_id: id, item_id: `i-${id}`, item_title: `Lamp ${id}`, my_side: "buyer", seller_id: "s2", price_cents: price,
      status: "in_cart", checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null,
      premium_cents: null, total_cents: null, porch_ok: true });
    state.cart = [mk("l1", 4000), mk("l2", 2500)];
    state.bundleOff = 650;
    show(<CartView />);
    // @mutate src/components/declutter/useBundleDiscount.ts | totalCents: checkoutAmounts([itemsCents - discountCents]).totalCents | totalCents: checkoutAmounts([itemsCents]).totalCents
    const bill = await screen.findByText("Bundle discount");
    const rows = bill.closest("[data-checkout-breakdown]")!.textContent!;
    expect(rows).toMatch(/2 items\$65/);
    expect(rows).toMatch(/Bundle discount−\$6\.50/);
    // $58.50 after the discount, plus the fee on $58.50 (5% + 70¢ = $3.63): $62.13.
    expect(rows).toMatch(/You pay\$62\.13/);
    expect(document.querySelector("[data-checkout-note]")!.textContent).toMatch(/keeps the whole \$58\.50/);
  });

  it("Q2427: one paid item: no preview asked, no discount row", async () => {
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 4000, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    state.bundleOff = 650;
    show(<CartView />);
    await screen.findByRole("button", { name: /^Pay / });
    // @mutate src/components/declutter/useBundleDiscount.ts |     enabled: paidCount >= 2,\n  });\n  const discountCents | enabled: true,\n  });\n  const discountCents
    await new Promise((r) => setTimeout(r, 50));
    expect(state.previewCalls).toBe(0);
    expect(screen.queryByText("Bundle discount")).toBeNull();
  });

  it("Q2425: no spot near, no meetup choice", async () => {
    state.deliveryOn = true;
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    show(<CartView />);
    const radios = await screen.findAllByRole("radio");
    // @mutate src/components/declutter/DeclutterTradeViews.tsx | ...(spotsNear.length > 0 ? ["meetup" as const] : []), | "meetup" as const,
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["porch", "pickup_home", "delivery"]);
    state.deliveryOn = false;
  });

  it("seller delivery (20261027153244): after pickup at the home, with the seller's rate, a time and the door choice; the total counts the rate, no fee line", async () => {
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
    // BUY-14: "Porch pickup" as on the item page, its line names the other safe place.
    expect(screen.getByLabelText(/^Porch pickup/)).toBeChecked();
    expect(screen.getByText(/porch or another safe place/)).toBeInTheDocument();
    expect(screen.queryByText("Porch or safe place")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Seller delivers/));
    // DB-9: the address is typed and checked in this checkout first (see the DB-9 tests below).
    fireEvent.change(screen.getByLabelText(/^Deliver to/), { target: { value: "12 Oak St, Baton Rouge" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    // Pay waits for a time AND the door choice.
    fireEvent.click((await screen.findAllByRole("radio", { name: /AM|PM/ }))[0]);
    // $3 item + $20 rate: the server's premium is 5% of $23 + 70c = $1.85, folded into the $24.85 total (never its own line, issue #3672).
    expect(screen.getByRole("button", { name: "Pay $24.85" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Leave it at my door/ }));
    const bill = document.querySelector("[data-checkout-breakdown]")!;
    expect(bill.textContent).toMatch(/Seller delivery\$20/);
    expect(bill.textContent).toMatch(/^Item\$3Seller delivery\$20You pay\$24\.85Includes a small Louisiana Helpr service fee\.$/);
    expect(bill.textContent!.replace("Includes a small Louisiana Helpr service fee.", "")).not.toMatch(/fee|%|¢|\$1\.85/i);
    fireEvent.click(screen.getByRole("button", { name: "Pay $24.85" }));
    await waitFor(() => expect(state.paid).toEqual([{ sellerId: "s2", handover: "seller_delivery", slot: slots[0], handoff: "leave" }]));
  });

  // Audit 2026-10-30 DB-9: the server keeps the last drop-off per buyer and seller (the Helpr delivery box writes the
  // same row). The box opened empty with Pay on and the order went to an address the buyer never saw here.
  // @mutate src/components/declutter/DeclutterTradeViews.tsx | && !!handoff && sdChecked !== null; | && !!handoff;
  // @mutate src/components/declutter/DeclutterTradeViews.tsx |       {!held && !opening && payWaitsOn && ( |       {false && (
  // @mutate src/components/declutter/SellerDeliveryChoice.tsx |       {state === "pick" && shownDay && checked !== null && ( |       {state === "pick" && shownDay && (
  // @mutate src/components/declutter/SellerDeliveryChoice.tsx |     onSuccess: (o, typed) => { onSlot(null); setDay(null); onOffer(o); onChecked(typed); }, |     onSuccess: (o) => { onSlot(null); setDay(null); onOffer(o); },
  it("DB-9: a stored drop-off is never used silently: the buyer types and checks the full address here, sees it, and only then can pay", async () => {
    state.sellerDeliveryOn = true;
    const slots = ["2026-11-03T15:00:00.000Z", "2026-11-03T16:00:00.000Z"];
    // The server already holds an address for this pair (from an earlier check or the Helpr delivery box).
    state.sdOffer = { available: true, reason: null, rate_cents: 2000, radius_miles: 10, dropoff_area: "Mid-City", slot_minutes: 60, slots, held_slot: null };
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    show(<CartView />);
    fireEvent.click(await screen.findByLabelText(/Seller delivers/));
    const input = screen.getByLabelText(/^Deliver to/) as HTMLInputElement;
    expect(input.value).toBe("");
    // No times, no "Deliver to: Mid-City" label, and Pay is off while the box is empty.
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
    expect(screen.queryByText(/Mid-City/)).toBeNull();
    expect(document.querySelector("[data-sd-address-needed]")).toHaveTextContent("Type the full address and tap Check");
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDisabled();
    // BUY-8: a grey Pay says why, right above it.
    expect(document.querySelector("[data-pay-waits-on]")).toHaveTextContent("Finish the delivery choices above to pay.");
    fireEvent.change(input, { target: { value: "12 Oak St, Baton Rouge" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    // The full address, written out, before the times.
    expect(await screen.findByText("12 Oak St, Baton Rouge")).toBeInTheDocument();
    expect(document.querySelector("[data-sd-deliver-to]")).toHaveTextContent("Delivering to 12 Oak St, Baton Rouge. The seller sees this address only after you pay.");
    fireEvent.click((await screen.findAllByRole("radio", { name: /AM|PM/ }))[0]);
    fireEvent.click(screen.getByRole("radio", { name: /Leave it at my door/ }));
    expect(screen.getByRole("button", { name: /^Pay / })).toBeEnabled();
    expect(document.querySelector("[data-pay-waits-on]")).toBeNull();
    // Editing the address takes the check back: the times go and Pay is off until it is checked again.
    fireEvent.change(input, { target: { value: "14 Oak St, Baton Rouge" } });
    expect(document.querySelector("[data-sd-deliver-to]")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDisabled();
  });

  // @mutate src/components/declutter/DeclutterTradeViews.tsx | setQuotedFor(itemsTotalCents); setSdChecked(null); }, | setQuotedFor(itemsTotalCents); },
  it("DB-9: pricing Helpr delivery to another address (it replaces the stored drop-off) makes seller delivery check its address again", async () => {
    state.sellerDeliveryOn = true;
    state.deliveryOn = true;
    const slots = ["2026-11-03T15:00:00.000Z"];
    state.sdOffer = { available: true, reason: null, rate_cents: 2000, radius_miles: 10, dropoff_area: "Mid-City", slot_minutes: 60, slots, held_slot: null };
    state.cart = [{ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
      checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true }];
    show(<CartView />);
    fireEvent.click(await screen.findByLabelText(/Seller delivers/));
    fireEvent.change(screen.getByLabelText(/^Deliver to/), { target: { value: "12 Oak St, Baton Rouge" } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("12 Oak St, Baton Rouge")).toBeInTheDocument();
    // The Helpr delivery box stores a different address on the server.
    fireEvent.click(screen.getByLabelText(/Helpr delivery/));
    fireEvent.change(screen.getByLabelText(/^Deliver to/), { target: { value: "900 Far Rd, Baker" } });
    fireEvent.click(screen.getByRole("button", { name: "Get price" }));
    await waitFor(() => expect(state.quotes).toEqual([{ sellerId: "s2", address: "900 Far Rd, Baker" }]));
    fireEvent.click(screen.getByLabelText(/Seller delivers/));
    await waitFor(() => expect(document.querySelector("[data-sd-address-needed]")).not.toBeNull());
    expect(document.querySelector("[data-sd-deliver-to]")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Delivery time" })).toBeNull();
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDisabled();
    state.deliveryOn = false;
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
    await screen.findByLabelText(/^Porch pickup/);
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
    // LEAD-PLACE-TIMES (20261031164337): a door pickup reads the seller's places too, so Pay waits for that read.
    await waitFor(() => expect(screen.getByRole("button", { name: "Pay $8.05" })).toBeEnabled());
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

// B-1 (deep audit 2026-10-28, CRITICAL): back from the payment page (?paid=1) the cart showed the unpaid checkout and a
// live Pay for 10+ s while the order was already paid: a buyer could pay twice. Now "Payment received" shows at once,
// the paid checkout's Pay is off until the cart (read again, every 2 s) shows it paid, and another seller's stays usable.
// @mutate src/components/declutter/DeclutterTradeViews.tsx |         disabled={held \|\| opening \|\| | disabled={opening \|\|
// @mutate src/components/declutter/DeclutterTradeViews.tsx |       <PaySettlingNotice s={settling} />\n |
// @mutate src/components/declutter/DeclutterTradeViews.tsx |           rememberPaying(sellerId);\n |
// @mutate src/components/declutter/DeclutterPaySettling.tsx |       returnedAt !== null && !settledBy(q.state.data, q.state.dataUpdatedAt, returnedAt, sellerId) ? SETTLE_POLL_MS : false, |       false,
// @mutate src/components/declutter/DeclutterPaySettling.tsx |     settling: !settled && !(slow && sellerId === null), |     settling: false,
describe("B-1: the return from the payment page never offers Pay again for what was just paid", () => {
  const soon = () => new Date(Date.now() + 20 * 3_600_000).toISOString();
  const lamp = () => ({ line_id: "l1", item_id: "i1", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
    checkout_by: soon(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null });
  const rug = () => ({ ...lamp(), line_id: "l9", item_id: "i9", item_title: "Rug", seller_id: "s3" });
  const group = (n: number) => screen.getByRole("region", { name: `Checkout ${n}` });
  beforeEach(() => {
    sessionStorage.clear();
    state.paid = [];
    state.opened = [];
    state.cart = [lamp(), rug()];
  });

  it("the checkout just paid says Payment received and holds its Pay until the cart shows it paid; another seller's Pay stays", async () => {
    // The Pay tap remembers which checkout it was.
    const before = show(<CartView />, "/declutter?tab=buying");
    fireEvent.click(await within(await screen.findByRole("region", { name: "Checkout 1" })).findByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(state.opened.length).toBe(1));
    before.unmount();

    // Back from Stripe: the webhook has not landed yet, so the server still has the lamp in the cart.
    show(<CartView />, "/declutter?tab=buying&paid=1");
    expect(await screen.findByText("Payment received.")).toBeInTheDocument();
    const held = within(group(1)).getByRole("button", { name: "Confirming your payment…" });
    expect(held).toBeDisabled();
    await waitFor(() => expect(within(group(2)).getByRole("button", { name: /^Pay / })).toBeEnabled());

    // The webhook lands: the next read (polled, no reload) shows the lamp paid, and the notice goes.
    state.cart = [{ ...lamp(), status: "paid", order_id: "ord1", order_status: "paid", handover: "porch", total_cents: 385 }, rug()];
    // It was on screen (asserted above), so this waits for the polled read to clear it, never for a first empty paint.
    await waitForElementToBeRemoved(() => screen.queryByText("Payment received."), { timeout: 5000 });
    expect(screen.queryByRole("button", { name: "Confirming your payment…" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Pay / }).length).toBe(1);
  });

  it("when which checkout was paid is unknown, every Pay waits", async () => {
    show(<CartView />, "/declutter?tab=buying&paid=1");
    expect(await screen.findByText("Payment received.")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Confirming your payment…" });
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
  });

  it("no ?paid=1: nothing is held", async () => {
    show(<CartView />, "/declutter?tab=buying");
    expect((await screen.findAllByRole("button", { name: /^Pay / })).length).toBe(2);
    expect(screen.queryByText("Payment received.")).toBeNull();
  });
});

// BUY-15 (buying audit 10-30): checkout at 1440 was one stretched column (Pay 1110 px wide, no side summary, no
// thumbnail). From lg the choices and the bill with Pay are two columns; each cart line shows its item's photo.
// NIGHT-BUYINGpresse-3: the line's title link was 20 px tall on a phone; it is a 44 px tap now.
// jsdom has no layout: the case pins the structure the lg grid lays out (the 375/1440 look is in the commit).
// @mutate src/components/declutter/DeclutterTradeViews.tsx | lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] | lg:block
// @mutate src/components/declutter/DeclutterTradeViews.tsx |     </div>\n    <div className="min-w-0 space-y-3 lg:sticky lg:top-4" data-checkout-summary=""> |     <div className="min-w-0 space-y-3 lg:sticky lg:top-4" data-checkout-summary="">
// @mutate src/components/declutter/DeclutterTradeViews.tsx |                     <CartThumb path={l.item_id ? cover.get(l.item_id) : undefined} />\n |
// @mutate src/components/declutter/DeclutterTradeViews.tsx |       {path && !failed && <img | {false && <img
// @mutate src/components/declutter/DeclutterTradeViews.tsx | className="flex min-h-11 min-w-0 items-center truncate" | className="truncate"
describe("BUY-15: checkout is two columns from lg, and each cart line shows its photo", () => {
  const line = { line_id: "l1", item_id: "i1", item_title: "Oak rocking chair", my_side: "buyer", seller_id: "s2", price_cents: 4000, status: "in_cart",
    checkout_by: new Date(Date.now() + 20 * 3_600_000).toISOString(), order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null };
  it("the ways to get it sit in the left column and the bill with Pay in the right one", async () => {
    cartPhotos.length = 0;
    state.cart = [line];
    show(<CartView />, "/declutter?tab=buying");
    const pay = await screen.findByRole("button", { name: /^Pay \$/ });
    const columns = document.querySelector("[data-checkout-columns]")!;
    expect(columns.className).toMatch(/\blg:grid\b/);
    expect(columns.className).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,22rem\)\]/);
    const choices = columns.querySelector(":scope > [data-checkout-choices]")!;
    const summary = columns.querySelector(":scope > [data-checkout-summary]")!;
    expect(choices).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(choices.querySelector("fieldset")).not.toBeNull();
    expect(choices.contains(pay)).toBe(false);
    expect(summary.contains(pay)).toBe(true);
    expect(summary.querySelector("[data-checkout-breakdown]")).not.toBeNull();
    expect(summary.querySelector("[data-checkout-note]")).not.toBeNull();
    // A phone keeps the old order: the choices come before the bill and Pay.
    expect(choices.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("each line shows its first photo (a grey square when it has none) and its title is a 44 px tap", async () => {
    cartPhotos.length = 0;
    cartPhotos.push({ id: "p2", item_id: "i1", storage_path: "s2/i1/b.jpg", position: 1 }, { id: "p1", item_id: "i1", storage_path: "s2/i1/a.jpg", position: 0 });
    state.cart = [line, { ...line, line_id: "l2", item_id: "i2", item_title: "Blue coffee mug", price_cents: 500 }];
    show(<CartView />, "/declutter?tab=buying");
    await waitFor(() => expect(document.querySelectorAll("[data-cart-thumb] img").length).toBe(1));
    const rows = Array.from(document.querySelectorAll("[data-cart-line]"));
    expect(rows).toHaveLength(2);
    // fetchPhotos returns them by position in real life; firstPhotos keeps the first one it is given.
    expect(rows[0].querySelector("[data-cart-thumb] img")?.getAttribute("src")).toBe("https://photos.test/s2/i1/b.jpg");
    expect(rows[1].querySelector("[data-cart-thumb]")).not.toBeNull();
    expect(rows[1].querySelector("[data-cart-thumb] img")).toBeNull();
    const link = within(rows[1] as HTMLElement).getByRole("link", { name: "Blue coffee mug" });
    expect(link.getAttribute("href")).toBe("/declutter/item/i2");
    expect(link.className).toMatch(/\bmin-h-11\b/);
    cartPhotos.length = 0;
  });
});
