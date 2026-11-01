/**
 * The desktop website's navigation is a LEFT sidebar, always open (owner
 * 2026-10-19; board 11; HELPR-DESIGN-SPEC v2 §4.4). It replaced the RIGHT rail
 * and its hamburger. Top to bottom: the H logo (never the "Helpr" wordmark,
 * owner 2026-10-20 08:30Z), an olive "Create" pill that opens the create sheet,
 * Home, Explore with the member's sections nested under it, Messages, You.
 * Count badges are --alert. The shared insets move the page RIGHT of it:
 * `.app-shell-frame { left }`, `#root { padding-left }`, `[data-rail-inset] { left }`.
 *
 * @mutate src/components/DesktopSidebarNav.tsx | className={`fixed left-0 top-0 bottom-0 z-40 | className={`fixed right-0 top-0 bottom-0 z-40
 * @mutate src/components/DesktopSidebarNav.tsx | <HelprMark to="/home" size="md" emblemOnly /> | <HelprMark to="/home" size="md" />
 * @mutate src/components/DesktopSidebarNav.tsx |           onClick={() => setCreateOpen(true)} |           onClick={() => navigate("/post-job")}
 * @mutate src/components/DesktopSidebarNav.tsx |     leftItems[0],\n    exploreItem, |     leftItems[0],
 * @mutate src/components/DesktopSidebarNav.tsx |                         // Count badges are --alert, never rust (spec v2 §1.1).\n                        background: "hsl(var(--alert))", |                         // Count badges are --alert, never rust (spec v2 §1.1).\n                        background: "hsl(var(--burnt-sienna))",
 * @mutate src/components/sidePanelOpen.tsx |   return true;\n}; |   return safeStorage.getItem(STORAGE_KEY) !== "0";\n};
 * @mutate src/components/DesktopTopNav.tsx |       data-rail-inset="" |       data-rail-off=""
 * @mutate src/components/DesktopTopNav.tsx |             aria-label="Profile"\n            data-testid="desktop-top-profile" |             aria-label="Settings"\n            data-testid="desktop-top-profile"
 * @mutate src/index.css |     padding-left: var(--desktop-sidebar-w); |     padding-right: var(--desktop-sidebar-w);
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const state = vi.hoisted(() => ({ jobs: 2, unread: 12, sheetOpened: 0 }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k !== "rentals" }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, isAdmin: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: state.jobs, jobs: state.jobs, shops: 0 }) }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: state.unread }) }));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/components/create/CreateSheet", () => ({
  CreateSheet: ({ open }: { open: boolean }) => {
    if (open) state.sheetOpened++;
    return open ? <div data-testid="create-sheet" /> : null;
  },
}));

import DesktopSidebarNav from "@/components/DesktopSidebarNav";
import { readSidePanelOpen } from "@/components/sidePanelOpen";
// The "Online for deliveries" pill (Q2440) reads the member's own row with React Query; it has its own test (goOnline.test.tsx).
vi.mock("@/components/declutter/DeliveryOnlinePill", () => ({ DeliveryOnlinePill: () => null }));
import DesktopTopNav from "@/components/DesktopTopNav";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));
const mount = (at = "/home") => render(<MemoryRouter initialEntries={[at]}><DesktopSidebarNav /></MemoryRouter>);
afterEach(() => { cleanup(); state.sheetOpened = 0; });

describe("the LEFT sidebar (board 11)", () => {
  it("is pinned to the LEFT edge, full height", () => {
    mount();
    const nav = document.querySelector('nav[aria-label="Primary"]') as HTMLElement;
    expect(nav.getAttribute("data-desktop-sidebar")).toBe("left");
    expect(nav.className).toMatch(/\bleft-0\b/);
    expect(nav.className).not.toMatch(/\bright-0\b/);
  });

  it("H logo, never the wordmark", () => {
    mount();
    const nav = document.querySelector('nav[aria-label="Primary"]') as HTMLElement;
    expect(nav.querySelector("img")).not.toBeNull();
    expect(nav.textContent ?? "").not.toMatch(/Helpr/);
  });

  it("Create opens the create sheet", () => {
    mount();
    expect(screen.queryByTestId("create-sheet")).toBeNull();
    fireEvent.click(screen.getByTestId("sidebar-create"));
    expect(screen.getByTestId("create-sheet")).toBeTruthy();
  });

  it("Home, Explore, the sections nested, Messages, You (in order); a closed section is greyed", () => {
    mount();
    const rows = [...document.querySelectorAll("[data-sidebar-item]")].map((b) => b.getAttribute("data-sidebar-item"));
    expect(rows).toEqual(["/home", "/explore", "/jobs", "/declutter", "/shops", "/rentals", "/messages", "/profile"]);
    const homes = document.querySelector('[data-sidebar-item="/rentals"]') as HTMLElement;
    expect(homes.getAttribute("aria-disabled")).toBe("true");
  });

  it("inside a section, Explore and that section are both current", () => {
    mount("/declutter");
    expect(document.querySelector('[data-sidebar-item="/explore"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[data-sidebar-item="/declutter"]')?.getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[data-sidebar-item="/home"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("count badges are --alert, never rust", () => {
    mount();
    const badges = [...document.querySelectorAll("[data-sidebar-badge]")];
    expect(badges.length).toBeGreaterThan(1);
    for (const b of badges) expect(b.getAttribute("style")).toContain("hsl(var(--alert))");
    expect(document.querySelector('[data-sidebar-item="/messages"] [data-sidebar-badge]')?.textContent).toBe("9+");
  });

  it("is always open: a stored 'closed' from the old hamburger is ignored", () => {
    localStorage.setItem("helpr.sidePanelOpen", "0");
    expect(readSidePanelOpen()).toBe(true);
    localStorage.removeItem("helpr.sidePanelOpen");
  });

  it("the desktop top bar has no hamburger and insets beside the sidebar", () => {
    render(<MemoryRouter initialEntries={["/home"]}><DesktopTopNav /></MemoryRouter>);
    const header = document.querySelector("header") as HTMLElement;
    expect(header.hasAttribute("data-rail-inset")).toBe(true);
    expect(header.querySelector('[aria-label*="navigation panel"]')).toBeNull();
    // UX-6: Help, then board 11: bell, then the member's photo.
    expect([...header.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Help", "Notifications", "Profile"]);
  });

  it("the shared insets move the page RIGHT of the sidebar (never a right-edge rail inset)", () => {
    const css = code("src/index.css");
    expect(css).toMatch(/html\.web-desktop\.app-shell\.desktop-rail\.side-panel-open \.app-shell-frame \{[^}]*\bleft: var\(--desktop-sidebar-w\);/);
    expect(css).toMatch(/:not\(\.app-shell\) #root \{\s*padding-left: var\(--desktop-sidebar-w\);/);
    expect(css).not.toMatch(/\bright: var\(--desktop-sidebar-w\)|padding-right: var\(--desktop-sidebar-w\)/);
  });
});
