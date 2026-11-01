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
 * @mutate src/components/declutter/DeclutterShareCard.tsx |   void shareNative({ title: it.title, text: shareText(it), url: listingLink(it.id) }); |   void shareNative({ title: it.title, text: shareText(it), url: getPublicOrigin() });
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const barShown = useOffScreen(buttons); |   const barShown = false;
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   useDockYield(barShown && !underAge && item.status === "live"); |   void underAge;
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
 * @mutate src/lib/declutter/api.ts |       .eq("seller_id", sellerId) |       .neq("seller_id", "")
 * @mutate src/lib/declutter/api.ts |       .neq("seller_id", sellerId) |       .neq("seller_id", "")
 * @mutate src/components/declutter/DeclutterItemRows.tsx | (rows ?? []).filter((r) => r.seller_id !== viewerId) | (rows ?? [])
 * @mutate src/components/declutter/DeclutterItemRows.tsx |       {moreRows.length > 0 && <Row |       {<Row
 * @mutate src/components/declutter/DeclutterItemView.tsx |       {!isSeller && user && (\n        <div className="mt-8"> |       {user && (\n        <div className="mt-8">
 * @mutate src/components/declutter/DeclutterItemView.tsx |             {drop && ( | {false && (
 * @mutate src/components/declutter/DeclutterItemView.tsx | lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} mine={isSeller} /> | lowestCents={drop.lowestCents} at={drop.at} pct={drop.pct} />
 * @mutate src/components/declutter/DeclutterItemView.tsx | const drop = planned && !(sellerState && sellerStateStopsDrops(sellerState, it.current_price_cents)) ? planned : null; | const drop = planned;
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const planned = dropState.data ? nextPriceDrop({ ...it, ...dropState.data }) : null; |   const planned = { at: new Date(), lowestCents: it.current_price_cents - 200, pct: 5 };
 * @mutate src/components/declutter/DeclutterBundleRow.tsx | (r) => r.status === "live" && r.seller_id !== viewerId | (r) => r.seller_id !== viewerId
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |   const capped = (more.data?.length ?? 0) >= 12; |   const capped = false;
 * @mutate src/components/declutter/DeclutterBundleRow.tsx |   if (!enabled \|\| buyable.length === 0 \|\| card.isLoading) return null; |   if (!enabled \|\| card.isLoading) return null;
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const isSeller = ownListing && !preview; |   const isSeller = ownListing;
 * Tester 5, 10-30: pressing Buy now in the preview showed nothing, because toast.info renders nothing in the app.
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const noteOwnListing = () => setPreviewPressed(true); |   const noteOwnListing = () => toast.info(PREVIEW_ACTION_NOTE);
 * @mutate src/components/declutter/DeclutterItemView.tsx |               onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); noteOwnListing(); }} |               onClickCapture={() => noteOwnListing()}
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  manageReads: 0,
  buys: 0,
  item: null as unknown,
  photos: [] as unknown[],
  rating: { avg: 4.8, count: 12 } as { avg: number; count: number } | null,
  seller: { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" } as unknown,
  tags: [] as string[][],
  safeRows: [] as unknown[],
  more: [] as unknown[],
  similar: [] as unknown[],
  tableRows: [] as unknown[],
  drop: null as unknown,
  manage: null as unknown,
  reads: 0,
  geo: { status: "idle" } as unknown,
  handovers: null as string[] | null,
};
const calls: [string, unknown[]][] = [];
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
    rpc: async (fn: string) =>
      fn === "declutter_item_pickup_windows" || fn === "declutter_item_pickup_places" || fn === "declutter_bundle_applies"
        ? { data: [], error: null }
        : fn === "declutter_guest_seller_first_name"
          ? { data: "Dana", error: null }
          : { data: state.safeRows, error: null },
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
    fetchItem: async () => state.item,
    fetchItemHandovers: async () => state.handovers,
    fetchItemDropState: async () => { state.reads++; return state.drop; },
    fetchManageState: async () => { state.reads++; state.manageReads++; return state.manage; },
    fetchPhotos: async () => state.photos,
    fetchQuestions: async () => [],
    fetchWatching: async () => new Set(),
    fetchMyItemReview: async () => null,
    fetchSellerRating: async () => state.rating,
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
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));

import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
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

function open(search = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/declutter/item/${ID}${search}`]}>
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
    state.handovers = null;
    guest.on = false;
    guest.open = ["declutter"];
    state.geo = { status: "idle" };
    state.photos = [];
    state.rating = { avg: 4.8, count: 12 };
    state.seller = { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" };
    state.tags = [];
    shared.length = 0;
    state.more = [];
    state.similar = [];
    state.drop = null;
    state.manage = null;
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("three photos: one full-width track, a counter and dots that follow the swipe, and a tap opens the full-screen viewer", async () => {
    state.photos = [0, 1, 2].map((i) => ({ id: `p${i}`, item_id: ID, storage_path: `a/${i}.jpg`, position: i }));
    open();
    const track = await screen.findByRole("group", { name: "Photos of Oak rocking chair" });
    expect(within(track).getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-gallery-dots] > span")).toHaveLength(3);
    // A swipe to the second photo moves the counter and the active dot.
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    track.scrollLeft = 300;
    fireEvent.scroll(track);
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-gallery-dots] > span")[1]).toHaveAttribute("data-dot-active");
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
    expect(document.querySelector("[data-item-pickup-hours]")?.textContent).toMatch(/exact address after you pay$/i);
    buyer.unmount();
    state.item = { ...ITEM, seller_id: "u1" };
    open();
    await screen.findByRole("region", { name: "Price and condition" });
    expect(document.querySelector("[data-item-where]")?.textContent).not.toMatch(/mi away|miles?/);
    expect(document.querySelector("[data-item-pickup-hours]")?.textContent).toMatch(/buyers see your exact address only after they pay$/i);
    expect(document.body.textContent).not.toMatch(/after you pay/);
    state.geo = { status: "idle" };
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
    const panelButton = () => within(screen.getByRole("region", { name: "Buy or make an offer" })).getByRole("button", { name: "Make an offer" });
    await waitFor(() => expect(panelButton()).toBeEnabled());
    expect(panelButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(hint);
    await waitFor(() => expect(panelButton()).toHaveAttribute("aria-expanded", "true"));
  });

  it("one filled button on a buyer's item page: Buy now (Ask is an outline beside its question box)", async () => {
    // @mutate src/components/declutter/DeclutterQuestions.tsx | <Button type="submit" variant="outline" className="h-auto shrink-0" | <Button type="submit" className="h-auto shrink-0"
    // Counted by the filled class inside the page (jsdom draws no CSS; the 375/1440 WebKit shots measured the same:
    // ~/.lh-shots/declutter-audit-1028/measure-*.json "primaries"). The phone's portaled buy bar repeats Buy now when the
    // in-page one scrolls away, so it is outside the page and not counted.
    state.item = { ...ITEM };
    const { container } = open();
    await screen.findByRole("button", { name: /^Buy now/ });
    await screen.findByRole("button", { name: "Ask" });
    const filled = [...container.querySelectorAll("button.btn-grad-primary, a.btn-grad-primary")].map((b) => (b.textContent ?? "").trim());
    expect(filled.length, JSON.stringify(filled)).toBe(1);
    expect(filled[0]).toMatch(/^Buy ·/);
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
    expect(screen.getByRole("link", { name: /^See the seller, Dana R\./ })).toHaveAttribute("href", "/user/u2");
    unmount();
    state.rating = { avg: 0, count: 0 };
    open();
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-rating]")).toBeNull();
    expect(screen.queryByText(/No reviews yet/)).toBeNull();
    // Messages open after checkout: no pre-purchase "Message seller".
    expect(screen.queryByRole("button", { name: /message/i })).toBeNull();
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

  it("phone: while the in-page Buy now / Make an offer are off screen, the same two ride in a bar on the bottom edge and the dock steps aside", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() { this.cb([{ isIntersecting: false }]); }
        disconnect() {}
      },
    );
    open();
    await screen.findAllByRole("button", { name: "Buy now · $42.70 total" });
    // The bar mounts from the observer's callback, in the panel's passive
    // effect, which can flush AFTER the in-page buttons are found: Vitest run
    // 39464962938 (main, 2026-10-20, CI's threads pool) read null here while a
    // local run saw it. Wait for it rather than read it on the same tick; the
    // mutation (barShown = false) still fails, since it never mounts.
    const bar = await waitFor(() => {
      const el = document.body.querySelector("[data-declutter-buybar]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(bar.className).toContain("bottom-0");
    // The dock yields the strip to the bar (fixedBottomBarsClearTheDock, Q1646).
    await waitFor(() => expect(document.documentElement.classList.contains("dock-yield")).toBe(true));
    expect(within(bar).getByRole("button", { name: "Buy now · $42.70 total" })).toBeInTheDocument();
    // A3-7: the bar and the panel use the same words for the same button.
    // @mutate src/components/declutter/DeclutterOfferPanel.tsx | data-offer-label="">Offer</span>\n                  <span className="sr-only">Make an offer</span> | data-offer-label="">Offer</span>\n                  <span className="sr-only">Make offer</span>
    expect(within(bar).getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Make offer" })).toBeNull();
  });
  // Audit 1030 DB-14: at 375 the in-page Buy now sat in the strip behind the dock, and the observer counted that strip
  // as on screen, so the bar never came and Buy now stayed hidden. The strip the dock covers is cut off the observed
  // screen, and a group only partly clear of it still gets the bar (local repro 375x900: before no bar, after bar
  // 827-900 with the dock hidden; ~/.lh-shots/b96/db14).
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |       { rootMargin: `0px 0px -${dockCoverPx()}px 0px`, threshold: [0, 0.99] }, |       { threshold: [0, 0.99] },
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |       ([entry]) => setOff(!entry.isIntersecting \|\| (entry.intersectionRatio ?? 1) < 0.99), |       ([entry]) => setOff(!entry.isIntersecting),
  it("DB-14: the strip behind the dock does not count as on screen, and buttons only partly clear of it still get the bar", async () => {
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
    try {
      open();
      await screen.findAllByRole("button", { name: "Buy now · $42.70 total" });
      await waitFor(() => expect(document.body.querySelector("[data-declutter-buybar]")).not.toBeNull());
      await waitFor(() => expect(document.documentElement.classList.contains("dock-yield")).toBe(true));
      expect(seen[seen.length - 1]?.rootMargin).toBe("0px 0px -64px 0px");
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
    const similar = screen.getByRole("region", { name: "Similar items" });
    expect(within(similar).getByText("Thing 3")).toBeInTheDocument();
    expect(screen.queryByText("My own lamp")).toBeNull();
    unmount();
    state.more = [];
    open();
    await screen.findByRole("region", { name: "Similar items" });
    expect(screen.queryByRole("region", { name: "More from this seller" })).toBeNull();
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
    const actions = <button type="button" aria-label="Watch this item">h</button>;
    const { container, unmount } = render(<MemoryRouter><RealAppPage title="Blue mug" phoneHidesTitle stickyHeader titleActions={actions}><p>body</p></RealAppPage></MemoryRouter>);
    const scroller = container.querySelector("[data-app-page-scroll]");
    expect(scroller).toHaveAttribute("data-own-title-row");
    const row = container.querySelector(".sticky-title-row");
    expect(row?.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(row?.className).toMatch(/(^|\s)top-\[calc\(-1\*var\(--shell-gap\)\)\](\s|$)/);
    // The row's parent is the page body (everything below), so the row can stick past the header.
    expect(row?.parentElement?.contains(screen.getByText("body"))).toBe(true);
    expect(within(row as HTMLElement).getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(within(row as HTMLElement).getByRole("button", { name: "Watch this item" })).toBeInTheDocument();
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
    // The buyer's words and the buyer's actions.
    expect(document.querySelector("[data-item-pickup-hours]")?.textContent).toMatch(/exact address after you pay$/i);
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
    expect(state.buys).toBe(0);
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
    state.more = [{ ...ITEM, id: "a3", title: "Rug", status: "reserved" }];
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    await screen.findByText("More from this seller");
    expect(document.querySelector("[data-bundle-line]")).toBeNull();
  });

  // Audit BUY-3: on an item the seller offers only delivered, "Buy now · $42.70 total" was a figure nobody can pay
  // (the line above said "Or from $X delivered") and the bundle row promised "one pickup".
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const delivered = way === "none"; |   const delivered = false;
  // @mutate src/components/declutter/DeclutterOfferPanel.tsx |           addCents={delivered ? deliveryPriceCents(1, [size]) : 0} |           addCents={0}
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
    expect((await screen.findAllByRole("button", { name: "Buy now · $42.70 total" })).length).toBeGreaterThan(0);
    expect(await screen.findByText(/^1 more item · check out together, one pickup$/)).toBeInTheDocument();
  });

  // BUY-16 (audit 10-30, High; owner 10-30: guests see item pages, sign up to buy or offer, no seller full name).
  // @mutate src/components/declutter/declutterUi.tsx |   if (!user) return <DeclutterGuestGate skeleton={skeleton}>{children}</DeclutterGuestGate>; |
  // @mutate src/components/declutter/DeclutterItemView.tsx |     {canAct && !user && <DeclutterGuestJoin free={free} offers={it.accepts_offers !== false} />} |
  // @mutate src/components/declutter/DeclutterItemView.tsx | <DeclutterGuestJoin free={free} offers={it.accepts_offers !== false} /> | <DeclutterGuestJoin free={free} />
  // @mutate src/components/declutter/DeclutterGuest.tsx |  : offers ? "Sign up to buy it or make an offer." : "Sign up to buy it."} |  : "Sign up to buy it or make an offer."}
  // @mutate src/components/declutter/DeclutterGuest.tsx |         {!barShown && <GuestBrand />}\n      </div> |       </div>
  // @mutate src/components/declutter/DeclutterItemView.tsx |           {!isSeller && user && <DeclutterSellerCard sellerId={it.seller_id} extra= |           {!isSeller && <DeclutterSellerCard sellerId={it.seller_id} extra=
  // @mutate src/components/declutter/DeclutterGuest.tsx |   if (open?.has("declutter")) return <><DeclutterGuestTopBar />{children}</>; |   return <><DeclutterGuestTopBar />{children}</>;
  // @mutate src/components/declutter/DeclutterItemView.tsx |           {!user && <DeclutterGuestSeller itemId={it.id} />} |
  // @mutate src/lib/declutter/api.ts |   const res = await supabase.rpc("declutter_guest_seller_first_name", { p_item_id: itemId }); |   const res = await supabase.rpc("get_safe_profiles", { user_ids: [itemId] });
  it("BUY-16: a guest reads a shared listing and is asked to sign up to buy; no seller name; the wall while Declutter isn't open", async () => {
    guest.on = true;
    state.item = { ...ITEM, live_at: new Date(Date.now() - 60_000).toISOString() };
    const first = open();
    expect(await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 })).toBeInTheDocument();
    expect(document.querySelector("[data-item-price]")?.textContent).toContain("$40");
    const join = document.querySelector("[data-guest-join]") as HTMLElement;
    expect(join).toHaveTextContent("Sign up to buy it or make an offer.");
    const back = encodeURIComponent(`/declutter/item/${ID}`);
    expect(within(join).getByRole("link", { name: "Sign up" })).toHaveAttribute("href", `/signup?redirect=${back}`);
    expect(within(join).getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?redirect=${back}`);
    expect(screen.queryByRole("button", { name: /Buy now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Watch this item" })).toBeNull();
    // AUD31-67: the guest has the brand and a way to the rest of Louisiana Helpr.
    expect(within(join).getByRole("link", { name: "Helpr home" })).toHaveAttribute("href", "/");
    // The seller's first name only (declutter_guest_seller_first_name), never the member card's "Dana R." or its link.
    const seller = await screen.findByText("Dana");
    expect(seller.closest("[data-guest-seller]")).not.toBeNull();
    expect(screen.queryByText(/Dana R/)).toBeNull();
    expect(screen.queryByText(/Robichaux/)).toBeNull();
    expect(screen.queryByRole("link", { name: /See the seller/ })).toBeNull();
    expect(screen.queryByText("LOGIN WALL")).toBeNull();
    first.unmount();
    // AUD31-68: a Buy-now-only listing (accepts_offers false) asks a guest to sign up to buy it, never to make an offer.
    state.item = { ...ITEM, live_at: new Date(Date.now() - 60_000).toISOString(), accepts_offers: false };
    const noOffers = open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    const joinNoOffers = document.querySelector("[data-guest-join]") as HTMLElement;
    expect(joinNoOffers).toHaveTextContent("Sign up to buy it.");
    expect(joinNoOffers.textContent).not.toMatch(/offer/i);
    expect(joinNoOffers).toHaveAttribute("aria-label", "Buy this item");
    noOffers.unmount();
    // Declutter not open to everyone: the login wall, as before.
    guest.open = [];
    open();
    expect(await screen.findByText("LOGIN WALL")).toBeInTheDocument();
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
