/**
 * THE SECTION TABS (owner, 2026-10-18: pop-up ~17:00Z option 1A, then the
 * "greyed, coming soon" ruling the same evening).
 *
 * (Superseded 2026-10-19 by the owner final decisions: Messages joined the bar
 * as its 6th tab; see src/test/dashboardsShell.test.tsx.) The owner approved this bottom bar: Home, ONE Jobs & Posts tab, Declutter,
 * Shops, Homes (a key icon; the 'rentals' switch), with the olive + kept beside
 * it, and Messages + the avatar moved to Home's top row next to the bell. The
 * desktop rail gains Homes under Shops, and the dock and the rail use the same
 * Posts/Jobs icons. A section whose switch is OFF for the viewer is NOT hidden:
 * it shows GREYED (aria-disabled, "<name>, coming soon", still 44px) and a tap
 * says "coming soon" instead of navigating; a section whose switch is on is
 * live. The switch is only read, never changed. The Declutter/Shops/Rentals
 * rows left the Profile page ("not where they belong"), and this nav never
 * says "Rentals".
 *
 * (Superseded again 2026-10-20 by the owner-approved mock-up: the phone bar
 * is Home, Explore, "+", Messages, You, and the sections live in EXPLORE. The
 * greyed "coming soon" rule now holds on Explore and the "+" sheet; see
 * src/test/centerCreateNav.test.tsx. The top bar keeps bell then avatar, per
 * HELPR-DESIGN-SPEC §3.)
 *
 * The Explore assertions RENDER the real page (hooks with network behind
 * them are stubbed); the @mutate lines break each sentence and this file must
 * go red.
 *
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | { path: "/rentals", icon: KeyRound, label: "Homes", feature: "rentals" as const }, | { path: "/rentals", icon: KeyRound, label: "Rentals", feature: "rentals" as const },
 * @mutate src/components/mobileNav/useSectionTabs.ts |   return sectionItems.map((s) => ({ ...s, on: on[s.feature] })); |   return sectionItems.map((s) => ({ ...s, on: true }));
 * @mutate src/components/sections/ExploreSwitcher.tsx |           if (!isOn(s)) return sayComingSoon(s.label); |
 * @mutate src/components/sections/ExploreSwitcher.tsx |       ariaLabel: on ? s.navLabel : comingSoonLabel(s.navLabel), |       ariaLabel: s.navLabel,
 * @mutate src/components/DesktopSidebarNav.tsx |     ...dockItems(sectionTabs, visibleSections), |     ...dockItems(sectionTabs, visibleSections), { path: "/posts", icon: User, label: "Posts" },
 * @mutate src/components/DesktopSidebarNav.tsx | onClick={() => { if (soon) return sayComingSoon(label); if | onClick={() => { if (false) return sayComingSoon(label); if
 * @mutate src/components/sections/AppTopBar.tsx |         <span data-testid="top-bar-bell"> |         <span data-testid="top-bar-bell-x">
 * @mutate src/components/profile/ProfileLanding.tsx |       <SettingsSection\n |       <Link to="/declutter">Declutter</Link>\n      <SettingsSection\n
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve, join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((m: string) => { toasts.push(m); }, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-1", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 3, markAllRead: () => {} }) }));
vi.mock("@/hooks/useActivityBadgeCounts", () => ({ useActivityBadgeCounts: () => ({ postsCount: 1, jobsCount: 2 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({
  useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }),
}));

vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));

import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import { sectionItems } from "@/components/mobileNav/mobileNavHelpers";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function renderExplore(at = "/jobs") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <ExploreSwitcher current="jobs" />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const exploreLabels = () =>
  [...document.querySelectorAll('[data-testid="explore-switcher"] [role="radio"]')].map((b) => b.getAttribute("aria-label") || b.textContent);

beforeEach(() => {
  switches.on.clear();
  toasts.length = 0;
});
afterEach(cleanup);

describe("the section tabs (owner 2026-10-18)", () => {
  it("are Declutter, Shops, Homes in that order; Homes is the 'rentals' switch and never says Rentals", () => {
    expect(sectionItems.map((s) => [s.path, s.label, s.feature])).toEqual([
      ["/declutter", "Declutter", "declutter"],
      ["/shops", "Shops", "shops"],
      ["/rentals", "Homes", "rentals"],
    ]);
    expect(sectionItems.some((s) => /rental/i.test(s.label))).toBe(false);
  });

  it("Explore lists Jobs, Declutter, Shops, Homes with every switch on; never Rentals", () => {
    switches.on = new Set(["declutter", "shops", "rentals"]);
    renderExplore();
    expect(exploreLabels()).toEqual(["Jobs", "Declutter", "Shops", "Homes"]);
  });

  it("a switched-OFF section is labelled 'coming soon', muted, and a tap does not navigate", () => {
    switches.on = new Set(["shops"]);
    renderExplore();
    const declutter = screen.getByRole("radio", { name: "Declutter, coming soon" });
    expect(declutter.querySelector("[data-soon]")).toBeTruthy();
    fireEvent.click(declutter);
    expect(screen.getByTestId("where").textContent).toBe("/jobs");
    expect(toasts).toEqual(["Declutter is coming soon"]);
    expect(screen.getByRole("radio", { name: "Homes, coming soon" })).toBeTruthy();
  });

  it("a switched-ON section is live: no aria-disabled, its plain name, and a tap navigates", () => {
    switches.on = new Set(["shops"]);
    renderExplore();
    const shops = screen.getByRole("radio", { name: "Shops" });
    expect(shops.querySelector("[data-soon]")).toBeNull();
    fireEvent.click(shops);
    expect(screen.getByTestId("where").textContent).toBe("/shops");
    expect(toasts).toEqual([]);
  });

  it("the top bar's right side is the section's +, then the bell, then the Profile avatar at the far right", () => {
    const bar = code("src/components/sections/AppTopBar.tsx");
    const add = bar.indexOf('data-testid="section-add"');
    const bell = bar.indexOf('data-testid="top-bar-bell"');
    const avatar = bar.indexOf('data-testid="top-bar-profile"');
    expect(add).toBeGreaterThan(0);
    expect(bell).toBeGreaterThan(add);
    expect(avatar).toBeGreaterThan(bell);
  });

  it("the rail IS the dock's list plus Profile: no separate Posts row, no Post a Job button, off sections greyed (Q2220)", () => {
    const rail = code("src/components/DesktopSidebarNav.tsx");
    expect(rail).toContain("const sectionTabs = useSectionTabs();");
    // One list for the dock and the rail (dockItems), so Posts lives inside Jobs on both.
    expect(rail).toMatch(/\.\.\.dockItems\(sectionTabs, visibleSections\),\s*PROFILE_ITEM,/);
    expect(rail).not.toMatch(/path: "\/posts"/);
    expect(rail).not.toMatch(/Post a Job/);
    expect(rail).toContain("onClick={() => { if (soon) return sayComingSoon(label); if (location.pathname === path) announceTabReselect(path); navigate(path); }}");
    expect(rail).toContain("aria-disabled={soon ? true : undefined}");
  });

  it("the Profile landing has no Declutter, Shops or Homes row", () => {
    const dir = "src/components/profile/profileLanding";
    const files = ["src/components/profile/ProfileLanding.tsx", ...readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".tsx") && !f.includes(".test.")).map((f) => join(dir, f))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(code(f), f).not.toMatch(/to=["{`]+\/(declutter|shops|rentals)["`}]/);
    }
  });
});
