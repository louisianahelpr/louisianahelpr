/**
 * S043 (Shops audit 11-12): Browse search runs on the server. Typing waits SHOPS_SEARCH_WAIT_MS, then asks shops_browse
 * with p_query (it matches the shop's name, category, area and its live items' titles), and shows every row it sends,
 * even a shop whose name never says the words (it matched on an item). The SQL side is guarded in
 * src/test/shopsBrowseSearch.test.ts and proven in src/test/pglite/shopsBrowseSearch.pglite.mjs.
 *
 * @mutate src/lib/shops/api.ts |       ...(args.query?.trim() ? { p_query: args.query.trim().slice(0, 80) } : {}), |
 * @mutate src/components/shops/ShopsHomeView.tsx |   const shown = list; |   const shown = list.filter((s) => !words || s.name.toLowerCase().includes(words));
 * @mutate src/components/shops/ShopsHomeView.tsx |     queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group, searched], |     queryKey: ["shops", "browse", from?.lat ?? null, from?.lng ?? null, group],
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({ rpc: [] as Array<Record<string, unknown>> }));

vi.mock("@/components/sections/useSectionPrefs", async (orig) => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { ...(await orig<object>()), useSectionPrefs: () => ({ prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, visible: SECTIONS, setHidden: vi.fn(() => true), move: vi.fn(), putFirst: vi.fn() }) };
});
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { full_name: "Test Member" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", async (orig) => ({ ...(await orig<object>()), useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/lib/needsYouStore", async (orig) => ({ ...(await orig<object>()), useNeedsYouCounts: () => ({ shops: 0 }) }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "none" } }) }));
vi.mock("@/lib/errorLogger", async (orig) => ({ ...(await orig<object>()), report: () => {} }));
vi.mock("./ShopBrowseCard", () => ({ ShopBrowseCard: ({ shop }: { shop: { name: string } }) => <p data-testid="shop-card">{shop.name}</p> }));
// The real browseShops, on a fake rpc: the page size and p_offset it sends are what this guards.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== "shops_browse") return { data: null, error: { message: `unexpected ${name}` } };
      calls.rpc.push(args);
      // The server matched the words (an item title can match a shop whose name never says them).
      if (args.p_query) return { data: [{ id: "k1", name: "Sweet Spot", category: "bakery", area_label: "Uptown" }], error: null };
      return { data: [{ id: "a", name: "Bayou Boards", category: "woodwork", area_label: "Mid-City" }, { id: "b", name: "Sweet Spot", category: "bakery", area_label: "Uptown" }], error: null };
    },
  },
}));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyShopId: () => Promise.resolve(null),
  fetchShopCategories: () => Promise.resolve([]),
  fetchShopCardExtras: () => Promise.resolve(new Map()),
}));

import ShopsHomeView from "@/components/shops/ShopsHomeView";

afterEach(() => { cleanup(); calls.rpc = []; });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops"]}><ShopsHomeView /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("S043: Browse search runs on the server", () => {
  it("typing asks shops_browse with p_query and shows what it found, item-title matches included", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId("shop-card")).toHaveLength(2));
    expect(calls.rpc[0].p_query).toBeUndefined();
    fireEvent.change(screen.getByPlaceholderText("Search shops"), { target: { value: "  King Cake " } });
    await waitFor(() => expect(calls.rpc.some((a) => a.p_query === "king cake")).toBe(true));
    await waitFor(() => expect(screen.getAllByTestId("shop-card").map((c) => c.textContent)).toEqual(["Sweet Spot"]));
  });
});
