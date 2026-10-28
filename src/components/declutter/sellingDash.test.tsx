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
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                     data-listing-status={item.status}\n |                     data-listing-status={item.status}>{STATUS_LABEL[item.status]}</p><p data-listing-status={item.status}\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |                 <ListingThumb path={thumb} category={item.category} />\n |
 * @mutate src/components/declutter/DeclutterTabParts.tsx | <div data-seller-empty="" | <div data-plain=""
 * @mutate src/components/declutter/SellItForMe.tsx |     ? "flex min-h-14 w-full items-center | ? "rounded-full flex min-h-14 w-full items-center
 * @mutate src/components/declutter/DeclutterHomeView.tsx |             <MyListingsView userId={userId} haulOn={haulOn} />\n |             <MyListingsView userId={userId} haulOn={haulOn} />\n            <BundleDiscountCard />\n
 * @mutate src/components/declutter/DeclutterHomeView.tsx |           <PickupTimesCard userId={userId} />\n |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  mine: [] as unknown[],
  offers: [] as unknown[],
  cart: [] as unknown[],
};

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
  fetchPhotos: async () => [{ id: "p1", item_id: "i1", storage_path: "u1/i1/a.jpg", position: 0 }],
  fetchDropStates: async () => new Map(),
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: async () => undefined,
  fetchMyCard: async () => ({ brand: "visa", last4: "4242" }),
  fetchMyActiveStrikes: async () => 0,
  fetchMyOffers: async () => state.offers,
  fetchMyCart: async () => state.cart,
  fetchMyPickupWindows: async () => [{ weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" }],
  setPickupWindows: async () => 1,
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
