/**
 * Declutter's tabs (owner, 2026-10-18): Browse · Buying · Selling · Wanted · Deliver.
 * A re-organisation, not new features, so the guard is:
 *   1. every action the old tabs (My listings, Offers, Cart) offered is still
 *      reachable, on the side it belongs to (BEFORE_ACTIONS below is the old
 *      tabs' inventory, read from origin/main 89193a221 before the move);
 *   2. the old links (?view=mine|offers|cart, still in sent notifications and
 *      emails, for BOTH sides) open the tab that now holds what they pointed at,
 *      and the address is rewritten to the new tab;
 *   3. Buying and Selling carry a badge with what needs the member.
 * The Declutter API module and the account hooks are stubbed (what each STATE
 * renders); the paid-order cards are their own test (declutterHandoverViews.test.tsx)
 * and are stood in for here by one marker per order, so this file checks only
 * which tab each order lands on.
 *
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   const only = asked && t.counts[asked] > 0 ? asked : null; |   const only = asked;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             <SectionActionPill className="mt-3" onClick={() => navigate(sectionByKey("declutter").add.path)}> |             <SectionActionPill className="mt-3 hidden" aria-hidden onClick={() => navigate(sectionByKey("declutter").add.path)}>
 * @mutate src/components/declutter/DeclutterHomeView.tsx | {view === "buying" ? <><BoughtWhatNext /><Suspense fallback={<DeclutterTabBones />}><BuyingDash todo={todo} /></Suspense></> | {view === "buying" ? <WantedView />
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("offers") && <OffersSection side="seller" onlyMyTurn={only === "offers"} />} |       {show("offers") && null}
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   const show = (g: SellingGroup) => only === null \|\| only === g; |   const show = (_g: SellingGroup) => true;
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map( |   const options = [...tabs.map(
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []), |         ...[],
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []), |         ...[{ value: "wanted" as const, label: "Wanted" }],
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             footnote={<WantedLink />} |             footnote={null}
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   if (!on) return null; |   if (on === undefined) return null;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                 <WantedLink />\n              </div> |                 {null}\n              </div>
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             title={q ? "Nothing matches that search." : |             title={others.length === 0 ? "Opens soon" : q ? "Nothing matches that search." :
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                 {searched && ( |                 {false && (
 * Owner 2026-10-30: nothing for sale at all is a real empty state (Sell something, Post what you're looking for).
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | others.length === 0 ? "Nothing for sale near you yet." | others.length === 0 ? "Opens soon"
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |               !searched && others.length === 0 ? <NothingForSaleActions guest={!member} /> : |               false ? <NothingForSaleActions guest={!member} /> :
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       {wanted && ( |       {true && (
 * @mutate src/components/declutter/DeclutterTabParts.tsx |   const lines = (cart.data ?? []).filter((l) => l.my_side === side); |   const lines = cart.data ?? [];
 * @mutate src/lib/declutter/tabs.ts |   if (view === "mine" \|\| view === "sales") return "selling"; |   if (view === "mine" \|\| view === "sales") return "buying";
 * @mutate src/lib/declutter/tabs.ts |   return sellerWaiting > 0 && buyerWaiting === 0 ? "selling" : "buying"; |   return "buying";
 * @mutate src/lib/declutter/tabs.ts |     selling: sellerOffers + salesOpen, |     selling: sellerOffers,
 * @mutate src/components/declutter/DeclutterHomeView.tsx |     if (!fromView \|\| !tabsReady) return; |     return;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { declutterTodo, oldDeclutterView } from "@/lib/declutter/tabs";

const SOON = new Date(Date.now() + 20 * 3_600_000).toISOString();

const state = {
  calls: [] as unknown[][],
  live: [] as unknown[],
  wantedOn: true,
  mine: [] as unknown[],
  offers: [] as unknown[],
  cart: [] as unknown[],
  bookings: [] as unknown[],
  questions: [] as { id: string; item_id: string; question: string; created_at: string }[],
  questionReads: 0,
};

// Seller delivery (20261027153244): its settings card and checkout offer read through these; answered here, never Supabase.
// Q2427: no bundle discount here (its own tests: declutterTradeViews, declutterBundleDiscount.test.ts).
// Audit 1028 D1-8: My listings listens for new notices (the shared realtime bus); no socket in a unit test.
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => null,
  fetchBundlePreview: async () => 0,
  // D-NEW12: Browse's "Bundle deal" read; no seller has one here.
  fetchBundleSellers: async () => new Set<string>(),
}));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/sellerDelivery")>();
  return {
    ...real,
    fetchMySellerDelivery: async () => ({ enabled: false, rate_cents: null, free_over_cents: null, radius_miles: 10, windows: [], days_off: [],
      items_off: [], rules: real.SELLER_DELIVERY_RULES }),
    fetchSellerDeliveryOffer: async () => ({ available: false, reason: "seller_not_delivering", rate_cents: null, base_rate_cents: null,
      free_over_cents: null, items_cents: null, radius_miles: null, dropoff_area: null, slot_minutes: 60, slots: [], held_slot: null }),
  };
});
vi.mock("@/hooks/useFeature", () => ({
  // Every switch on except seller delivery, which this suite does not cover (its own tests do:
  // declutterTradeViews.test.tsx, src/test/declutterSellerDelivery.test.ts); porch reads "Porch pickup" either way (BUY-14).
  // 'declutter_wanted' follows state.wantedOn (the Wanted tab and Browse's "Can't find it?" link, owner 2026-10-28).
  useFeature: (key: string) => key !== "declutter_seller_delivery" && (key !== "declutter_wanted" || state.wantedOn),
  useFeatureStatus: (key: string) => ({ on: key !== "declutter_wanted" || state.wantedOn, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// The payout prompt is its own test (sellerPayoutPrompt.test.tsx); it reads prod-only hooks.
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
// Q2352: the cart's one-time setup fee answer (the live platform setting) is not this spec's subject: paid.
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
// The whole hook shape: Sell it for me (on Selling) reads explain + gatedProps too.
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
// The tester-only "early preview" read (useSectionTabs) stubbed as not loaded (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/components/sections/SectionScreen", () => ({
  // The section's tabs are the Explore header's second row (SectionScreen `tabs`, owner 2026-10-22).
  // Honours globalSearch like the real one (default on).
  SectionScreen: ({ title, children, tabs, globalSearch = true }: { title: string; children: React.ReactNode; tabs?: React.ReactNode; globalSearch?: boolean }) => (
    <main>
      <h1>{title}</h1>
      {tabs}
      {globalSearch && <div role="search" data-testid="explore-search-entry" />}
      {children}
    </main>
  ),
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children, titleActions }: { title: string; children: React.ReactNode; titleActions?: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {titleActions}
      {children}
    </main>
  ),
}));
vi.mock("@/lib/declutter/haulAway", () => ({
  fetchHaulAwayState: async () => [],
  oneTripGroup: () => [],
  haulJobToDelete: () => null,
  deleteNeverPaidHaulJob: async () => true,
  cancelHaulAway: async () => "live",
  HAUL_AWAY_CLIENT_ERROR_COPY: { haul_away_job_stuck: "stuck" },
}));
// The handover chat (#3730): Selling's "Agree a handover" reads the member's open chats; none here.
vi.mock("@/lib/declutter/handoverTalk", () => ({ fetchMyOpenHandoverTalks: async () => [], openHandoverTalk: async () => "t1" }));
// A1-B2 (b28): "You paid" reads the card charge per order (declutter_my_paid_cents); which tab an order lands on is
// what this file checks, so no figure is answered here.
vi.mock("@/lib/declutter/paidCents", () => ({ fetchMyPaidCents: async () => new Map() }));
// One marker per paid order: which tab it lands on is what this file checks.
vi.mock("./DeclutterHandoverViews", () => ({
  PaidOrdersSection: ({ cart, heading, show }: { cart: { status: string; order_id: string | null; my_side: string }[]; heading?: React.ReactNode; show?: (id: string) => boolean }) => (
    <section>
      {heading}
      {cart.filter((l) => l.status === "paid" && l.order_id && (!show || show(l.order_id))).map((l) => <p key={l.order_id} data-paid-marker="">{`paid order ${l.order_id} as ${l.my_side}`}</p>)}
    </section>
  ),
}));
// Buying's tracker (BuyingOrders.tsx) reads each paid order's booking and handover row: none booked, nothing handed over.
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchMyBookings: async () => state.bookings,
  fetchMyHandover: async (orderId: string) => ({ order_id: orderId, status: "paid", side: "buyer", confirmed_at: null, set_out_at: null, set_out_photo_path: null, picked_up_at: null }),
  // Audit 1b D2-2: no open problem on these orders (the cards' problem note has its own tests).
  fetchOpenProblems: async () => [],
  // B110: the checkout's pickup-time chips read the seller's times; none here (their own tests: checkoutPickupTime).
  fetchItemPickupWindows: async () => [],
}));
// Q2425: no safe meetup spot near these carts (its own tests: declutterTradeViews, declutterHandoverViews).
vi.mock("@/lib/declutter/meetup", () => ({ fetchMeetupSpotsNear: async () => [], fetchOrderMeetup: async () => null }));
// The cart reads the seller's porch places (D-NEW14); these sellers have none. Places are proved in porchPlacesUi.test.tsx.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchSellerPorchPlaces: async () => [] }));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => state.live,
  fetchWatching: async () => new Set(),
  setWatch: async () => "ok",
  fetchMapPins: async () => new Map(),
  fetchMyItems: async () => state.mine,
  // Audit DC-9: unanswered questions on the seller's listings (only those asked for).
  fetchUnansweredQuestions: async (ids: string[]) => { state.questionReads++; return state.questions.filter((q) => ids.includes(q.item_id)); },
  // The "Your listing is live" sheet (ListedWhatNext) reads the item back.
  fetchItem: async (id: string) => state.mine.find((m) => (m as { id: string }).id === id) ?? null,
  fetchItemDropState: async () => null,
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  withdrawItem: async () => undefined,
  fetchMyCard: async () => ({ brand: "visa", last4: "4242" }),
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  makeOffer: async () => "o",
  respondOffer: async (...a: unknown[]) => { state.calls.push(["respond", ...a]); return "accepted"; },
  buyNow: async () => "l",
  sellerCancelSale: async (...a: unknown[]) => { state.calls.push(["cancel_sale", ...a]); return 1; },
  startCardSave: async () => "https://checkout.stripe.test/setup",
  startCheckoutPayment: async () => ({ url: "https://checkout.stripe.test/pay", paid: false }),
  fetchHasAgreedSales: async () => false,
  // Q2487: Buying shows the free-ask pause line and your open free asks; none here.
  fetchMyFreePause: async () => null,
  fetchMyFreeRequests: async () => [],
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { toast } from "sonner";
// LEAD-TOAST3: member confirmations are the bare toast(), which vi.spyOn cannot wrap; a callable mock that
// still shows the real toast (and keeps toast.success/error) lets a test read what was said.
vi.mock("sonner", async (importOriginal) => {
  const m = await importOriginal<typeof import("sonner")>();
  return { ...m, toast: Object.assign(vi.fn((...a: Parameters<typeof m.toast>) => m.toast(...a)), m.toast) };
});
// Q2428: no partner charity near and no donation receipts (the donate RPCs never reach prod from a test).
vi.mock("@/lib/declutter/donate", () => ({
  fetchDonationPartnersNear: vi.fn(async () => []),
  fetchMyDonations: vi.fn(async () => []),
  chooseDonation: vi.fn(async () => 0),
  donatePostJobPath: (p: string) => `${p}&donate=1`,
  oneDonationPartner: () => null,
}));

let where = "";
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}

function at(path: string, routerState?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[routerState ? { pathname: path.split("?")[0], search: `?${path.split("?")[1]}`, state: routerState } : path]}>
        <Routes>
          <Route path="/declutter" element={<><DeclutterPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ITEM = {
  id: "i1", seller_id: "u1", status: "live", title: "Oak rocking chair", description: "", category: "furniture",
  condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: "2026-10-14", porch_ok: true,
};
const OFFER = {
  offer_id: "o1", item_id: "i1", item_title: "Oak rocking chair", my_side: "seller", amount_cents: 2500, awaiting: "seller",
  status: "open", respond_by: SOON, counter_count: 0, current_price_cents: 4000, floor_price_cents: null, updated_at: "2026-10-14",
};
const LINE = {
  line_id: "l1", item_id: "i5", item_title: "Lamp", my_side: "buyer", seller_id: "s2", price_cents: 300, status: "in_cart",
  checkout_by: SOON, order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true,
};

/** A member who is on both sides of everything. */
function everything() {
  state.mine = [ITEM, { ...ITEM, id: "i2", status: "draft", title: "Desk" }];
  state.offers = [
    OFFER,
    { ...OFFER, offer_id: "o2", my_side: "buyer", awaiting: "seller", item_id: "i7", item_title: "Rug" },
    { ...OFFER, offer_id: "o3", my_side: "buyer", awaiting: "buyer", item_id: "i8", item_title: "Mirror", counter_count: 1 },
  ];
  state.cart = [
    LINE,
    { ...LINE, line_id: "l2", item_id: "i9", item_title: "Chair", my_side: "seller", seller_id: "u1" },
    { ...LINE, line_id: "l3", item_id: "i10", item_title: "Vase", status: "paid", order_id: "ord-bought", order_status: "paid", handover: "pickup_home" },
    { ...LINE, line_id: "l4", item_id: "i11", item_title: "Shelf", my_side: "seller", seller_id: "u1", status: "paid", order_id: "ord-sold", order_status: "paid", handover: "porch" },
  ];
}

