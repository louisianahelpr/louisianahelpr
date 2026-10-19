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
 * @mutate src/components/declutter/DeclutterHomeView.tsx |         : view === "buying" ? <BuyingDash todo={todo} /> |         : view === "buying" ? <WantedView />
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("offers") && <OffersSection side="seller" />} |       {show("offers") && null}
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   const show = (g: SellingGroup) => only === null \|\| only === g; |   const show = (_g: SellingGroup) => true;
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map( |   const options = [...tabs.map(
 * @mutate src/components/declutter/DeclutterHomeView.tsx |           { value: "selling", label: "Selling", count: todo?.selling }, |           { value: "selling", label: "Selling", count: todo?.selling },\n          { value: "wanted", label: "Wanted" },
 * @mutate src/components/declutter/DeclutterTabParts.tsx |   const lines = (cart.data ?? []).filter((l) => l.my_side === side); |   const lines = cart.data ?? [];
 * @mutate src/lib/declutter/tabs.ts |   if (view === "mine") return "selling"; |   if (view === "mine") return "buying";
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
  mine: [] as unknown[],
  offers: [] as unknown[],
  cart: [] as unknown[],
};

vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => true,
  useFeatureStatus: () => ({ on: true, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
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
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => [],
  fetchMyItems: async () => state.mine,
  fetchPhotos: async () => [],
  fetchSellerRatings: async () => new Map(),
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: async () => undefined,
  fetchMyCard: async () => ({ brand: "visa", last4: "4242" }),
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  makeOffer: async () => "o",
  respondOffer: async () => "declined",
  buyNow: async () => "l",
  sellerCancelSale: async () => 1,
  startCardSave: async () => "https://checkout.stripe.test/setup",
  startCheckoutPayment: async () => ({ url: "https://checkout.stripe.test/pay", paid: false }),
  fetchHasAgreedSales: async () => false,
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";

let where = "";
function Where() {
  const loc = useLocation();
  where = loc.pathname + loc.search;
  return null;
}

function at(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["feature-enabled", "declutter", "u1"], true);
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
    { role: "button", name: "Take down" },
    { role: "link", name: /Moving out\?/ },
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
    state.mine = [];
    state.offers = [];
    state.cart = [];
    where = "";
  });

  it("owner 10-19: Browse | Buying | Selling, one word each, Browse leftmost and the default; Wanted's entry is hidden even with its switch on", async () => {
    at("/declutter");
    await screen.findByRole("tablist", { name: "Declutter view" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Browse", "Buying", "Selling"]);
    for (const t of tabs) expect(t.textContent).toMatch(/^\S+$/);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText(/Wanted/)).toBeNull();
    expect(tabs.length).toBeGreaterThan(2);
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

  it("Selling: your listings, the offers on your items, sales waiting to be paid and paid sales, every old action still there", async () => {
    everything();
    at("/declutter?view=selling");
    expect(await screen.findByRole("heading", { name: /^Your listings/ })).toBeInTheDocument();
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
