/**
 * OWNER 11-14 (top priority): "Messages and You are already at the top, so replace those with Shops and Homes and just
 * have those 2 listed as coming soon."
 *  - The phone bottom bar is Home, Jobs, Declutter, Shops, Homes. On the website Shops and Homes wear a small "Soon"
 *    tag while they are not open to everyone (closed to the viewer, or a tester's preview) and drop it the day they
 *    open. In the store app the tabs are listed with NO tag (owner 10-31 + 11-06, App Review 2.1: hideUnopenedInApp).
 *    A tap opens the section's route, whose gate (ShopsGate / RentalsGate) is the coming-soon screen for anyone it is
 *    closed to; Shops is never opened by the bar. A closed section carries no to-do count.
 *  - Messages is the top row's chat button (44px), between the search and the bell, with the unread badge the old
 *    Messages tab wore; on /messages it is the lit "you are here" mark. The photo still opens You.
 *  - Messages and You light no bottom tab.
 *
 * @mutate src/components/mobileNav/dockItems.ts |     { path: homes.path, icon: homes.icon, label: homes.label, comingSoon: true },\n | \n
 * @mutate src/components/MobileNav.tsx |       const soon = !!item.comingSoon && !!t && (!t.on \|\| t.preview) && !hideUnopenedInApp(); |       const soon = !!item.comingSoon && !!t && !t.on;
 * @mutate src/components/mobileNav/dockItems.ts | label: homes.label, comingSoon: true }, | label: homes.label },
 * @mutate src/components/MobileNav.tsx |     const badgeCount = isGuest \|\| closed ? 0 : dockBadgeCount(badgeKey, unreadCount, todo); |     const badgeCount = isGuest ? 0 : dockBadgeCount(badgeKey, unreadCount, todo);
 * @mutate src/components/sections/AppTopBar.tsx |       {user && !isWebDesktop && <PhoneMessagesButton />}\n | \n
 * @mutate src/components/sections/AppTopBar.tsx |       {unreadCount > 0 && ( |       {false && (
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
const openAll = vi.hoisted(() => ({ set: null as ReadonlySet<string> | null }));
const unread = vi.hoisted(() => ({ n: 0 }));
const todo = vi.hoisted(() => ({ total: 0, jobs: 0, shops: 0, declutter: 0 }));
const native = vi.hoisted(() => ({ on: false }));

vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
vi.mock("@/lib/hideUnopenedInApp", async (orig) => ({ ...(await orig<object>()), hideUnopenedInApp: () => native.on }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => openAll.set }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-soon", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: unread.n, markAllRead: () => {} }) }));
vi.mock("@/components/mobileNav/navUnreadStore", async (orig) => ({ ...(await orig<object>()), useSharedUnreadCount: () => unread.n }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => todo }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {}, whenPageSettled: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", () => ({ useDockSheetsLoader: () => null }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));

import MobileNav from "@/components/MobileNav";
import { AppTopBar } from "@/components/sections/AppTopBar";

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}</span>;
}
function renderPhone(at = "/home", search = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <AppTopBar title="Jobs" search={search ? <input aria-label="Search jobs" /> : undefined} />
        <MobileNav />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const DOCK = 'nav[aria-label="Bottom navigation"]';
const tabs = () => [...document.querySelectorAll<HTMLElement>(`${DOCK} button[aria-label]`)];
const names = () => tabs().map((t) => t.querySelector("[data-dock-label]")?.textContent);
const tab = (name: string) => tabs().find((t) => t.querySelector("[data-dock-label]")?.textContent === name)!;
const soonOn = () => [...document.querySelectorAll(`${DOCK} [data-dock-soon]`)].map((s) => s.getAttribute("data-dock-soon"));

beforeEach(() => {
  switches.on = new Set(["declutter"]);
  openAll.set = new Set(["declutter"]);
  unread.n = 0;
  Object.assign(todo, { total: 0, jobs: 0, shops: 0, declutter: 0 });
  native.on = false;
});
afterEach(cleanup);

describe("the phone bottom bar (owner 11-14)", () => {
  it("is Home, Jobs, Declutter, Shops, Homes: no Messages or You tab", () => {
    renderPhone();
    expect(tabs()).toHaveLength(5); // vacuity floor
    expect(names()).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes"]);
  });

  it("a member: Shops and Homes wear the Soon tag (Declutter, open, does not); the name says so", () => {
    renderPhone();
    expect(soonOn()).toEqual(["/shops", "/rentals"]);
    expect(tab("Shops").getAttribute("aria-label")).toBe("Shops, Soon");
    expect(tab("Homes").getAttribute("aria-label")).toBe("Homes, Soon");
    expect(tab("Shops").querySelector("[data-dock-soon]")?.textContent).toBe("Soon");
    // The tag is after the name in DOM order (WCAG 2.5.3: the name starts with the visible words).
    const label = tab("Shops").querySelector("[data-dock-label]")!;
    expect(label.compareDocumentPosition(tab("Shops").querySelector("[data-dock-soon]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a tester's preview (on for them, not for everyone) still says Soon; open to everyone, no tag", () => {
    switches.on = new Set(["declutter", "shops", "rentals"]);
    renderPhone();
    expect(soonOn()).toEqual(["/shops", "/rentals"]);
    cleanup();
    openAll.set = new Set(["declutter", "shops", "rentals"]);
    renderPhone();
    expect(soonOn()).toEqual([]);
    expect(tab("Shops").getAttribute("aria-label")).toBe("Shops");
  });

  it("Declutter never wears the tag, even while its switch reads off (loading) for the viewer", () => {
    switches.on = new Set();
    renderPhone();
    expect(soonOn()).toEqual(["/shops", "/rentals"]);
    expect(tab("Declutter").getAttribute("aria-label")).toBe("Declutter");
  });

  it("the store app lists Shops and Homes with no Soon tag (App Review 2.1)", () => {
    native.on = true;
    renderPhone();
    expect(names()).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes"]);
    expect(soonOn()).toEqual([]);
  });

  it.each([["Shops", "/shops"], ["Homes", "/rentals"]])("%s opens %s (its gate is the coming-soon screen) and is lit there", (name, path) => {
    renderPhone();
    fireEvent.click(tab(name));
    expect(screen.getByTestId("where").textContent).toBe(path);
    cleanup();
    renderPhone(path);
    expect(tab(name).getAttribute("aria-current")).toBe("page");
  });

  it("a closed section carries no to-do count", () => {
    Object.assign(todo, { shops: 2 });
    renderPhone();
    expect(document.querySelector(`${DOCK} [data-dock-badge="/shops"]`)).toBeNull();
  });

  it.each(["/messages", "/profile"])("%s lights no bottom tab", (at) => {
    renderPhone(at);
    expect(tabs().filter((t) => t.getAttribute("aria-current") === "page")).toEqual([]);
  });
});

describe("Messages on the top row (owner 11-14)", () => {
  const order = () =>
    [...screen.getByTestId("app-top-bar").querySelectorAll("button")].map((b) => b.getAttribute("data-testid") ?? b.getAttribute("aria-label"));

  it("sits between the search and the bell, a 44px button; the photo still opens You", () => {
    renderPhone();
    expect(order()).toEqual(["top-bar-messages", "Notifications", "top-bar-profile"]);
    const msg = screen.getByTestId("top-bar-messages");
    expect(msg.className).toMatch(/\bh-11\b/);
    expect(msg.className).toMatch(/\bw-11\b/);
    fireEvent.click(screen.getByTestId("top-bar-profile"));
    expect(screen.getByTestId("where").textContent).toBe("/profile");
  });

  it("carries the unread badge the Messages tab wore, and opens Messages", () => {
    unread.n = 12;
    renderPhone();
    const msg = screen.getByTestId("top-bar-messages");
    expect(msg.querySelector('[data-top-bar-badge="messages"]')?.textContent).toBe("9+");
    expect(msg.getAttribute("aria-label")).toBe("9+ Messages");
    fireEvent.click(msg);
    expect(screen.getByTestId("where").textContent).toBe("/messages");
  });

  it("no badge at 0; lit (aria-current) on Messages itself", () => {
    renderPhone("/messages");
    const msg = screen.getByTestId("top-bar-messages");
    expect(msg.querySelector("[data-top-bar-badge]")).toBeNull();
    expect(msg.getAttribute("aria-label")).toBe("Messages");
    expect(msg.getAttribute("aria-current")).toBe("page");
  });

  it("You's title row (no search) has it too", () => {
    renderPhone("/profile", false);
    expect(screen.getByTestId("app-top-bar").querySelector('[data-testid="top-bar-messages"]')).not.toBeNull();
  });
});
