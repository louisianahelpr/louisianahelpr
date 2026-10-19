/**
 * The photo-first Declutter item page (owner, 2026-10-19: Facebook Marketplace /
 * OfferUp / Mercari): the swipeable gallery with dots and a full-screen viewer,
 * the category tint when there is no photo, the seller card (stars only with
 * reviews, "Joined <month year>", no invented response time), Share with the
 * item's own link, and the phone's buy bar while the in-page buttons are off
 * screen. The API is stubbed: these check what each state renders.
 *
 * @mutate src/components/declutter/DeclutterGallery.tsx |   if (urls.length === 0) { |   if (false) {
 * @mutate src/components/declutter/DeclutterGallery.tsx |               onClick={() => setOpen(i)} |               onClick={() => undefined}
 * @mutate src/components/declutter/DeclutterGallery.tsx |             if (el.clientWidth > 0) setAt(Math.round(el.scrollLeft / el.clientWidth)); |             void el;
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |               {reviews > 0 && (\n                <span data-seller-rating | {true && (\n                <span data-seller-rating
 * @mutate src/components/declutter/DeclutterSellerCard.tsx |               {joined && <span>{joined}</span>} |
 * @mutate src/components/declutter/DeclutterItemView.tsx |     url: `${getPublicOrigin()}/declutter/item/${it.id}`, |     url: getPublicOrigin(),
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx |   const barShown = useOffScreen(buttons); |   const barShown = false;
 * @mutate src/lib/declutter/api.ts |   const row = pickRequestedProfile(rows, sellerId) | const row = rows[0]
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  item: null as unknown,
  photos: [] as unknown[],
  rating: { avg: 4.8, count: 12 } as { avg: number; count: number } | null,
  seller: { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" } as unknown,
  safeRows: [] as unknown[],
};
const shared: unknown[] = [];

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useUserLocation", () => ({
  useUserLocation: () => ({ status: "idle" }),
  getCachedUserLocation: () => null,
  deriveFallbackLocation: async () => null,
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
vi.mock("@/lib/nativeShare", () => ({ shareNative: async (c: unknown) => { shared.push(c); return "shared"; } }));
vi.mock("@/lib/authRedirects", async () => ({
  ...(await vi.importActual<object>("@/lib/authRedirects")),
  getPublicOrigin: () => "https://www.louisianahelpr.com",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: state.safeRows, error: null }) },
}));
vi.mock("@/lib/declutter/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/declutter/api")>("@/lib/declutter/api");
  return {
    ...real,
    fetchSellerCardReal: real.fetchSellerCard,
    fetchItem: async () => state.item,
    fetchPhotos: async () => state.photos,
    fetchQuestions: async () => [],
    fetchWatching: async () => new Set(),
    fetchMyItemReview: async () => null,
    fetchSellerRating: async () => state.rating,
    fetchSellerCard: async () => state.seller,
    fetchMyCard: async () => null,
    photoPublicUrl: (p: string) => `https://cdn/${p}`,
    setWatch: async () => "watching",
    askQuestion: async () => "q",
    answerQuestion: async () => "a",
    makeOffer: async () => "o",
    buyNow: async () => "l",
    startCardSave: async () => "https://stripe",
  };
});
vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));

import DeclutterItemPage from "@/pages/declutter/DeclutterItemPage";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import * as api from "@/lib/declutter/api";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ITEM = {
  id: ID, seller_id: "u2", status: "live", title: "Oak rocking chair", description: "Solid oak.",
  category: "furniture", condition_stars: 4, delivery_size: "large", price_cents: 4000, current_price_cents: 4000,
  area_label: "Mid-City, Baton Rouge", area_lat: 30.45, area_lng: -91.15, created_at: "2026-10-14", live_at: null, porch_ok: true,
};

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/declutter/item/${ID}`]}>
        <Routes>
          <Route path="/declutter/item/:id" element={<DeclutterItemPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the photo-first Declutter item page", () => {
  beforeEach(() => {
    state.item = { ...ITEM };
    state.photos = [];
    state.rating = { avg: 4.8, count: 12 };
    state.seller = { name: "Dana Robichaux", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" };
    shared.length = 0;
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

  it("no photos: the category tint, never a blank box, and no dots", async () => {
    open();
    await screen.findByRole("heading", { name: "Oak rocking chair", level: 2 });
    expect(document.querySelector("[data-gallery-empty] [data-photo-placeholder]")).not.toBeNull();
    expect(document.querySelector("[data-gallery-dots]")).toBeNull();
  });

  it("seller card: First L., stars and joined date; a seller with no reviews shows no stars and no 'No reviews yet'", async () => {
    const { unmount } = open();
    expect(await screen.findByText("Dana R.")).toBeInTheDocument();
    expect(screen.getByText("Joined March 2025")).toBeInTheDocument();
    expect(document.querySelector("[data-seller-rating]")?.textContent).toContain("12 reviews");
    expect(screen.getByRole("link", { name: "See the seller, Dana R." })).toHaveAttribute("href", "/user/u2");
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

  it("phone: while the in-page Buy now / Make an offer are off screen, the same two ride in a bar above the dock", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() { this.cb([{ isIntersecting: false }]); }
        disconnect() {}
      },
    );
    open();
    await screen.findAllByRole("button", { name: "Buy now · $40" });
    const bar = document.body.querySelector("[data-declutter-buybar]") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.className).toContain("bottom-safe-nav");
    expect(within(bar).getByRole("button", { name: "Buy now · $40" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Make an offer" })).toBeInTheDocument();
  });
});