/**
 * The old tabs' actions (origin/main 89193a221): My listings (View, Finish
 * listing, Delete, Take down, Moving out), Offers (Accept, Answer with a
 * price, Say no, Take back my offer, the seller's "Your sales": Cancel sale),
 * Cart (Pay, the handover choice, every paid order of both sides).
 */
const BEFORE_ACTIONS = {
  selling: [
    { role: "link", name: /^Preview\b/ },
    { role: "button", name: /^Finish listing\b/ },
    { role: "button", name: /^Delete\b/ },
    // Board 158: a live listing's "Take down" lives in its Manage sheet (Delete listing / Mark sold elsewhere).
    // D4-12: the row's button names its item.
    // @mutate src/components/declutter/DeclutterHomeView.tsx | aria-label={`Manage ${item.title}`} | aria-label="Manage"
    { role: "button", name: /^Manage .+/ },
    // Moving out sale (with Sell a bunch and Sell it for me) is a choice in the sell chooser now, reached from this one
    // row (owner 2026-10-30; src/components/declutter/declutterSellChooser.test.tsx).
    { role: "link", name: /More ways to sell/ },
    { role: "button", name: "Cancel sale" },
  ],
  buying: [
    { role: "button", name: "Pay $3.85" },
    { role: "radio", name: /Porch pickup/ },
    { role: "radio", name: /Meet at the seller's home/ },
    { role: "button", name: "Take back my offer" },
  ],
} as const;

const tab = (name: RegExp) => screen.getByRole("tab", { name });

describe("Declutter tabs: Browse · Buying · Selling · Wanted · Deliver", () => {
  beforeEach(() => {
    state.live = [];
    state.calls = [];
    state.wantedOn = true;
    state.mine = [];
    state.offers = [];
    state.cart = [];
    state.bookings = [];
    state.questions = [];
    state.questionReads = 0;
    where = "";
  });

  it("owner 10-19 + 10-28 + 10-30: Browse | Buying | Selling | Deliver | Wanted | Free, one word each, Browse leftmost and the default", async () => {
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    const tabs = screen.getAllByRole("tab");
    // Deliver is a tab again (owner 2026-10-28: Helprs couldn't find it under Selling); Wanted (owner 2026-10-28, "Both");
    // Free next to Wanted (OWN-FREE, owner via the lead 2026-10-30).
    expect(tabs.map((t) => t.textContent)).toEqual(["Browse", "Buying", "Selling", "Deliver", "Wanted", "Free"]);
    for (const t of tabs) expect(t.textContent).toMatch(/^\S+$/);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs.length).toBeGreaterThan(2);
  });

  it("lead 10-28: Accept and Cancel sale ask in an in-app sheet, never window.confirm; nothing runs until its button", async () => {
    // @mutate src/components/declutter/DeclutterOffersSection.tsx |             onClick={() => setAccepting(true)} |             onClick={() => act.mutate({ action: "accept" })}
    // @mutate src/components/declutter/DeclutterSalesWaiting.tsx |                   onClick={() => l.item_id && setAsking({ itemId: l.item_id, kind })} |                   onClick={() => { if (l.item_id) cancel.mutate({ itemId: l.item_id, kind }); }}
    const confirmSpy = vi.spyOn(window, "confirm");
    everything();
    at("/declutter?tab=selling");
    const onMine = await screen.findByRole("region", { name: "Offers on your items" });
    fireEvent.click(within(onMine).getByRole("button", { name: "Accept" }));
    let sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Sell it for $25?");
    expect(sheet).toHaveTextContent("every other offer on it closes, and the buyer gets 24 hours to pay.");
    expect(state.calls).toEqual([]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Accept" }));
    await vi.waitFor(() => expect(state.calls).toEqual([["respond", "o1", "accept", null]]));
    await vi.waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("button", { name: "Cancel sale" })).toBeEnabled(); });
    fireEvent.click(screen.getByRole("button", { name: "Cancel sale" }));
    sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Cancel this sale?");
    expect(sheet).toHaveTextContent("You'll get a Declutter strike");
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep the sale" }));
    await vi.waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("button", { name: "Cancel sale" })).toBeEnabled(); });
    expect(state.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel sale" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel sale" }));
    await vi.waitFor(() => expect(state.calls[1]).toEqual(["cancel_sale", "i9"]));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("owner 10-28: no Wanted tab and no \"Can't find it?\" link while 'declutter_wanted' is off; ?tab=wanted opens Browse", async () => {
    state.wantedOn = false;
    at("/declutter?tab=wanted");
    await screen.findByRole("tablist", { name: "Declutter view" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Browse", "Buying", "Selling", "Deliver", "Free"]);
    expect(tab(/^Browse/)).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-wanted-link")).toBeNull();
    expect(screen.queryByText(/Wanted/)).toBeNull();
    // The empty state's pills: Sell something only, never a link to a Wanted tab that is not there.
    expect(screen.getByRole("link", { name: "Sell something" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Post what you're looking for" })).toBeNull();
  });

  it("owner 10-28: with 'declutter_wanted' off, a search that finds nothing has no \"Can't find it?\" link either", async () => {
    state.wantedOn = false;
    at("/declutter?q=sofa");
    expect(await screen.findByText("Nothing matches that search.")).toBeInTheDocument();
    expect(screen.getByTestId("declutter-clear-search")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-wanted-link")).toBeNull();
  });

  // OWN-FREE (owner via the lead, 2026-10-30): a Free tab next to Wanted, for everyone (the Free section has no
  // switch of its own), listing the live free items of OTHER members by Browse's own read and "Free" rule.
  // @mutate src/components/declutter/DeclutterHomeView.tsx |         { value: "free", label: "Free" },\n |
  // @mutate src/components/declutter/DeclutterHomeView.tsx |               : view === "free" ? <FreeView userId={user.id} /> |               : view === "free" ? <WantedView />
  // @mutate src/components/declutter/DeclutterFreeView.tsx | const FREE_ONLY = { ...NO_FILTERS, freeOnly: true }; | const FREE_ONLY = { ...NO_FILTERS };
  // @mutate src/components/declutter/DeclutterFreeView.tsx | (items.data ?? []).filter((i) => i.seller_id !== userId) | (items.data ?? [])
  // @mutate src/components/declutter/DeclutterHomeView.tsx | const MINE_TABS_FREE = [...MINE_TABS, "free"] as const; | const MINE_TABS_FREE = [...MINE_TABS] as const;
  it("the Free tab lists only other members' live free items, and says so when there are none", async () => {
    state.live = [
      { ...ITEM, id: "f1", seller_id: "s9", title: "Free bookshelf", price_cents: 0, current_price_cents: 0 },
      { ...ITEM, id: "f2", seller_id: "s9", title: "Brass floor lamp" },
      { ...ITEM, id: "f3", seller_id: "u1", title: "My own free crib", price_cents: 0, current_price_cents: 0 },
    ];
    const first = at("/declutter?tab=free");
    expect(await screen.findByText("Free bookshelf")).toBeInTheDocument();
    expect(tab(/^Free/)).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Brass floor lamp")).toBeNull();
    expect(screen.queryByText("My own free crib")).toBeNull();
    expect(screen.getByTestId("declutter-free-list").querySelectorAll("li").length).toBe(1);
    first.unmount();
    // Wanted off: Free is still a tab.
    state.wantedOn = false;
    state.live = [{ ...ITEM, id: "f2", seller_id: "s9", title: "Brass floor lamp" }];
    at("/declutter?tab=free");
    expect(await screen.findByText("Nothing free right now.")).toBeInTheDocument();
    expect(tab(/^Free/)).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Brass floor lamp")).toBeNull();
  });

  it("lead 10-28 (shot 04): a search that finds nothing says so, never \"Opens soon\", with Show all items and the Wanted link", async () => {
    // Nothing listed at all (an early-preview section) AND a search in the address: the search's answer wins.
    at("/declutter?q=sofa");
    expect(await screen.findByText("Nothing matches that search.")).toBeInTheDocument();
    expect(screen.queryByText("Opens soon")).toBeNull();
    expect(screen.queryByText("Nothing for sale near you yet.")).toBeNull();
    expect(screen.getByTestId("declutter-wanted-link")).toBeInTheDocument();
    const clear = screen.getByTestId("declutter-clear-search");
    expect(clear).toHaveTextContent("Show all items");
    fireEvent.click(clear);
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-clear-search")).toBeNull();
  });

  it("owner 10-28: Browse's \"Can't find it? Post what you're looking for\" opens the Wanted tab, under the list and in the no-results state", async () => {
    // Nothing for sale at all (owner 2026-10-30): the empty state's own pill, "Post what you're looking for", beside
    // "Sell something", and no "Opens soon".
    const empty = at("/declutter");
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
    expect(screen.queryByText("Opens soon")).toBeNull();
    // With Wanted on, the line names both ways (b29: it says only "Be the first to sell something." without it).
    expect(screen.getByText("Be the first to sell something, or say what you're looking for.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post what you're looking for" })).toHaveAttribute("href", "/declutter?tab=wanted");
    expect(screen.getByRole("link", { name: "Sell something" })).toHaveAttribute("href", "/declutter/sell?mode=choose");
    empty.unmount();
    // A list: the link closes the end card under the cards.
    state.live = [{ ...ITEM, id: "i40", seller_id: "s9", title: "Brass floor lamp" }];
    at("/declutter");
    expect(await screen.findByText("Brass floor lamp")).toBeInTheDocument();
    const link = within(screen.getByTestId("browse-end-card")).getByTestId("declutter-wanted-link");
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Your Wanted posts" })).toBeInTheDocument();
    expect(tab(/^Wanted/)).toHaveAttribute("aria-selected", "true");
    expect(where).toBe("/declutter?tab=wanted");
    // The way back: the Browse tab, right there in the same row.
    fireEvent.click(tab(/^Browse/));
    expect(await screen.findByText("Brass floor lamp")).toBeInTheDocument();
    expect(where).toBe("/declutter");
  });

  it("owner 10-19: a status box shows only its list (highlighted); tapping it again shows every list", async () => {
    everything();
    const { container } = at("/declutter?tab=selling");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    const offers = () => container.querySelector('[data-status-box="offers"]') as HTMLElement;
    expect(offers()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(offers());
    expect(await screen.findByRole("region", { name: "Offers on your items" })).toBeInTheDocument();
    expect(offers()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: /^Your listings/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Sold, waiting for the buyer to pay" })).toBeNull();
    expect(where).toContain("status=offers");
    fireEvent.click(offers());
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    expect(offers()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { name: "Sold, waiting for the buyer to pay" })).toBeInTheDocument();
  });

  // DA-3 + DA-4 (Declutter audit 2026-10-30, shots da-seller-claimed-mid-wk375, da-claim-after-wk375): a FREE item
  // someone claimed read as a sale on both sides ("Sold, waiting for the buyer to pay", "Cancel sale", "To be paid",
  // "Sold: pickup and payout"; the claimer's "Your cart · 1 to check out" over a "Checkout" card). Free lines now use
  // give-away words; a paid line beside them keeps the sale words (the class: every waiting kind on both tabs).
  // @mutate src/components/declutter/DeclutterSalesWaiting.tsx |     ["free", waiting.filter((l) => l.price_cents === 0)], |     ["paid", waiting.filter((l) => l.price_cents === 0)],
  // @mutate src/components/declutter/DeclutterSalesWaiting.tsx |   return free === waiting.length ? "Claimed" : "Waiting"; |   return "To be paid";
  // @mutate src/components/declutter/DeclutterTabParts.tsx | sold.every((l) => l.price_cents === 0) ? "Given away: pickup" | false ? "Given away: pickup"
  // @mutate src/components/declutter/DeclutterCartWords.tsx |   return claimsOnly ? { title: "Claimed", todoWords: "to choose a pickup" } : | return false ? { title: "Claimed", todoWords: "to choose a pickup" } :
  // @mutate src/components/declutter/DeclutterCartWords.tsx |   if (allFree) { |   if (false) {
  // @mutate src/components/declutter/DeclutterSalesWaiting.tsx |     body: "No strike for a free item. | body: "You'll get a Declutter strike. No strike for a free item.
  // @mutate src/components/declutter/DeclutterSalesWaiting.tsx | kind === "free" ? WORDS.free.done : | false ? WORDS.free.done :
  it("DA-3/DA-4: a free claim reads as a give-away on Selling and on Buying, never as a sale", async () => {
    const FREE = { ...LINE, price_cents: 0, porch_ok: true };
    state.mine = [ITEM];
    state.offers = [];
    state.cart = [
      { ...FREE, line_id: "f1", item_id: "if1", item_title: "Free mug", my_side: "seller", seller_id: "u1" },
      { ...FREE, line_id: "f2", item_id: "if2", item_title: "Free rug", my_side: "seller", seller_id: "u1", status: "paid", order_id: "ord-given", order_status: "paid", handover: "porch" },
      { ...FREE, line_id: "f3", item_id: "if3", item_title: "Free vase", my_side: "buyer", seller_id: "s2" },
    ];
    const { container, unmount } = at("/declutter?tab=selling");
    const claimed = await screen.findByRole("region", { name: "Claimed, they're choosing a pickup" });
    expect(within(claimed).getByText(/They're choosing how to pick it up/)).toBeInTheDocument();
    expect(within(claimed).getByRole("button", { name: "Cancel claim" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sold, waiting for the buyer to pay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel sale" })).toBeNull();
    expect(container.querySelector('[data-status-box="waiting"]')?.textContent ?? "").toMatch(/^Claimed/);
    expect(screen.getByRole("heading", { name: /^Given away: pickup/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Sold: pickup and payout/ })).toBeNull();
    fireEvent.click(within(claimed).getByRole("button", { name: "Cancel claim" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Cancel this claim?");
    expect(within(sheet).getByRole("button", { name: "Keep the claim" })).toBeInTheDocument();
    // B100 (owner 2026-10-30, 20261030132149): cancelling a free claim gives no strike and the item goes back up.
    expect(sheet).toHaveTextContent("No strike for a free item.");
    expect(sheet).toHaveTextContent("it goes back up so others can ask for it.");
    expect(sheet).not.toHaveTextContent(/Declutter strike|comes down/);
    const said = vi.mocked(toast);
    said.mockClear();
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel claim" }));
    await vi.waitFor(() => expect(state.calls).toContainEqual(["cancel_sale", "if1"]));
    await vi.waitFor(() => expect(said).toHaveBeenCalledWith("Claim cancelled. It's back up."));
    unmount();

    // A paid sale waiting beside the free claim keeps the sale words; the chip names both.
    state.cart = [...state.cart, { ...LINE, line_id: "p1", item_id: "ip1", item_title: "Paid lamp", my_side: "seller", seller_id: "u1" }];
    const both = at("/declutter?tab=selling");
    expect(await screen.findByRole("region", { name: "Sold, waiting for the buyer to pay" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Claimed, they're choosing a pickup" })).toBeInTheDocument();
    expect(both.container.querySelector('[data-status-box="waiting"]')?.textContent ?? "").toMatch(/^Waiting/);
    both.unmount();

    // The claimer: no cart, no checkout.
    state.cart = state.cart.filter((l) => (l as { line_id: string }).line_id === "f3");
    at("/declutter?view=buying");
    expect(await screen.findByRole("heading", { name: /^Claimed/ })).toHaveTextContent("to choose a pickup");
    expect(screen.getByRole("heading", { name: "Choose how you'll get it" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Your cart/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Checkout" })).toBeNull();
  });

  it("Buying: the cart, the offers you sent and your purchases, every old action still there", async () => {
    everything();
    at("/declutter?view=buying");
    expect(await screen.findByRole("heading", { name: /^Your cart/ })).toBeInTheDocument();
    // LEAD-DECL-SEARCHBAR (2026-10-31): no "Search all sections" bar; LEAD-SEARCH-ALL-TABS (owner 2026-10-31): the
    // search is the icon by the gear on Buying too, matching Jobs (the icon and its place: sellingDash.test.tsx).
    expect(screen.getByRole("link", { name: "Search all sections" })).toHaveAttribute("href", "/search");
    for (const a of BEFORE_ACTIONS.buying) expect(screen.getAllByRole(a.role, { name: a.name }).length).toBeGreaterThan(0);
    const sent = screen.getByRole("region", { name: "Your offers" });
    // A seller's counter waits on the buyer: Accept / Answer with a price / Say no, here.
    expect(within(sent).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(within(sent).getByRole("button", { name: "Answer with a price" })).toBeInTheDocument();
    expect(within(sent).getByRole("button", { name: "Say no" })).toBeInTheDocument();
    expect(screen.getByText("paid order ord-bought as buyer")).toBeInTheDocument();
    // Nothing of the seller's side.
    expect(screen.queryByText("paid order ord-sold as seller")).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel sale" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Offers on your items/ })).toBeNull();
  });

  // Lead 2026-10-28 (Buying, calmer; shot round2/buying-paid-375-light.png): "Your cart is empty." and "You haven't
  // made any offers." sat above a purchase. Under "All" an empty list is left out; with nothing at all the tab says so
  // ONCE; a chosen chip still shows its own list's empty state.
  // @mutate src/components/declutter/DeclutterMineViews.tsx |   const showCart = t.ready && (only === null \|\| only === "needs_you") && (t.checkouts > 0 \|\| settling.settling); |   const showCart = t.ready;
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       {t.ready && !orders && offers.has === false && !settling.settling && ( |       {false && (
  it("lead 10-28: Buying shows no empty list beside a purchase, and one empty state when there is nothing at all", async () => {
    state.cart = [{ ...LINE, line_id: "l3", item_id: "i10", item_title: "Vase", status: "paid", order_id: "ord-bought", order_status: "paid", handover: "pickup_home" }];
    // ?status=done with nothing done (a group that just emptied): every order shows, never a blank tab.
    const first = at("/declutter?tab=buying&status=done");
    expect(await screen.findByText("paid order ord-bought as buyer")).toBeInTheDocument();
    expect(screen.queryByText("Your cart is empty.")).toBeNull();
    expect(screen.queryByRole("region", { name: "Your cart" })).toBeNull();
    expect(screen.queryByText("You haven't made any offers.")).toBeNull();
    expect(screen.queryByText("Nothing bought yet.")).toBeNull();
    first.unmount();

    state.cart = [];
    const second = at("/declutter?tab=buying");
    expect(await screen.findByText("Nothing bought yet.")).toBeInTheDocument();
    expect(screen.queryByText("Your cart is empty.")).toBeNull();
    expect(screen.queryByText("You haven't made any offers.")).toBeNull();
    expect(screen.queryByText(/^Nothing bought yet\. After you pay/)).toBeNull();
    // Exactly one empty state on the tab.
    expect(screen.getAllByText(/^Nothing bought yet\.$|cart is empty|haven't made any offers|^Nothing bought yet\. After/).length).toBe(1);
    second.unmount();

    // Owner 10-28 tracker: a chip shows only when it holds orders, so an old or stale ?status= (the retired "cart" chip,
    // or a group that just emptied) shows the one empty state, never a blank tab.
    at("/declutter?tab=buying&status=cart");
    expect(await screen.findByText("Nothing bought yet.")).toBeInTheDocument();
    expect(screen.queryByText("Your cart is empty.")).toBeNull();
  });

  // Owner 2026-10-28: "buyers and sellers need a very organized way to keep track of all their purchases". Buying is an
  // order tracker like Jobs > Posted. The class: the chips are exactly the ORDER_BUCKETS groups that hold orders, in
  // that order, and each chip's count is exactly how many orders (a checkout, a paid order, one that ended) it shows.
  // Offers are their own group and never a chip.
  // @mutate src/components/declutter/BuyingOrders.tsx |   counts.needs_you += checkouts; |   counts.needs_you += 0;
  // @mutate src/components/declutter/BuyingOrders.tsx |   counts.cancelled += ended.length; |   counts.cancelled += 0;
  // @mutate src/components/declutter/BuyingOrders.tsx |   return ORDER_BUCKETS.filter((b) => counts[b.key] > 0).map( |   return ORDER_BUCKETS.map(
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       <PaidOrders side="buyer" views={t.views} show={(id) => only === null \|\| t.views.get(id)?.bucket === only} /> |       <PaidOrders side="buyer" views={t.views} />
  // Audit DB-6 (2026-10-30): a seller's counter to answer sat under every order, below the fold. It now comes before
  // the orders; offers that wait on the seller stay below them.
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       {offers.has && offers.toAnswer && <OffersSection side="buyer" />}\n |
  // @mutate src/components/declutter/DeclutterMineViews.tsx |     toAnswer: mine.some((o) => o.status === "open" && o.awaiting === "buyer"), |     toAnswer: false,
  it("DB-6: a counter to answer puts Your offers above the orders; offers waiting on the seller stay below", async () => {
    const paid = { ...LINE, line_id: "p1", item_id: "p1", item_title: "Desk", status: "paid", order_id: "o-done", order_status: "handed_over", handover: "porch" };
    const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (const [awaiting, offersFirst] of [["buyer", true], ["seller", false]] as const) {
      state.offers = [{ ...OFFER, my_side: "buyer", awaiting, item_id: "i7", item_title: "Rug" }];
      state.cart = [paid];
      const { unmount } = at("/declutter?tab=buying");
      const order = await screen.findByText("paid order o-done as buyer");
      const offers = await screen.findByRole("region", { name: "Your offers" });
      expect([awaiting, before(offers, order)]).toEqual([awaiting, offersFirst]);
      expect(screen.getAllByRole("region", { name: "Your offers" })).toHaveLength(1);
      unmount();
    }
  });

  it("owner 10-28: Buying is an order tracker: one chip per group that holds orders, each count = the orders it shows", async () => {
    const LATER = new Date(Date.now() + 48 * 3_600_000).toISOString();
    state.offers = [{ ...OFFER, my_side: "buyer", awaiting: "seller", item_id: "i7", item_title: "Rug" }];
    state.cart = [
      LINE, // a checkout to pay: Needs you
      { ...LINE, line_id: "p1", item_id: "p1", item_title: "Porch lamp", status: "paid", order_id: "o-porch", order_status: "paid", handover: "porch" }, // pick a day: Needs you
      { ...LINE, line_id: "p2", item_id: "p2", item_title: "Desk", status: "paid", order_id: "o-booked", order_status: "paid", handover: "pickup_home" }, // booked: Upcoming
      { ...LINE, line_id: "p3", item_id: "p3", item_title: "Sofa", status: "paid", order_id: "o-helpr", order_status: "paid", handover: "delivery" }, // finding a Helpr: Waiting
      { ...LINE, line_id: "p4", item_id: "p4", item_title: "Mug", status: "paid", order_id: "o-done", order_status: "handed_over", handover: "porch" }, // Done
      { ...LINE, line_id: "p5", item_id: "p5", item_title: "Vase", status: "paid", order_id: "o-refunded", order_status: "refunded", handover: "pickup_home" }, // Cancelled
      { ...LINE, line_id: "p6", item_id: "p6", item_title: "Rake", status: "missed" }, // ended unpaid: Cancelled
      { ...LINE, line_id: "s1", item_id: "s1", item_title: "Shelf", my_side: "seller", seller_id: "u1", status: "paid", order_id: "ord-sold", order_status: "paid", handover: "porch" },
    ];
    state.bookings = [{ order_id: "o-booked", slot_start: LATER, slot_end: LATER, porch_mode: null, porch_until: null }];
    const { container } = at("/declutter?tab=buying");
    await screen.findByText("paid order o-porch as buyer");
    const want: [string, string, number][] = [["needs_you", "Needs you", 2], ["waiting", "Waiting", 1], ["upcoming", "Upcoming", 1], ["done", "Done", 1], ["cancelled", "Cancelled", 2]];
    await vi.waitFor(() => {
      const boxes = Array.from(container.querySelectorAll("[data-status-box]")) as HTMLElement[];
      expect(boxes.map((b) => [b.getAttribute("data-status-box"), b.querySelector("[data-chip-label]")?.textContent, Number(b.getAttribute("data-count"))])).toEqual(want);
    });
    expect(container.querySelector("[data-status-all]")?.getAttribute("data-count")).toBe("7");
    // Offers are their own group, never a chip.
    expect(screen.getByRole("region", { name: "Your offers" })).toBeInTheDocument();
    const shown = () =>
      container.querySelectorAll("[data-paid-marker]").length + container.querySelectorAll('section[aria-label^="Checkout"]').length + container.querySelectorAll("[data-ended-line]").length;
    expect(shown()).toBe(7);
    expect(screen.queryByText("paid order ord-sold as seller")).toBeNull();
    let checked = 0;
    for (const [key, , n] of want) {
      fireEvent.click(container.querySelector(`[data-status-box="${key}"]`) as HTMLElement);
      await vi.waitFor(() => expect(where).toContain(`status=${key}`));
      await vi.waitFor(() => expect(shown(), key).toBe(n));
      checked++;
    }
    expect(checked).toBeGreaterThan(4);
    // Cancelled shows the refunded order and the checkout that ran out, and says nothing was charged for it.
    expect(screen.getByText("paid order o-refunded as buyer")).toBeInTheDocument();
    expect(screen.getByText(/The time to check out ran out\. Nothing was charged\./)).toBeInTheDocument();
  });

  it("Selling: your listings, the offers on your items, sales waiting to be paid and paid sales, every old action still there", async () => {
    everything();
    at("/declutter?view=selling");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    // LEAD-SEARCH-ALL-TABS (owner 2026-10-31): the search icon is on Selling too.
    expect(screen.getByRole("link", { name: "Search all sections" })).toHaveAttribute("href", "/search");
    for (const a of BEFORE_ACTIONS.selling) expect(screen.getAllByRole(a.role, { name: a.name }).length).toBeGreaterThan(0);
    const onMine = screen.getByRole("region", { name: "Offers on your items" });
    expect(within(onMine).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(within(onMine).getByRole("button", { name: "Answer with a price" })).toBeInTheDocument();
    expect(within(onMine).getByRole("button", { name: "Say no" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sold, waiting for the buyer to pay" })).toBeInTheDocument();
    expect(screen.getByText("paid order ord-sold as seller")).toBeInTheDocument();
    // Nothing of the buyer's side.
    expect(screen.queryByText("paid order ord-bought as buyer")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Take back my offer" })).toBeNull();
  });

  it("badges: Buying and Selling say how many things need the member", async () => {
    everything();
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    // Buying: a cart line to check out, a counter to answer and a purchase to pick up. Selling: an offer and a sale to hand over.
    expect(tab(/^Buying/)).toHaveAccessibleName(/3/);
    expect(tab(/^Selling/)).toHaveAccessibleName(/2/);
  });

  // Audit DC-9 (lead 2026-10-30): the Selling badge counts what "To answer" counts, so a question waiting on a live
  // listing shows on the tab too; the tab row waits for that read (no late re-wrap).
  // @mutate src/components/declutter/DeclutterHomeView.tsx |         { value: "selling", label: "Selling", count: todo ? todo.selling + questions.count : undefined }, |         { value: "selling", label: "Selling", count: todo?.selling },
  // @mutate src/components/declutter/SellerQuestionsToAnswer.tsx |     enabled: mine.isSuccess && ids.length > 0, |     enabled: mine.isSuccess,
  it("DC-9: the Selling badge counts unanswered questions too, and the read is made only with a listing on sale", async () => {
    everything();
    state.questions = [{ id: "q1", item_id: "i1", question: "Is it sturdy?", created_at: "2026-10-29" }];
    const first = at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    // An offer, a sale to hand over and a question.
    expect(tab(/^Selling/)).toHaveAccessibleName(/3/);
    expect(state.questionReads).toBe(1);
    first.unmount();
    // Nothing on sale: no question read at all.
    state.questionReads = 0;
    state.mine = [{ ...ITEM, status: "draft" }];
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    expect(state.questionReads).toBe(0);
  });

  it("no badge when nothing needs the member", async () => {
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    expect(tab(/^Buying/).textContent).toBe("Buying");
    expect(tab(/^Selling/).textContent).toBe("Selling");
  });

  // Audit posting 1030 #11: on a phone the Selling tab had no way to sell.
  // @mutate src/components/declutter/DeclutterHomeView.tsx | <Link to={SELL_ONE_PATH}>Sell an item</Link> | <span>Sell an item</span>
  it("Selling offers Sell an item straight to the photo screen, and one line to the other ways", async () => {
    state.mine = [ITEM];
    at("/declutter?tab=selling");
    await screen.findByRole("heading", { name: /^Your listings/ });
    const row = document.querySelector("[data-selling-sell]")!;
    expect(within(row as HTMLElement).getByRole("link", { name: "Sell an item" })).toHaveAttribute("href", "/declutter/sell");
    expect(within(row as HTMLElement).getByRole("link", { name: "Free, a bunch, or moving out?" })).toHaveAttribute("href", "/declutter/sell?mode=choose");
  });

  // LEAD-SELLING-NO-SELL-BTN-PHONE (owner 2026-10-31): on a phone the + covers it, so the row is off below sm (640px)
  // and the filter chips move up; from sm to the desktop header (lg, 900px) it shows; the header has its own from lg.
  // @mutate src/components/declutter/DeclutterHomeView.tsx | <div className="hidden items-center gap-3 sm:flex lg:hidden" data-selling-sell=""> | <div className="flex items-center gap-3 lg:hidden" data-selling-sell="">
  it("the Sell an item row is not on a phone, only from sm until the desktop header", async () => {
    state.mine = [ITEM];
    at("/declutter?tab=selling");
    await screen.findByRole("heading", { name: /^Your listings/ });
    const cls = (document.querySelector("[data-selling-sell]") as HTMLElement).className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["hidden", "sm:flex", "lg:hidden"]));
    expect(cls).not.toContain("flex");
  });

  it("old link ?view=mine opens Selling and the address becomes ?tab=selling", async () => {
    state.mine = [ITEM];
    at("/declutter?view=mine");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    expect(tab(/^Selling/)).toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=selling"));
  });

  // Audit posting 1030 #3: the address rewrite threw away the router state, so the sheet never opened after a real Post.
  // @mutate src/components/declutter/DeclutterHomeView.tsx |     }, { replace: true, state: location.state }); |     }, { replace: true });
  it("an old ?view= link keeps its router state through the rewrite, so \"Your listing is live\" stays open", async () => {
    state.mine = [ITEM];
    at("/declutter?view=selling", { justListed: { itemId: "i1", status: "live" } });
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=selling"));
    expect(await screen.findByRole("heading", { name: "Your listing is live" })).toBeInTheDocument();
  });

  it("old link ?view=cart sent to a seller (the buyer paid) opens Selling, keeping its other params", async () => {
    state.cart = [{ ...LINE, my_side: "seller", seller_id: "u1", status: "paid", order_id: "ord-sold", order_status: "paid", handover: "porch" }];
    at("/declutter?view=cart&paid=1");
    expect(await screen.findByText("paid order ord-sold as seller")).toBeInTheDocument();
    expect(tab(/^Selling/)).toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => expect(where).toBe("/declutter?paid=1&tab=selling"));
  });

  it("old link ?view=cart sent to a buyer opens Buying", async () => {
    state.cart = [LINE];
    at("/declutter?view=cart");
    expect(await screen.findByRole("button", { name: "Pay $3.85" })).toBeInTheDocument();
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=buying"));
  });

  it("old link ?view=offers opens Selling for a new offer, and Buying when only a counter waits on the buyer", async () => {
    state.offers = [OFFER];
    const first = at("/declutter?view=offers");
    expect(await screen.findByRole("region", { name: "Offers on your items" })).toBeInTheDocument();
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=selling"));
    first.unmount();
    state.offers = [{ ...OFFER, my_side: "buyer", awaiting: "buyer" }];
    at("/declutter?view=offers");
    expect(await screen.findByRole("region", { name: "Your offers" })).toBeInTheDocument();
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=buying"));
  });

  // D2 (Cowork audit 2026-10-20): the Buying "Offers" box read 0 above a listed
  // offer (it counted only offers waiting for the buyer's answer). The class:
  // a status box either counts exactly the rows its list shows, or its label
  // says it counts what needs you (To pay / To answer / Pick up / Hand over / To be paid).
  // Buying's chips are the order tracker's (owner 10-28): its count rule is the tracker test above.
  it.each([
    ["selling", "Offers on your items", { ...OFFER, my_side: "seller", awaiting: "buyer" }],
  ] as const)("D2: %s: a box never shows a count its list contradicts", async (side, region, offer) => {
    state.offers = [offer];
    const { container } = at(`/declutter?tab=${side}`);
    const list = await screen.findByRole("region", { name: region });
    const rows = list.querySelectorAll("li").length;
    expect(rows).toBe(1);
    const boxes = Array.from(container.querySelectorAll("[data-status-box]")) as HTMLElement[];
    expect(boxes.length).toBeGreaterThan(2);
    const box = container.querySelector('[data-status-box="offers"]') as HTMLElement;
    const count = Number(/\d+/.exec(box.textContent ?? "")?.[0]);
    const label = (box.textContent ?? "").replace(/\d+/, "").trim();
    const needsYouLabel = /^(To |Pick up|Hand over)/.test(label);
    expect(count === rows || needsYouLabel, `box "${label}" shows ${count} above ${rows} listed`).toBe(true);
  });

  // Audit DC-9: "To answer" left out unanswered questions and showed buyer-turn offers and the settings. It counts
  // and shows the seller-turn offers AND the unanswered questions on listings on sale, and nothing else.
  // @mutate src/components/declutter/DeclutterMineViews.tsx |   const toAnswer = (todo?.sellerOffers ?? 0) + questions.count + reports.size; |   const toAnswer = (todo?.sellerOffers ?? 0) + reports.size;
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("offers") && <QuestionsToAnswer userId={userId} />} |
  // @mutate src/components/declutter/DeclutterOffersSection.tsx |     const waiting = mine.filter((o) => o.status === "open" && o.awaiting === side); |     const waiting = mine.filter((o) => o.status === "open");
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       {only === null && settings} |       {settings}
  // @mutate src/components/declutter/SellerQuestionsToAnswer.tsx | const ASKABLE = new Set(["live", "paused"]); | const ASKABLE = new Set(["live", "paused", "draft", "sold"]);
  // AUD31-28 (audit 2026-10-31): the Answer row opens the item at its questions, not at the top.
  // @mutate src/components/declutter/SellerQuestionsToAnswer.tsx | <Link to={`/declutter/item/${r.item_id}#declutter-questions`} | <Link to={`/declutter/item/${r.item_id}`}
  it("DC-9: To answer counts and shows the offers waiting on the seller and the unanswered questions, nothing else", async () => {
    state.mine = [ITEM, { ...ITEM, id: "i2", title: "Desk" }, { ...ITEM, id: "i3", status: "draft", title: "Draft lamp" }];
    state.offers = [OFFER, { ...OFFER, offer_id: "o9", item_id: "i2", item_title: "Desk", awaiting: "buyer" }];
    state.questions = [
      { id: "q1", item_id: "i2", question: "Does the desk come apart?", created_at: "2026-10-29" },
      // Only listings on sale (live or paused) count; a draft is not on sale.
      { id: "q2", item_id: "i3", question: "Still have it?", created_at: "2026-10-29" },
    ];
    const { container } = at("/declutter?tab=selling&status=offers");
    const qs = await screen.findByRole("region", { name: "Questions to answer" });
    expect(within(qs).getByText("Does the desk come apart?")).toBeInTheDocument();
    expect(within(qs).getByRole("link", { name: /Does the desk come apart/ })).toHaveAttribute("href", "/declutter/item/i2#declutter-questions");
    expect(within(qs).queryByText("Still have it?")).toBeNull();
    const box = container.querySelector('[data-status-box="offers"]') as HTMLElement;
    await vi.waitFor(() => expect(box.textContent).toBe("To answer · 2"));
    const offers = screen.getByRole("region", { name: "Offers on your items" });
    expect(offers.querySelectorAll("li")).toHaveLength(1);
    expect(within(offers).queryByText("Desk")).toBeNull(); // the buyer's turn: not here
    expect(container.querySelector("[data-selling-settings]")).toBeNull();
    // All: the settings and every open offer are back.
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(await screen.findByRole("link", { name: /Declutter settings/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Offers on your items" }).querySelectorAll("li").length).toBeGreaterThan(1);
  });

  it("DC-9: To answer with nothing waiting says so once", async () => {
    state.mine = [ITEM];
    state.offers = [{ ...OFFER, awaiting: "buyer" }];
    at("/declutter?tab=selling&status=offers");
    expect(await screen.findByText("Nothing to answer right now.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Offers on your items" })).toBeNull();
  });

  // D3 (Cowork audit 2026-10-20): the empty Selling list said 'Tap "Sell an
  // item" to start.' with no such button on the screen. The class: an empty
  // state that names an action offers that action, right there.
  it("D3: an empty Selling list offers 'Sell an item' as a button in the list itself", async () => {
    state.mine = [];
    at("/declutter?tab=selling");
    const region = await screen.findByRole("region", { name: "Your listings" });
    const btn = within(region).getByRole("button", { name: "Sell an item" });
    expect(btn).toBeVisible();
    // Whatever the empty state tells you to tap is on screen.
    for (const m of (region.textContent ?? "").matchAll(/Tap "([^"]+)"/g)) {
      expect(within(region).getByRole("button", { name: m[1] })).toBeInTheDocument();
    }
  });

  it("every old view value maps to one of the new tabs (none falls back to Browse)", () => {
    const todo = declutterTodo([], []);
    for (const v of ["mine", "offers", "cart"] as const) {
      expect(["buying", "selling"]).toContain(oldDeclutterView(v, todo));
      expect(["buying", "selling"]).toContain(oldDeclutterView(v, null));
    }
  });

  it("the counts: an expired cart line, a delivery order and a handed-over order need nothing", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const t = declutterTodo(
      [
        { ...LINE, checkout_by: past },
        { ...LINE, line_id: "x", status: "paid", order_id: "d1", order_status: "paid", handover: "delivery" },
        { ...LINE, line_id: "y", status: "paid", order_id: "h1", order_status: "handed_over", handover: "porch" },
        { ...LINE, line_id: "z", status: "paid", order_id: "p1", order_status: "paid", handover: "porch" },
        { ...LINE, line_id: "z2", status: "paid", order_id: "p1", order_status: "paid", handover: "porch" },
      ] as never,
      [{ ...OFFER, status: "declined" }, { ...OFFER, offer_id: "w", awaiting: "buyer" }] as never,
    );
    expect(t).toMatchObject({ toPay: 0, purchasesOpen: 1, sellerOffers: 0, buying: 1, selling: 0 });
  });

  // Audit 2026-10-28 #37 (SE2-4): the seller's Helpr notices ("A Helpr will pick it up", "Helpr pickup
  // booked", "Picked up") link the old ?view=cart, which opened the BUYER's tab for a seller whose only
  // open sale is a Helpr delivery; the buyer's "Your item is on its way" opened Selling for a member
  // who also had a porch sale open.
  // @mutate src/lib/declutter/tabs.ts |   const sellerWaiting = todo ? todo.salesOpen + todo.salesAwaitingPayment + todo.salesDelivering : 0; |   const sellerWaiting = todo ? todo.salesOpen + todo.salesAwaitingPayment : 0;
  // @mutate src/lib/declutter/tabs.ts |   const buyerWaiting = todo ? todo.toPay + todo.purchasesOpen + todo.purchasesDelivering : 0; |   const buyerWaiting = todo ? todo.toPay + todo.purchasesOpen : 0;
  it("an old ?view=cart link opens the side whose Helpr delivery is under way (#37)", () => {
    const delivering = (side: "buyer" | "seller", id: string) =>
      ({ ...LINE, line_id: id, my_side: side, status: "paid", order_id: id, order_status: "paid", handover: "delivery" });
    const sellerOnly = declutterTodo([delivering("seller", "d1")] as never, []);
    expect(sellerOnly).toMatchObject({ salesDelivering: 1, purchasesDelivering: 0, selling: 0 });
    expect(oldDeclutterView("cart", sellerOnly)).toBe("selling");
    const porchSale = { ...LINE, line_id: "p1", my_side: "seller", status: "paid", order_id: "p1", order_status: "paid", handover: "porch" };
    const buyerDelivery = declutterTodo([delivering("buyer", "d2"), porchSale] as never, []);
    expect(buyerDelivery).toMatchObject({ purchasesDelivering: 1, salesOpen: 1, buying: 0 });
    // Both sides have something: the link's usual side (Buying), not the seller's porch sale.
    expect(oldDeclutterView("cart", buyerDelivery)).toBe("buying");
    // A handed-over delivery is history: it decides nothing.
    const done = declutterTodo([{ ...delivering("seller", "d3"), order_status: "handed_over" }] as never, []);
    expect(done.salesDelivering).toBe(0);
  });
});

// @mutate src/components/declutter/DeclutterHomeView.tsx |         { value: "deliver", label: "Deliver" },\n |
