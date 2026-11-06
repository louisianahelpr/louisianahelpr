/**
 * Q2005 (NOT-LAUNCHED Shops; audit 11-05 M16): while Shops is switched off for a member, every Shops route shows
 * "Opens soon" in the shared Browse empty state, never the bare 404 (old links, shared links). /shops keeps its
 * section frame; a sub-screen keeps its own title. The not-found page also files a "non-existent route" error report,
 * which an old Shops link must never do.
 *
 * @mutate src/components/shops/shopsUi.tsx |   if (settled) return <ShopsOpensSoon title={title} backTo={backTo} sectionRoot={!!skeleton} />; |   if (settled) return null;
 * @mutate src/components/shops/shopsUi.tsx |       title="Opens soon" |       title="Page not found"
 * @mutate src/components/shops/shopsUi.tsx |   if (sectionRoot) { |   if (false) {
 * @mutate src/components/shops/shopsUi.tsx |           <Link to="/home">Go to Dashboard</Link> |           <Link to="/">Go to Dashboard</Link>
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
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null }) }));
// The switch answered OFF (settled): a signed-out answer is settled at once.
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true, lastAnswer: false }) }));
vi.mock("@/hooks/useAuthReady", async (orig) => ({ ...(await orig<object>()), useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null, useSectionsOpen: () => ({ open: null, settled: true }) }));
const reported = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/errorLogger", async (orig) => ({ ...(await orig<object>()), report: () => { reported.calls += 1; } }));

import ShopsPage from "@/pages/shops/ShopsPage";
import ShopOrdersPage from "@/pages/shops/ShopOrdersPage";
import ShopEditPage from "@/pages/shops/ShopEditPage";
import ShopDashboardPage from "@/pages/shops/ShopDashboardPage";
import { SHOPS_OPENS_SOON_BODY } from "./shopsUi";

afterEach(cleanup);

function mount(node: ReactNode, path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const PAGES: Array<[string, () => ReactNode, string]> = [
  ["/shops", () => <ShopsPage />, "Shops"],
  ["/shops/orders", () => <ShopOrdersPage />, "My orders"],
  ["/shops/mine", () => <ShopEditPage />, "My shop"],
  ["/shops/dashboard", () => <ShopDashboardPage />, "Shop dashboard"],
];

describe("Shops switched off shows Opens soon, never the 404 (Q2005)", () => {
  it.each(PAGES)("%s", (path, page, title) => {
    reported.calls = 0;
    mount(page(), path);
    expect(screen.getByText("Opens soon")).toBeTruthy();
    expect(screen.getByText(SHOPS_OPENS_SOON_BODY)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/home");
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.queryByText(/page not found|404/i)).toBeNull();
    expect(reported.calls).toBe(0);
  });

  it("/shops keeps its section frame (the Explore header), not a sub-screen's back arrow", () => {
    mount(<ShopsPage />, "/shops");
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /back/i })).toBeNull();
    expect(document.querySelector("[data-browse-empty]")).not.toBeNull();
  });

  it("a sub-screen keeps its own title and back link", () => {
    mount(<ShopOrdersPage />, "/shops/orders");
    expect(document.querySelector("[data-browse-empty]")).not.toBeNull();
    expect(screen.getAllByText("My orders").length).toBeGreaterThan(0);
  });
});
