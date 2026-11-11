/**
 * Declutter's loading frame and its location ask (build-queue 1c).
 *
 *  1. While the 'declutter' switch loads, DeclutterGate renders the screen's
 *     skeleton in its real shell (title + <Skeleton> bones), never a blank page.
 *     Measured before: a blank frame and a +754px jump on /declutter and
 *     /declutter/item/:id (scripts/audit/measure-loading-states.mjs).
 *  2. Landing on a Declutter screen never asks for location. The device is
 *     asked only from "Use my location", with Declutter's own words; the job
 *     screens' default wording is unchanged.
 *
 * @mutate src/components/declutter/declutterUi.tsx |   if (!settled) return <>{skeleton}</>; |   if (!settled) return null;
 *  3. Item 6 (lh-silent-failure review of declutter-loading, findings 2 and
 *     4-7): "Not now" leaves a way to ask again; miles from a rough origin
 *     say "about"; a cached coarse fix keeps its flag; a ZIP on file that
 *     could not be placed is not told to "add your ZIP code"; a profile
 *     refetch never reopens the dialog without a tap.
 *
 * @mutate src/components/declutter/useDeclutterOrigin.ts |   const asked = attempts > 0; |   const asked = true;
 * @mutate src/components/declutter/useDeclutterOrigin.ts |   const device = useUserLocation(asked, "declutter_location", attempts); |   const device = useUserLocation(asked, "location", attempts);
 * @mutate src/components/declutter/useDeclutterOrigin.ts |   const canAskAgain = asked && !asking && (device.status === "error" \|\| (device.status === "ready" && !gotDeviceFix)); |   const canAskAgain = false;
 * @mutate src/components/declutter/useDeclutterOrigin.ts | approximate: fix.approximate }); | approximate: false });
 * @mutate src/components/declutter/useDeclutterOrigin.ts |         if (alive) setKnown(fb ? { status: "ready", ...fb } : { status: "none", zipOnFile }); |         if (alive) setKnown(fb ? { status: "ready", ...fb } : { status: "none", zipOnFile: false });
 * @mutate src/hooks/useUserLocation.ts |   }, [enabled, request, rationale, attempt]); |   }, [enabled, request, rationale, attempt, profile]);
 * @mutate src/hooks/useUserLocation.ts |   return { lat: cached.lat, lng: cached.lng, approximate: cached.approximate }; |   return { lat: cached.lat, lng: cached.lng, approximate: false };
 * @mutate src/components/declutter/DeclutterItemView.tsx | milesLabel(miles, geo.status === "ready" && geo.approximate); | milesLabel(miles);
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | miles={miles} approximate={origin.status === "ready" && origin.approximate}\n | miles={miles} approximate={false}\n
 * @mutate src/components/declutter/useDeclutterOrigin.ts |     asked && device.status === "error" | false && device.status === "error"
 * @mutate src/pages/declutter/DeclutterItemPage.tsx | skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable notFound />} | skeleton={<DeclutterItemSkeleton />}
 * @mutate src/pages/declutter/DeclutterItemPage.tsx | skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable notFound />} | skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable />}
 * @mutate src/components/declutter/DeclutterSkeletons.tsx |   usePageTitle(notFound ? "Item not found — Helpr" : "Declutter — Helpr"); |   usePageTitle("Declutter — Helpr");
 * @mutate src/hooks/usePermissionRationale.ts | body: "Declutter uses your location to show how far away each item is | body: "We use your location to show jobs near you, how far away each item is
 */
import { CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, within, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { feature: true, featureSettled: true };

// DeclutterHome reads its tab-row switches with useFeatureStatus (Q?declutter-settle):
// each answers at once, like useFeature, so only the gate's own read is ever pending.
// Q2427: no bundle discount here (its own tests: declutterTradeViews, declutterBundleDiscount.test.ts).
// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
// The item page's pickup places (b9 place times): none here; their own tests are itemHandoverTimes / SellPorchPlaces'.
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<object>()), fetchItemPickupPlaces: async () => [], fetchMyPorchPlaces: async () => [], fetchSellerPorchPlaces: async () => [], fetchOrderPorchPlace: async () => null }));
vi.mock("@/lib/declutter/movingSale", async (orig) => ({ ...(await orig<object>()), fetchItemInMovingSale: async () => false }));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleRule: async () => null,
  fetchBundlePreview: async () => 0,
  // D-NEW12: Browse's "Bundle deal" read; no seller has one here.
  fetchBundleSellers: async () => new Set<string>(),
}));
// The item page's pickup-times line (#58, 2026-10-28) reads the seller's windows: none here.
vi.mock("@/lib/declutter/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/handover")>()),
  fetchItemPickupWindows: async () => [],
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature, useFeatureStatus: () => ({ on: state.feature, settled: true }) }));
// What Browse lists; empty unless a test puts an item up.
const watchCalls: unknown[][] = [];
const live: { items: unknown[] } = { items: [] };
const pins: { map: Map<string, { lat: number; lng: number }>; reads: number } = { map: new Map(), reads: 0 };
// The desktop website (900px+, not native) or a phone; jsdom has no matchMedia, so the width is set here.
const screenWidth = { desktop: false };
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => screenWidth.desktop }));
// Apple's map script never loads here (its token is an edge call): the map's box and pin read are what is tested.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "loading" }));
// The nightly drop columns per item (Browse reads them in one call).
const dropStates: Record<string, { sale_mode: string | null; last_price_drop_on: string | null }> = {};
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// ONE object, as React Query hands back: a fresh profile per render would
// re-run every effect keyed on it.
const account: { user: { id: string }; profile: Record<string, unknown>; isLoading: boolean } = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
// The item page's Buy now / offer panel adds the one-time setup fee (b28, the live platform setting): none owed here.
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeKnown: () => true }));
vi.mock("@/lib/persistUserLocation", () => ({ persistUserLocation: async () => undefined }));
// A ZIP on file whose lookup fails (network or an unknown ZIP): no area.
vi.mock("@/lib/parishLookup", () => ({ resolveParishByZip: async (zip: string) => ({ status: "lookup-failed", zip }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children, titleActions }: { title: string; children: React.ReactNode; titleActions?: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {titleActions}
      {children}
    </main>
  ),
}));
// The tester-only "early preview" read (useSectionTabs) stubbed as not loaded (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/components/sections/SectionScreen", () => ({
  // Honours globalSearch like the real one (default on), so a Browse that forgets to turn Explore's
  // "Search all sections" off shows a second search here too.
  // `search` is the phone bar's search (owner 11-08, the Vinted header), drawn where the real bar draws it: first.
  SectionScreen: ({ title, children, tabs, search, globalSearch = true }: { title: string; children: React.ReactNode; tabs?: React.ReactNode; search?: React.ReactNode; globalSearch?: boolean }) => (
    <main>
      <h1>{title}</h1>
      {search}
      {tabs}
      {globalSearch && <div role="search" data-testid="explore-search-entry" />}
      {children}
    </main>
  ),
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>Page not found</p> }));
// Declutter trades (20261106163703): the listing's "Open to trades" read is the trade module's; off here.
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  fetchAcceptsTrades: async () => false,
}));
vi.mock("@/lib/declutter/saveCounts", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/saveCounts")>()), fetchSaveCounts: async () => new Map<string, number>() }));
vi.mock("@/lib/declutter/api", () => ({
  fetchHasAgreedSales: async () => false,
  // The Buying / Selling badges (DeclutterHome reads them with the tab row).
  fetchMyCart: async () => [],
  fetchMyOffers: async () => [],
  fetchLiveItems: async () => live.items,
  // The Browse map's rough-area pins (declutter_map_pins), read only while a map is on screen.
  fetchMapPins: async () => {
    pins.reads++;
    return pins.map;
  },
  fetchMyItems: async () => [],
  fetchPhotos: async () => [],
  fetchQuestions: async () => [],
  fetchSellerRating: async () => ({ avg: 0, count: 0 }),
  fetchSellerCard: async () => null,
  fetchSellerItems: async () => [],
  fetchSimilarItems: async () => [],
  fetchMyCard: async () => null,
  fetchDropStates: async (ids: string[]) => new Map(ids.filter((id) => dropStates[id]).map((id) => [id, dropStates[id]])),
  fetchWatching: async () => new Set(),
  fetchItem: async () => ({
    id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", description: "Solid oak.",
    category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
    area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null,
  }),
  fetchMyItemReview: async () => null,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  photoPublicUrl: (p: string) => `https://cdn/${p}`, photoCardUrl: (p: string) => `https://cdn/${p}`, CARD_PHOTO_PX: 480,
  withdrawItem: async () => undefined,
  setWatch: async (...a: unknown[]) => { watchCalls.push(a); return "watching"; },
  askQuestion: async () => "q",
  answerQuestion: async () => "a",
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
import { useUserLocation } from "@/hooks/useUserLocation";
import { __resolveRationale } from "@/hooks/usePermissionRationale";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { dropOutlook } from "@/lib/declutter/browseFilters";

const getCurrentPosition = vi.fn();

/** Where the miles come from and "Use my location" live in Browse's slide-up filter sheet (owner 2026-10-19). */
async function openFilters() {
  // 5 s, as declutterTabs does: the phone header carries the section tabs too since F153, and a role query over the
  // bigger tree under a loaded run took past the 1 s default (2026-11-09: 5 of its tests, one run).
  fireEvent.click(await screen.findByRole("button", { name: /^Filters/ }, { timeout: 5000 }));
}

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Settled: what useFeature's own query holds once the server answered.
  // Not settled: the query has not answered yet (the loading frame).
  if (state.featureSettled) qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: state.feature });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
        </Routes>
      </MemoryRouter>
      <PermissionRationaleDialog />
    </QueryClientProvider>
  );
  const r = render(tree());
  return { ...r, again: () => r.rerender(tree()) };
}

