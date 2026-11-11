/**
 * Builder 1 Shops screenshot pass (Q1958, 11-10, prod, helper-e2e, read-only): helper-e2e owns a shop, yet /shops at
 * 375 floated "+ Open a shop" over its own open shop card (~/.lh-shots/b1-owner-1110c/shops-discover-H-375-light.png),
 * and the pill landed on "Edit my shop". The desktop bar's "+ Open a shop" did the same. A member with a shop is now
 * offered "+ Add an item" (the item editor, /shops/mine#add-item) on both; a member without one keeps "+ Open a shop";
 * neither shows until the answer is in, so the words never change under the member's thumb.
 *
 * @mutate src/components/shops/ShopsHomeView.tsx | const add = myShop.data ? ADD_AN_ITEM : undefined; | const add = undefined as typeof ADD_AN_ITEM \| undefined;
 * @mutate src/components/shops/ShopsHomeView.tsx | <SectionCreateFab section="shops" text="Open a shop" add={add} /> | <SectionCreateFab section="shops" text="Open a shop" />
 * @mutate src/components/sections/SectionCreateFab.tsx | const add = own ?? (section ? sectionByKey(section).add : null); | const add = section ? sectionByKey(section).add : null;
 * @mutate src/components/sections/AppTopBar.tsx | <SectionAddButton section={section} add={add} /> | <SectionAddButton section={section} />
 * @mutate src/components/sections/SectionScreen.tsx | showAdd={showAdd} add={add} /> | showAdd={showAdd} />
 * @mutate src/components/shops/ShopsHomeView.tsx | fab={desktop \|\| !known ? undefined | fab={desktop ? undefined
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ desktop: false, myShop: null as string | null, hold: false }));

vi.mock("@/components/sections/useSectionPrefs", async (orig) => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { ...(await orig<object>()), useSectionPrefs: () => ({ prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, visible: SECTIONS, setHidden: vi.fn(() => true), move: vi.fn(), putFirst: vi.fn() }) };
});
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { full_name: "Test Member" } }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true, lastAnswer: true }) }));
vi.mock("@/hooks/useAuthReady", async (orig) => ({ ...(await orig<object>()), useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/lib/needsYouStore", async (orig) => ({ ...(await orig<object>()), useNeedsYouCounts: () => ({ shops: 0 }) }));
vi.mock("@/components/declutter/useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "none" } }) }));
vi.mock("@/lib/errorLogger", async (orig) => ({ ...(await orig<object>()), report: () => {} }));
vi.mock("@/lib/shops/api", async (orig) => ({
  ...(await orig<object>()),
  fetchMyShopId: () => (state.hold ? new Promise(() => {}) : Promise.resolve(state.myShop)),
  browseShops: () => Promise.resolve([]),
  fetchShopCategories: () => Promise.resolve([]),
  fetchShopCardExtras: () => Promise.resolve(new Map()),
}));

import ShopsHomeView from "@/components/shops/ShopsHomeView";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";

const slot = document.createElement("div");
document.body.appendChild(slot);
registerDesktopTitleSlot(slot);

afterEach(() => { cleanup(); state.hold = false; });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/shops"]}>
        <Routes>
          <Route path="/shops" element={<ShopsHomeView />} />
          <Route path="/shops/mine" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a member who already has a shop is never offered '+ Open a shop' on /shops", () => {
  it("phone, has a shop: the pill says Add an item and opens the item editor", async () => {
    state.desktop = false; state.myShop = "shop-1";
    mount();
    const fab = await screen.findByTestId("section-create-fab");
    expect(fab.textContent).toBe("Add an item");
    expect(screen.queryByText(/Open a shop/)).toBeNull();
    fireEvent.click(fab);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/shops/mine#add-item"));
  });

  it("phone, no shop: the pill still says Open a shop (the control is not dead)", async () => {
    state.desktop = false; state.myShop = null;
    mount();
    expect((await screen.findByTestId("section-create-fab")).textContent).toBe("Open a shop");
  });

  it("phone, answer not in yet: no pill, so its words never change under a thumb", async () => {
    state.desktop = false; state.myShop = "shop-1"; state.hold = true;
    mount();
    await screen.findByText("Shops");
    expect(screen.queryByTestId("section-create-fab")).toBeNull();
  });

  it("desktop, has a shop: the bar's button says Add an item", async () => {
    state.desktop = true; state.myShop = "shop-1";
    mount();
    const add = await screen.findByTestId("section-add");
    expect(add.textContent).toBe("Add an item");
    expect(add.getAttribute("aria-label")).toBe("Add an item to my shop");
  });

  it("desktop, no shop: the bar's button says Open a shop", async () => {
    state.desktop = true; state.myShop = null;
    mount();
    expect((await screen.findByTestId("section-add")).textContent).toBe("Open a shop");
  });
});
