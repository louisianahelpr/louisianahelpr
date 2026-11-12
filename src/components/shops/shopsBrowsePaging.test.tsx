/**
 * S043 (Shops audit 11-12): Browse held only the nearest page of shops (shops_browse caps a page at 60) with no
 * "load more", so its search could never reach a shop beyond it. A full page now offers "Show more shops", which asks
 * shops_browse for the next page (p_offset) and adds it under the cards; the friendly end card shows only once the
 * last page is in.
 *
 * @mutate src/components/shops/ShopsHomeView.tsx |     getNextPageParam: (last, all) => (last.length >= SHOPS_BROWSE_PAGE ? all.length * SHOPS_BROWSE_PAGE : undefined), |     getNextPageParam: () => undefined,
 * @mutate src/lib/shops/api.ts |       ...(args.offset ? { p_offset: args.offset } : {}), |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls = vi.hoisted(() => ({ rpc: [] as Array<Record<string, unknown>>, total: 61 }));

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
      const from = Number(args.p_offset ?? 0);
      const n = Math.max(0, Math.min(Number(args.p_limit), calls.total - from));
      return { data: Array.from({ length: n }, (_, i) => ({ id: `s${from + i}`, name: `Shop ${from + i}`, category: "bakery", area_label: "Broussard" })), error: null };
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

afterEach(() => { cleanup(); calls.rpc = []; calls.total = 61; });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops"]}><ShopsHomeView /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("S043: Browse pages past the nearest 60 shops", () => {
  it("a full page offers Show more shops, which loads the next page under the cards", async () => {
    mount();
    await waitFor(() => expect(screen.getAllByTestId("shop-card")).toHaveLength(60));
    expect(calls.rpc[0]).toMatchObject({ p_limit: 60 });
    expect(calls.rpc[0].p_offset).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Show more shops" }));
    await waitFor(() => expect(screen.getAllByTestId("shop-card")).toHaveLength(61));
    expect(calls.rpc[1]).toMatchObject({ p_limit: 60, p_offset: 60 });
    expect(screen.getByText("Shop 60")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more shops" })).toBeNull();
  });

  it("a short first page: no Show more", async () => {
    calls.total = 5;
    mount();
    await waitFor(() => expect(screen.getAllByTestId("shop-card")).toHaveLength(5));
    expect(screen.queryByRole("button", { name: "Show more shops" })).toBeNull();
  });
});
