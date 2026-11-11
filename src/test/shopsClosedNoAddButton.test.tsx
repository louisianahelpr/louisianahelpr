/**
 * Q2005 screenshot pass (Builder 1, 11-10, MOCKED switch answer with shops off): at 1440 the "Coming soon" /shops
 * screen still drew the desktop bar's "+ Open a shop" beside the bell, an action into a section that is closed to
 * this member (~/.lh-shots/b1-owner-1110b/shops-MOCKED-off-P-1440-light.png; 375 had none). ShopsOpensSoon now asks
 * SectionScreen for no add button (showAdd={false}); an open section keeps it.
 *
 * @mutate src/components/shops/shopsUi.tsx | search={null} showAdd={false}> | search={null}>
 * @mutate src/components/sections/AppTopBar.tsx | isWebDesktop && showAdd && section && | isWebDesktop && section &&
 * @mutate src/components/sections/SectionScreen.tsx | mine={mine} showAdd={showAdd} /> | mine={mine} />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/components/sections/useSectionPrefs", async (orig) => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { ...(await orig<object>()), useSectionPrefs: () => ({ prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, visible: SECTIONS, setHidden: vi.fn(() => true), move: vi.fn(), putFirst: vi.fn() }) };
});
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }) }));
vi.mock("@/hooks/useAuthReady", async (orig) => ({ ...(await orig<object>()), useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null, useSectionsOpen: () => ({ open: null, settled: true }) }));
vi.mock("@/lib/errorLogger", async (orig) => ({ ...(await orig<object>()), report: () => {} }));

import ShopsPage from "@/pages/shops/ShopsPage";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";

// The desktop app header's title slot (DesktopTopNav registers it): the section bar portals its row there.
const slot = document.createElement("div");
document.body.appendChild(slot);
registerDesktopTitleSlot(slot);

afterEach(cleanup);

function mount(node: ReactNode, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a closed Shops section offers no '+ Open a shop' on the desktop bar (Q2005)", () => {
  it("/shops while Shops is off: Coming soon, and no add button", () => {
    mount(<ShopsPage />, "/shops");
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByTestId("section-add")).toBeNull();
    expect(screen.queryByText(/Open a shop/)).toBeNull();
  });

  it("an open section's screen still draws its add button (the control is not dead)", () => {
    mount(<SectionScreen section="shops" title="Shops"><p>body</p></SectionScreen>, "/shops");
    expect(screen.getByTestId("section-add").textContent).toContain("Open a shop");
  });
});
