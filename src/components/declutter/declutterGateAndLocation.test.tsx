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
 * @mutate src/components/declutter/declutterUi.tsx |   return settled ? <NotFound /> : <>{skeleton}</>; |   return settled ? <NotFound /> : null;
 * @mutate src/components/declutter/useDeclutterOrigin.ts |   const [asked, setAsked] = useState(false); |   const [asked, setAsked] = useState(true);
 * @mutate src/components/declutter/useDeclutterOrigin.ts |   const device = useUserLocation(asked, "declutter_location"); |   const device = useUserLocation(asked);
 * @mutate src/pages/declutter/DeclutterItemPage.tsx | skeleton={isItemId(id) ? <DeclutterItemSkeleton /> : <DeclutterItemUnavailable />} | skeleton={<DeclutterItemSkeleton />}
 * @mutate src/hooks/usePermissionRationale.ts | body: "Declutter uses your location to show how far away each item is | body: "We use your location to show jobs near you, how far away each item is
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = { feature: true, featureSettled: true };

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
// ONE object, as React Query hands back: a fresh profile per render would
// re-run every effect keyed on it.
const account = { user: { id: "u1" }, profile: {}, isLoading: false };
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => account }));
vi.mock("@/lib/persistUserLocation", () => ({ persistUserLocation: async () => undefined }));
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
  fetchLiveItems: async () => [],
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
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
        </Routes>
      </MemoryRouter>
      <PermissionRationaleDialog />
    </QueryClientProvider>,
  );
}

const bones = (c: HTMLElement) => c.querySelectorAll("[data-skeleton]").length;

describe("Declutter loading frame (DeclutterGate)", () => {
  beforeEach(() => {
    state.feature = false;
    state.featureSettled = false;
  });

  it.each([
    ["/declutter", <DeclutterPage key="h" />, "/declutter", "Declutter"],
    ["/declutter/sell", <DeclutterSellPage key="s" />, "/declutter/sell", "Sell an item"],
    ["/declutter/item/0f0e0d0c-0b0a-4908-8706-050403020100", <DeclutterItemPage key="i" />, "/declutter/item/:id", "Item"],
  ])("%s: the switch still loading paints the page's shell and bones, not a blank page", (path, el, route, title) => {
    const { container } = at(path, el, route);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(bones(container)).toBeGreaterThan(0);
    expect(screen.queryByText("Page not found")).toBeNull();
  });

  it("a link that cannot name an item says so at once: no skeleton of photos that will never come", () => {
    const { container } = at("/declutter/item/test", <DeclutterItemPage />, "/declutter/item/:id");
    expect(screen.getByText("This item isn't available.")).toBeInTheDocument();
    expect(bones(container)).toBe(0);
  });

  it("a settled 'off' is still the 404, with no skeleton left behind", () => {
    state.featureSettled = true;
    const { container } = at("/declutter", <DeclutterPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(bones(container)).toBe(0);
  });
});

describe("Declutter location ask", () => {
  beforeEach(() => {
    state.feature = true;
    state.featureSettled = true;
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
    // Once asked, the button goes (a declined prompt cannot be re-shown from the page).
    expect(screen.queryByRole("button", { name: "Use my location" })).toBeNull();
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
});
