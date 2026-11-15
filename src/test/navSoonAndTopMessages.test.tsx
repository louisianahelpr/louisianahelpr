/**
 * OWNER 11-14 (top priority): "Messages and You are already at the top, so replace those with Shops and Homes and just
 * have those 2 listed as coming soon."
 *  - The phone bottom bar is Home, Jobs, Declutter, Shops, Homes. On the website Shops and Homes wear a small "Soon"
 *    tag while they are not open to everyone (closed to the viewer, or a tester's preview) and drop it the day they
 *    open. In the store app both tabs are listed with NO tag, closed or not, and open their coming-soon screens
 *    (owner 11-06: DOCK_LISTS_CLOSED_SECTIONS_IN_APP true; hideUnopenedInApp, owner 10-31: no "Soon" in the app).
 *    A tap opens the section's route, whose gate (ShopsGate / RentalsGate) is the coming-soon screen for anyone it is
 *    closed to; Shops is never opened by the bar. A closed section carries no to-do count.
 *  - Messages is on the top row: since owner 11-15 inside the ONE Inbox icon (44px), between the search and the photo,
 *    whose badge holds the unread the old Messages tab wore; on /messages it is the lit "you are here" mark. The photo
 *    still opens You. (The tabs and the combined badge: src/test/inboxOneIconTwoTabs.test.tsx.)
 *  - Messages and You light no bottom tab.
 *
 * @mutate src/components/mobileNav/dockItems.ts |     { path: homes.path, icon: homes.icon, label: homes.label, comingSoon: true },\n | \n
 * @mutate src/components/mobileNav/dockItems.ts | export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = true; | export const DOCK_LISTS_CLOSED_SECTIONS_IN_APP = false;
 * @mutate src/components/MobileNav.tsx |       const soon = !!item.comingSoon && !!t && (!t.on \|\| t.preview) && !hideUnopenedInApp(); |       const soon = !!item.comingSoon && !!t && !t.on;
 * @mutate src/components/mobileNav/dockItems.ts | label: homes.label, comingSoon: true }, | label: homes.label },
 * @mutate src/components/MobileNav.tsx |     const badgeCount = isGuest \|\| closed ? 0 : dockBadgeCount(badgeKey, unreadCount, todo); |     const badgeCount = isGuest ? 0 : dockBadgeCount(badgeKey, unreadCount, todo);
 * @mutate src/components/sections/AppTopBar.tsx |       {user && !isWebDesktop && <TopBarInbox />} |
 * @mutate src/components/inbox/InboxButton.tsx |       {total > 0 && ( |       {false && (
 * @mutate src/components/sections/SectionSearchBar.tsx | full.length <= 22 ? "max-[429px]:hidden" | full.length <= 22 ? "max-[409px]:hidden"
 * @mutate src/components/messages/MessagesSearchRow.tsx | <span className="max-[459px]:hidden"> | <span className="max-[439px]:hidden">
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
// The store app is native.on; sectionListedHere is the real rule read through the same answer.
vi.mock("@/lib/hideUnopenedInApp", () => ({
  hideUnopenedInApp: () => native.on,
  sectionListedHere: (tab: { on: boolean; preview: boolean } | undefined) => !tab || !native.on || (tab.on && !tab.preview),
}));
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
import { nounHideClass } from "@/components/sections/SectionSearchBar";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  it("the store app lists Shops and Homes while closed to the member, with NO Soon tag (owner 11-06)", () => {
    native.on = true;
    renderPhone();
    expect(names()).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes"]);
    expect(soonOn()).toEqual([]);
    expect(tab("Shops").getAttribute("aria-label")).toBe("Shops");
  });

  it("the store app: a tester-only preview is listed too, with no tag", () => {
    native.on = true;
    switches.on = new Set(["declutter", "shops", "rentals"]);
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

describe("Messages on the top row, inside the Inbox icon (owner 11-14, merged with the bell 11-15)", () => {
  const order = () =>
    [...screen.getByTestId("app-top-bar").querySelectorAll("button")].map((b) => b.getAttribute("data-testid") ?? b.getAttribute("aria-label"));

  it("sits between the search and the photo, a 44px button; the photo still opens You", async () => {
    renderPhone();
    const inbox = await screen.findByTestId("top-bar-inbox");
    expect(order()).toEqual(["top-bar-inbox", "top-bar-profile"]);
    expect(inbox.className).toMatch(/\bh-11\b/);
    expect(inbox.className).toMatch(/\bw-11\b/);
    fireEvent.click(screen.getByTestId("top-bar-profile"));
    expect(screen.getByTestId("where").textContent).toBe("/profile");
  });

  it("carries the unread badge the Messages tab wore, and opens the Inbox", async () => {
    unread.n = 12;
    renderPhone();
    const inbox = await screen.findByTestId("top-bar-inbox");
    expect(inbox.querySelector('[data-top-bar-badge="inbox"]')?.textContent).toBe("12");
    expect(inbox.getAttribute("aria-label")).toBe("Inbox, 12 unread");
    fireEvent.click(inbox);
    expect(screen.getByTestId("where").textContent).toBe("/messages");
  });

  it("no badge at 0; lit (aria-current) on the Inbox itself", async () => {
    renderPhone("/messages");
    const inbox = await screen.findByTestId("top-bar-inbox");
    expect(inbox.querySelector("[data-top-bar-badge]")).toBeNull();
    expect(inbox.getAttribute("aria-label")).toBe("Inbox");
    expect(inbox.getAttribute("aria-current")).toBe("page");
  });

  it("You's title row (no search) has it too", async () => {
    renderPhone("/profile", false);
    expect(screen.getByTestId("app-top-bar").contains(await screen.findByTestId("top-bar-inbox"))).toBe(true);
  });
});

// The row lost 44px to Messages, so a search's words drop their noun (never cut) where they no longer fit. Measured
// in Chromium at 320/360/375/390/414/430 (English and Spanish), ~/.lh-shots/nav-soon-1114/fit-*.txt.
describe("the search words still fit beside Messages, the bell and the photo", () => {
  it("short words keep their noun from 360, longer ones from 410 / 430, the longest from 450", () => {
    expect(nounHideClass("Search jobs")).toBe("max-[359px]:hidden");
    expect(nounHideClass("Search Declutter")).toBe("max-[409px]:hidden");
    expect(nounHideClass("Buscar en Declutter")).toBe("max-[429px]:hidden");
    expect(nounHideClass("Search jobs and items")).toBe("max-[429px]:hidden");
    expect(nounHideClass("Buscar trabajos y artículos")).toBe("max-[449px]:hidden");
  });

  it("Messages' 'Search conversations' drops its noun below 460px", () => {
    const row = readFileSync(resolve(__dirname, "../components/messages/MessagesSearchRow.tsx"), "utf8");
    expect(row).toContain('{t("chat.searchShort")}<span className="max-[459px]:hidden"> {t("chat.searchNoun")}</span>');
  });
});
