/**
 * DECLUTTER'S VINTED HEADER (owner 11-08: "the top is all crunched"; the layout changed again the same morning, from
 * the Vinted screenshot). On a phone, Declutter's top was the title with the bell, Messages, a green "+" and the photo,
 * then Browse · Buying · "4 more ›" · search · filters · gear in ONE row. Now:
 *   row 1: a rounded "Search Declutter" bar with Filters inside it, then ONLY the bell and the photo. No visible title
 *          (a visually hidden h1 names the page). Messages lives in the bell: its panel opens on a Messages row and its
 *          badge counts notifications + messages.
 *   row 2: the category chips; the grid starts right under them.
 *   Buying, Selling, Deliver, Wanted, Free and the settings: "My Declutter", opened from the photo, each with its
 *          to-do count; the photo wears a dot while any has one.
 *   Sell: a floating "+ Sell" pill above the bottom bar.
 * The desktop website keeps its row. Shots: ~/.lh-shots/b1-declutter-header/.
 * F146/F148 (owner UI audit 11-09) changed row 1 for every section: the page's title shows on the left with the bell
 * and the photo on the right, and the search is its own full-width row right under the bar; Messages is a bottom-bar
 * tab, so it left the bell. The rest (My Declutter, the chips, the + Sell pill) stands.
 * THE COMPACT TOP (owner 11-14, Depop / Vinted): row 1 is the search again, the bell and the photo inline on its right,
 * the title a visually hidden h1 (src/test/compactTopRow.test.tsx).
 *
 * @mutate src/components/sections/AppTopBar.tsx |             <div data-testid="app-top-bar-search" className="min-w-0 flex-1">{search}</div> | {null}
 * @mutate src/components/sections/AppTopBar.tsx | <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1> | <h1 className="sr-only">{title}</h1>
 * @mutate src/components/sections/AppTopBar.tsx |           onClick={() => { if (mine) { setMineAsked(true); setMineOpen(true); } else navigate("/profile"); }} |           onClick={() => navigate("/profile")}
 * @mutate src/components/sections/AppTopBar.tsx |           {mineToDo > 0 && <span data-top-bar-badge="mine" | {false && <span data-top-bar-badge="mine"
 * @mutate src/components/sections/sectionMine.ts | (i.count && i.count > 0 ? i.count : 0) | 0
 * @mutate src/components/sections/MySectionSheet.tsx |                   {i.count !== undefined && i.count > 0 && ( |                   {false && (
 * @mutate src/components/sections/MySectionSheet.tsx |           <Link to="/profile" onClick={close} data-mine-profile="" className={ROW}> |           <Link to="/profile" onClick={close} data-mine-profile="" className={ROW} hidden>
 * @mutate src/components/notificationPanel/NotificationBell.tsx |       unreadCount={bellUnreadCount({ notifications, unreadTotal }) + messagesUnread} |       unreadCount={bellUnreadCount({ notifications, unreadTotal })}
 * @mutate src/components/notificationPanel/useBellMessagesUnread.ts |   return on ? n : 0; |   return 0;
 * @mutate src/components/NotificationPanelView.tsx | unreadCount={unreadCount + messagesUnread} | unreadCount={unreadCount}
 * @mutate src/components/NotificationPanelView.tsx |         {withMessages && ( |         {false && (
 * @mutate src/components/sections/SectionCreateFab.tsx |       className={`fixed bottom-safe-nav right-4 |       className={`fixed bottom-0 right-4
 * @mutate src/components/sections/SectionCreateFab.tsx |   const shown = !desktop && !hidden && !(section && !add); |   const shown = !hidden && !(section && !add);
 * @mutate src/components/sections/SectionSearchBar.tsx |       {filter && <span data-search-bar-filter="" | {false && <span data-search-bar-filter=""
 * @mutate src/components/sections/SectionSearchBar.tsx |         onClick={() => navigate(home, { state: FOCUS_SEARCH_STATE })} |         onClick={() => navigate("/search")}
 * @mutate src/components/sections/SectionScreen.tsx | ${fab ? "pb-20" : "pb-6"} | pb-6
 * @mutate src/components/declutter/DeclutterHomeView.tsx | <SectionScreen section="declutter" title="Declutter" globalSearch={false} search={head.search} mine={head.mine} | <SectionScreen section="declutter" title="Declutter" globalSearch={false} search={head.search}
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         {desktop && itemsPhase !== "offline-empty" && rows.length > 0 && <DeclutterMilesFrom ask={ask} />} |         {itemsPhase !== "offline-empty" && rows.length > 0 && <DeclutterMilesFrom ask={ask} />}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
const view = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => view.desktop }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-v", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: () => () => {}, prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/sections/ExploreSwitcher", () => ({ useSectionIsOn: () => () => true }));

import { AppTopBar } from "@/components/sections/AppTopBar";
import NotificationBell from "@/components/notificationPanel/NotificationBell";
import { setNotificationUser, setUnreadTotal, __resetNotificationStore } from "@/components/notificationPanel/notificationStore";
import { stores, notifyUnreadWatchers } from "@/components/mobileNav/navUnreadStore";
import { SectionCreateFab } from "@/components/sections/SectionCreateFab";
import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import type { SectionMineMenu } from "@/components/sections/sectionMine";

const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}

beforeEach(() => { view.desktop = false; });
afterEach(() => { cleanup(); __resetNotificationStore(); stores.clear(); });

const MINE: SectionMineMenu = {
  title: "My Declutter",
  items: [
    { key: "buying", label: "Buying", to: "/declutter?tab=buying", count: 2 },
    { key: "selling", label: "Selling", to: "/declutter?tab=selling", quiet: 3, count: 1 },
    { key: "deliver", label: "Deliver", to: "/declutter?tab=deliver" },
    { key: "free", label: "Free", to: "/declutter?tab=free" },
  ],
  settings: { label: "Declutter settings", to: "/declutter/settings" },
};

describe("row 1: the search with the bell and the photo inline on its right (the compact top, owner 11-14)", () => {
  it("the bar is the search row; the title is a hidden h1; no Messages button and no '+'", () => {
    render(<MemoryRouter><AppTopBar title="Declutter" explore section="declutter" search={<input aria-label="Search Declutter" />} mine={MINE} /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    expect(screen.getByRole("heading", { level: 1, name: "Declutter" }).className).toContain("sr-only");
    const row = screen.getByTestId("app-top-bar-search");
    expect(row.contains(screen.getByRole("textbox", { name: "Search Declutter" }))).toBe(true);
    expect(bar.contains(row)).toBe(true);
    expect(screen.queryByTestId("top-bar-messages")).toBeNull();
    expect(screen.queryByTestId("top-bar-create")).toBeNull();
    // The bar's buttons, in order: the bell, then the photo. Nothing else.
    expect(Array.from(bar.querySelectorAll("button")).map((b) => b.getAttribute("data-testid") ?? b.getAttribute("aria-label"))).toEqual(["Notifications", "top-bar-profile"]);
  });

  it("the photo opens My Declutter: every list with its to-do count, the settings and the profile; a dot while any has a count", async () => {
    render(<MemoryRouter><AppTopBar title="Declutter" explore section="declutter" search={<span />} mine={MINE} /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    const photo = screen.getByTestId("top-bar-profile");
    expect(photo).toHaveAccessibleName("My Declutter, 3 to do, TP"); // the initials the bare photo shows are part of its name (WCAG 2.5.3)
    expect(photo.querySelector('[data-top-bar-badge="mine"]')).not.toBeNull();
    fireEvent.click(photo);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("My Declutter", { selector: "h2, h3, [role=heading], *" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("link").map((r) => r.getAttribute("href"))).toEqual(["/declutter?tab=buying", "/declutter?tab=selling", "/declutter?tab=deliver", "/declutter?tab=free", "/declutter/settings", "/profile"]);
    expect(sheet.querySelector('[data-mine-count="buying"]')?.textContent).toBe("2");
    expect(sheet.querySelector('[data-mine-count="selling"]')?.textContent).toBe("1");
    expect(sheet.querySelector('[data-mine-count="deliver"]')).toBeNull();
    fireEvent.click(within(sheet).getByRole("link", { name: "Selling, 1 to do" }));
    expect(screen.getByTestId("where").textContent).toBe("/declutter?tab=selling");
  });

  it("nothing to do: no dot, and the photo is named after the menu", () => {
    render(<MemoryRouter><AppTopBar title="Declutter" explore section="declutter" search={<span />} mine={{ ...MINE, items: MINE.items.map((i) => ({ ...i, count: 0 })) }} /></MemoryRouter>);
    const photo = screen.getByTestId("top-bar-profile");
    expect(photo).toHaveAccessibleName("My Declutter, TP");
    expect(photo.querySelector('[data-top-bar-badge="mine"]')).toBeNull();
  });

  it("every other bar is the same one pattern: visible title, the bell, the photo, no search row without a search (F148)", () => {
    render(<MemoryRouter><AppTopBar title="Jobs" explore section="jobs" /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1, name: "Jobs" }).className).not.toContain("sr-only");
    expect(screen.queryByTestId("top-bar-messages")).toBeNull();
    expect(screen.queryByTestId("top-bar-create")).toBeNull();
    expect(screen.queryByTestId("app-top-bar-search")).toBeNull();
    expect(screen.getByRole("button", { name: /^Notifications$/ })).toBeInTheDocument();
  });

  it("the bell's badge is notifications + messages unread, and its name says both", () => {
    setNotificationUser("u-v");
    setUnreadTotal(5);
    stores.set("u-v", { count: 3, messages: 3, listeners: new Set(), publish: () => {}, setShop: () => {}, close: () => {} });
    notifyUnreadWatchers();
    render(<MemoryRouter><NotificationBell withMessages /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Notifications and messages, 8 unread" }).textContent).toBe("8");
    cleanup();
    // A bell without Messages counts notifications only.
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Notifications, 5 unread" }).textContent).toBe("5");
  });

  it("the loaded panel keeps the same total on its bell and opens on a Messages row (source of the panel view)", () => {
    const panel = code("src/components/NotificationPanelView.tsx");
    expect(panel).toContain("unreadCount={unreadCount + messagesUnread} withMessages={withMessages}");
    expect(panel).toMatch(/\{withMessages && \([\s\S]{0,200}data-testid="bell-messages-row"[\s\S]{0,200}navigate\("\/messages"\)/);
    expect(code("src/components/NotificationPanel.tsx")).toMatch(/visibleNotifications,\s*withMessages,\s*\};/);
  });
});

describe("the Search Declutter bar", () => {
  it("on Browse it is the field, with Filters inside its right end", () => {
    const onChange = vi.fn();
    render(<MemoryRouter><SectionSearchBar noun="Declutter" home="/declutter" value="" onChange={onChange} filter={<button type="button">Filters</button>} /></MemoryRouter>);
    const bar = screen.getByRole("search", { name: "Search Declutter" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Declutter" }), { target: { value: "lamp" } });
    expect(onChange).toHaveBeenCalledWith("lamp");
    const filters = screen.getByRole("button", { name: "Filters" });
    expect(bar.lastElementChild?.contains(filters)).toBe(true);
  });

  it("on every other list it takes the member to Browse's field", () => {
    render(<MemoryRouter initialEntries={["/declutter?tab=selling"]}><Routes><Route path="*" element={<><SectionSearchBar noun="Declutter" home="/declutter" /><Where /></>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    expect(screen.getByTestId("where").textContent).toBe("/declutter");
  });
});

describe("Sell: the floating + Sell pill", () => {
  it("phone: one pill over the page, above the bottom bar on the shared clearance; it opens the sell chooser", () => {
    render(<MemoryRouter><Routes><Route path="*" element={<><SectionCreateFab section="declutter" text="Sell" /><Where /></>} /></Routes></MemoryRouter>);
    const sell = screen.getByRole("button", { name: "Sell an item" });
    expect(sell.textContent).toBe("Sell");
    expect(sell.parentElement).toBe(document.body);
    expect(sell.className.split(" ")).toEqual(expect.arrayContaining(["fixed", "bottom-safe-nav", "right-4"]));
    fireEvent.click(sell);
    expect(screen.getByTestId("where").textContent).toBe(SELL_CHOOSER_PATH);
  });

  it("desktop website: no pill (the bar keeps '+ Sell an item')", () => {
    view.desktop = true;
    render(<MemoryRouter><SectionCreateFab section="declutter" text="Sell" /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Sell an item" })).toBeNull();
  });

  it("the screen leaves room under its last row for the pill, and Declutter's screens hand the bar its search (and a member's, My Declutter)", () => {
    expect(code("src/components/sections/SectionScreen.tsx")).toMatch(/\$\{fab \? "pb-20" : "pb-6"\}/);
    const screens = ["src/components/declutter/DeclutterHomeView.tsx", "src/components/declutter/DeclutterBrowseView.tsx", "src/components/declutter/DeclutterSkeletons.tsx"];
    const calls = screens.flatMap((f) => [...code(f).matchAll(/<SectionScreen\b[\s\S]*?>\n/g)].map((m) => [f, m[0]] as const));
    expect(calls.length).toBeGreaterThan(2);
    for (const [f, call] of calls) expect(call, f).toMatch(/\bsearch=\{/);
    for (const f of screens.slice(0, 2)) expect(code(f), f).toMatch(/<SectionScreen\b[^>]*\bmine=\{head\.mine\}/);
  });
});
