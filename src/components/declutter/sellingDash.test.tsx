/**
 * The Selling tab, polished (owner 2026-10-28, walkthrough shots 06, 08, 15, 30 in
 * ~/.lh-shots/declutter-walk-1028/): the classes the walkthrough found, each checked on the rendered tab.
 *   1. ONE selected look in the filter row: a filled pill is always the pressed filter (a filled "Sell an item"
 *      ended the row and read as a second selected filter).
 *   2. No Explore "Search all sections" row on Selling.
 *   3. Every listing row: a thumbnail, ONE status line ("Not listed yet" + "Finish the listing to put it up for
 *      sale." read as two), its actions in one group (right-aligned from sm up).
 *   4. "Offers on your items" and "Sold: pickup and payout" empty: a designed empty state, not a bare sentence.
 *   5. "Sell it for me" and "Moving out sale": rows in one card, never loose pills.
 *   6. The seller's settings (I can deliver, pickup times, bundle discount) in ONE area after the lists, never a
 *      card in among them.
 * The Declutter API module and the account hooks are stubbed (what each STATE renders), as in declutterTabs.test.tsx.
 *
 * @mutate src/components/declutter/DeclutterMineViews.tsx | const OFF = "border border-border bg-card text-foreground"; | const OFF = "btn-grad-primary";
 * @mutate src/components/declutter/DeclutterHomeView.tsx | globalSearch={view !== "buying" && view !== "selling"} | globalSearch={view !== "buying"}
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                     data-listing-status={item.status}\n |                     data-listing-status={item.status}>{sellerStatusLabel(item)}</p><p data-listing-status={item.status}\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                 <ListingThumb path={thumb} category={item.category} />\n |
 * @mutate src/components/declutter/DeclutterTabParts.tsx | <div data-seller-empty="" | <div data-plain=""
 * @mutate src/components/declutter/SellItForMe.tsx |     ? "flex min-h-14 w-full items-center | ? "rounded-full flex min-h-14 w-full items-center
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             <MyListingsView userId={userId} haulOn={haulOn} />\n |             <MyListingsView userId={userId} haulOn={haulOn} />\n            <BundleDiscountCard />\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |           <PickupTimesCard userId={userId} />\n |
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("taken") && <TakenDownSection items={takenDown} ended={ended} />} |
 * @mutate src/components/declutter/DeclutterMineViews.tsx | (i) => i.status === "withdrawn" \|\| i.status === "sold_elsewhere") | (i) => i.status === "never" \|\| i.status === "sold_elsewhere")
 * @mutate src/components/declutter/declutterUi.tsx |   if (item.current_price_cents === 0 && item.status === "sold") return "Claimed · waiting for pickup"; |   void 0;
 * @mutate src/components/declutter/declutterUi.tsx |   if (item.current_price_cents === 0 && item.status === "reserved") return "Claimed"; |   void 0;
 * @mutate src/components/declutter/DeclutterItemView.tsx | title={`Your listing: ${sellerStatusLabel(it)}`} | title={`Your listing: ${STATUS_LABEL[it.status]}`}
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   const cents = SOLD.has(item.status) ? sold : item.current_price_cents; |   const cents = item.current_price_cents;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                 <ListingPrice item={item} sold={sales.data?.get(item.id)?.cents} /> |                 <ListingPrice item={item} sold={item.current_price_cents} />
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   if (cents === undefined) return null; |   if (cents === undefined) return <span data-listing-price="">{itemPriceLabel(item.current_price_cents)}</span>;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   return paid ? `${base} · ${paid}` : base; |   return base;
 * @mutate src/components/declutter/DeclutterHomeView.tsx |     return orderId ? (payouts.data ?? []).find((p) => p.order_id === orderId) ?? null : null; |     return (payouts.data ?? [])[0] ?? null;
 * @mutate src/lib/declutter/soldPayout.ts |   if (saleCents === undefined \|\| saleCents === 0) return null; |   if (saleCents === undefined) return null;
 * @mutate src/lib/declutter/soldPayout.ts |       return payout.executed_at ? `Paid out ${formatDay(payout.executed_at)}` : "Paid out"; |       return "Paid out";
 * @mutate src/components/declutter/DeclutterTakenDown.tsx |     mutationFn: (itemId: string) => reopenListing(itemId).then(() => itemId), |     mutationFn: async (itemId: string) => itemId,
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "@/test/helpers/trackedFiles";
import { blankComments } from "@/test/helpers/blankNonCode";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const reopenSpy = vi.hoisted(() => vi.fn(async (_id: string) => "draft"));
const withdrawSpy = vi.hoisted(() => vi.fn(async (_id: string) => undefined));
const state = {
  mine: [] as unknown[],
  offers: [] as unknown[],
  cart: [] as unknown[],
  sales: new Map<string, { cents: number; orderId: string | null }>(),
  payouts: [] as unknown[],
  /** Audit 1b D2-2: open problems on the seller's orders. */
  problems: [] as unknown[],
};

vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchMyPayouts: async () => state.payouts,
  fetchOpenProblems: async () => state.problems,
}));
// Audit 1028 D1-8: My listings listens for new notices (the shared realtime bus); no socket in a unit test.
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
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
  };
});
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => true,
  useFeatureStatus: () => ({ on: true, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// The payout prompt is its own test (sellerPayoutPrompt.test.tsx); it reads prod-only hooks.
vi.mock("@/components/declutter/SellerPayoutPrompt", () => ({ SellerPayoutPrompt: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/components/sections/SectionScreen", () => ({
  // The real SectionScreen draws Explore's "Search all sections" field when globalSearch is on (its default).
  SectionScreen: ({ title, children, tabs, globalSearch = true }: { title: string; children: React.ReactNode; tabs?: React.ReactNode; globalSearch?: boolean }) => (
    <main>
      <h1>{title}</h1>
      {globalSearch && <button type="button">Search all sections</button>}
      {tabs}
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
vi.mock("./DeclutterHandoverViews", () => ({ PaidOrdersSection: () => null }));
vi.mock("./DeclutterDeliveryViews", () => ({ DeliverView: () => null }));
vi.mock("@/lib/declutter/meetup", () => ({ fetchMeetupSpotsNear: async () => [], fetchOrderMeetup: async () => null }));
vi.mock("@/lib/declutter/donate", () => ({
  fetchDonationPartnersNear: vi.fn(async () => []),
  fetchMyDonations: vi.fn(async () => []),
  chooseDonation: vi.fn(async () => 0),
  donatePostJobPath: (p: string) => `${p}&donate=1`,
  oneDonationPartner: () => null,
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchLiveItems: async () => [],
  fetchMapPins: async () => new Map(),
  fetchMyItems: async () => state.mine,
  fetchMySales: async () => state.sales,
  fetchPhotos: async () => [{ id: "p1", item_id: "i1", storage_path: "u1/i1/a.jpg", position: 0 }],
  fetchDropStates: async () => new Map(),
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: withdrawSpy,
  fetchMyCard: async () => ({ brand: "visa", last4: "4242" }),
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  fetchMyPickupWindows: async () => [{ weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" }],
  setPickupWindows: async () => 1,
  reopenListing: (id: string) => reopenSpy(id),
  respondOffer: async () => "declined",
  sellerCancelSale: async () => 1,
  startCheckoutPayment: async () => ({ url: "https://checkout.stripe.test/pay", paid: false }),
  fetchHasAgreedSales: async () => false,
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { STATUS_HELP } from "./declutterUi";

function at(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/declutter" element={<DeclutterPage />} />
          <Route path="/declutter/sell" element={<p>Sell page</p>} />
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
/** One listing in each status a seller manages from this list. */
const EVERY_STATUS = [
  ITEM,
  { ...ITEM, id: "i2", status: "draft", title: "Desk" },
  { ...ITEM, id: "i3", status: "pending_review", title: "Lamp", category: "home_decor" },
  { ...ITEM, id: "i4", status: "paused", title: "Rug" },
  { ...ITEM, id: "i5", status: "rejected", title: "Mirror" },
];

describe("Selling tab (owner 2026-10-28: make this more polished)", () => {
  beforeEach(() => {
    state.mine = EVERY_STATUS;
    state.offers = [];
    state.cart = [];
  });

  it("the filter row has one selected look: every filled pill is the pressed filter, and nothing else sits in the row", async () => {
    const { container } = at("/declutter?tab=selling");
    await screen.findByRole("heading", { name: /^Your listings/ });
    const row = container.querySelector("[data-status-chips]") as HTMLElement;
    const buttons = Array.from(row.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) {
      // Every control in the row is a filter (it has a pressed state) ...
      expect(b.getAttribute("aria-pressed"), b.textContent ?? "").not.toBeNull();
      // ... and it wears the filled (selected) look only while pressed.
      expect(b.classList.contains("btn-grad-primary"), b.textContent ?? "").toBe(b.getAttribute("aria-pressed") === "true");
    }
    expect(buttons.filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(within(row).queryByRole("button", { name: "Sell an item" })).toBeNull();
  });

  it("no 'Search all sections' row on Selling (Deliver keeps it)", async () => {
    at("/declutter?tab=selling");
    await screen.findByRole("heading", { name: /^Your listings/ });
    expect(screen.queryByRole("button", { name: "Search all sections" })).toBeNull();
  });

  it("the mock draws the search row where it is on, so the check above can fail", async () => {
    at("/declutter?tab=deliver");
    expect(await screen.findByRole("button", { name: "Search all sections" })).toBeInTheDocument();
  });

  // B48 live check 2026-10-29: a porch + meetup listing read only "For sale · Porch pickup".
  // @mutate src/components/declutter/DeclutterHomeView.tsx |   if (item.status === "live" && ways.length) return | if (false) return
  it("a live listing's line names every way the seller ticked, in checkout's order", async () => {
    state.mine = [{ ...ITEM, handovers: ["meetup", "porch"] }, { ...ITEM, id: "i9", title: "Old radio", handovers: null }];
    const { container } = at("/declutter?tab=selling");
    await screen.findByText("Old radio");
    const lines = Array.from(container.querySelectorAll("[data-listing-status]")).map((e) => e.textContent);
    expect(lines).toEqual(["For sale · Porch pickup · Meet at a safe spot", "For sale · Porch pickup"]);
  });

  it("every listing row: a thumbnail, ONE status line, the actions in one group", async () => {
    const { container } = at("/declutter?tab=selling");
    await screen.findByText("Oak rocking chair");
    await screen.findByText("Mirror");
    const rows = Array.from(container.querySelectorAll("[data-listing-row]"));
    expect(rows.length).toBe(EVERY_STATUS.length);
    expect(rows.length).toBeGreaterThan(4);
    for (const r of rows) {
      expect(r.querySelectorAll("[data-listing-thumb]")).toHaveLength(1);
      expect(r.querySelectorAll("[data-listing-status]")).toHaveLength(1);
      expect(r.querySelectorAll("[data-listing-actions]")).toHaveLength(1);
      // The old second line (STATUS_HELP) never comes back under the status.
      for (const help of Object.values(STATUS_HELP)) expect(r.textContent).not.toContain(help);
    }
    // A photo-less listing shows its category icon (the Browse card's placeholder), never a blank box.
    expect(rows[1].querySelector("[data-photo-placeholder]")).not.toBeNull();
    expect(rows[0].querySelector("img")).not.toBeNull();
  });

  it("empty 'Offers on your items' and 'Sold: pickup and payout' are designed empty states", async () => {
    at("/declutter?tab=selling");
    const offers = await screen.findByRole("region", { name: "Offers on your items" });
    expect(offers.querySelector("[data-seller-empty]")).not.toBeNull();
    expect(within(offers).getByText("No offers yet")).toBeInTheDocument();
    const sold = await screen.findByRole("region", { name: "Sold: pickup and payout" });
    expect(sold.querySelector("[data-seller-empty]")).not.toBeNull();
    expect(within(sold).getByText("Nothing sold yet")).toBeInTheDocument();
  });

  it("'Sell it for me' and 'Moving out sale' are rows in one card, never pills", async () => {
    at("/declutter?tab=selling");
    const more = await screen.findByRole("region", { name: "More ways to sell" });
    const entries = [within(more).getByTestId("sell-it-for-me-entry"), within(more).getByRole("link", { name: /Moving out sale/ })];
    expect(entries.length).toBeGreaterThan(1);
    for (const e of entries) {
      expect(e.className).not.toMatch(/rounded-full/);
      // A row says what it is and what it does: a title and a line under it.
      expect(e.querySelectorAll("span.block").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("the seller's settings sit in ONE area after the lists, never among them", async () => {
    const { container } = at("/declutter?tab=selling");
    const settings = await screen.findByRole("region", { name: "Selling settings" });
    expect(await within(settings).findByRole("region", { name: "Pickup times" })).toBeInTheDocument();
    expect(within(settings).getByRole("region", { name: "Bundle discount" })).toBeInTheDocument();
    expect(within(settings).getByRole("region", { name: "Your delivery" })).toBeInTheDocument();
    const cards = container.querySelectorAll("[data-bundle-card], [data-seller-delivery-card], [data-pickup-times-card]");
    expect(cards.length).toBeGreaterThan(2);
    for (const c of Array.from(cards)) expect(settings.contains(c)).toBe(true);
    // After every list: nothing of the lists follows the settings.
    for (const name of ["Your listings", "Offers on your items", "Sold: pickup and payout", "More ways to sell"]) {
      const list = screen.getByRole("region", { name });
      expect(list.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});

/**
 * Taken down (owner 2026-10-28, shots 48-49; deep audit SE-1): a listing the seller took down never vanishes with no
 * history. Every status a seller's listing can sit in shows somewhere on Selling (none silently filtered out), and a
 * taken-down one carries Relist (declutter_reopen_listing, 20261028180400; PGlite proof
 * src/test/pglite/declutterReopenListing.pglite.mjs).
 */
describe("Selling tab: Taken down, with Relist", () => {
  const TAKEN = { ...ITEM, id: "i9", status: "withdrawn", title: "Old radio", current_price_cents: 3500 };
  beforeEach(() => {
    state.offers = [];
    state.cart = [];
    reopenSpy.mockClear();
  });

  it("a taken-down listing shows under its own 'Taken down' chip and group, and Relist reopens it in the sell flow", async () => {
    state.mine = [ITEM, TAKEN];
    const { container } = at("/declutter?tab=selling");
    const group = await screen.findByRole("region", { name: "Selling history" });
    expect(within(group).getByText("Old radio")).toBeInTheDocument();
    const chip = container.querySelector('[data-status-box="taken"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain("1");
    fireEvent.click(within(group).getByRole("button", { name: "Relist" }));
    await waitFor(() => expect(reopenSpy).toHaveBeenCalledWith("i9"));
    expect(await screen.findByText("Sell page")).toBeInTheDocument();
  });

  it("every status a seller's own listing can hold is shown on Selling (nothing vanishes)", async () => {
    // The statuses a seller's listing can sit in without a sale (sold / completed show as orders under Sold).
    const statuses = ["draft", "pending_review", "live", "paused", "reserved", "rejected", "withdrawn", "sold_elsewhere"] as const;
    state.mine = statuses.map((s, n) => ({ ...ITEM, id: `s${n}`, status: s, title: `Item ${s}` }));
    at("/declutter?tab=selling");
    expect(statuses.length).toBeGreaterThan(5);
    for (const s of statuses) expect(await screen.findByText(`Item ${s}`)).toBeInTheDocument();
  });

  it("no 'Taken down' chip or group while nothing is taken down", async () => {
    state.mine = [ITEM];
    const { container } = at("/declutter?tab=selling");
    await screen.findByText("Oak rocking chair");
    expect(container.querySelector('[data-status-box="taken"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "Selling history" })).toBeNull();
  });

  // A2-5 (audit 2 SE2-1): "Mark sold elsewhere" keeps the listing as 'sold_elsewhere'. It belongs in the seller's
  // history, reads "Sold elsewhere.", has no Relist (it was sold), and is off the live listings.
  // @mutate src/components/declutter/DeclutterMineViews.tsx | i.status === "withdrawn" \|\| i.status === "sold_elsewhere") | i.status === "withdrawn")
  // @mutate src/components/declutter/DeclutterTakenDown.tsx |             {item.status === "withdrawn" && ( |             {true && (
  // @mutate src/components/declutter/DeclutterHomeView.tsx | new Set(["withdrawn", "sold_elsewhere"]) | new Set(["withdrawn"])
  it("a listing sold elsewhere is in Selling history, reads Sold elsewhere, has no Relist, and is off Your listings (A2-5)", async () => {
    const SOLD = { ...ITEM, id: "i8", status: "sold_elsewhere", title: "Brass lamp", current_price_cents: 2000 };
    state.mine = [ITEM, SOLD];
    const { container } = at("/declutter?tab=selling");
    const group = await screen.findByRole("region", { name: "Selling history" });
    const row = within(group).getByText("Brass lamp").closest("li") as HTMLElement;
    expect(within(row).getByText("Sold elsewhere.")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Relist" })).toBeNull();
    expect((container.querySelector('[data-status-box="taken"]') as HTMLElement).textContent).toContain("History");
    const listings = screen.getByRole("region", { name: "Your listings" });
    expect(within(listings).queryByText("Brass lamp")).toBeNull();
    expect(within(listings).getByText("Oak rocking chair")).toBeInTheDocument();
  });
});

/**
 * Audit 2, A2-20 (idea 3: a "Cancelled / Sold elsewhere / Deleted" history in Selling): a sale that ended without a
 * handover left the seller no record (the buyer keeps one on Buying). Every seller line that ended ('missed',
 * 'cancelled_by_seller'; with or without the order closed as 'refunded') is a row in Selling history saying what
 * happened, and counts in the History chip; a buyer's own ended line never shows on Selling.
 * @mutate src/components/declutter/DeclutterEndedSales.tsx | l.my_side === "seller" && (l.status === "missed" \|\| l.status === "cancelled_by_seller") | l.my_side === "seller" && l.status === "missed"
 * @mutate src/components/declutter/DeclutterMineViews.tsx |   const history = takenDown.length + ended.length; |   const history = takenDown.length;
 * @mutate src/components/declutter/DeclutterTakenDown.tsx |         <EndedSaleRows lines={ended} />\n |
 * @mutate src/components/declutter/DeclutterTakenDown.tsx |   if (items.length === 0 && ended.length === 0) return null; |   if (items.length === 0) return null;
 * @mutate src/components/declutter/DeclutterEndedSales.tsx |   if (l.order_status === "refunded") { |   if (false) {
 */
describe("Selling history: sales that ended without a handover (A2-20)", () => {
  beforeEach(() => {
    state.offers = [];
  });
  const seller = (over: Record<string, unknown>) => ({
    line_id: `l-${String(over.item_title)}`, item_id: "i1", my_side: "seller", seller_id: "u1", price_cents: 3200, checkout_by: "2026-10-27T12:00:00Z",
    order_id: null, order_status: null, handover: null, premium_cents: null, total_cents: null, porch_ok: true, ...over,
  });

  it("each kind of ended sale is a row with its own words; the chip counts them; a buyer's ended line is not here", async () => {
    state.mine = [ITEM];
    state.cart = [
      seller({ item_title: "Ran out", status: "missed" }),
      seller({ item_title: "Called off", status: "cancelled_by_seller" }),
      seller({ item_title: "No-show", status: "missed", order_id: "o1", order_status: "refunded" }),
      seller({ item_title: "Seller cancelled", status: "cancelled_by_seller", order_id: "o2", order_status: "refunded" }),
      seller({ item_title: "Free no-show", status: "missed", order_id: "o3", order_status: "refunded", price_cents: 0 }),
      seller({ item_title: "Free cancelled", status: "cancelled_by_seller", order_id: "o4", order_status: "refunded", price_cents: 0 }),
      seller({ item_title: "Free ran out", status: "missed", price_cents: 0 }),
      { ...seller({ item_title: "Bought by me", status: "missed" }), my_side: "buyer" },
    ];
    const WORDS: Record<string, string> = {
      "Ran out": "The buyer didn't check out in 48 hours. Nothing was charged.",
      "Called off": "You called off the sale. Nothing was charged.",
      "No-show": "Cancelled. The buyer missed the pickup.",
      "Seller cancelled": "You cancelled this sale after the buyer paid. They were refunded.",
      "Free no-show": "Cancelled. The buyer missed the pickup.",
      "Free cancelled": "You cancelled this free pickup.",
      "Free ran out": "The buyer didn't pick a pickup in 48 hours.",
    };
    const { container } = at("/declutter?tab=selling");
    const group = await screen.findByRole("region", { name: "Selling history" });
    const rows = Array.from(group.querySelectorAll("[data-ended-sale-row]"));
    expect(rows.length).toBe(Object.keys(WORDS).length);
    expect(rows.length).toBeGreaterThan(6);
    for (const [title, words] of Object.entries(WORDS)) {
      const row = rows.find((r) => r.textContent?.includes(title))!;
      expect(row, title).toBeTruthy();
      expect(row.textContent, title).toContain(words);
      expect(row.textContent, title).not.toMatch(/fee/i);
    }
    expect(group.textContent).not.toContain("Bought by me");
    expect((container.querySelector('[data-status-box="taken"]') as HTMLElement).textContent).toContain(String(Object.keys(WORDS).length));
  });

  it("only an ended sale (nothing taken down): the History chip and section still show", async () => {
    state.mine = [ITEM];
    state.cart = [seller({ item_title: "Ran out", status: "missed" })];
    const { container } = at("/declutter?tab=selling");
    const group = await screen.findByRole("region", { name: "Selling history" });
    expect(within(group).getByText("Ran out")).toBeInTheDocument();
    expect(container.querySelector('[data-status-box="taken"]')).not.toBeNull();
  });
});

// #18 (lead 2026-10-28): "Take this item off sale?" was the browser's window.confirm (a grey system box). It is the
// shared in-app ConfirmSheet now; src/test/declutterNoBrowserConfirm.test.ts keeps it at zero for this file.
// @mutate src/components/declutter/DeclutterHomeView.tsx |                     onClick={() => setAsking(item)} |                     onClick={() => { if (window.confirm("Take this item off sale?")) takeDown.mutate(item.id); }}
describe("#18: taking a listing down asks in the app", () => {
  it("Take down opens the sheet; Not now changes nothing; Take down takes it down", async () => {
    withdrawSpy.mockClear();
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => { throw new Error("window.confirm used"); });
    state.mine = [{ ...ITEM, id: "i7", status: "pending_review", title: "Wicker chair" }];
    state.offers = [];
    state.cart = [];
    at("/declutter?tab=selling");
    // D4-12: the row's button names its item.
    // @mutate src/components/declutter/DeclutterHomeView.tsx |                     aria-label={`${item.status === "draft" ? "Delete" : "Take down"} ${item.title}`} |                     aria-label="Take down"
    fireEvent.click(await screen.findByRole("button", { name: "Take down Wicker chair" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Take this item off sale?")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // the sheet closes on the press itself
    expect(withdrawSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Take down Wicker chair" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Take down" }));
    await waitFor(() => expect(withdrawSpy).toHaveBeenCalledWith("i7"));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

/**
 * Deep audit SE-4 (2026-10-28): a claimed FREE item read "Sold" on Selling before anyone picked it up. A free item is
 * claimed, never sold: declutter_claim_free reserves it, declutter_checkout_free moves it to 'sold' with nothing paid
 * (20261027170717), and only the handover makes it 'completed'. Every seller-facing status word comes from
 * sellerStatusLabel; a paid sale still reads "Sold".
 */
describe("Selling tab: a claimed free item is never 'Sold'", () => {
  beforeEach(() => {
    state.offers = [];
    state.cart = [];
  });

  it("free + reserved reads 'Claimed', free + sold 'Claimed · waiting for pickup', a paid sale 'Sold'", async () => {
    state.mine = [
      { ...ITEM, id: "f1", status: "reserved", title: "Free lamp", current_price_cents: 0 },
      { ...ITEM, id: "f2", status: "sold", title: "Free chair", current_price_cents: 0 },
      { ...ITEM, id: "p1", status: "sold", title: "Paid desk", current_price_cents: 3200 },
    ];
    const { container } = at("/declutter?tab=selling");
    await screen.findByText("Paid desk");
    const line = (title: string) => {
      const row = Array.from(container.querySelectorAll("[data-listing-row]")).find((r) => r.textContent?.includes(title))!;
      return row.querySelector("[data-listing-status]")!.textContent;
    };
    expect(line("Free lamp")).toBe("Claimed");
    expect(line("Free chair")).toBe("Claimed · waiting for pickup");
    expect(line("Paid desk")).toBe("Sold");
  });

  it("no seller screen reads a listing's status word straight from STATUS_LABEL (only sellerStatusLabel does)", () => {
    const dirs = ["src/components/declutter", "src/pages/declutter"];
    const files = dirs.flatMap((d) =>
      (readdirSync(join(process.cwd(), d), { recursive: true }) as string[])
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => `${d}/${f}`),
    );
    expect(files.length).toBeGreaterThan(40);
    const offenders = files.filter(
      (f) => f !== "src/components/declutter/declutterUi.tsx" && /\bSTATUS_LABEL\s*\[/.test(blankComments(readFileSync(join(process.cwd(), f), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Deep audit SE-5 (2026-10-28, shot 49b): "Blue enamel mug · Handed over · $40" on a mug that sold for $32. A sold
 * listing's row shows what it sold for (its paid cart line, fetchMySales), and no figure at all while that is
 * unknown, never the list price in its place. An unsold listing keeps its current price.
 */
describe("Selling tab: a sold listing shows what it sold for", () => {
  beforeEach(() => {
    state.offers = [];
    state.cart = [];
  });

  const price = (container: HTMLElement, title: string) => {
    const row = Array.from(container.querySelectorAll("[data-listing-row]")).find((r) => r.textContent?.includes(title))!;
    return row.querySelector("[data-listing-price]")?.textContent ?? null;
  };

  it("sold and handed over: the sold price; live: the current price", async () => {
    state.mine = [
      { ...ITEM, id: "s1", status: "completed", title: "Blue enamel mug", price_cents: 4000, current_price_cents: 4000 },
      { ...ITEM, id: "s2", status: "sold", title: "Oak desk", price_cents: 9000, current_price_cents: 9000 },
      { ...ITEM, id: "s3", status: "live", title: "Floor lamp", price_cents: 2500, current_price_cents: 2000 },
    ];
    state.sales = new Map([["s1", { cents: 3200, orderId: "o1" }], ["s2", { cents: 7500, orderId: "o2" }]]);
    const { container } = at("/declutter?tab=selling");
    await waitFor(() => expect(price(container, "Blue enamel mug")).toBe("$32"));
    expect(price(container, "Oak desk")).toBe("$75");
    expect(price(container, "Floor lamp")).toBe("$20");
  });

  it("a sold listing whose sale price is unknown shows no figure, never its list price", async () => {
    state.mine = [{ ...ITEM, id: "s1", status: "completed", title: "Blue enamel mug", price_cents: 4000, current_price_cents: 4000 }];
    state.sales = new Map();
    const { container } = at("/declutter?tab=selling");
    await screen.findByText("Blue enamel mug");
    await new Promise((r) => setTimeout(r, 50));
    expect(price(container, "Blue enamel mug")).toBeNull();
    expect(container.querySelector("[data-selling-list]")!.textContent).not.toContain("$40");
  });
});

/**
 * Deep audit #60 (2026-10-28, idea 6: "Show the sold price and payout status in Selling"): a sold listing's ONE status
 * line also says where its payout stands, from the seller's own payout row matched by the sale's order
 * (fetchMySales -> order id -> fetchMyPayouts), never a fee figure. A free (claimed) item has no payout words.
 */
describe("Selling tab: a sold listing says where its payout stands", () => {
  beforeEach(() => {
    state.offers = [];
    state.cart = [];
  });

  const statusOf = (container: HTMLElement, title: string) => {
    const row = Array.from(container.querySelectorAll("[data-listing-row]")).find((r) => r.textContent?.includes(title))!;
    return row.querySelector("[data-listing-status]")!.textContent;
  };

  it("paid out (dated), payout pending, sold before the handover, a handed-over sale with no payout row yet, a free claim", async () => {
    const PAID_AT = "2026-10-29T15:00:00Z";
    state.mine = [
      { ...ITEM, id: "a1", status: "completed", title: "Blue enamel mug" },
      { ...ITEM, id: "a2", status: "completed", title: "Oak desk" },
      { ...ITEM, id: "a3", status: "sold", title: "Floor lamp" },
      { ...ITEM, id: "a4", status: "completed", title: "Rocking chair" },
      { ...ITEM, id: "a5", status: "sold", title: "Wicker basket", current_price_cents: 0 },
    ];
    state.sales = new Map([
      ["a1", { cents: 3200, orderId: "o1" }], ["a2", { cents: 7500, orderId: "o2" }], ["a3", { cents: 2000, orderId: "o3" }],
      ["a4", { cents: 5000, orderId: "o4" }], ["a5", { cents: 0, orderId: "o5" }],
    ]);
    state.payouts = [
      { order_id: "o2", items_cents: 7500, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 7500, status: "pending", executed_at: null },
      { order_id: "o1", items_cents: 3200, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 3200, status: "succeeded", executed_at: PAID_AT },
    ];
    const day = new Date(PAID_AT).toLocaleDateString([], { month: "short", day: "numeric" }).replace(/ /g, "\u00a0");
    const { container } = at("/declutter?tab=selling");
    await waitFor(() => expect(statusOf(container, "Blue enamel mug")).toBe(`Handed over · Paid out ${day}`));
    expect(statusOf(container, "Oak desk")).toBe("Handed over · Payout once the sale is final");
    expect(statusOf(container, "Floor lamp")).toBe("Sold · Paid 24 hours after the handover");
    expect(statusOf(container, "Rocking chair")).toBe("Handed over");
    expect(statusOf(container, "Wicker basket")).toBe("Claimed · waiting for pickup");
    // Never a fee figure on the line.
    for (const t of ["Blue enamel mug", "Oak desk", "Floor lamp"]) expect(statusOf(container, t)).not.toMatch(/\$|fee/i);
  });

  // Audit 1b D2-2 (1b-s-order-afterprob-p1-1440): the row said "Sold · Paid 24 hours after the handover" while a
  // problem held the money. The row reads the order's open problem by the sale's order id.
  // @mutate src/components/declutter/DeclutterHomeView.tsx | listingStatusLine(item, sales.data?.get(item.id)?.cents, payoutOf(item.id), problemOn(item.id)) | listingStatusLine(item, sales.data?.get(item.id)?.cents, payoutOf(item.id))
  it("an open problem: the sold row says the money is held; another sale's row is unchanged (D2-2)", async () => {
    state.mine = [{ ...ITEM, id: "a3", status: "sold", title: "Floor lamp" }, { ...ITEM, id: "a6", status: "sold", title: "Side table" }];
    state.sales = new Map([["a3", { cents: 2000, orderId: "o3" }], ["a6", { cents: 2500, orderId: "o6" }]]);
    state.payouts = [];
    state.problems = [{ id: "p1", order_id: "o3", reporter_side: "buyer", reason: "damaged" }];
    const { container } = at("/declutter?tab=selling");
    await waitFor(() => expect(statusOf(container, "Floor lamp")).toBe("Sold · Held while Louisiana Helpr looks at a problem"));
    expect(statusOf(container, "Side table")).toBe("Sold · Paid 24 hours after the handover");
    state.problems = [];
  });

  it("every payout status has words; a free item or an unread sale has none", async () => {
    const { soldPayoutWords } = await import("@/lib/declutter/soldPayout");
    const day = () => "Oct 29";
    const statuses = ["succeeded", "pending", "failed", "nothing_due"] as const;
    expect(statuses.length).toBeGreaterThan(3);
    for (const st of statuses) expect(soldPayoutWords("completed", 3200, { status: st, executed_at: "2026-10-29T15:00:00Z" }, day), st).toBeTruthy();
    expect(soldPayoutWords("completed", 3200, { status: "succeeded", executed_at: "2026-10-29T15:00:00Z" }, day)).toBe("Paid out Oct 29");
    expect(soldPayoutWords("completed", 3200, { status: "failed", executed_at: null }, day)).toBe("Payout didn't go through yet");
    expect(soldPayoutWords("completed", 0, { status: "nothing_due", executed_at: null }, day)).toBeNull();
    expect(soldPayoutWords("sold", 0, null, day)).toBeNull();
    expect(soldPayoutWords("completed", undefined, null, day)).toBeNull();
  });

  // Audit 1b D2-2: the listing row said "Sold · Paid 24 hours after the handover" while a problem held the money.
  // @mutate src/lib/declutter/soldPayout.ts |   if (problemOpen && payout?.status !== "succeeded") return | if (false) return
  it("an open problem: the row says the money is held, until it was paid out (D2-2)", async () => {
    const { soldPayoutWords } = await import("@/lib/declutter/soldPayout");
    const day = () => "Oct 29";
    const held = "Held while Louisiana Helpr looks at a problem";
    expect(soldPayoutWords("sold", 3200, null, day, true)).toBe(held);
    expect(soldPayoutWords("completed", 3200, { status: "pending", executed_at: null }, day, true)).toBe(held);
    expect(soldPayoutWords("completed", 3200, { status: "succeeded", executed_at: "2026-10-29T15:00:00Z" }, day, true)).toBe("Paid out Oct 29");
    expect(soldPayoutWords("sold", 0, null, day, true)).toBeNull();
    expect(soldPayoutWords("sold", 3200, null, day)).toBe("Paid 24 hours after the handover");
  });
});
