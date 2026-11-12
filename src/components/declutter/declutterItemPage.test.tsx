/**
 * The photo-first Declutter item page (owner, 2026-10-19: Facebook Marketplace /
 * OfferUp / Mercari): the swipeable gallery with dots and a full-screen viewer,
 * the category tint when there is no photo, the seller card (stars only with
 * reviews, "Joined <month year>", no invented response time), Share with the
 * item's own link, and the phone's buy bar while the in-page buttons are off
 * screen. The API is stubbed: these check what each state renders.
 *
 * @mutate src/components/declutter/DeclutterGallery.tsx |   if (urls.length === 0) { |   if (false) {
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const boughtByMe = !ownListing && !forSale; |   const boughtByMe = false;
 * @mutate src/components/declutter/DeclutterItemView.tsx | readTimes={forSale && !!user} | readTimes={!!user}
 *   DA-6 (Declutter audit 2026-10-30): the buyer's own sold item says "You bought this." / "You claimed this." with
 *   Buying, asks no item pickup times (that read answers only while it is for sale) and no "shared after you pay".
 * @mutate src/components/declutter/DeclutterGallery.tsx |               onClick={() => setOpen(i)} |               onClick={() => undefined}
 * @mutate src/components/declutter/DeclutterGallery.tsx |             if (el.clientWidth > 0) setAt(Math.round(el.scrollLeft / el.clientWidth)); |             void el;
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |             {reviews > 0 && (\n              <span data-seller-rating | {true && (\n              <span data-seller-rating
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |             {joined && <span className="block text-xs text-muted-foreground">{joined}</span>} |
 * F359d (owner 11-11): "12 pickups" on the member and guest seller cards; none at 0.
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |             {pickupCount > 0 && <span data-seller-pickups | {false && <span data-seller-pickups
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |             {pickupCount > 0 && <span data-seller-pickups | {pickupCount >= 0 && <span data-seller-pickups
 * @mutate src/components/declutter/DeclutterGuest.tsx |         {c.pickups > 0 && <span data-guest-seller-pickups | {false && <span data-guest-seller-pickups
 * @mutate src/lib/declutter/api.ts | idChecked: row.id_checked === true, pickups: pickupCount(row.pickup_count) }; | idChecked: row.id_checked === true, pickups: 0 };
 * @mutate src/components/declutter/DeclutterShareCard.tsx |   void shareNative({ title: it.title, text: shareText(it), url: listingLink(it.id) }); |   void shareNative({ title: it.title, text: shareText(it), url: getPublicOrigin() });
 * @mutate src/components/ui/StickyActionBar.tsx | className="fixed inset-x-0 bottom-0 z-40 border-t | className="inset-x-0 bottom-0 z-40 border-t
 * @mutate src/components/ui/StickyActionBar.tsx |   useDockYield(active && phone); |   void phone;
 * @mutate src/lib/declutter/api.ts |   const row = pickRequestedProfile(rows, sellerId) | const row = rows[0]
 * @mutate src/components/declutter/DeclutterItemView.tsx |       phoneHidesTitle\n |
 * @mutate src/components/PageHeader.tsx | phoneHidesTitle ? " max-sm:sr-only" : ""} | phoneHidesTitle ? "" : ""}
 * @mutate src/components/AppPage.tsx | rightSlot={titleActions} phoneHidesTitle={phoneHidesTitle} hidesTitle={hidesTitle} | rightSlot={titleActions} hidesTitle={hidesTitle}
 * DA-9 (Declutter audit 2026-10-30): back, share and heart stay pinned on the item page while it scrolls.
 * @mutate src/components/declutter/DeclutterItemView.tsx |       stickyHeader\n    > |     >
 * @mutate src/components/AppPage.tsx | data-own-title-row={stickyHeader ? "" : undefined} | data-own-title-row={undefined}
 * @mutate src/components/AppPage.tsx | hidesTitle={hidesTitle} sticky={stickyHeader} wrapTitle={wrapTitle} /> | hidesTitle={hidesTitle} wrapTitle={wrapTitle} />
 * @mutate src/components/profile/ProfileTabHeader.tsx | "sticky-title-row sticky top-[calc(-1*var(--shell-gap))] z-40 -mx-3 px-3 -mb-[var(--section-gap)]" | "sticky-title-row -mx-3 px-3 -mb-[var(--section-gap)]"
 * @mutate src/components/PageHeader.tsx |             {stickyTitle && phoneHidesTitle && ( |             {false && (
 * @mutate src/components/profile/ProfileTabHeader.tsx |         phoneHidesTitle={phoneHidesTitle}\n |
 * @mutate src/lib/declutter/api.ts |       .select(cols)\n      .eq("seller_id", sellerId) |       .select(cols)\n      .neq("seller_id", "")
 * @mutate src/lib/declutter/api.ts |       .neq("seller_id", sellerId) |       .neq("seller_id", "")
 * @mutate src/components/declutter/DeclutterItemRows.tsx | (rows ?? []).filter((r) => r.seller_id !== viewerId) | (rows ?? [])
 * @mutate src/components/declutter/DeclutterItemRows.tsx |       {moreRows.length > 0 && <Row |       {<Row
 * @mutate src/components/declutter/DeclutterItemView.tsx |       {!isSeller && afterPaint && (\n        <div className="mt-8"> |       {afterPaint && (\n        <div className="mt-8">
 * @mutate src/components/declutter/DeclutterItemView.tsx |             {drop && ( | {false && (
 * @mutate src/components/declutter/DeclutterItemView.tsx | lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} mine={isSeller} /> | lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} />
 * @mutate src/components/declutter/DeclutterItemView.tsx | const drop = planned && !(sellerState && sellerStateStopsDrops(sellerState, it.current_price_cents)) ? planned : null; | const drop = planned;
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const planned = dropState.data ? nextPriceDrop({ ...it, ...dropState.data }) : null; |   const planned = { at: new Date(), lowestCents: it.current_price_cents - 200, pct: 5 };
 * @mutate src/components/declutter/DeclutterBundleRow.tsx | (r) => r.status === "live" && r.seller_id !== viewerId | (r) => r.seller_id !== viewerId
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |   const full = (more.data?.length ?? 0) >= 12; |   const full = false;
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |   if (!enabled \|\| buyable.length === 0 \|\| card.isLoading) return null; |   if (!enabled \|\| card.isLoading) return null;
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const isSeller = ownListing && !preview; |   const isSeller = ownListing;
 * Tester 5, 10-30: pressing Buy now in the preview showed nothing, because toast.info renders nothing in the app.
 * Audit 11-10 F359f: the owner's item page shows the open trade offer for it with Accept / Decline.
 * @mutate src/components/declutter/DeclutterItemView.tsx |           {isSeller && user && it.status === "live" && it.accepts_trades === true && <Suspense fallback={null}><ItemTradeOffers itemId={it.id} userId={user.id} /></Suspense>}\n |
 * @mutate src/components/declutter/DeclutterTradeOffers.tsx | (t) => t.status === "open" && t.item?.id === itemId | (t) => t.status === "open"
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const noteOwnListing = () => setPreviewPressed(true); |   const noteOwnListing = () => toast.info(PREVIEW_ACTION_NOTE);
 * @mutate src/components/declutter/DeclutterItemView.tsx |               onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); noteOwnListing(); }} |               onClickCapture={() => noteOwnListing()}
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  manageReads: 0,
  soldReads: 0,
  buys: 0,
  item: null as unknown,
  photos: [] as unknown[],
  rating: { avg: 4.8, count: 12 } as { avg: number; count: number } | null,
  /** F359d: the seller's completed pickups (declutter_seller_pickup_count). */
  pickups: 7,
  seller: { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" } as unknown,
  tags: [] as string[][],
  safeRows: [] as unknown[],
  more: [] as unknown[],
  similar: [] as unknown[],
  liveCount: null as number | null,
  newest: [] as unknown[],
  sold: null as { title: string; photo_id: string | null } | null,
  questions: [] as unknown[],
  tableRows: [] as unknown[],
  drop: null as unknown,
  manage: null as unknown,
  reads: 0,
  geo: { status: "idle" } as unknown,
  handovers: null as string[] | null,
  /** Audit 11-10 F359f: the member's trade offers (both sides read the same mock). */
  trades: [] as unknown[],
};
const calls: [string, unknown[]][] = [];
const GUEST_CARD: { display_name: string; avg_rating: number | null; review_count: number; id_checked: boolean; pickup_count?: number } = { display_name: "Dana R.", avg_rating: 4.5, review_count: 2, id_checked: true, pickup_count: 12 };
const guestCard = { row: { ...GUEST_CARD } };
// A PostgREST builder that records each call and resolves to state.tableRows.
const builder: object = new Proxy({}, {
  get: (_t, k) =>
    k === "then"
      ? (res: (v: unknown) => void) => res({ data: state.tableRows, error: null })
      : (...a: unknown[]) => { calls.push([String(k), a]); return builder; },
});
const shared: unknown[] = [];

