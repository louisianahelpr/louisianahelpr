/**
 * The lead's review of the design-build screenshots (2026-10-20, Home 375/1440):
 *
 * 1. Home's section cards showed big "0" numbers ("0 need you", "0 properties").
 *    Spec v2 §1.5 + §5.5 and board 19: never "0" when the honest answer is
 *    "nothing yet"; a card shows its real non-zero counts in ONE line, or the
 *    both-sides invitation ("Hire help or find work").
 * 2. (REVERSED by the owner, 2026-10-20 08:30Z: keep the H logo top-left on
 *    phone Home, greeting under it; never the "Helpr" wordmark.) Pinned below:
 *    the phone bar draws the H emblem, bell and avatar; the desktop bar draws
 *    nothing on Home (the left sidebar carries the H logo).
 * 3. The bottom bar's "You" was the member's avatar while the top bar also
 *    showed it. Boards: "You" is a person icon, filled when active. (Nav
 *    redesign, owner 2026-11-06: You moved to the top bar as the photo; the
 *    dock's five tabs each stay an icon, filled when active, never a photo.)
 * 4. The active tab had a RUST underline and the count badges were rust.
 *    Rust is money only: the active tab is olive (filled icon + label), count
 *    badges are --alert (#B3261E).
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |   const shown = parts.filter(([n]) => n > 0) |   const shown = parts.filter(() => true)
 * @mutate src/pages/home/HomeDashboard.tsx |                 const line = summary.tiles[s.key]; |                 const line = summary.tiles[s.key] ?? "0";
 * @mutate src/components/sections/AppTopBar.tsx |         <HelprMark size="sm" emblemOnly to="/home" /> |         <HelprMark size="sm" to="/home" />
 * @mutate src/components/MobileNav.tsx |                 background: "hsl(var(--alert))", |                 background: "hsl(var(--burnt-sienna))",
 * @mutate src/components/notificationPanel/NotificationTrigger.tsx | style={{ background: "hsl(var(--alert))", color: "#fff" }} | style={{ background: "hsl(var(--burnt-sienna))", color: "#fff" }}
 * @mutate src/components/MobileNav.tsx |           <Icon\n            className="w-[22px] h-[22px] transition-all duration-200" |           {path === "/jobs" && <img alt="" src="avatar.png" />}\n          <Icon\n            className="w-[22px] h-[22px] transition-all duration-200"
 * @mutate src/components/MobileNav.tsx |             fill={isActive && path !== "/explore" ? "currentColor" : "none"} |             fill="none"
 *
 * 5. (Q1816, 11-04) axe 4.14 turned label-content-name-mismatch on (WCAG 2.5.3): the top bar's Profile, the bell and
 *    the dock's badged tabs had an aria-label without their visible text (initials "TP", the count "4", "3Messages").
 *    Every icon button's name holds its visible words, in order (axe's own token rule, read from textContent: jsdom
 *    lays nothing out, so this cannot see visibility; the e2e axe sweeps do).
 * @mutate src/lib/avatarImage.ts |   return initials ? `${word}, ${initials}` : word; |   return word;
 * @mutate src/components/notificationPanel/NotificationTrigger.tsx |   return count > 0 ? `${name}, ${formatUnreadBadge(count)} unread` : name; |   return name;
 * @mutate src/components/MobileNav.tsx | : showBadge ? `${dockBadgeText(badgeCount)} ${shown}` : soon | : soon
 * @mutate src/components/MobileNav.tsx |         {" "}\n        <span data-dock-label |         <span data-dock-label
 */
