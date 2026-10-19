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
 * The dock assertions RENDER the real MobileNav (hooks with network behind
 * them are stubbed); the @mutate lines break each sentence and this file must
 * go red.
 *
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | { path: "/rentals", icon: KeyRound, label: "Homes", feature: "rentals" as const }, | { path: "/rentals", icon: KeyRound, label: "Rentals", feature: "rentals" as const },
 * @mutate src/components/mobileNav/useSectionTabs.ts |   return sectionItems.map((s) => ({ ...s, on: on[s.feature] })); |   return sectionItems.map((s) => ({ ...s, on: true }));
 * @mutate src/components/MobileNav.tsx |       if (soon) {\n        sayComingSoon(label);\n        return;\n      } |
 * @mutate src/components/MobileNav.tsx |         ariaDisabled={soon} |
 * @mutate src/components/MobileNav.tsx |   const sectionDock = !isGuest; |   const sectionDock = false;
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

import MobileNav from "@/components/MobileNav";
import { sectionItems } from "@/components/mobileNav/mobileNavHelpers";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function renderDock(at = "/home") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        <MobileNav />
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dockLabels = () =>
  [...document.querySelectorAll('nav[aria-label="Bottom navigation"] button[aria-label]')].map((b) => b.getAttribute("aria-label"));

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

  it("the dock is Home, Jobs, Declutter, Shops, Homes, Messages (owner final 2026-10-19); no +, no Profile tab", () => {
    switches.on = new Set(["declutter", "shops", "rentals"]);
    renderDock();
    const labels = dockLabels();
    expect(labels).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes", "Messages"]);
    // The "+" left the dock (owner, 2026-10-19): each section has its own add pill.
    expect(labels).not.toContain("Post a new job");
    expect(labels).not.toContain("Profile");
  });

  it("a switched-OFF section is greyed, aria-disabled, labelled 'coming soon', and a tap does not navigate", () => {
    switches.on = new Set(["shops"]);
    renderDock();
    const declutter = screen.getByRole("button", { name: "Declutter, coming soon" });
    expect(declutter.getAttribute("aria-disabled")).toBe("true");
    expect(declutter.className).toMatch(/\bopacity-40\b/);
    expect(declutter.className).toMatch(/min-h-\[48px\]/);
    fireEvent.click(declutter);
    expect(screen.getByTestId("where").textContent).toBe("/home");
    expect(toasts).toEqual(["Declutter is coming soon"]);
    expect(screen.getByRole("button", { name: "Homes, coming soon" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("a switched-ON section is live: no aria-disabled, its plain name, and a tap navigates", () => {
    switches.on = new Set(["shops"]);
    renderDock();
    const shops = screen.getByRole("button", { name: "Shops" });
    expect(shops.getAttribute("aria-disabled")).toBeNull();
    expect(shops.className).not.toMatch(/\bopacity-40\b/);
    fireEvent.click(shops);
    expect(screen.getByTestId("where").textContent).toBe("/shops");
    expect(toasts).toEqual([]);
  });

  it("the Jobs tab is lit on /posts and carries both badges", () => {
    renderDock("/posts");
    const jp = screen.getByRole("button", { name: "Jobs" });
    expect(jp.getAttribute("aria-current")).toBe("page");
    expect(jp.textContent).toContain("3");
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