const bones = (c: HTMLElement) => c.querySelectorAll("[data-skeleton]").length;

describe("Declutter loading frame (DeclutterGate)", () => {
  beforeEach(() => {
    state.feature = false;
    state.featureSettled = false;
  });

  it.each([
    ["/declutter", <DeclutterPage key="h" />, "/declutter", "Declutter", true],
    // The sell form's first row (the payout note) depends on the member, so
    // its frame is the real header and a loading status, no bones.
    ["/declutter/sell", <DeclutterSellPage key="s" />, "/declutter/sell", "Sell an item", false],
    ["/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage key="i" />, "/declutter/item/:id", "Item", true],
  ])("%s: the switch still loading paints the page's shell (and bones where data lands), not a blank page", (path, el, route, title, hasBones) => {
    const { container } = at(path, el, route);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
    if (hasBones) expect(bones(container)).toBeGreaterThan(0);
    else expect(bones(container)).toBe(0);
    expect(screen.queryByText("Page not found")).toBeNull();
  });

  it("a link that cannot name an item says so at once: no skeleton of photos that will never come", () => {
    const { container } = at("/declutter/item/test", <DeclutterItemPage />, "/declutter/item/:id");
    // Audit 11-10 F316: a mistyped link is a broken link, never "It sold"; the tab says so too.
    expect(screen.getByText("We couldn't find that item.")).toBeInTheDocument();
    expect(screen.getByText("The link may be broken.")).toBeInTheDocument();
    expect(screen.queryByText("No longer available.")).toBeNull();
    expect(document.title).toBe("Item not found — Helpr");
    expect(bones(container)).toBe(0);
  });

  // Q2565: the unavailable item page is not a dead end: it is titled Declutter and offers the way on.
  // @mutate src/components/declutter/DeclutterSkeletons.tsx |         <Link to="/declutter">See more on Declutter</Link> |         <span>See more on Declutter</span>
  // @mutate src/components/declutter/DeclutterSkeletons.tsx |     <AppPage title="Declutter" backTo="/declutter"> |     <AppPage title="Item" backTo="/declutter">
  it("a sold or taken-down item offers a way on to Declutter (Q2565)", () => {
    at("/declutter/item/test", <DeclutterItemPage />, "/declutter/item/:id");
    expect(screen.getByRole("heading", { name: "Declutter" })).toBeInTheDocument();
    const onward = screen.getByRole("link", { name: "See more on Declutter" });
    expect(onward.getAttribute("href")).toBe("/declutter");
  });

  it("a settled 'off' is still the 404, with no skeleton left behind", async () => {
    state.featureSettled = true;
    const { container } = at("/declutter", <DeclutterPage />);
    // /declutter first asks whether the member has a sale to finish (row 62), then 404s.
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(bones(container)).toBe(0);
  });
});

describe("Declutter location ask", () => {
  beforeEach(() => {
    state.feature = true;
    state.featureSettled = true;
    account.profile = {};
    live.items = [];
    sessionStorage.clear();
    localStorage.clear();
    getCurrentPosition.mockReset();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  });
  afterEach(() => {
    act(() => __resolveRationale(false));
  });

  it("landing on Browse asks for nothing; 'Use my location' asks with Declutter's own words", async () => {
    at("/declutter", <DeclutterPage />);
    await openFilters();
    const use = await screen.findByRole("button", { name: "Use my location" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();

    fireEvent.click(use);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Declutter uses your location/);
    expect(dialog.textContent).toMatch(/item/);
    expect(dialog.textContent).not.toMatch(/\bjobs?\b|Helpr/);
    // While the dialog is open, no button: the ask is in progress.
    expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Try my location again" })).toBeNull();
  });

  it("a refused ask says so, and the screen gives the reason", async () => {
    at("/declutter", <DeclutterPage />);
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "Use my location" }));
    await screen.findByRole("alertdialog");
    act(() => __resolveRationale(false));
    expect(await screen.findByText("Location permission declined")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
    // The notice must not still offer "Use your location" once that is gone.
    expect(screen.queryByText(/^Use your location/)).toBeNull();
  });

  it("'Not now' is not the end: the member can ask again, and the dialog opens again only on that tap (findings 2, 7)", async () => {
    const view = at("/declutter", <DeclutterPage />);
    await openFilters();
    fireEvent.click(await screen.findByRole("button", { name: "Use my location" }));
    await screen.findByRole("alertdialog");
    act(() => __resolveRationale(false));
    const again = await screen.findByRole("button", { name: "Try my location again" });

    // A profile refetch hands back a NEW object with the same values: no tap, no dialog.
    account.profile = { ...account.profile };
    view.again();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(again);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // (Not answered "Share location" here: a fix would fill the module cache
    // that the later tests in this file land on.)
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("a ZIP on file that could not be placed is never told to 'add your ZIP code' (finding 6)", async () => {
    account.profile = { zip_code: "70808" };
    at("/declutter", <DeclutterPage />);
    await openFilters();
    expect(await screen.findByText(/couldn't find the area for the ZIP code on your profile/)).toBeInTheDocument();
    expect(screen.queryByText(/add your ZIP code/i)).toBeNull();
  });

  it("miles from a parish centre say 'about'; miles from a saved fix do not (finding 4)", async () => {
    account.profile = { parish: "East Baton Rouge" };
    const parish = at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText(/About 1 mi away/)).toBeInTheDocument();
    expect(screen.queryByText(/Less than 1 mi away/)).toBeNull();
    parish.unmount();

    // The Browse card says the same.
    live.items = [{
      id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
    }];
    const browse = at("/declutter", <DeclutterPage />);
    // Audit 11-10 F321: the card says it short ("About 1 mi"), so the condition beside it has room.
    await waitFor(() => expect(document.querySelector("[data-card-away]")?.textContent).toBe("About 1 mi"));
    // Owner pick 4 (11-08): three text lines; the town line is gone (the distance says how far).
    expect(document.querySelector("[data-item-card]")?.textContent).not.toContain("Mid-City, Baton Rouge");
    browse.unmount();
    live.items = [];

    account.profile = { latitude: "30.4501", longitude: "-91.1501" };
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText(/Less than 1 mi away/)).toBeInTheDocument();
    expect(screen.queryByText(/About \d+ mi away/)).toBeNull();
  });

  it("a Browse card (board 25, spec v2 §3; owner pick 4, 11-08): 4:5 photo or the category tint, THREE text lines (title, condition · distance, price), the incl.-fee price bold in ink, NO stars, and real tags only", async () => {
    const card = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      id, seller_id: "u2", status: "live", title, category: "furniture", condition_stars: 4, delivery_size: "small",
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
      live_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), porch_ok: true, ...extra,
    });
    // i1 is on the nightly drop plan and was dropped at the last run, so its next chance is the coming run.
    const lastRunDay = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    dropStates.i1 = { sale_mode: "offers", last_price_drop_on: lastRunDay };
    live.items = [card("i1", "Oak rocking chair"), card("i2", "Brass floor lamp", { delivery_size: "large" }), card("i3", "Cast iron skillet")];
    const browse = at("/declutter", <DeclutterPage />);
    const first = (await screen.findByText("Oak rocking chair")).closest("a")!;
    // @mutate src/components/declutter/DeclutterItemCard.tsx | className="block truncate text-ds-13 font-semibold leading-snug" title={item.title} | className="block line-clamp-2 text-ds-13 font-semibold leading-snug" title={item.title}
    expect(first.querySelector("[data-card-title]")!.className).toMatch(/\btruncate\b/);
    // Owner 11-09 (reverses pick 2 of 11-08): the LIST price is the bold one, in ink; "incl. fee" small and grey under it.
    // @mutate src/components/declutter/DeclutterItemCard.tsx | <span data-card-base-price="" className={`text-ds-16 ${PRICE_PAID}`}> | <span data-card-base-price="" className={`text-ds-11 ${PRICE_BASE}`}>
    const list = first.querySelector("[data-card-price] [data-card-base-price]")!;
    expect(list.className).toMatch(/\bfont-bold\b/);
    expect(list.className).toMatch(/\btext-foreground\b/);
    expect(list.className).not.toMatch(/burnt-sienna/);
    expect(list.textContent).toBe("$40");
    const incl = first.querySelector("[data-card-price] [data-price-incl-fee]")!;
    expect(incl.className).toMatch(/\btext-muted-foreground\b/);
    expect(incl.className).not.toMatch(/\bfont-bold\b/);
    // The list price comes first, the incl.-fee line after it.
    expect(list.compareDocumentPosition(incl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Three text lines under the photo: title, the meta line, the price.
    expect(first.querySelectorAll("[data-card-title], [data-card-place], [data-card-price]")).toHaveLength(3);
    // 4:5 photo (Vinted's taller tile), never square.
    expect(first.querySelector(".aspect-\\[4\\/5\\]")).not.toBeNull();
    // No photo: the category's icon on a tint, never an empty grey box (PhotoPlaceholder).
    // @mutate src/components/declutter/DeclutterItemCard.tsx | <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" /> | {null}
    expect(first.querySelector("[data-photo-placeholder] svg.lucide-sofa")).not.toBeNull();
    expect(first.querySelector("[data-card-price]")!.className).not.toMatch(/\btruncate\b/);
    // #45 (deep audit 2026-10-28): the distance never truncates (shrink-0); the condition beside it gives way first.
    // @mutate src/components/declutter/DeclutterItemCard.tsx | <span data-card-away className="shrink-0 whitespace-nowrap"> | <span data-card-away className="truncate">
    expect(first.querySelector("[data-card-condition]")!.className).toMatch(/\btruncate\b/);
    expect(first.querySelector("[data-card-place]")!.className).not.toMatch(/\btruncate\b/);
    // Porch pickup is a tag on the photo (owner pick 4), not a text line.
    expect(first.querySelector("[data-photo-tags] [data-card-porch]")?.textContent).toBe("Porch pickup");
    // Stars are for people, never an item card (spec v2 §3).
    for (const a of screen.getAllByText(/Oak rocking chair|Brass floor lamp|Cast iron skillet/).map((e) => e.closest("a")!)) {
      expect(a.querySelector("svg.lucide-star")).toBeNull();
    }
    // The tag comes from the real rules: the drop plan, or a big item's Helpr delivery; else none.
    // @mutate src/components/declutter/DeclutterBrowseView.tsx | tag={isNewSince(item, newSince, droppedIn.data) ? "new" : outlook.get(item.id)?.tonight ? "drop" : item.delivery_size !== "small" ? "delivery" : null} | tag={null}
    const tagOf = (t: string) => screen.getByText(t).closest("a")!.querySelector("[data-card-tag]")?.getAttribute("data-card-tag") ?? null;
    // Whether the next chance is tonight depends on the clock (the rule itself: browseFilters.test.ts).
    expect(tagOf("Oak rocking chair")).toBe(dropOutlook(live.items[0] as never, dropStates.i1).tonight ? "drop" : null);
    expect(tagOf("Brass floor lamp")).toBe("delivery");
    expect(tagOf("Cast iron skillet")).toBeNull();
    // Drop wording is never a promise: the stop is private.
    expect(screen.queryByText(/^Drops tonight$/)).toBeNull();
    browse.unmount();
    live.items = [];
    delete dropStates.i1;
  });

  it("category chips at the top of Browse (owner 11-07, replacing 10-21's sheet-only rule) and in the filter sheet set ONE category; a tap shows only that category and marks it, a second tap shows everything", async () => {
    // @mutate src/lib/declutter/browseFilters.ts |     if (f.category && item.category !== f.category) return false; |
    // @mutate src/components/declutter/DeclutterFilterPanel.tsx | <Chip key={key} on={filters.category === key} onClick={() => onChange({ ...filters, category: filters.category === key ? null : key })}> | <Chip key={key} on={filters.category === key} onClick={() => onChange({ ...filters, category: key })}>
    // @mutate src/components/declutter/DeclutterBrowseView.tsx | onChange={(category) => setFilters((f) => ({ ...f, category }))} free= | onChange={() => undefined} free=
    const item = (id: string, title: string, category: string) => ({
      id, seller_id: "u2", status: "live", title, category, condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
    });
    live.items = [item("i1", "Oak rocking chair", "furniture"), item("i2", "Stand mixer", "kitchen")];
    at("/declutter", <DeclutterPage />);
    await screen.findByText("Oak rocking chair");
    // ONE search on Browse: "Search Declutter" with its filters, never Explore's "Search all sections" above it.
    // @mutate src/components/declutter/DeclutterBrowseView.tsx | globalSearch={false} search={head.search} mine={head.mine} fab={fab} tabs={head.tabs}> | globalSearch search={head.search} mine={head.mine} fab={fab} tabs={head.tabs}>
    expect(screen.queryByTestId("explore-search-entry")).toBeNull();
    expect(screen.getAllByRole("searchbox", { name: "Search Declutter" })).toHaveLength(1);
    // The chip row: All, then the categories on the list (never one with nothing for sale), each one tap.
    const chipRow = screen.getByRole("group", { name: "Categories" });
    expect(within(chipRow).getAllByRole("button").map((b) => b.textContent)).toEqual(["All", "Furniture", "Kitchen"]);
    expect(within(chipRow).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(chipRow).getByRole("button", { name: "Kitchen" }));
    expect(screen.queryByText("Oak rocking chair")).toBeNull();
    expect(screen.getByText("Stand mixer")).toBeInTheDocument();
    expect(within(chipRow).getByRole("button", { name: "Kitchen" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(chipRow).getByRole("button", { name: "Kitchen" }));
    expect(screen.getByText("Oak rocking chair")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = await screen.findByRole("dialog");
    const kitchen = within(sheet).getByRole("button", { name: "Kitchen" });
    // One category-name map (lead 2026-10-28): the sheet says what Sell and Wanted say.
    expect(within(sheet).getByRole("button", { name: "Home decor" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Decor" })).toBeNull();
    expect(Object.keys(CATEGORY_LABEL).filter((k) => within(sheet).queryByRole("button", { name: CATEGORY_LABEL[k] })).length).toBeGreaterThan(10);
    fireEvent.click(kitchen);
    expect(kitchen).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Oak rocking chair")).toBeNull();
    expect(screen.getByText("Stand mixer")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Toys and games" }));
    expect(screen.getByText("Nothing in Toys and games right now.")).toBeInTheDocument();
    const toys = within(sheet).getByRole("button", { name: "Toys and games" });
    fireEvent.click(toys);
    expect(toys).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Oak rocking chair")).toBeInTheDocument();
    expect(screen.getByText("Stand mixer")).toBeInTheDocument();
    live.items = [];
  });

  // Owner 2026-10-28: "declutter should have the same search filter and map view as jobs". The old desktop layout
  // (a full-width search row and a permanent Filters column, board 39 / audit #33) is gone; these pin the new one.
  const twoItems = () => {
    const item = (id: string, title: string) => ({
      id, seller_id: "u2", status: "live", title, category: "furniture", condition_stars: 4, delivery_size: "small",
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
    });
    live.items = [item("i1", "Oak rocking chair"), item("i2", "Brass lamp")];
  };

  it("desktop website: Browse's count beside the tab, and search, Filters and the map toggle at the END of the tabs row; no search row, no Filters column; list | map", async () => {
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |         count: listLoading \|\| preview \|\| items.isError ? undefined : rows.length, |         count: undefined,
    // @mutate src/components/declutter/DeclutterHomeView.tsx | end={<>{browse?.end}<SectionSettingsButton settings={DECLUTTER_SETTINGS} /></>} | end={<SectionSettingsButton settings={DECLUTTER_SETTINGS} />}
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |     body = desktop && mapVisible ? ( |     body = false ? (
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |       view={desktop \|\| !member ? undefined : { value: phoneView, set: setPhoneView }} |       view={{ value: phoneView, set: setPhoneView }}
    screenWidth.desktop = true;
    twoItems();
    try {
      const { container } = at("/declutter", <DeclutterPage />);
      await screen.findByText("Oak rocking chair");
      const tabs = screen.getByRole("tablist", { name: "Declutter view" }).parentElement as HTMLElement;
      // The count rides beside "Browse" (SectionTabs browseCount), as Jobs' does.
      expect(within(tabs).getByTestId("browse-count").textContent).toBe("2");
      // The controls are IN the tabs row, not a row of their own.
      const strip = container.querySelector("[data-feed-strip]") as HTMLElement;
      expect(strip).not.toBeNull();
      expect(tabs.contains(strip)).toBe(true);
      // F073 (UI audit 11-09): a visible search field (pinned open), no longer the square.
      expect(within(strip).getByRole("searchbox", { name: "Search items" })).toBeInTheDocument();
      expect(within(strip).getByRole("button", { name: "Filters" })).toBeInTheDocument();
      const mapToggle = within(strip).getByRole("button", { name: "Hide the map" });
      expect(screen.queryByTestId("declutter-browse-bar")).toBeNull();
      expect(container.querySelector("[data-filter-column]")).toBeNull();
      // list | map, the map's pins read only now that a map is on screen.
      expect(container.querySelector("[data-browse-split]")).not.toBeNull();
      await screen.findByRole("region", { name: "Map of items for sale" });
      expect(pins.reads).toBeGreaterThan(0);
      // Filters open the shared FilterSheet; no List / Map choice in it (both are on screen).
      fireEvent.click(within(strip).getByRole("button", { name: "Filters" }));
      const sheet = await screen.findByRole("dialog");
      expect(within(sheet).getByRole("button", { name: "Kitchen" })).toBeInTheDocument();
      expect(within(sheet).queryByRole("radiogroup", { name: "Feed view" })).toBeNull();
      fireEvent.keyDown(sheet, { key: "Escape" });
      // Hiding the map gives the list the width, and the choice is kept.
      fireEvent.click(mapToggle);
      expect(container.querySelector("[data-browse-split]")).toBeNull();
      expect(within(strip).getByRole("button", { name: "Show the map" })).toHaveAttribute("aria-pressed", "false");
      expect(localStorage.getItem("helpr.declutterMapVisible")).toBe("0");
    } finally {
      screenWidth.desktop = false;
      live.items = [];
      localStorage.removeItem("helpr.declutterMapVisible");
    }
  });

  it("phone (owner 11-08, the Vinted header): the Search Declutter bar with Filters inside it, the section tabs under it (F153), then the category chips; the filter sheet's View switches the list to the map, as Jobs' does", async () => {
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |   const pins = useQuery({ queryKey: ["declutter", "map-pins"], queryFn: fetchMapPins, enabled: mapShown && others.length > 0 }); |   const pins = useQuery({ queryKey: ["declutter", "map-pins"], queryFn: fetchMapPins, enabled: others.length > 0 });
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |   } else if (!desktop && mapShown) { |   } else if (false) {
    // @mutate src/components/declutter/DeclutterHomeView.tsx |         <SectionTabs label="Declutter view" value={view} onChange={goTab} tabs= |         <SectionTabs label="Declutter view" value={view} onChange={goTab} onlySelected tabs=
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |         chips: chipRow ? <div data-declutter-chips-row="" className="pb-2">{chipRow}</div> : listLoading && !items.isError ? <DeclutterChipBones /> : null, |         chips: null,
    twoItems();
    pins.reads = 0;
    try {
      const { container } = at("/declutter", <DeclutterPage />);
      await screen.findByText("Oak rocking chair");
      expect(screen.queryByTestId("declutter-browse-bar")).toBeNull();
      // F153 (owner UI audit 11-09): the section tabs are back on a phone, one sideways row under the search bar,
      // above the chips (they were only in My Declutter since 11-08). The gear stays in My Declutter.
      const tabs = screen.getByTestId("section-tabs");
      expect(within(tabs).getAllByRole("tab").map((t) => t.getAttribute("data-section-tab"))).toEqual(expect.arrayContaining(["browse", "buying", "selling", "deliver", "free"]));
      const bar = screen.getByRole("search", { name: "Search Declutter" });
      expect(bar.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(bar).getByRole("button", { name: "Filters" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Declutter settings" })).toBeNull();
      // The chips sit in the header, under the bar, before the grid.
      const chips = container.querySelector("[data-declutter-chips-row]") as HTMLElement;
      expect(chips).not.toBeNull();
      expect(bar.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(tabs.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(chips.compareDocumentPosition(screen.getByText("Oak rocking chair")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Typing filters the feed.
      fireEvent.change(within(bar).getByRole("searchbox", { name: "Search Declutter" }), { target: { value: "lamp" } });
      expect(await screen.findByText("Brass lamp")).toBeInTheDocument();
      // The filter applies on the change (the chair was on screen above), so its absence is checked at once, not waited for (waitForEmptyIsVacuous).
      expect(screen.queryByText("Oak rocking chair")).toBeNull();
      fireEvent.click(within(bar).getByRole("button", { name: "Clear search" }));
      expect(await screen.findByText("Oak rocking chair")).toBeInTheDocument();
      expect(container.querySelector("[data-feed-strip]")).toBeNull();
      expect(container.querySelector("[data-filter-column]")).toBeNull();
      // The list first; no map and no pin read until the member asks for the map.
      expect(container.querySelector("[data-declutter-map]")).toBeNull();
      expect(pins.reads).toBe(0);
      fireEvent.click(within(bar).getByRole("button", { name: "Filters" }));
      const sheet = await screen.findByRole("dialog");
      fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Feed view" })).getByRole("radio", { name: /Map/ }));
      await screen.findByRole("region", { name: "Map of items for sale" });
      expect(pins.reads).toBeGreaterThan(0);
      expect(screen.queryByText("Oak rocking chair")).toBeNull();
      // NIGHT-BUYINGrealma-1: the choice is kept, so a reload opens the map again.
      expect(localStorage.getItem("helpr.declutterPhoneView")).toBe("map");
      // DA-13: the way back is on the map's own screen.
      // @mutate src/components/declutter/DeclutterBrowseView.tsx |  data-map-back="" onClick={() => setPhoneView("list")}> |  data-map-back="">
      fireEvent.click(screen.getByRole("button", { name: "Show list" }));
      expect(await screen.findByText("Oak rocking chair")).toBeInTheDocument();
      expect(container.querySelector("[data-declutter-map]")).toBeNull();
      expect(localStorage.getItem("helpr.declutterPhoneView")).toBe("list");
    } finally {
      live.items = [];
      localStorage.removeItem("helpr.declutterPhoneView");
    }
  });

  it("NIGHT-BUYINGrealma-1: phone, a member who chose the map opens on the map after a reload", async () => {
    // @mutate src/components/declutter/DeclutterBrowseView.tsx | useState<"list" \| "map">(() => (safeStorage.getItem(PHONE_VIEW_KEY) === "map" ? "map" : "list")) | useState<"list" \| "map">(() => "list")
    twoItems();
    localStorage.setItem("helpr.declutterPhoneView", "map");
    try {
      at("/declutter", <DeclutterPage />);
      expect(await screen.findByRole("region", { name: "Map of items for sale" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show list" })).toBeInTheDocument();
    } finally {
      live.items = [];
      localStorage.removeItem("helpr.declutterPhoneView");
    }
  });

  it("DA-16: how you get it shows the same at every width: no breakpoint hides the distance or the porch tag", async () => {
    // @mutate src/components/declutter/DeclutterItemCard.tsx | <span data-card-place="" className="flex min-w-0 text-ds-11 | <span data-card-place="" className="hidden lg:flex min-w-0 text-ds-11
    // @mutate src/components/declutter/DeclutterItemCard.tsx | {item.porch_ok && <PhotoTag data-card-porch="">{t("decl.card.porch")}</PhotoTag>} | {null}
    const { ItemCard } = await import("./DeclutterItemCard");
    const item = {
      id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15, porch_ok: true,
    } as never;
    const r = render(<MemoryRouter><ItemCard item={item} miles={5} approximate={false} /></MemoryRouter>);
    const how = r.container.querySelector("[data-card-place]")!;
    const porch = r.container.querySelector("[data-card-porch]")!;
    expect(how.textContent).toBe("Lightly used · 5 mi");
    expect(porch.textContent).toBe("Porch pickup");
    for (const el of [how, porch, porch.closest("[data-photo-tags]")!]) expect(el.className).not.toMatch(/(^|\s)(hidden|lg:|sm:|md:)/);
    r.unmount();
  });

  it("a card's tile is never blank (audit #32): the category icon sits under every photo, and a photo that fails to load drops out", async () => {
    // @mutate src/components/declutter/DeclutterItemCard.tsx |         {photoPath && photoStage !== "failed" && ( |         {photoPath && (
    // @mutate src/components/declutter/DeclutterItemCard.tsx | <PhotoPlaceholder icon={categoryIcon(item.category)} seed={item.category} className="absolute inset-0 h-full w-full" />\n |
    const { ItemCard } = await import("./DeclutterItemCard");
    const item = {
      id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City", area_lat: 30.45, area_lng: -91.15,
    } as never;
    const r = render(<MemoryRouter><ItemCard item={item} photoPath="u2/declutter/i9/a.png" miles={null} approximate={false} /></MemoryRouter>);
    const tile = r.container.querySelector("[data-item-card]")!;
    // The photo is on top; the icon is already underneath it (a transparent or loading photo shows the icon). A later
    // card's photo renders once firstRowPhotoGate opens (at once: no first-row photo is in flight, B77).
    await waitFor(() => expect(tile.querySelector("img")).not.toBeNull());
    expect(tile.querySelector("[data-photo-placeholder] svg.lucide-sofa")).not.toBeNull();
    // The card-sized thumbnail fails first (owner 10-31: thumbnails), then the full photo it falls back to.
    fireEvent.error(tile.querySelector("img")!);
    fireEvent.error(tile.querySelector("img")!);
    expect(tile.querySelector("img")).toBeNull();
    expect(tile.querySelector("[data-photo-placeholder] svg.lucide-sofa")).not.toBeNull();
    r.unmount();
  });

  it("#45 (deep audit 2026-10-28): a long condition gives way, the distance always shows whole", async () => {
    const { ItemCard } = await import("./DeclutterItemCard");
    const item = {
      id: "i9", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
    } as never;
    const r = render(<MemoryRouter><ItemCard item={item} miles={3.2} approximate={false} /></MemoryRouter>);
    const place = r.container.querySelector("[data-card-place]")!;
    const away = place.querySelector("[data-card-away]")!;
    // Audit 11-10 F321: the short form on the card; the item page keeps "3 mi away".
    expect(away.textContent).toBe("3 mi");
    // @mutate src/components/declutter/DeclutterItemCard.tsx |   const away = milesLabelShort(miles, approximate)?.replace( |   const away = milesLabelShort(miles, approximate)?.concat(" away")?.replace(
    // The distance is its own piece that never shrinks or truncates; only the condition does (owner pick 4, 11-08:
    // the town line is gone).
    expect(away.className).toMatch(/\bshrink-0\b/);
    expect(away.className).not.toMatch(/\btruncate\b/);
    expect(away.closest(".truncate")).toBeNull();
    const cond = place.querySelector("[data-card-condition]")!;
    expect(cond.className).toMatch(/\btruncate\b/);
    expect(cond.contains(away)).toBe(false);
    expect(r.container.textContent).not.toContain("Mid City, Baton Rouge");
    r.unmount();
  });

  it("a heart on each Browse card (slice 4): over the photo, beside the card link (never inside it), and a tap watches the item", async () => {
    // @mutate src/components/declutter/DeclutterBrowseView.tsx |                   toggle: () => toggleWatch.mutate({ id: item.id, on: !(watching.data?.has(item.id) ?? false) }), |                   toggle: () => undefined,
    // @mutate src/components/declutter/DeclutterItemCard.tsx |   if (!save) { |   if (true) {
    live.items = [{
      id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", category: "furniture", condition_stars: 4,
      price_cents: 4000, current_price_cents: 4000, area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15,
    }];
    watchCalls.length = 0;
    at("/declutter", <DeclutterPage />);
    const heart = await screen.findByRole("button", { name: "Save Oak rocking chair" });
    expect(heart).toHaveAttribute("aria-pressed", "false");
    expect(heart.closest("a")).toBeNull();
    fireEvent.click(heart);
    await vi.waitFor(() => expect(watchCalls).toEqual([["i1", true]]));
    live.items = [];
  });

  it("an item page never asks for location", async () => {
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByRole("heading", { name: "Oak rocking chair", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("job screens keep their own wording (useUserLocation's default is unchanged)", async () => {
    render(<PermissionRationaleDialog />);
    renderHook(() => useUserLocation(true));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/show jobs near you/);
  });

  // LAST in the file: it fills useUserLocation's module cache (5-minute TTL),
  // which every Declutter screen reads on landing.
  it("a cached COARSE fix keeps its flag, so the item page says 'about' (finding 5)", async () => {
    getCurrentPosition.mockImplementation((ok: PositionCallback) =>
      ok({ coords: { latitude: 30.4501, longitude: -91.1501, accuracy: 45_000 } } as GeolocationPosition),
    );
    render(<PermissionRationaleDialog />);
    const hook = renderHook(() => useUserLocation(true));
    await screen.findByRole("alertdialog");
    act(() => __resolveRationale(true));
    await vi.waitFor(() => expect(hook.result.current).toMatchObject({ status: "ready", source: "device", approximate: true }));
    cleanup();

    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText(/About 1 mi away/)).toBeInTheDocument();
  });
});
