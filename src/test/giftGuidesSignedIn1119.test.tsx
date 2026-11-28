/**
 * GUARD (owner 11-19): "make sure the guides can be easily viewed and accessed when signed in or out". The signed-out
 * half (the public bar's "Guides" on every page at every phone width) is src/test/navGiftGuidesOnPhone1118.test.tsx.
 * Signed in, a member reaches the Holiday gift guides from where members look:
 *  - the desktop rail has its own "Holiday gift guides" row with the gift icon, a real link to /gift-guides, marked
 *    current on any guide;
 *  - on a phone (no rail, and the public bar is for guests), You (where the top bar's photo leads) has a "Holiday Gift
 *    Guides" row, a real link to /gift-guides;
 *  - the desktop photo menu keeps its "Holiday gift guides" item and Home keeps the closable promo card
 *    (GiftGuidesPromo, src/test/giftGuidesPromo.test.tsx);
 *  - /gift-guides and /gift-guides/<slug> are open routes: no MarketingRedirect, SignedInRedirect or ProtectedRoute
 *    wraps them, and a signed-in member who opens a guide stays on it (it is not sent to /home).
 *
 * @mutate src/components/DesktopSidebarNav.tsx |     { path: "/gift-guides", icon: Gift, label: "Holiday gift guides", nested: true }, |
 * @mutate src/components/DesktopSidebarNav.tsx | (sec.key === "jobs" \|\| sec.key === "declutter" ? i + 1 : at) | (at)
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |             to="/gift-guides"\n            data-testid="you-gift-guides" |             to="/profile"\n            data-testid="you-gift-guides"
 * @mutate src/App.tsx | <Route path="/gift-guides/:slug" element={<RouteErrorBoundary>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</RouteErrorBoundary>} /> | <Route path="/gift-guides/:slug" element={<RouteErrorBoundary><MarketingRedirect>{routeEl(<PageTransition><GiftGuides /></PageTransition>)}</MarketingRedirect></RouteErrorBoundary>} />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return b;
    },
  },
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));
// The rail's other reads, as in adminEntryOnlyForAdmins.test.tsx.
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0 }) }));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; });
vi.mock("@/components/create/CreateSheet", () => ({ CreateSheet: () => null }));
// The page's chrome (PublicLayout picks the app shell for a member) is not what this pins; its own tests cover it.
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: ReactNode }) => <main><h1 data-test-title="">{title}</h1>{children}</main>,
}));

import DesktopSidebarNav from "@/components/DesktopSidebarNav";
import { YouMenu } from "@/components/profile/profileLanding/YouMenu";
import GiftGuides from "@/pages/info/GiftGuides";
import { GUIDES } from "@/content/giftGuideCatalog";

afterEach(cleanup);

let where = "";
function Where() { where = useLocation().pathname; return null; }
const wrap = (ui: ReactNode, path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}>{ui}<Where /></MemoryRouter></QueryClientProvider>);
};
const src = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("signed in, the Holiday gift guides are one tap away (owner 11-19)", () => {
  it("the desktop rail has a Holiday gift guides row: the gift icon, a real link, current on a guide", () => {
    const slug = GUIDES[0].slug;
    wrap(<DesktopSidebarNav />, `/gift-guides/${slug}`);
    const row = document.querySelector('[data-sidebar-item="/gift-guides"]') as HTMLAnchorElement;
    expect(row).toBeTruthy();
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("href")).toBe("/gift-guides");
    expect(row).toHaveAccessibleName("Holiday gift guides");
    expect(row.querySelector("svg.lucide-gift")).toBeTruthy();
    expect(row.getAttribute("aria-current")).toBe("page");
    // Owner 2026-11-21 night ("Side menu: move Gift Guides under Explore, right after Jobs and Declutter"): it is one of
    // the rows under Explore, indented like the sections, right after the last of Jobs and Declutter, before Inbox.
    const rows = [...document.querySelectorAll("[data-sidebar-item]")].map((r) => r.getAttribute("data-sidebar-item"));
    expect(rows.length).toBeGreaterThan(3);
    const at = rows.indexOf("/gift-guides");
    expect(rows.indexOf("/explore")).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(rows.indexOf("/explore"));
    const before = rows.slice(rows.indexOf("/explore") + 1, at);
    expect(before.length, rows.join(" ")).toBeGreaterThan(0);
    expect(before[before.length - 1], rows.join(" ")).toMatch(/^\/(jobs|declutter)$/);
    for (const p of ["/jobs", "/declutter"]) if (rows.includes(p)) expect(rows.indexOf(p), p).toBeLessThan(at);
    expect(at).toBeLessThan(rows.indexOf("/messages"));
    expect(row.className).toContain("pl-9");
  });

  it("You (the phone's menu, where the top bar's photo leads) has a Holiday gift guides row linking /gift-guides", () => {
    wrap(<YouMenu onSelectTab={() => {}} onRequestLogout={() => {}} onRequestDelete={() => {}} />, "/profile");
    const row = screen.getByTestId("you-gift-guides");
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("href")).toBe("/gift-guides");
    expect(row).toHaveAccessibleName("Holiday gift guides");
    expect(row.querySelector("svg.lucide-gift")).toBeTruthy();
  });

  it("the desktop photo menu and Home's closable promo card still lead there", () => {
    expect(src("components/DesktopTopNav.tsx")).toContain('navigate("/gift-guides")');
    const home = src("pages/home/HomeDashboard.tsx");
    expect(home).toContain('import("@/components/GiftGuidesPromo")');
    expect(home).toContain('<GiftGuidesPromo where="home" />');
    expect(src("components/GiftGuidesPromo.tsx")).toContain('to="/gift-guides"');
  });

  it("/gift-guides and /gift-guides/<slug> are open routes, wrapped in no signed-in redirect or login gate", () => {
    const app = src("App.tsx");
    for (const path of ["/gift-guides", "/gift-guides/:slug"]) {
      const lines = app.split("\n").filter((l) => l.includes(`<Route path="${path}"`));
      expect(lines, path).toHaveLength(1);
      expect(lines[0]).toContain("<GiftGuides />");
      expect(lines[0]).not.toMatch(/MarketingRedirect|SignedInRedirect|ProtectedRoute|AdminRoute|NativeRedirect|Navigate/);
    }
  });

  it("a signed-in member who opens a guide stays on it, and the list stays the list", async () => {
    const guide = GUIDES.find((g) => !g.empty) ?? GUIDES[0];
    const routes = (
      <Routes>
        <Route path="/gift-guides" element={<GiftGuides />} />
        <Route path="/gift-guides/:slug" element={<GiftGuides />} />
        <Route path="/home" element={<p>dashboard</p>} />
      </Routes>
    );
    const r = wrap(routes, `/gift-guides/${guide.slug}`);
    // The banner h1 reads its lead too ("gifts for Her", holiday polish 2), so match the title at its end.
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 }).some((h) => (h.textContent ?? "").trim().endsWith(guide.title))).toBe(true));
    expect(where).toBe(`/gift-guides/${guide.slug}`);
    expect(screen.queryByText("dashboard")).toBeNull();
    r.unmount();
    wrap(routes, "/gift-guides");
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 }).length).toBeGreaterThan(0));
    expect(where).toBe("/gift-guides");
    expect(screen.queryByText("dashboard")).toBeNull();
  });
});
