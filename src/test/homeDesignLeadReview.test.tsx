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
 *    showed it. Boards: "You" is a person icon, filled when active.
 * 4. The active tab had a RUST underline and the count badges were rust.
 *    Rust is money only: the active tab is olive (filled icon + label), count
 *    badges are --alert (#B3261E).
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |   const shown = parts.filter(([n]) => n > 0) |   const shown = parts.filter(() => true)
 * @mutate src/pages/home/HomeDashboard.tsx |               const line = summary.tiles[s.key] ?? SECTION_INVITE[s.key]; |               const line = summary.tiles[s.key] ?? "0";
 * @mutate src/components/sections/AppTopBar.tsx |         <HelprMark size="sm" emblemOnly to="/home" /> |         <HelprMark size="sm" to="/home" />
 * @mutate src/components/MobileNav.tsx |                 background: "hsl(var(--alert))", |                 background: "hsl(var(--burnt-sienna))",
 * @mutate src/components/notificationPanel/NotificationTrigger.tsx | style={{ background: "hsl(var(--alert))", color: "#fff" }} | style={{ background: "hsl(var(--burnt-sienna))", color: "#fff" }}
 * @mutate src/components/MobileNav.tsx |           <Icon\n            className="w-[22px] h-[22px] transition-all duration-200" |           {path === "/profile" && <img alt="" src="avatar.png" />}\n          <Icon\n            className="w-[22px] h-[22px] transition-all duration-200"
 * @mutate src/components/MobileNav.tsx |             fill={isActive && path !== "/explore" ? "currentColor" : "none"} |             fill="none"
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const unread = vi.hoisted(() => ({ n: 0 }));
const desktop = vi.hoisted(() => ({ on: false }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-review", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: unread.n, markAllRead: () => {} }) }));
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 0, jobs: 0, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
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
afterEach(() => { cleanup(); unread.n = 0; desktop.on = false; });

describe("1. Home section cards never show a 0 (spec v2 §1.5/§5.5, board 19)", () => {
  it("one line of the NON-zero counts, singular/plural from the real number", () => {
    expect(countLine([[2, "need you"], [1, "in progress"]])).toBe("2 need you · 1 in progress");
    expect(countLine([[0, "need you"], [1, "in progress"]])).toBe("1 in progress");
    expect(countLine([[1, "property", "properties"]])).toBe("1 property");
    expect(countLine([[3, "property", "properties"]])).toBe("3 properties");
  });

  it("nothing real -> null, and the card shows the both-sides invitation", () => {
    expect(countLine([[0, "need you"], [0, "in progress"]])).toBeNull();
    expect(SECTION_INVITE).toEqual({
      jobs: "Hire help or find work",
      declutter: "Sell or find a deal",
      shops: "Shop local or open a shop",
      homes: "Find a place or list one",
    });
    const home = code("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain("const line = summary.tiles[s.key] ?? SECTION_INVITE[s.key];");
    // The old big-number slot is gone: no tile prints a bare count.
    expect(home).not.toMatch(/\{on \? tile\.n : /);
  });
});

describe("2. phone Home keeps the H logo (owner 2026-10-20 08:30Z), never the wordmark", () => {
  it("phone: H emblem left, Help + bell + avatar right", () => {
    render(<MemoryRouter><AppTopBar /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    const logo = bar.firstElementChild as HTMLElement;
    expect(logo.querySelector("img")).not.toBeNull();
    expect(logo.textContent ?? "").not.toMatch(/Helpr/);
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Help", "Notifications", "Profile"]);
  });

  it("desktop Home: no bar (the left sidebar carries the H logo)", () => {
    desktop.on = true;
    render(<MemoryRouter><AppTopBar /></MemoryRouter>);
    expect(screen.queryByTestId("app-top-bar")).toBeNull();
  });
});

describe("3 + 4. the bottom bar: You is a person icon; olive active, --alert badges", () => {
  it("You draws an icon, never the member's photo or monogram", () => {
    renderDock("/profile");
    const you = screen.getByRole("button", { name: "You" });
    expect(you.querySelector("svg")).not.toBeNull();
    expect(you.querySelector("img")).toBeNull();
    expect(you.textContent).toBe("You"); // no "TP" monogram beside the label
    expect(you.getAttribute("aria-current")).toBe("page");
    expect(you.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
  });

  it("the active tab is olive with no rust anywhere in the bar", () => {
    unread.n = 3;
    const { container } = renderDock("/home");
    const home = screen.getByRole("button", { name: "Home" });
    expect(home.getAttribute("style")).toContain("hsl(var(--bark))");
    expect(container.innerHTML).not.toMatch(/burnt-sienna|accent-ink/);
  });

  it("the Messages count badge is --alert with white text", () => {
    unread.n = 12;
    renderDock("/home");
    const badge = [...screen.getByRole("button", { name: "Messages" }).querySelectorAll("span")].find((s) => s.textContent === "9+");
    expect(badge, "a 9+ badge on Messages").toBeTruthy();
    expect(badge!.getAttribute("style")).toContain("hsl(var(--alert))");
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