// BUY-16: `guest.on` signs the visitor out (useFeature is false signed out, as the real hook); `guest.open` is the
// landing's features_open_to_everyone answer (null = still loading).
const guest = { on: false, open: ["declutter"] as string[] | null };
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => !guest.on, useFeatureStatus: () => ({ on: !guest.on, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: guest.on ? null : { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: guest.on ? null : { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/components/landing/useSectionsOpen", async () => ({
  ...(await vi.importActual<object>("@/components/landing/useSectionsOpen")),
  useSectionsOpen: () => (guest.open === null ? { open: null, settled: false } : { open: new Set(guest.open), settled: true }),
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => state.geo,
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
}));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children, titleActions, phoneHidesTitle, hidesTitle, stickyHeader }: { title: string; children: React.ReactNode; titleActions?: React.ReactNode; phoneHidesTitle?: boolean; hidesTitle?: boolean; stickyHeader?: boolean }) => (
    <main data-sticky-header={stickyHeader ? "" : undefined}>
      <h1 data-phone-hides-title={phoneHidesTitle ? "" : undefined} data-hides-title={hidesTitle ? "" : undefined}>{title}</h1>
      {titleActions}
      {children}
    </main>
  ),
}));
vi.mock("@/lib/nativeShare", () => ({ shareNative: async (c: unknown) => { shared.push(c); return "shared"; } }));
vi.mock("@/lib/authRedirects", async () => ({
  ...(await vi.importActual<object>("@/lib/authRedirects")),
  getPublicOrigin: () => "https://www.louisianahelpr.com",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    // The pickup-times, pickup-places and bundle reads answer their own shapes: no windows, no places (so the usual
    // times are the item's pickup times, ItemHandoverTimes), no discountable items. Without its own answer the places
    // read got the seller-card rows an earlier case left in state.safeRows, and DA-6 lost its pickup-times read.
    rpc: async (fn: string) => {
      calls.push(["rpc", [fn]]);
      return fn === "declutter_item_pickup_windows" || fn === "declutter_item_pickup_places" || fn === "declutter_bundle_applies"
        ? { data: [], error: null }
        : fn === "declutter_guest_seller_first_name"
          ? { data: "Dana", error: null }
          : fn === "declutter_guest_seller_card"
            // F227/F319: the server's four fields, exactly (20261111205821).
            ? { data: [guestCard.row], error: null }
            : { data: state.safeRows, error: null };
    },
    from: (t: string) => { calls.push(["from", [t]]); return builder; },
  },
}));
vi.mock("@/lib/declutter/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/declutter/api")>("@/lib/declutter/api");
  return {
    ...real,
    fetchSellerCardReal: real.fetchSellerCard,
    fetchSellerItemsReal: real.fetchSellerItems,
    fetchSimilarItemsReal: real.fetchSimilarItems,
    fetchSellerItems: async () => state.more,
    fetchSimilarItems: async () => state.similar,
    fetchSellerLiveCount: async () => state.liveCount,
    fetchNewestItems: async () => state.newest,
    fetchSoldItemCard: async () => { state.soldReads++; return state.sold; },
    fetchItem: async () => state.item,
    fetchItemHandovers: async () => state.handovers,
    fetchItemDropState: async () => { state.reads++; return state.drop; },
    fetchManageState: async () => { state.reads++; state.manageReads++; return state.manage; },
    fetchPhotos: async () => state.photos,
    fetchQuestions: async () => state.questions,
    fetchWatching: async () => new Set(),
    fetchMyItemReview: async () => null,
    fetchSellerRating: async () => state.rating,
    fetchSellerPickupCount: async () => state.pickups,
    fetchSellerCard: async () => state.seller,
    fetchSellerReviewTags: async () => state.tags,
    fetchMyCard: async () => null,
    photoPublicUrl: (p: string) => `https://unit-test.invalid/storage/v1/object/public/job-photos/${p}`, photoCardUrl: (p: string) => `https://unit-test.invalid/storage/v1/object/public/job-photos/${p}`, CARD_PHOTO_PX: 480,
    setWatch: async () => "watching",
    askQuestion: async () => "q",
    answerQuestion: async () => "a",
    makeOffer: async () => "o",
    buyNow: async () => { state.buys++; return "l"; },
    startCardSave: async () => "https://stripe",
  };
});
vi.mock("@/lib/declutter/trades", async () => ({
  ...(await vi.importActual<typeof import("@/lib/declutter/trades")>("@/lib/declutter/trades")),
  fetchMyTrades: async () => state.trades,
}));
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));

import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { ROWS_NEAR_MARGIN } from "./DeclutterItemRows";
import PageHeader from "@/components/PageHeader";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import * as api from "@/lib/declutter/api";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ITEM = {
  id: ID, seller_id: "u2", status: "live", title: "Oak rocking chair", description: "Solid oak.",
  category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null, porch_ok: true,
};