import { describe, it, expect, vi, afterEach } from "vitest";
// The account's Customize row (useSectionPrefs, Q2199) is data, not what this spec measures: answered locally
// (no row yet, saves accepted); the device copy and the hook's own rules stay real.
vi.mock("@/lib/sectionPrefsRow", () => ({
  fetchSectionPrefsRow: async () => ({ data: null, error: null }),
  saveSectionPrefsRow: async () => ({ error: null }),
}));
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const unread = vi.hoisted(() => ({ n: 0 }));
const todo = vi.hoisted(() => ({ jobs: 0 }));
const desktop = vi.hoisted(() => ({ on: false }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
// S2-016: the navs read the member's unread shop chats for the badge; none here.
vi.mock("@/lib/shops/talkUnread", () => ({ SHOP_TALKS_SUMMARY_KEY: ["shops", "my-talks", "summary"], SHOP_TALKS_UNREAD_EVENT: "lh-shop-talks-unread", fetchShopTalkSummary: async () => ({ total: 0, unread: 0 }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-review", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: unread.n, markAllRead: () => {} }) }));
// The top row's Messages button reads the shared store MobileNav fills (owner 11-14); answered from the same number.
vi.mock("@/components/mobileNav/navUnreadStore", async (orig) => ({ ...(await orig<object>()), useSharedUnreadCount: () => unread.n }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: todo.jobs, jobs: todo.jobs, shops: 0, declutter: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));

import MobileNav from "@/components/MobileNav";
import { AppTopBar } from "@/components/sections/AppTopBar";
import { NotificationTrigger } from "@/components/notificationPanel/NotificationTrigger";
import { countLine, SECTION_INVITE } from "@/pages/home/homeDashboard/useHomeSummary";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function renderDock(at = "/home") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <MobileNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => { cleanup(); unread.n = 0; todo.jobs = 0; desktop.on = false; });

describe("1. Home section cards never show a 0 (spec v2 §1.5/§5.5, board 19)", () => {
  it("one line of the NON-zero counts, singular/plural from the real number", () => {
    expect(countLine([[2, "need you"], [1, "in progress"]])).toBe("2 need you · 1 in progress");
    expect(countLine([[0, "need you"], [1, "in progress"]])).toBe("1 in progress");
    expect(countLine([[1, "property", "properties"]])).toBe("1 property");
    expect(countLine([[3, "property", "properties"]])).toBe("3 properties");
  });

  it("nothing real -> null; the section chip then shows its name alone (design audit A D4, 11-08), the invitation stays in Customize", () => {
    expect(countLine([[0, "need you"], [0, "in progress"]])).toBeNull();
    expect(SECTION_INVITE).toEqual({
      jobs: "Hire help or find work",
      declutter: "Sell or find a deal",
      shops: "Shop local or open a shop",
      homes: "Find a place or list one",
    });
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("const line = summary.tiles[s.key];\n");
    expect(home).toContain('{line && <span data-tile-line className="font-normal text-muted-foreground"> · {line}</span>}');
    // The old big-number slot is gone: no tile prints a bare count.
    expect(home).not.toMatch(/\{on \? tile\.n : /);
  });
});

describe("2. phone Home keeps the H logo (owner 2026-10-20 08:30Z), never the wordmark", () => {
  it("phone: H emblem left; Messages, the bell and the avatar right (F148; Messages back on the top row, owner 11-14; Help is in You)", () => {
    render(<MemoryRouter><AppTopBar /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    const logo = bar.firstElementChild as HTMLElement;
    expect(logo.querySelector("img")).not.toBeNull();
    expect(logo.textContent ?? "").not.toMatch(/Helpr/);
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Messages", "Notifications", "Profile, TP"]); // the avatar's initials are in its name (WCAG 2.5.3, Q1816)
  });

  it("desktop Home: no bar (the left sidebar carries the H logo)", () => {
    desktop.on = true;
    render(<MemoryRouter><AppTopBar /></MemoryRouter>);
    expect(screen.queryByTestId("app-top-bar")).toBeNull();
  });
});

describe("3 + 4. the bottom bar: You is a person icon; olive active, --alert badges", () => {
  it("every dock tab draws an icon, never the member's photo or monogram; the active one is filled", () => {
    renderDock("/jobs");
    const tabs = [...document.querySelectorAll('nav[aria-label="Bottom navigation"] button[aria-label]')];
    expect(tabs.length).toBe(5); // vacuity floor
    for (const t of tabs) {
      expect(t.querySelector("svg"), t.getAttribute("aria-label") ?? "").not.toBeNull();
      expect(t.querySelector("img"), t.getAttribute("aria-label") ?? "").toBeNull();
    }
    const jobs = screen.getByRole("button", { name: "Jobs" });
    expect(jobs.textContent?.trim()).toBe("Jobs"); // its name under the icon (F147), no "TP" monogram
    expect(jobs.getAttribute("aria-current")).toBe("page");
    expect(jobs.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("the active tab is olive with no rust anywhere in the bar", () => {
    todo.jobs = 3;
    const { container } = renderDock("/home");
    const home = screen.getByRole("button", { name: "Home" });
    expect(home.getAttribute("style")).toContain("hsl(var(--bark))");
    expect(container.innerHTML).not.toMatch(/burnt-sienna|accent-ink/);
  });

  it("the Jobs to-do badge is --alert with white text", () => {
    todo.jobs = 12;
    renderDock("/home");
    const badge = [...screen.getByRole("button", { name: "9+ Jobs" }).querySelectorAll("span")].find((s) => s.textContent === "9+");
    expect(badge, "a 9+ badge on Jobs").toBeTruthy();
    expect(badge!.getAttribute("style")).toContain("hsl(var(--alert))");
  });

  it("the top row's Messages count badge is --alert with white text, and its name starts with the count (owner 11-14)", () => {
    unread.n = 12;
    try {
      render(<MemoryRouter><AppTopBar /></MemoryRouter>);
      const msgs = screen.getByRole("button", { name: "9+ Messages" });
      const badge = msgs.querySelector('[data-top-bar-badge="messages"]');
      expect(badge?.textContent).toBe("9+");
      expect(badge?.getAttribute("style")).toContain("hsl(var(--alert))");
      expect(nameHoldsVisibleText(msgs), msgs.getAttribute("aria-label") ?? "").toBe(true);
    } finally {
      unread.n = 0;
    }
  });

  it("the bell's count badge is --alert too", () => {
    render(<NotificationTrigger unreadCount={4} />);
    const badge = [...document.querySelectorAll("span")].find((s) => s.getAttribute("style")?.includes("background"));
    expect(badge?.getAttribute("style")).toContain("hsl(var(--alert))");
  });

  it("--alert exists as a token (#B3261E)", () => {
    expect(code("src/index.css")).toMatch(/--alert: 4 71% 41%;/);
  });
});

/** axe 4.14's label-content-name-mismatch: the visible text's words, in order, inside the name's words. */
function nameHoldsVisibleText(el: Element): boolean {
  const words = (t: string) => t.toLowerCase().replace(/\([^()]*\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  const seen = words(el.textContent ?? "");
  const name = words(el.getAttribute("aria-label") ?? "");
  if (!seen.length) return true;
  for (let i = 0; i + seen.length <= name.length; i++) if (seen.every((w, j) => name[i + j] === w)) return true;
  return false;
}

describe("5. an icon button's name holds its visible text (WCAG 2.5.3, axe label-content-name-mismatch, Q1816)", () => {
  it("the checker itself fails a name without the visible text (can fail)", () => {
    const b = document.createElement("button");
    b.setAttribute("aria-label", "Messages");
    b.innerHTML = "<span>3</span>Messages";
    expect(nameHoldsVisibleText(b)).toBe(false);
    b.innerHTML = "<span>3</span> Messages";
    b.setAttribute("aria-label", "3 Messages");
    expect(nameHoldsVisibleText(b)).toBe(true);
  });

  it("the top bar's Profile names the initials its avatar shows", () => {
    render(<MemoryRouter><AppTopBar /></MemoryRouter>);
    const profile = screen.getByTestId("top-bar-profile");
    expect(profile.textContent).toContain("TP");
    expect(nameHoldsVisibleText(profile), profile.getAttribute("aria-label") ?? "").toBe(true);
  });

  it("the bell with a count names the count", () => {
    render(<NotificationTrigger unreadCount={4} />);
    const bell = screen.getByRole("button");
    expect(bell.textContent).toBe("4");
    expect(nameHoldsVisibleText(bell), bell.getAttribute("aria-label") ?? "").toBe(true);
  });

  it("every dock tab, badged or not, names what it shows", () => {
    todo.jobs = 3; // a bare digit: the badge "3" must start the name ("3 Jobs")
    renderDock("/home");
    const tabs = [...document.querySelectorAll("nav button[aria-label]")];
    expect(tabs.length).toBeGreaterThan(3);
    expect(tabs.some((t) => /\d/.test(t.textContent ?? "")), "no badged tab rendered").toBe(true);
    expect(tabs.filter((t) => !nameHoldsVisibleText(t)).map((t) => `${t.getAttribute("aria-label")} / ${t.textContent}`)).toEqual([]);
  });
});
