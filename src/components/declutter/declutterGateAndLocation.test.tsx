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
 * @mutate src/components/declutter/DeclutterItemView.tsx |   const away = milesLabel(miles, geo.status === "ready" && geo.approximate); |   const away = milesLabel(miles);
 * @mutate src/components/declutter/DeclutterHomeView.tsx | miles={miles} approximate={origin.status === "ready" && origin.approximate} /> | miles={miles} approximate={false} />
 * @mutate src/components/declutter/useDeclutterOrigin.ts |     asked && device.status === "error" | false && device.status === "error"
 * @mutate src/pages/declutter/DeclutterItemPage.tsx | skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable />} | skeleton={<DeclutterItemSkeleton />}
 * @mutate src/hooks/usePermissionRationale.ts | body: "Declutter uses your location to show how far away each item is | body: "We use your location to show jobs near you, how far away each item is
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { feature: true, featureSettled: true };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
// What Browse lists; empty unless a test puts an item up.
const live: { items: unknown[] } = { items: [] };
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// ONE object, as React Query hands back: a fresh profile per render would
// re-run every effect keyed on it.
const account: { user: { id: string }; profile: Record<string, unknown>; isLoading: boolean } = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
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
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>Page not found</p> }));
vi.mock("@/lib/declutter/api", () => ({
  fetchHasAgreedSales: async () => false,
  fetchLiveItems: async () => live.items,
  fetchMyItems: async () => [],
  fetchPhotos: async () => [],
  fetchQuestions: async () => [],
  fetchSellerRating: async () => ({ avg: 0, count: 0 }),
  fetchWatching: async () => new Set(),
  fetchItem: async () => ({
    id: "i1", seller_id: "u2", status: "live", title: "Oak rocking chair", description: "Solid oak.",
    category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
    area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null,
  }),
  fetchMyItemReview: async () => null,
  fetchMyItemPrivate: async () => null,
  fetchMyPickupWindows: async () => [],
  photoPublicUrl: (p: string) => `https://cdn/${p}`,
  withdrawItem: async () => undefined,
  setWatch: async () => "watching",
  askQuestion: async () => "q",
  answerQuestion: async () => "a",
}));

import DeclutterPage from "@/pages/declutter/DeclutterPage";
import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { PermissionRationaleDialog } from "@/components/PermissionRationaleDialog";
import { useUserLocation } from "@/hooks/useUserLocation";
import { __resolveRationale } from "@/hooks/usePermissionRationale";

const getCurrentPosition = vi.fn();

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Settled: what useFeature's own query holds once the server answered.
  // Not settled: the query has not answered yet (the loading frame).
  if (state.featureSettled) qc.setQueryData(["feature-enabled", "declutter", "u1"], state.feature);
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
    expect(screen.getByText("This item isn't available.")).toBeInTheDocument();
    expect(bones(container)).toBe(0);
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
    getCurrentPosition.mockReset();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  });
  afterEach(() => {
    act(() => __resolveRationale(false));
  });

  it("landing on Browse asks for nothing; 'Use my location' asks with Declutter's own words", async () => {
    at("/declutter", <DeclutterPage />);
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
    // (Not answered "Share Location" here: a fix would fill the module cache
    // that the later tests in this file land on.)
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("a ZIP on file that could not be placed is never told to 'add your ZIP code' (finding 6)", async () => {
    account.profile = { zip_code: "70808" };
    at("/declutter", <DeclutterPage />);
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
    expect(await screen.findByText(/Mid-City, Baton Rouge · About 1 mi away/)).toBeInTheDocument();
    browse.unmount();
    live.items = [];

    account.profile = { latitude: "30.4501", longitude: "-91.1501" };
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByText(/Less than 1 mi away/)).toBeInTheDocument();
    expect(screen.queryByText(/About \d+ mi away/)).toBeNull();
  });

  it("an item page never asks for location", async () => {
    at("/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage />, "/declutter/item/:id");
    expect(await screen.findByRole("heading", { name: "Oak rocking chair" })).toBeInTheDocument();
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
