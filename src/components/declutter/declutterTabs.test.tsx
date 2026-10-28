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
 * @mutate src/components/declutter/DeclutterMineViews.tsx |           { key: "offers", label: "To answer", count: todo?.buyerOffers ?? 0, hot: true }, |           { key: "offers", label: "Offers", count: todo?.buyerOffers ?? 0, hot: true },
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             <SectionActionPill className="mt-3" onClick={() => navigate(sectionByKey("declutter").add.path)}> |             <SectionActionPill className="mt-3 hidden" aria-hidden onClick={() => navigate(sectionByKey("declutter").add.path)}>
 * @mutate src/components/declutter/DeclutterHomeView.tsx | {view === "buying" ? <><BoughtWhatNext /><BuyingDash todo={todo} /></> | {view === "buying" ? <WantedView />
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("offers") && <OffersSection side="seller" />} |       {show("offers") && null}
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   const show = (g: SellingGroup) => only === null \|\| only === g; |   const show = (_g: SellingGroup) => true;
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map( |   const options = [...tabs.map(
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []), |         ...[],
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         ...(wantedOn ? [{ value: "wanted" as const, label: "Wanted" }] : []), |         ...[{ value: "wanted" as const, label: "Wanted" }],
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             footnote={<WantedLink />} |             footnote={null}
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   if (!on) return null; |   if (on === undefined) return null;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                 <WantedLink />\n              </div> |                 {null}\n              </div>
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |             title={q ? "Nothing matches that search." : |             title={others.length === 0 ? "Opens soon" : q ? "Nothing matches that search." :
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                 {searched && ( |                 {false && (
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
};

// Seller delivery (20261027153244): its settings card and checkout offer read through these; answered here, never Supabase.
// Q2427: no bundle discount here (its own tests: declutterTradeViews, declutterBundleDiscount.test.ts).
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => null,
  fetchBundlePreview: async () => 0,
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
  // declutterTradeViews.test.tsx, src/test/declutterSellerDelivery.test.ts); with it on, porch reads "Porch or safe place".
  // 'declutter_wanted' follows state.wantedOn (the Wanted tab and Browse's "Can't find it?" link, owner 2026-10-28).
  useFeature: (key: string) => key !== "declutter_seller_delivery" && (key !== "declutter_wanted" || state.wantedOn),
  useFeatureStatus: (key: string) => ({ on: key !== "declutter_wanted" || state.wantedOn, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
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
// One marker per paid order: which tab it lands on is what this file checks.
vi.mock("./DeclutterHandoverViews", () => ({
  PaidOrdersSection: ({ cart, heading }: { cart: { status: string; order_id: string | null; my_side: string }[]; heading?: React.ReactNode }) => (
    <section>
      {heading}
      {cart.filter((l) => l.status === "paid" && l.order_id).map((l) => <p key={l.order_id}>{`paid order ${l.order_id} as ${l.my_side}`}</p>)}
    </section>
  ),
}));
// Q2425: no safe meetup spot near these carts (its own tests: declutterTradeViews, declutterHandoverViews).
vi.mock("@/lib/declutter/meetup", () => ({ fetchMeetupSpotsNear: async () => [], fetchOrderMeetup: async () => null }));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => state.live,
  fetchWatching: async () => new Set(),
  setWatch: async () => "ok",
  fetchMapPins: async () => new Map(),
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
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
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
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

function at(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
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
    { role: "link", name: "View" },
    { role: "button", name: "Finish listing" },
    { role: "button", name: "Delete" },
    // Board 158: a live listing's "Take down" lives in its Manage sheet (Delete listing / Mark sold elsewhere).
    { role: "button", name: "Manage" },
    { role: "link", name: /Moving out sale/ },
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
    where = "";
  });

  it("owner 10-19 + 10-28: Browse | Buying | Selling | Deliver | Wanted, one word each, Browse leftmost and the default", async () => {
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    const tabs = screen.getAllByRole("tab");
    // Deliver is a tab again (owner 2026-10-28: Helprs couldn't find it under Selling); Wanted last (owner 2026-10-28, "Both").
    expect(tabs.map((t) => t.textContent)).toEqual(["Browse", "Buying", "Selling", "Deliver", "Wanted"]);
    for (const t of tabs) expect(t.textContent).toMatch(/^\S+$/);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs.length).toBeGreaterThan(2);
  });

  it("lead 10-28: Accept and Cancel sale ask in an in-app sheet, never window.confirm; nothing runs until its button", async () => {
    // @mutate src/components/declutter/DeclutterTradeViews.tsx |             onClick={() => setAccepting(true)} |             onClick={() => act.mutate({ action: "accept" })}
    // @mutate src/components/declutter/DeclutterSalesWaiting.tsx |               onClick={() => setAsking(l.item_id)} |               onClick={() => { if (l.item_id) cancel.mutate(l.item_id); }}
    const confirmSpy = vi.spyOn(window, "confirm");
    everything();
    at("/declutter?tab=selling");
    const onMine = await screen.findByRole("region", { name: "Offers on your items" });
    fireEvent.click(within(onMine).getByRole("button", { name: "Accept" }));
    let sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveTextContent("Sell it for $25?");
    expect(sheet).toHaveTextContent("every other offer on it closes, and the buyer gets 48 hours to pay.");
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
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Browse", "Buying", "Selling", "Deliver"]);
    expect(tab(/^Browse/)).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Nothing for sale yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-wanted-link")).toBeNull();
    expect(screen.queryByText(/Wanted/)).toBeNull();
  });

  it("lead 10-28 (shot 04): a search that finds nothing says so, never \"Opens soon\", with Show all items and the Wanted link", async () => {
    // Nothing listed at all (an early-preview section) AND a search in the address: the search's answer wins.
    at("/declutter?q=sofa");
    expect(await screen.findByText("Nothing matches that search.")).toBeInTheDocument();
    expect(screen.queryByText("Opens soon")).toBeNull();
    expect(screen.queryByText("Nothing for sale yet.")).toBeNull();
    expect(screen.getByTestId("declutter-wanted-link")).toBeInTheDocument();
    const clear = screen.getByTestId("declutter-clear-search");
    expect(clear).toHaveTextContent("Show all items");
    fireEvent.click(clear);
    expect(await screen.findByText("Nothing for sale yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("declutter-clear-search")).toBeNull();
  });

  it("owner 10-28: Browse's \"Can't find it? Post what you're looking for\" opens the Wanted tab, under the list and in the no-results state", async () => {
    // No results: the link sits in the empty state.
    const empty = at("/declutter");
    const inEmpty = await screen.findByTestId("declutter-wanted-link");
    expect(inEmpty).toHaveTextContent("Can't find it? Post what you're looking for");
    expect(inEmpty).toHaveAttribute("href", "/declutter?tab=wanted");
    empty.unmount();
    // A list: the link closes the end card under the cards.
    state.live = [{ ...ITEM, id: "i40", seller_id: "s9", title: "Brass floor lamp" }];
    at("/declutter");
    expect(await screen.findByText("Brass floor lamp")).toBeInTheDocument();
    const link = within(screen.getByTestId("browse-end-card")).getByTestId("declutter-wanted-link");
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Your wanted posts" })).toBeInTheDocument();
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

  it("Buying: the cart, the offers you sent and your purchases, every old action still there", async () => {
    everything();
    at("/declutter?view=buying");
    expect(await screen.findByRole("heading", { name: /^Your cart/ })).toBeInTheDocument();
    // Lead 2026-10-28 (shot 05): no "Search all sections" row on a buyer's own lists; Selling keeps it.
    // @mutate src/components/declutter/DeclutterHomeView.tsx | globalSearch={view !== "buying"} tabs={tabsFor()} | globalSearch tabs={tabsFor()}
    expect(screen.queryByTestId("explore-search-entry")).toBeNull();
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
  // @mutate src/components/declutter/DeclutterMineViews.tsx |   const show = (g: BuyingGroup) => (only === null ? !has \|\| has[g] : only === g); |   const show = (g: BuyingGroup) => only === null \|\| only === g;
  // @mutate src/components/declutter/DeclutterMineViews.tsx |       {nothing && ( |       {false && (
  it("lead 10-28: Buying shows no empty list beside a purchase, and one empty state when there is nothing at all", async () => {
    state.cart = [{ ...LINE, line_id: "l3", item_id: "i10", item_title: "Vase", status: "paid", order_id: "ord-bought", order_status: "paid", handover: "pickup_home" }];
    const first = at("/declutter?tab=buying");
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

    // A chosen chip shows its own list, empty or not.
    at("/declutter?tab=buying&status=cart");
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing bought yet.")).toBeNull();
  });

  it("Selling: your listings, the offers on your items, sales waiting to be paid and paid sales, every old action still there", async () => {
    everything();
    at("/declutter?view=selling");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    expect(screen.getByTestId("explore-search-entry")).toBeInTheDocument();
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

  it("no badge when nothing needs the member", async () => {
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    expect(tab(/^Buying/).textContent).toBe("Buying");
    expect(tab(/^Selling/).textContent).toBe("Selling");
  });

  it("old link ?view=mine opens Selling and the address becomes ?tab=selling", async () => {
    state.mine = [ITEM];
    at("/declutter?view=mine");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
    expect(tab(/^Selling/)).toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => expect(where).toBe("/declutter?tab=selling"));
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
  it.each([
    ["buying", "Your offers", { ...OFFER, my_side: "buyer", awaiting: "seller" }],
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
});

// @mutate src/components/declutter/DeclutterHomeView.tsx |         { value: "deliver", label: "Deliver" },\n |