function open(search = "", id = ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/declutter/item/${id}${search}`]}>
        <Routes>
          <Route path="/declutter/item/:id" element={<DeclutterItemPage />} />
          <Route path="/login" element={<p>LOGIN WALL</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the photo-first Declutter item page", () => {
  beforeEach(() => {
    state.item = { ...ITEM };
    state.questions = [];
    state.handovers = null;
    guest.on = false;
    guest.open = ["declutter"];
    state.geo = { status: "idle" };
    state.photos = [];
    state.rating = { avg: 4.8, count: 12 };
    state.pickups = 7;
    state.seller = { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" };
    state.tags = [];
    shared.length = 0;
    state.more = [];
    state.similar = [];
    state.liveCount = null;
    state.newest = [];
    state.sold = null;
    state.drop = null;
    state.manage = null;
    state.trades = [];
    calls.length = 0;
    guestCard.row = { ...GUEST_CARD };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Owner 11-11 F229: a protection line under a paid price, naming porch pickup only where the listing offers it.
  // @mutate src/components/declutter/DeclutterItemView.tsx | {it.current_price_cents > 0 && !isSeller && ( |  {false && (
  // @mutate src/components/declutter/DeclutterItemView.tsx | ${it.porch_ok !== false ? ", pick up from the porch" : ""} | , pick up from the porch
  it("F229: a paid listing says what protects the buyer; porch only where it is offered; none on a free item", async () => {
    const { unmount } = open();
    expect((await screen.findByText(/^Protected:/)).textContent).toBe("Protected: pay in the app, pick up from the porch, 24 hours to report a problem.");
    unmount();
    state.item = { ...ITEM, porch_ok: false };
    const second = open();
    expect((await screen.findByText(/^Protected:/)).textContent).toBe("Protected: pay in the app, 24 hours to report a problem.");
    second.unmount();
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0 };
    open();
    await screen.findByText("Oak rocking chair", { selector: "h2" });
    expect(screen.queryByText(/^Protected:/)).toBeNull();
  });

  it("three photos: one full-width track, a counter and dots that follow the swipe, and a tap opens the full-screen viewer", async () => {
    state.photos = [0, 1, 2].map((i) => ({ id: `p${i}`, item_id: ID, storage_path: `a/${i}.jpg`, position: i }));
    open();
    const track = await screen.findByRole("group", { name: "Photos of Oak rocking chair" });
    expect(within(track).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-gallery-dots] > button")).toHaveLength(3);
    // A swipe to the second photo moves the counter and the active dot.
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    track.scrollLeft = 300;
    fireEvent.scroll(track);
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-gallery-dots] > button")[1]).toHaveAttribute("data-dot-active");
    // F060 (UI audit 11-09): each dot is a button that shows its photo (the way back to photo 1 with a mouse).
    // @mutate src/components/declutter/DeclutterGallery.tsx |  onClick={() => go(i)} /> |  />
    fireEvent.click(screen.getByRole("button", { name: "Show photo 1 of 3" }));
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 1 of 3" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show photo 2 of 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Open photo 2 of 3 full screen" }));
    expect(await screen.findByRole("dialog", { name: "Photo viewer" })).toBeInTheDocument();
  });

  // D5 (Cowork audit 2026-10-20; HELPR-DESIGN-SPEC): an item's condition is a
  // word chip, never stars. Stars only ever mean a person's rating. The class:
  // no star icon and no "N stars" text in the price-and-condition block, and no
  // screen in src writes a condition as "N stars".
  // @mutate src/components/declutter/DeclutterItemView.tsx | <ConditionChip stars={it.condition_stars} /> | <span aria-label="4 of 5 stars"><svg className="lucide-star" /></span>
  // Audit #47 (2026-10-21): each fact once, one heading style. The condition is the chip only (no Details row
  // repeating it); owner mockup 11-01: the title is painted once at every width, in the item column beside Save and
  // Share, and the header's h1 is for screen readers only (hidesTitle); Questions is a sentence-case head.
  // @mutate src/components/declutter/DeclutterItemView.tsx |       hidesTitle\n |
  // @mutate src/components/PageHeader.tsx | ${hidesTitle ? " sr-only" : phoneHidesTitle | ${hidesTitle ? "" : phoneHidesTitle
  // @mutate src/components/declutter/DeclutterQuestions.tsx | <h2 id="declutter-questions" className="text-base font-semibold"> | <h2 id="declutter-questions" className="text-ds-13 font-semibold uppercase tracking-wider text-muted-foreground">
  it("audit #47: the condition is said once, the title once per width, and Questions is a sentence-case head", async () => {
    open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(screen.getAllByText(/Lightly used/).length).toBe(1);
    const title = document.querySelector("[aria-label='Price and condition'] h2")!;
    expect(title.textContent).toBe("Oak rocking chair");
    expect(title.className.split(/\s+/)).not.toContain("lg:sr-only");
    expect(title.parentElement!.querySelector("[data-item-save-share]")).not.toBeNull();
    // The header's h1 is not painted at any width (the page paints the title once, here).
    expect(document.querySelector("h1")).toHaveAttribute("data-hides-title");
    const q = await screen.findByRole("heading", { name: /^Questions/ });
    expect(q.className.split(/\s+/)).not.toContain("uppercase");
  });

  it("A3-48 (owner 11-01 11:49 AM): Helpr delivery priced BY SIZE, this item's size marked, never an all-in total; never on a free item or your own", async () => {
    // @mutate src/components/declutter/DeclutterItemView.tsx | askSignal={offerAsk} footer={deliveredLine} /> | askSignal={offerAsk} />
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx |       {footer}\n |
    // @mutate src/components/declutter/DeclutterItemView.tsx |       <DeliveryPriceList quote={null} size={it.delivery_size} /> |       <DeliveryPriceList quote={null} />
    // @mutate src/components/declutter/DeliveryPriceList.tsx |           const mine = (quote?.size ?? size) === r.size; |           const mine = quote?.size === r.size;
    // A $40 large chair: the list says "Large +$20" marked, not "$70.20" (which was Buy now plus the delivery floor).
    const first = open();
    const line = await waitFor(() => {
      const el = document.querySelector("[data-item-delivered]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // Owner mockup 11-01: the line sits under the two buttons, inside their card.
    expect(line.querySelector("p")?.textContent).toBe("Or a local Helpr delivers it, priced by size:");
    const rows = [...line.querySelectorAll("[data-delivery-size]")].map((r) => r.textContent);
    expect(rows).toEqual(["Small or medium$6 + $1.50 a mile", "Large+$20", "Extra large+$40"]);
    expect(line.querySelector("[aria-current='true']")?.getAttribute("data-delivery-size")).toBe("large");
    expect(line.textContent).not.toContain("$70.20");
    expect(line.closest("[aria-label='Buy or make an offer']")).not.toBeNull();
    expect(line.textContent).not.toMatch(/fee|%|¢/i);
    first.unmount();
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0 };
    const second = open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(document.querySelector("[data-item-delivered]")).toBeNull();
    second.unmount();
    state.item = { ...ITEM, seller_id: "u1" };
    open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(document.querySelector("[data-item-delivered]")).toBeNull();
  });

  // Audit DC-7: the seller's own item page used the buyer's words ("after you pay") and said "About 52 mi away".
  // @mutate src/components/declutter/DeclutterItemView.tsx |   const away = ownListing ? null : milesLabel( |   const away = milesLabel(
  // @mutate src/components/declutter/DeclutterItemView.tsx |             isSeller={isSeller}\n            showAddressNote | isSeller={false}\n            showAddressNote
  it("the seller's own page: no distance, and owner words about the address (DC-7)", async () => {
    state.geo = { status: "ready", lat: 30.0, lng: -90.0, approximate: false };
    const buyer = open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(document.querySelector("[data-item-where]")?.textContent).toMatch(/mi away/);
    expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("Exact address after you pay");
    buyer.unmount();
    state.item = { ...ITEM, seller_id: "u1" };
    open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(document.querySelector("[data-item-where]")?.textContent).not.toMatch(/mi away|miles?/);
    expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("Buyers see your exact address only after they pay");
    expect(document.body.textContent).not.toMatch(/after you pay/);
    state.geo = { status: "idle" };
  });

  // Audit 11-10 F359d: the giver of a free item reads who sees the address in giver words, not "buyers ... picked".
  // @mutate src/components/declutter/ItemPickupBlock.tsx | "they'll see your exact address only once you pick them" | "buyers see your exact address only once they're picked"
  it("F359d: the giver's own free item says they'll see the address once you pick them", async () => {
    state.item = { ...ITEM, seller_id: "u1", price_cents: 0, current_price_cents: 0 };
    open();
    await waitFor(() => expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("They'll see your exact address only once you pick them"));
  });

  // Deep audit #23: a free item is claimed, never offered on; its page must not end with "Make an offer".
  // @mutate src/components/declutter/DeclutterItemView.tsx | canAsk={canAct && !preview} preview={preview} free={free} onMakeOffer={ | canAsk={canAct && !preview} preview={preview} onMakeOffer={
  it("a free item's page never says 'Make an offer'; a priced one keeps the line", async () => {
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0 };
    const free = open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(await screen.findByText(/Everyone can see questions and answers/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Make an offer/);
    free.unmount();
    state.item = { ...ITEM };
    open();
    expect((await screen.findByText(/Want to make a deal\?/)).textContent).toMatch(/Want to make a deal\? Make an offer\.$/);
  });

  // AUD31-15: the hint's "Make an offer" was plain words; it opens the offer box, as the panel's own button does.
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |     if (askSignal === 0 \|\| offersOff) return; |     return;
  // @mutate src/components/declutter/DeclutterItemView.tsx | onMakeOffer={() => setOfferAsk((n) => n + 1)} | onMakeOffer={() => undefined}
  it("the Questions hint's Make an offer opens the offer box", async () => {
    state.item = { ...ITEM };
    const { container } = open();
    const hint = await waitFor(() => {
      const b = container.querySelector<HTMLButtonElement>("[data-question-make-offer]");
      expect(b).not.toBeNull();
      return b!;
    });
    const panelButton = () => within(screen.getByRole("region", { name: "Buy or make an offer" })).getByRole("button", { name: "Make offer" });
    await waitFor(() => expect(panelButton()).toBeEnabled());
    expect(panelButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(hint);
    await waitFor(() => expect(panelButton()).toHaveAttribute("aria-expanded", "true"));
  });

  it("one filled button on a buyer's item page: Buy now (Ask is an outline beside its question box)", async () => {
    // @mutate src/components/declutter/DeclutterQuestions.tsx | <Button type="submit" variant="outline" className="h-auto shrink-0" | <Button type="submit" className="h-auto shrink-0"
    // Counted by the filled class inside the page (jsdom draws no CSS; the 375/1440 WebKit shots measured the same:
    // ~/.lh-shots/declutter-audit-1028/measure-*.json "primaries"). Owner pick 1 (11-08): the sticky bar is the one place
    // Buy now shows (in the page at this width, fixed on a phone), never a second copy.
    state.item = { ...ITEM };
    const { container } = open();
    await screen.findByRole("button", { name: /^Buy now/ });
    await screen.findByRole("button", { name: "Ask" });
    const filled = [...container.querySelectorAll("button.btn-grad-primary, a.btn-grad-primary")].map((b) => (b.textContent ?? "").trim());
    expect(filled.length, JSON.stringify(filled)).toBe(1);
    expect(filled[0]).toBe("Buy now");
  });

  // Owner 11-07 (lead: no new messaging path; Declutter has no messaging before a sale): asking the seller focuses the
  // public Questions box on the same page. Owner pick 1 (11-08): that Message button moved to the seller row.
  // @mutate src/components/declutter/DeclutterItemView.tsx |     box?.focus({ preventScroll: true }); |     void box;
  // @mutate src/components/declutter/DeclutterSellerCard.tsx |   return <div data-seller-row="" className="flex items-center gap-2">{link}{action}</div>; |   return link;
  it("owner pick 1 (11-08): Message sits on the seller row and focuses the public Questions box", async () => {
    state.item = { ...ITEM };
    open();
    const ask = await screen.findByRole("button", { name: "Message the seller" });
    expect(ask.closest("[data-seller-row]")).not.toBeNull();
    expect(ask.closest("a")).toBeNull();
    expect(ask.closest("[data-declutter-buybar]")).toBeNull();
    await screen.findByRole("button", { name: "Ask" });
    fireEvent.click(ask);
    expect(document.activeElement?.id).toBe("declutter-question");
  });

  it("D5: the condition is a word chip ('Lightly used'), never stars", async () => {
    open();
    const block = await screen.findByRole("region", { name: "Price and condition" });
    const chip = block.querySelector("[data-condition-chip]");
    expect(chip?.textContent).toBe("Condition: Lightly used");
    expect(block.querySelector("svg.lucide-star")).toBeNull();
    expect(block.textContent).not.toMatch(/\bstars?\b/i);
    const { readFileSync } = await import("node:fs");
    const { walkSource, readSource } = await import("@/test/helpers/walkSource");
    const { blankComments } = await import("@/test/helpers/blankNonCode");
    const { join, resolve } = await import("node:path");
    const files = walkSource([join(resolve(__dirname, "..", "..", ".."), "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const starred = files.filter((f) => /\}\s*stars:|\$\{\w+\} stars:|\bConditionStars\b/.test(blankComments(readSource(f) ?? readFileSync(f, "utf8"))));
    expect(starred).toEqual([]);
  });

  it("no photos: the category tint, never a blank box, and no dots", async () => {
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    expect(document.querySelector("[data-gallery-empty] [data-photo-placeholder]")).not.toBeNull();
    expect(document.querySelector("[data-gallery-dots]")).toBeNull();
  });

  it("Q2265 seller card: what buyers said most, from visible reviews; nothing when no review has a tag", async () => {
    // @mutate src/components/declutter/DeclutterSellerCard.tsx | {top.length > 0 && ( | {false && (
    state.tags = [["as_described", "easy_pickup"], ["as_described"], []];
    const { unmount } = open();
    await waitFor(() => expect(document.querySelector("[data-seller-tags]")?.textContent).toBe("As described (2) · Easy pickup (1)"));
    unmount();
    state.tags = [[], []];
    open();
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-tags]")).toBeNull();
  });

  it("seller card: First L., stars and joined date; a seller with no reviews shows no stars and no 'No reviews yet'", async () => {
    const { unmount } = open();
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(screen.getByText("Joined March 2025")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-rating]")?.textContent).toContain("12 reviews");
    expect(screen.getByRole("link", { name: /^See the seller,\s*Dana R\./ })).toHaveAttribute("href", "/user/u2");
    // F359d (owner 11-11): the completed pickup count, words and number only.
    expect((await vi.waitFor(() => document.querySelector("[data-seller-pickups]")!))?.textContent).toBe("7 pickups");
    unmount();
    state.rating = { avg: 0, count: 0 };
    state.pickups = 0;
    open();
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-rating]")).toBeNull();
    // No pickups yet: no line at all (never "0 pickups").
    expect(document.querySelector("[data-seller-pickups]")).toBeNull();
    expect(screen.queryByText(/^\d+ pickups?$/)).toBeNull();
    expect(screen.queryByText(/No reviews yet/)).toBeNull();
    // Messages open after checkout: the one pre-purchase "Message the seller" (owner pick 1, 11-08) is a button that
    // opens the PUBLIC Questions box, never a link into private messages.
    expect(screen.getAllByRole("button", { name: /message/i }).map((b) => b.getAttribute("aria-label"))).toEqual(["Message the seller"]);
    expect(screen.queryByRole("link", { name: /message/i })).toBeNull();
  });

  it("the seller card's read never shows another person's row (get_safe_profiles also answers profile ids)", async () => {
    const real = (api as unknown as { fetchSellerCardReal: typeof api.fetchSellerCard }).fetchSellerCardReal;
    state.safeRows = [{ user_id: "someone-else", profile_id: "u2", full_name: "Wrong Person", avatar_url: null, created_at: null }];
    expect(await real("u2")).toBeNull();
    state.safeRows = [{ user_id: "u2", profile_id: "x", full_name: "Dana Robichaux", avatar_url: "https://a/b.jpg", created_at: "2025-03-10T12:00:00Z" }];
    expect(await real("u2")).toEqual({ name: "Dana Robichaux", avatarUrl: "https://a/b.jpg", joinedAt: "2025-03-10T12:00:00Z" });
  });

  it("Share sends the item's own link, title and price", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Share this item" }));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]).toMatchObject({ title: "Oak rocking chair", url: `https://www.louisianahelpr.com/declutter/item/${ID}` });
    expect((shared[0] as { text: string }).text).toContain("$40");
  });

  // Owner pick 1 (11-08): on a phone Make offer and Buy now ride in ONE bar fixed on the bottom edge, from the first
  // screen (no inline copy above it, no wait for the buttons to scroll away), and the dock steps aside.
  // @mutate src/components/ui/StickyActionBar.tsx |   useDockYield(active && phone); |   useDockYield(false);
  // @mutate src/components/ui/StickyActionBar.tsx |   if (!phone) { |   if (true) {
  it("phone: Make offer and Buy now ride in one bar on the bottom edge from the first screen, and the dock steps aside", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...real(query), matches: query.includes("max-width: 639px") })) as typeof window.matchMedia;
    try {
      const { container } = open();
      const bar = await waitFor(() => {
        const el = document.body.querySelector("[data-declutter-buybar]") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(bar.className).toContain("bottom-0");
      expect(bar.className).toContain("fixed");
      // Portaled to <body>: outside the page, so no transformed ancestor places it.
      expect(container.contains(bar)).toBe(false);
      await waitFor(() => expect(document.documentElement.classList.contains("dock-yield")).toBe(true));
      expect(within(bar).getByRole("button", { name: "Buy now" })).toBeInTheDocument();
      expect(within(bar).getByRole("button", { name: "Make offer" })).toBeInTheDocument();
      // ONE set of buttons: none left in the page.
      expect(screen.getAllByRole("button", { name: "Buy now" })).toHaveLength(1);
    } finally {
      window.matchMedia = real;
    }
  });
  // Q2560 (Auditor 1, audit 1102a): a free item gets the same pinned bar, with its one "Ask for it" button.
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |   const askBarShown = useOffScreen(askButton) && item.status === "live" && !underAge && !myAsk; |   const askBarShown = false;
  // @mutate src/components/declutter/DeclutterFreeClaim.tsx |   useDockYield(askBarShown); |   void askBarShown;
  it("phone: a free item's Ask for it rides in the same bottom bar once its button is off screen (Q2560)", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() { this.cb([{ isIntersecting: false }]); }
        disconnect() {}
      },
    );
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0 };
    open();
    await screen.findAllByRole("button", { name: "Ask for it" });
    const bar = await waitFor(() => {
      const el = document.body.querySelector("[data-declutter-askbar]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(bar.className).toContain("bottom-0");
    expect(within(bar).getByRole("button", { name: "Ask for it" })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.classList.contains("dock-yield")).toBe(true));
    // A paid item's bar is not drawn for a free item.
    expect(document.body.querySelector("[data-declutter-buybar]")).toBeNull();
  });
  // Audit 1030 DB-14: at 375 the in-page Buy now sat in the strip behind the dock, and the observer counted that strip
  // as on screen, so the bar never came and Buy now stayed hidden. The strip the dock covers is cut off the observed
  // screen, and a group only partly clear of it still gets the bar (local repro 375x900: before no bar, after bar
  // 827-900 with the dock hidden; ~/.lh-shots/b96/db14).
  // @mutate src/components/declutter/useOffScreen.ts |       { rootMargin: `0px 0px -${dockCoverPx()}px 0px`, threshold: [0, 0.99] }, |       { threshold: [0, 0.99] },
  // @mutate src/components/declutter/useOffScreen.ts |       ([entry]) => setOff(!entry.isIntersecting \|\| (entry.intersectionRatio ?? 1) < 0.99), |       ([entry]) => setOff(!entry.isIntersecting),
  it("DB-14: the strip behind the dock does not count as on screen, and a button only partly clear of it still gets the bar (free item's Ask for it; a paid item's bar is always shown since owner pick 1, 11-08)", async () => {
    const dock = document.createElement("div");
    dock.className = "mobile-nav-frame";
    dock.getBoundingClientRect = () => ({ top: window.innerHeight - 64, bottom: window.innerHeight, height: 64, left: 0, right: 375, width: 375, x: 0, y: window.innerHeight - 64, toJSON: () => ({}) });
    document.body.appendChild(dock);
    const seen: { rootMargin?: string }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (e: { isIntersecting: boolean; intersectionRatio: number }[]) => void, opts: { rootMargin?: string }) { seen.push(opts ?? {}); }
        // Half of the button group shows above the dock: intersecting, but not clear of it.
        observe() { this.cb([{ isIntersecting: true, intersectionRatio: 0.5 }]); }
        disconnect() {}
      },
    );
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0 };
    try {
      open();
      await screen.findAllByRole("button", { name: "Ask for it" });
      await waitFor(() => expect(document.body.querySelector("[data-declutter-askbar]")).not.toBeNull());
      await waitFor(() => expect(document.documentElement.classList.contains("dock-yield")).toBe(true));
      // F062: the rows under the item watch for themselves too (ROWS_NEAR_MARGIN); this is the action bar's observer.
      expect(seen.filter((o) => o.rootMargin !== ROWS_NEAR_MARGIN).slice(-1)[0]?.rootMargin).toBe("0px 0px -64px 0px");
    } finally {
      dock.remove();
    }
  });

  it("More from this seller and Similar items: rows of the Browse card, never the member's own items, an empty row left out", async () => {
    const row = (n: number, extra: object) => ({ ...ITEM, id: `0f0e0d0c-0b0a-4908-8706-0504030201${String(n).padStart(2, "0")}`, title: `Thing ${n}`, ...extra });
    state.more = [row(1, {}), row(2, {})];
    state.similar = [row(3, { seller_id: "u3" }), row(4, { seller_id: "u1", title: "My own lamp" })];
    const { unmount } = open();
    const more = await screen.findByRole("region", { name: "More from this seller" });
    expect(within(more).getAllByRole("link")).toHaveLength(2);
    expect(more.querySelectorAll("[data-item-card]")).toHaveLength(2);
    // Q2572 (audit 1102a): the cards snap to their start, so the scroller's snap line (scroll-padding) must equal its
    // padding, or the first card snaps off the page gutter (x 8 at 375). jsdom draws no layout: the two classes are read.
    // @mutate src/components/declutter/DeclutterItemRows.tsx | flex snap-x scroll-px-3 gap-3 | flex snap-x gap-3
    for (const scroller of document.querySelectorAll("[data-item-row-scroller]")) {
      const cls = scroller.className.split(/\s+/);
      if (cls.includes("snap-x")) expect(cls).toEqual(expect.arrayContaining(["px-3", "scroll-px-3"]));
    }
    expect(document.querySelectorAll("[data-item-row-scroller]").length).toBeGreaterThan(1);
    const similar = screen.getByRole("region", { name: "Similar items" });
    expect(within(similar).getByText("Thing 3")).toBeInTheDocument();
    expect(screen.queryByText("My own lamp")).toBeNull();
    unmount();
    state.more = [];
    open();
    await screen.findByRole("region", { name: "Similar items" });
    expect(screen.queryByRole("region", { name: "More from this seller" })).toBeNull();
  });

  // Q2579 (audit 1102a): on the seller's own TAKEN-DOWN listing an unanswered question asked for an answer ("waiting for
  // your answer" + a primary Answer) though no buyer can see the listing. It says "relist it to answer", no button;
  // the same question on the live listing still asks.
  // @mutate src/components/declutter/DeclutterItemView.tsx | listingDown={it.status === "withdrawn"} /> | />
  // @mutate src/components/declutter/DeclutterQuestions.tsx | onAnswer={isSeller && !listingDown ? () => setAnswering(q) : null} | onAnswer={isSeller ? () => setAnswering(q) : null}
  it("Q2579: the seller's own taken-down listing never asks them to answer a question", async () => {
    const asked = { id: "q9", item_id: ITEM.id, question: "Is it still here?", answer: null, created_at: new Date().toISOString(), answered_at: null };
    state.questions = [asked];
    state.item = { ...ITEM, seller_id: "u1", status: "withdrawn" };
    const { unmount } = open();
    expect(await screen.findByText(/· relist it to answer$/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for your answer/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
    unmount();
    state.item = { ...ITEM, seller_id: "u1", status: "live" };
    open();
    expect(await screen.findByText(/· waiting for your answer$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument();
  });

  it("the seller's own item page shows no rows", async () => {
    state.item = { ...ITEM, seller_id: "u1" };
    state.more = [{ ...ITEM, id: "x", seller_id: "u9", title: "Other thing" }];
    state.similar = [{ ...ITEM, id: "y", seller_id: "u9", title: "Similar thing" }];
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    // Give the row reads time to land (they would within a tick) before saying they are absent.
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole("status", { name: "Loading more items" })).toBeNull();
    expect(screen.queryByText("Other thing")).toBeNull();
    expect(screen.queryByText("Similar thing")).toBeNull();
  });

  it("the row reads: this seller's other live items, and other sellers' live items in the same category", async () => {
    const r = api as unknown as Record<string, (...a: string[]) => Promise<unknown>>;
    await r.fetchSellerItemsReal("u2", ID);
    expect(calls).toEqual(expect.arrayContaining([["from", ["declutter_items"]], ["eq", ["seller_id", "u2"]], ["in", ["status", ["live", "reserved"]]], ["neq", ["id", ID]]]));
    calls.length = 0;
    await r.fetchSimilarItemsReal("furniture", ID, "u2");
    expect(calls).toEqual(expect.arrayContaining([["eq", ["category", "furniture"]], ["in", ["status", ["live", "reserved"]]], ["neq", ["id", ID]], ["neq", ["seller_id", "u2"]]]));
  });
  it("phone header: back + share + heart only (the h1 stays for screen readers), the full title under the price", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Oak rocking chair", level: 1 })).toHaveAttribute("data-phone-hides-title");
    expect(screen.getByRole("heading", { name: "Oak rocking chair", level: 2 })).toBeInTheDocument();
  });

  it("PageHeader / ProfileTabHeader: phoneHidesTitle hides the h1 below sm only; without it nothing changes", () => {
    const { unmount } = render(<MemoryRouter><ProfileTabHeader title="A long item title" backTo="/declutter" phoneHidesTitle /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "A long item title" }).className).toMatch(/(^|\s)max-sm:sr-only(\s|$)/);
    unmount();
    render(<MemoryRouter><PageHeader title="Plain title" /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Plain title" }).className).not.toMatch(/sr-only/);
    cleanup();
    // Owner mockup 11-01: hidesTitle keeps the h1 for screen readers at EVERY width.
    render(<MemoryRouter><ProfileTabHeader title="Item title" backTo="/declutter" phoneHidesTitle hidesTitle /></MemoryRouter>);
    const h = screen.getByRole("heading", { name: "Item title" }).className.split(/\s+/);
    expect(h).toContain("sr-only");
    expect(h).not.toContain("max-sm:sr-only");
  });

  it("DA-9: the item page asks for a pinned title row, so back, share and heart stay on screen as it scrolls", async () => {
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 1 });
    expect(screen.getByRole("main")).toHaveAttribute("data-sticky-header");
  });

  it("DA-9: the real AppPage's stickyHeader pins the row (back + actions + the scrolled title) and turns off the title-only bar", async () => {
    const { default: RealAppPage } = await vi.importActual<typeof import("@/components/AppPage")>("@/components/AppPage");
    const actions = <button type="button" aria-label="Save this item">h</button>;
    const { container, unmount } = render(<MemoryRouter><RealAppPage title="Blue mug" phoneHidesTitle stickyHeader titleActions={actions}><p>body</p></RealAppPage></MemoryRouter>);
    const scroller = container.querySelector("[data-app-page-scroll]");
    expect(scroller).toHaveAttribute("data-own-title-row");
    const row = container.querySelector(".sticky-title-row");
    expect(row?.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(row?.className).toMatch(/(^|\s)top-\[calc\(-1\*var\(--shell-gap\)\)\](\s|$)/);
    // The row's parent is the page body (everything below), so the row can stick past the header.
    expect(row?.parentElement?.contains(screen.getByText("body"))).toBe(true);
    expect(within(row as HTMLElement).getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole("button", { name: "Save this item" })).toBeInTheDocument();
    const name = row?.querySelector(".sticky-title-row-name");
    expect(name?.textContent).toBe("Blue mug");
    expect(name).toHaveAttribute("aria-hidden", "true");
    // AUD31-15: a long title takes two lines on the pinned row, never "Oak rocking ..." at 375.
    // @mutate src/components/PageHeader.tsx | sticky-title-row-name min-w-0 flex-1 line-clamp-2 break-words | sticky-title-row-name min-w-0 flex-1 truncate
    expect(name?.className).toMatch(/(^|\s)line-clamp-2(\s|$)/);
    expect(name?.className).not.toMatch(/(^|\s)truncate(\s|$)/);
    unmount();
    // Without it, every other AppPage is exactly as before.
    const plain = render(<MemoryRouter><RealAppPage title="Earnings"><p>body</p></RealAppPage></MemoryRouter>);
    expect(plain.container.querySelector("[data-own-title-row]")).toBeNull();
    expect(plain.container.querySelector(".sticky-title-row")).toBeNull();
    expect(plain.container.querySelector(".sticky-title-row-name")).toBeNull();
  });

  it("the real AppPage passes phoneHidesTitle down to the header", async () => {
    const { default: RealAppPage } = await vi.importActual<typeof import("@/components/AppPage")>("@/components/AppPage");
    render(<MemoryRouter><RealAppPage title="Real page title" phoneHidesTitle><p>body</p></RealAppPage></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Real page title" }).className).toMatch(/(^|\s)max-sm:sr-only(\s|$)/);
  });
  // Board 4 (2026-10-20): the price-drop line only from the real nightly rule
  // (src/lib/declutter/priceDrop.ts), and only "could ... as low as": the
  // seller's stop is private, so the page never promises a drop.
  it("board 4: an offers listing shows when it could next drop and how low; a fixed-price one shows nothing", async () => {
    // Live a minute ago: not yet eligible at the last run, so no "at its stop" doubt.
    state.item = { ...ITEM, current_price_cents: 3800, live_at: new Date(Date.now() - 60_000).toISOString() };
    state.drop = { sale_mode: "offers", last_price_drop_on: null };
    const first = open();
    // A row from before 20261028160637 (no drop_pct) keeps 5%, now to a whole dollar: $38 -> $36.
    const banner = await screen.findByText(/Next possible drop: \$36, (this evening|tomorrow) at \d{1,2}:07 PM/);
    expect(banner.closest("[data-price-drop]")).not.toBeNull();
    expect(screen.queryByText(/Drops to/)).toBeNull();
    expect(screen.getByText(/can drop 5%, rounded down to a whole dollar/)).toBeInTheDocument();
    first.unmount();
    // Owner 2026-10-28: the seller's own step is what the buyer is told.
    state.drop = { sale_mode: "offers", last_price_drop_on: null, drop_pct: 20 };
    const twenty = open();
    expect(await screen.findByText(/Next possible drop: \$30, (this evening|tomorrow)/)).toBeInTheDocument();
    expect(screen.getByText(/can drop 20%, rounded down/)).toBeInTheDocument();
    twenty.unmount();
    // Drops off: no line at all.
    state.drop = { sale_mode: "offers", last_price_drop_on: null, drop_pct: 0 };
    const offOpen = open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    expect(document.querySelector("[data-price-drop]")).toBeNull();
    offOpen.unmount();
    state.drop = { sale_mode: "fixed", last_price_drop_on: null };
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    expect(document.querySelector("[data-price-drop]")).toBeNull();
  });

  // Lead (2026-10-20): the seller reads about their own rule, never "the seller chose"; once they stop the drops
  // (board 158) their page stops saying "Could drop".
  it("seller: the drop line speaks to the seller, and hides once they stopped the drops", async () => {
    state.item = { ...ITEM, seller_id: "u1", current_price_cents: 3800, live_at: new Date(Date.now() - 60_000).toISOString() };
    state.drop = { sale_mode: "offers", last_price_drop_on: null };
    state.manage = { floor_price_cents: 3000, drops_stopped: false };
    const first = open();
    expect(await screen.findByText(/never goes below your lowest price/)).toBeInTheDocument();
    expect(screen.queryByText(/the seller chose/)).toBeNull();
    first.unmount();
    state.manage = { floor_price_cents: 3000, drops_stopped: true };
    state.reads = 0;
    open();
    await screen.findByText("Your listing is for sale");
    // Both reads (the drop rule and the seller's own stop) have landed before absence is judged.
    await waitFor(() => expect(state.reads).toBe(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.querySelector("[data-price-drop]")).toBeNull();
  });

  it("F359f: the owner's page shows the open trade offer for this listing with Accept / Decline; one for another listing does not show", async () => {
    state.item = { ...ITEM, seller_id: "u1", accepts_trades: true, live_at: new Date(Date.now() - 60_000).toISOString() };
    const trade = (id: string, itemId: string, offered: string) => ({ id, status: "open", respond_by: new Date(Date.now() + 47 * 3_600_000).toISOString(),
      created_at: "2026-11-10T00:00:00Z", item: { id: itemId, title: "Oak rocking chair", current_price_cents: 4000 },
      offered: { id: `o-${id}`, title: offered, current_price_cents: 2500 }, my_side: "seller", my_line_status: null, talk_order_id: null });
    state.trades = [trade("t-other", "elsewhere", "Desk lamp"), trade("t1", ID, "Bluetooth speaker")];
    open();
    await screen.findByText("Your listing is for sale");
    const card = await waitFor(() => {
      const el = document.querySelector('[data-trade-card="t1"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(card.textContent).toContain("Trade offer");
    expect(card.textContent).toContain("Bluetooth speaker");
    expect(within(card).getByRole("button", { name: "Accept trade" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(document.querySelector('[data-trade-card="t-other"]')).toBeNull();
    expect(screen.queryByText("Desk lamp")).toBeNull();
  });

  it("seller: a lowest price at the price can't drop, so nothing is said about drops (owner 2026-10-30)", async () => {
    state.item = { ...ITEM, seller_id: "u1", current_price_cents: 3800, live_at: new Date(Date.now() - 60_000).toISOString() };
    state.drop = { sale_mode: "offers", last_price_drop_on: null, drop_pct: 5 };
    state.manage = { floor_price_cents: 3800, drops_stopped: false };
    state.reads = 0;
    open();
    await screen.findByText("Your listing is for sale");
    await waitFor(() => expect(state.reads).toBe(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(document.querySelector("[data-price-drop]")).toBeNull();
  });

  it("See what buyers see: no seller controls or private reads, the buyer's words, and actions only say whose listing it is", async () => {
    state.item = { ...ITEM, seller_id: "u1", current_price_cents: 3800, title: "Oak dresser", live_at: new Date(Date.now() - 60_000).toISOString() };
    state.drop = { sale_mode: "offers", last_price_drop_on: null, drop_pct: 5 };
    state.manage = { floor_price_cents: 1234, drops_stopped: false };
    state.reads = 0;
    state.manageReads = 0;
    state.buys = 0;
    const first = open("?preview=buyer");
    await screen.findByText("This is what buyers see");
    // The way back is a 44px outline button, not a 16px text link (audit 1110 F333).
    const back = screen.getByRole("link", { name: "Back to your listing" });
    expect(back.className).toMatch(/\bh-11\b/);
    expect(back.className).not.toMatch(/\bunderline\b/);
    // The buyer's words and the buyer's actions.
    expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("Exact address after you pay");
    expect(await screen.findByText(/until it reaches a price the seller chose/)).toBeInTheDocument();
    const buy = (await screen.findAllByRole("button", { name: /Buy now/ }))[0];
    // No seller panel, and the seller's private lowest price is never read or shown.
    expect(screen.queryByText("Your listing is for sale")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(state.manageReads).toBe(0);
    expect(document.body.textContent).not.toContain("$12.34");
    expect(document.body.textContent).not.toContain("1 Main St");
    // Pressing Buy only says whose listing it is: nothing reaches the checkout.
    fireEvent.click(buy);
    // After the click has had time to reach a checkout (vacuity 11-07: read at once, a click that got through still read 0).
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(state.buys).toBe(0);
    // Nor does it start the buy (its card step): the capture stops the click before the button's own handler.
    expect(document.querySelector("[data-card-step-title]")).toBeNull();
    // On the page itself: toast.info renders nothing in the app (toastPolicy), so a spy on it proved nothing.
    expect((await screen.findByText(/^This is your listing\./)).closest("[data-preview-note]")).toBeTruthy();
    // LEAD-PREVIEW-ASK (owner 2026-10-31): the Ask box shows, greyed out, saying how it works; nothing can be sent.
    // @mutate src/components/declutter/DeclutterItemView.tsx | canAsk={canAct && !preview} preview={preview} free={free} onMakeOffer={ | canAsk={canAct && !preview} free={free} onMakeOffer={
    const askBox = (await screen.findByText("Buyers ask here. You'll get a notice and answer from this page.")).closest("[data-preview-ask]")!;
    expect(askBox).toBeTruthy();
    expect(askBox.querySelector("input")).toBeDisabled();
    expect(within(askBox as HTMLElement).getByRole("button", { name: "Ask" })).toBeDisabled();
    // Not the seller: the same link is the ordinary page.
    first.unmount();
    state.item = { ...ITEM, seller_id: "someone-else", current_price_cents: 3800, live_at: new Date(Date.now() - 60_000).toISOString() };
    open("?preview=buyer");
    await screen.findAllByRole("button", { name: /Buy now/ });
    expect(screen.queryByText("This is what buyers see")).toBeNull();
  });

  // Board 4: "N more from <first name>. One pickup, one fee." is true because
  // declutter_start_checkout groups every cart line from one seller into one
  // order and charges declutter_buyer_fee_cents once. Only items that can still
  // be bought (live) count; none, no row.
  it("board 4: the bundle row counts the seller's other LIVE items by first name; only reserved ones, no row", async () => {
    state.more = [
      { ...ITEM, id: "a1", title: "Side table", status: "live" },
      { ...ITEM, id: "a2", title: "Lamp", status: "live" },
      { ...ITEM, id: "a3", title: "Rug", status: "reserved" },
    ];
    const first = open();
    // Owner mockup 11-01: folded into the seller card, one line.
    const row = await screen.findByText(/^2 more items · check out together, one pickup$/);
    expect(row).toHaveAttribute("data-bundle-line");
    expect(row.closest("[data-seller-card]")).not.toBeNull();
    first.unmount();
    // A full page of 12 (the read's limit) may hide more: "11+", never a short count.
    state.more = Array.from({ length: 12 }, (_, i) => ({ ...ITEM, id: `b${i}`, title: `Thing ${i}`, status: i === 0 ? "reserved" : "live" }));
    const full = open();
    expect(await screen.findByText(/^11\+ more items · /)).toBeInTheDocument();
    full.unmount();
    // F120 (UI audit 11-09): with the seller's real count in, the card says it ("254 more items"), never "12+".
    // @mutate src/components/declutter/DeclutterBundleRow.tsx |   return { count: counted ? total.data! : buyable.length, capped, firstName, |   return { count: buyable.length, capped: full, firstName,
    state.liveCount = 254;
    const counted = open();
    expect(await screen.findByText(/^254 more items · /)).toBeInTheDocument();
    counted.unmount();
    state.more = [{ ...ITEM, id: "a3", title: "Rug", status: "reserved" }];
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    await screen.findByText("More from this seller");
    expect(document.querySelector("[data-bundle-line]")).toBeNull();
  });

  // Audit BUY-3: on an item the seller offers only delivered, "Buy now · $42.70 total" was a figure nobody can pay
  // (the line above said "Or from $X delivered") and the bundle row promised "one pickup".
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |   if (way !== "none") return | if (true) return
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |         addCents={deliveryPriceCents(1, [size])} |         addCents={0}
  // @mutate src/components/declutter/DeclutterBundleRow.tsx |   const pickup = noDeliveryWay(ways.data) !== "none"; |   const pickup = true;
  it("BUY-3: a delivery-only item's Buy now names the least it costs delivered, and the bundle row promises no pickup", async () => {
    const { buyNowTotalCents } = await import("@/lib/declutter/money");
    const { deliveryPriceCents } = await import("@/lib/declutter/delivery");
    const { formatPrice } = await import("@/lib/declutter/distance");
    const delivered = formatPrice(buyNowTotalCents(4000) + deliveryPriceCents(1, ["large"]));
    expect(delivered).not.toBe("$42.70");
    state.item = { ...ITEM, live_at: new Date(Date.now() - 60_000).toISOString() };
    state.more = [{ ...ITEM, id: "a1", title: "Side table", status: "live" }];
    state.handovers = ["delivery"];
    const first = open();
    expect((await screen.findAllByRole("button", { name: `Buy now · from ${delivered} delivered` })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /\$42\.70 total/ })).toBeNull();
    // A3-48: the page's delivery block is the size list (this large item marked), not a second total.
    expect(document.querySelector("[data-item-delivered] [aria-current='true']")?.getAttribute("data-delivery-size")).toBe("large");
    const row = await screen.findByText(/^1 more item · check out together, one payment$/);
    expect(row.textContent).not.toMatch(/pickup/);
    first.unmount();
    // A seller who offers the porch too: the pickup total and "one pickup" as before.
    state.handovers = ["porch", "delivery"];
    open();
    expect((await screen.findAllByRole("button", { name: "Buy now" })).length).toBeGreaterThan(0);
    expect(await screen.findByText(/^1 more item · check out together, one pickup$/)).toBeInTheDocument();
  });

  // BUY-16 (audit 10-30, High; owner 10-30: guests see item pages, sign up to buy or offer, no seller full name).
  // @mutate src/components/declutter/declutterUi.tsx |   if (!user) return <DeclutterGuestGate skeleton={skeleton}>{children}</DeclutterGuestGate>; |
  // @mutate src/components/declutter/DeclutterItemView.tsx |     {canAct && !user && !signedOutOwner && <DeclutterGuestJoin free={free} offers={it.accepts_offers !== false} trades={!free && it.accepts_trades === true} />} |
  // @mutate src/components/declutter/DeclutterItemView.tsx | <DeclutterGuestJoin free={free} offers={it.accepts_offers !== false} trades={!free && it.accepts_trades === true} /> | <DeclutterGuestJoin free={free} trades={!free && it.accepts_trades === true} />
  // @mutate src/components/declutter/DeclutterGuest.tsx |         {!free && offers && ( |         {!free && (
  // @mutate src/components/declutter/DeclutterGuest.tsx |             <GuestBrand />\n          </div>\n        )} |           </div>\n        )}
  // @mutate src/components/declutter/DeclutterItemView.tsx |           {!isSeller && user && (\n            <DeclutterSellerCard |           {!isSeller && (\n            <DeclutterSellerCard
  // @mutate src/components/declutter/DeclutterGuest.tsx |   if (failed \|\| open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>; |   return <><DeclutterGuestTopBar />{children}</>;
  // @mutate src/components/declutter/DeclutterItemView.tsx |           {!user && <DeclutterGuestSeller itemId={it.id} free={free} />} |
  // @mutate src/lib/declutter/api.ts |   const res = await supabase.rpc("declutter_guest_seller_card", { p_item_id: itemId }); |   const res = await supabase.rpc("get_safe_profiles", { user_ids: [itemId] });
  // F227/F319 (owner 11-11): the guest card is "Dana R.", the rating and ID checked, and nothing else (no photo, no link).
  // @mutate src/components/declutter/DeclutterGuest.tsx |         {c.idChecked && ( |         {true && (
  // @mutate src/components/declutter/DeclutterGuest.tsx |         {c.avg !== null && c.count > 0 && ( |         {false && (
  // @mutate src/components/declutter/DeclutterGuest.tsx |         <span className="block truncate font-semibold">{c.name}</span> |         <a href="/u/x" className="block truncate font-semibold">{c.name}</a>
  it("BUY-16 + owner pick 1 (11-08): a guest sees the REAL Make offer / Buy now, each going to sign up and back; only the small guest seller card (F227); the wall while Declutter isn't open", async () => {
    guest.on = true;
    state.item = { ...ITEM, live_at: new Date(Date.now() - 60_000).toISOString() };
    const first = open();
    expect(await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 })).toBeInTheDocument();
    expect(document.querySelector("[data-item-price]")?.textContent).toContain("$40");
    const join = document.querySelector("[data-guest-join]") as HTMLElement;
    expect(join).toHaveTextContent("Signing up is free. We'll bring you back to this item.");
    const back = encodeURIComponent(`/declutter/item/${ID}`);
    // The real pair, in the member's order (Make offer, then the one filled Buy now), each to sign up and back here.
    // @mutate src/components/declutter/DeclutterGuest.tsx |           <Link to={signup} data-guest-buy="">{free ? "Sign up to ask for it" : "Buy now"}</Link> |           <Link to="/signup" data-guest-buy="">{free ? "Sign up to ask for it" : "Buy now"}</Link>
    const pair = join.querySelector("[data-guest-buttons]")!;
    expect(Array.from(pair.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Make offer", "Buy now"]);
    for (const a of pair.querySelectorAll("a")) expect(a).toHaveAttribute("href", `/signup?redirect=${back}`);
    expect(within(join).getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?redirect=${back}`);
    // No member action runs for a guest: these are links to sign up, never the Buy now button that holds the item.
    expect(screen.queryByRole("button", { name: /Buy now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save this item" })).toBeNull();
    // AUD31-67: the guest has the brand and a way to the rest of Louisiana Helpr.
    expect(within(join).getByRole("link", { name: "Helpr home" })).toHaveAttribute("href", "/");
    // F227/F319 (owner 11-11, narrow exception to BUY-16): the small guest card from declutter_guest_seller_card,
    // exactly "Dana R.", the rating and ID checked. Never the member card, its photo, join date or profile link, and no
    // member-only read (get_safe_profiles, get_public_profile_stats) for a guest.
    const seller = await screen.findByText("Dana R.");
    const guestCard = seller.closest("[data-guest-seller]") as HTMLElement;
    expect(guestCard).not.toBeNull();
    // F359d: "12 pickups" (declutter_guest_seller_card.pickup_count, 20261112002528), a count and nothing else.
    expect(guestCard.textContent).toBe("DSold byDana R.4.5 stars from · 2 reviews12 pickupsID checked");
    expect(guestCard.querySelector("[data-guest-seller-pickups]")?.textContent).toBe("12 pickups");
    expect(guestCard.querySelector("[data-guest-seller-rating]")?.textContent).toBe("4.5 stars from · 2 reviews");
    expect(guestCard.querySelector("[data-guest-seller-id]")?.textContent).toBe("ID checked");
    expect(guestCard.querySelectorAll("a, img, button")).toHaveLength(0);
    expect(guestCard.closest("a")).toBeNull();
    expect(document.querySelector("[data-seller-card]")).toBeNull();
    expect(screen.queryByText(/Robichaux/)).toBeNull();
    expect(screen.queryByText(/^Joined /)).toBeNull();
    expect(screen.queryByRole("link", { name: /See the seller/ })).toBeNull();
    const rpcs = calls.filter(([k]) => k === "rpc").map(([, a]) => a[0]);
    expect(rpcs).toContain("declutter_guest_seller_card");
    expect(rpcs).not.toContain("get_safe_profiles");
    expect(rpcs).not.toContain("get_public_profile_stats");
    expect(screen.queryByText("LOGIN WALL")).toBeNull();
    first.unmount();
    // AUD31-68: a Buy-now-only listing (accepts_offers false) asks a guest to sign up to buy it, never to make an offer.
    state.item = { ...ITEM, live_at: new Date(Date.now() - 60_000).toISOString(), accepts_offers: false };
    const noOffers = open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    const joinNoOffers = document.querySelector("[data-guest-join]") as HTMLElement;
    expect(within(joinNoOffers).getByRole("link", { name: "Buy now" })).toBeInTheDocument();
    expect(joinNoOffers.textContent).not.toMatch(/offer/i);
    expect(joinNoOffers).toHaveAttribute("aria-label", "Buy this item");
    noOffers.unmount();
    // Declutter not open to everyone: the login wall, as before.
    guest.open = [];
    open();
    expect(await screen.findByText("LOGIN WALL")).toBeInTheDocument();
  });

  // F061 (UI audit 11-09): a sold or taken-down item was a notice, one button and a blank page.
  // @mutate src/components/declutter/DeclutterSkeletons.tsx |       {more}\n    </AppPage> |     </AppPage>
  it("F061: a sold or taken-down item shows the notice, the way on, and a row of what is new (never the member's own)", async () => {
    state.item = null;
    state.newest = [
      { ...ITEM, id: "0f0e0d0c-0b0a-4908-8706-050403020191", title: "Desk lamp", seller_id: "u3" },
      { ...ITEM, id: "0f0e0d0c-0b0a-4908-8706-050403020192", title: "My own rug", seller_id: "u1" },
    ];
    open();
    expect(await screen.findByText("No longer available.")).toBeInTheDocument();
    const row = await screen.findByRole("region", { name: "New on Declutter" });
    // L008: a card is named by its own text (title and price), not an aria-label.
    expect(within(row).getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringMatching(/Desk lamp.*\$40/)]);
    // Not sold (withdrawn, removed, ...): nothing of the listing.
    expect(document.querySelector("[data-sold-item]")).toBeNull();
  });

  // Audit 11-10 F316: /declutter/item/abc said "No longer available. It sold..." and asked the sold-card RPC with
  // "abc" (a 400 from the database). A malformed id asks the server for nothing and says the link is broken.
  // @mutate src/components/declutter/DeclutterItemView.tsx |   if (!validId) return <DeclutterItemUnavailable notFound more={<NewestItemsRow viewerId={user?.id ?? null} />} />;\n | \n
  it("F316: a mistyped item link says the link may be broken, titles the tab Item not found, and reads nothing", async () => {
    state.item = null;
    state.sold = { title: "Oak rocking chair", photo_id: null };
    state.soldReads = 0;
    open("", "abc");
    expect(await screen.findByText("We couldn't find that item.")).toBeInTheDocument();
    expect(screen.getByText("The link may be broken.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/It sold or is no longer on Declutter/);
    expect(document.title).toBe("Item not found — Helpr");
    await act(async () => { await Promise.resolve(); });
    expect(state.soldReads).toBe(0);
    expect(document.querySelector("[data-sold-item]")).toBeNull();
  });

  // F061 (lead rule 11-09): a SOLD item shows its cover greyed, its title and "Sold" (declutter_sold_item_card).
  // @mutate src/components/declutter/DeclutterItemView.tsx | top={item.isError ? null : <SoldItemCard itemId={itemId} />} | top={null}
  it("F061: a sold item shows its greyed cover, its title and Sold above the notice", async () => {
    state.item = null;
    state.sold = { title: "Oak rocking chair", photo_id: "11111111-2222-4333-8444-555555555555" };
    open();
    const sold = await screen.findByRole("region", { name: "Oak rocking chair, sold" });
    expect(within(sold).getByText("Sold")).toBeInTheDocument();
    const img = within(sold).getByRole("img", { name: "Oak rocking chair" });
    expect(img.getAttribute("src")).toMatch(/\/functions\/v1\/shop-photo\?id=11111111-2222-4333-8444-555555555555&kind=declutter&w=240&sq=1$/);
    expect(img.className).toMatch(/\bgrayscale\b/);
  });

  // F049 (UI audit 11-09): a free item said "Sold by Lexi" and "Exact address if the giver picks you".
  // @mutate src/components/declutter/DeclutterGuest.tsx | {free ? "Given by" : "Sold by"} | {"Sold by"}
  // @mutate src/components/declutter/ItemPickupBlock.tsx | `You'll get the exact address if ${giver ?? "the giver"} picks you.` | "exact address if the giver picks you"
  it("F049: a guest on a free item reads 'Given by Dana R.' and 'You'll get the exact address if Dana picks you.'", async () => {
    guest.on = true;
    state.handovers = ["porch"];
    state.item = { ...ITEM, price_cents: 0, current_price_cents: 0, live_at: new Date(Date.now() - 60_000).toISOString() };
    // A seller with no public review and no ID check: the name alone, no stars, no badge (F227: never a false claim).
    guestCard.row = { display_name: "Dana R.", avg_rating: null, review_count: 0, id_checked: false };
    open();
    const seller = await screen.findByText("Dana R.");
    expect(seller.closest("[data-guest-seller]")?.textContent).toBe("DGiven byDana R.");
    await vi.waitFor(() => expect(document.querySelector("[data-item-address-note]")?.textContent).toBe("You'll get the exact address if Dana picks you."));
    expect(document.body.textContent).not.toMatch(/Sold by|giver picks you/);
  });

  it("DA-6: the buyer's own sold item says You bought this (free: You claimed this), with Buying, and asks no item pickup times", async () => {
    const rpcSpy = vi.fn();
    const { supabase } = await import("@/integrations/supabase/client");
    const realRpc = supabase.rpc;
    (supabase as { rpc: unknown }).rpc = async (fn: string, ...rest: unknown[]) => { rpcSpy(fn); return (realRpc as (f: string, ...r: unknown[]) => unknown)(fn, ...rest); };
    try {
      state.item = { ...ITEM, status: "sold" };
      const sold = open();
      expect(await screen.findByText("You bought this.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Buying" })).toHaveAttribute("href", "/declutter?tab=buying");
      expect(document.body.textContent).not.toMatch(/exact address after you pay/);
      expect(screen.queryByRole("button", { name: "Buy now" })).toBeNull();
      expect(rpcSpy.mock.calls.map((c) => c[0])).not.toContain("declutter_item_pickup_windows");
      sold.unmount();
      state.item = { ...ITEM, status: "completed", price_cents: 0, current_price_cents: 0 };
      const claimed = open();
      expect(await screen.findByText("You claimed this.")).toBeInTheDocument();
      claimed.unmount();
      // Still for sale: no such line, and the pickup times are asked for.
      rpcSpy.mockClear();
      state.item = { ...ITEM };
      open();
      await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
      expect(screen.queryByText("You bought this.")).toBeNull();
      await waitFor(() => expect(rpcSpy.mock.calls.map((c) => c[0])).toContain("declutter_item_pickup_windows"));
    } finally {
      (supabase as { rpc: unknown }).rpc = realRpc;
    }
  });
});
