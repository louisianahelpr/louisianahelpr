/**
 * L8 (iOS design audit 2026-11-16, se-90-404.png): a signed-in member on the 404 had no bottom bar and no header, so
 * the page's own button was the only way out. The standard says the catch-all renders with full chrome. MobileNav
 * and PublicLayout now ask routeHasDock(pathname, useNotFoundPathname()): the 404's own pathname carries the dock,
 * and PublicLayout reserves its clearance. Any other unknown path (the marketing "/") still has none.
 *
 * The real dock renders under the real router; the catch-all reports itself exactly as NotFound does.
 *
 * @mutate src/components/mobileNav/mobileNavHelpers.ts |   return notFound === pathname \|\| authPages.some |   return authPages.some
 * @mutate src/components/MobileNav.tsx |   if (!routeHasDock(location.pathname, notFoundPath)) return null; |   if (!routeHasDock(location.pathname, null)) return null;
 * @mutate src/components/marketing/PublicLayout.tsx |     const reserveBottomNav = routeHasDock(location.pathname, notFoundPath); |     const reserveBottomNav = routeHasDock(location.pathname, null);
 */
import { describe, it, expect, vi, afterEach } from "vitest";
// The account's Customize row (useSectionPrefs, Q2199) is data, not what this spec measures: answered locally
// (no row yet, saves accepted); the device copy and the hook's own rules stay real.
vi.mock("@/lib/sectionPrefsRow", () => ({
  fetchSectionPrefsRow: async () => ({ data: null, error: null }),
  saveSectionPrefsRow: async () => ({ error: null }),
}));

import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: () => false,
  useFeatureStatus: () => ({ on: false, settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-dock", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0, markAllRead: () => {} }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));

import { useEffect } from "react";
import MobileNav from "@/components/MobileNav";
import { setNotFoundPathname } from "@/hooks/useAppShellViewport";
import { blankComments } from "@/test/helpers/blankNonCode";
import { readFileSync } from "node:fs";

/** The catch-all, reporting itself the way src/pages/info/NotFound.tsx does. */
function CatchAll() {
  const { pathname } = useLocation();
  useEffect(() => {
    setNotFoundPathname(pathname);
    return () => setNotFoundPathname(null);
  }, [pathname]);
  return <p>Page not found</p>;
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <MobileNav />
        <Routes>
          <Route path="/home" element={<p>Home page</p>} />
          <Route path="/" element={<p>Landing</p>} />
          <Route path="*" element={<CatchAll />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dock = () => document.querySelector('nav[aria-label="Bottom navigation"]');

afterEach(() => {
  cleanup();
  setNotFoundPathname(null);
});

describe("L8: the 404 keeps the bottom bar for a member", () => {
  it("a dock route has the dock (control)", () => {
    renderAt("/home");
    expect(dock()).not.toBeNull();
  });

  it("the 404 has the dock, and html keeps its clearance", async () => {
    renderAt("/no-such-page-at-all");
    await screen.findByText("Page not found");
    expect(dock()).not.toBeNull();
    expect(document.documentElement.classList.contains("no-bottom-nav")).toBe(false);
  });

  it("an unknown path that is not the 404 still has none (the marketing landing)", () => {
    renderAt("/");
    expect(screen.getByText("Landing")).toBeTruthy();
    expect(dock()).toBeNull();
  });

  it("PublicLayout reserves the dock's clearance on the 404 from the same answer", () => {
    const src = blankComments(readFileSync("src/components/marketing/PublicLayout.tsx", "utf8"));
    expect(src).toMatch(/reserveBottomNav = routeHasDock\(location\.pathname, notFoundPath\)/);
    expect(src).toMatch(/notFoundPath = useNotFoundPathname\(\)/);
    const nf = blankComments(readFileSync("src/pages/info/NotFound.tsx", "utf8"));
    expect(nf).toMatch(/setNotFoundPathname\(location\.pathname\)/);
  });
});
