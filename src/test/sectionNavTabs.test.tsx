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
 * @mutate src/components/mobileNav/useSectionTabs.ts |     return { ...s, on: on[s.feature], preview, listed: sectionListedHere({ on: on[s.feature], preview }) }; |     return { ...s, on: true, preview, listed: sectionListedHere({ on: on[s.feature], preview }) };
 * @mutate src/components/sections/ExploreSwitcher.tsx |     const soon = !on \|\| isPreview(s); |     const soon = !on;
 * (Owner 2026-10-21: on Explore a closed section says "Soon" ON its tab and a
 * tap does nothing, no toast popping up elsewhere; the row is the LIGHTER
 * control, tone="quiet", under which the section's own solid switch sits.)
 *
 * @mutate src/components/sections/ExploreSwitcher.tsx |           if (!s \|\| !isOn(s)) return; |           if (!s) return;
 * @mutate src/components/sections/ExploreSwitcher.tsx |           if (!s \|\| !isOn(s)) return; |           if (!s) return; if (!isOn(s)) return void toast("Soon");
 * @mutate src/components/sections/ExploreSwitcher.tsx |         tone="quiet" |         tone="solid"
 * (Owner 2026-10-22, the Explore header: a section not open to everyone says "Coming soon" under its name for
 * EVERY viewer, member and tester alike; a tester's still opens, and its empty Browse says "Opens soon".)
 * (Owner 2026-10-29, A2-L11: the caption under a closed chip is "Soon" at 11px, not "Coming soon" at 9px; the
 * chip's accessible name stays "Declutter, coming soon" and the desktop rail keeps "Coming soon".)
 * @mutate src/components/sections/ExploreSwitcher.tsx | <SoonPill variant="caption" data-coming-soon="" /> | <span data-coming-soon="" />
 * @mutate src/components/sections/ExploreSwitcher.tsx |       ariaLabel: soon ? tr("nav.comingSoon", { label: name }) : name, |       ariaLabel: name,
 * @mutate src/components/DesktopSidebarNav.tsx |     youItem,\n  ]; |     youItem,\n    { path: "/posts", icon: Plus, label: "Posts" },\n  ];
 * @mutate src/components/DesktopSidebarNav.tsx | onClick={() => { if (soon) return sayComingSoon(label); if | onClick={() => { if (false) return sayComingSoon(label); if
 * @mutate src/components/sections/AppTopBar.tsx |         <span data-testid="top-bar-bell"> |         <span data-testid="top-bar-bell-x">
 * @mutate src/components/profile/ProfileLanding.tsx |       <YourActivity /> |       <Link to="/declutter">Declutter</Link>\n      <YourActivity />
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
// features_open_to_everyone's answer for the "Preview" mark: null = loading or failed.
const everyone = vi.hoisted(() => ({ open: null as ReadonlySet<string> | null }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => everyone.open }));
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
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 3, jobs: 3, shops: 0 }) }));
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
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));

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
  everyone.open = null;
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

  it("a switched-OFF section says 'Coming soon' under its name, muted; a tap neither navigates nor fires a toast", () => {
    switches.on = new Set(["shops"]);
    renderExplore();
    const declutter = screen.getByRole("radio", { name: "Declutter, coming soon" });
    expect(declutter.querySelector("[data-soon]")).toBeTruthy();
    expect(declutter.querySelector("[data-coming-soon]")?.textContent?.trim()).toBe("Soon");
    fireEvent.click(declutter);
    expect(screen.getByTestId("where").textContent).toBe("/jobs");
    expect(toasts).toEqual([]);
    const homes = screen.getByRole("radio", { name: "Homes, coming soon" });
    expect(homes.querySelector("[data-coming-soon]")?.textContent?.trim()).toBe("Soon");
    // A section open to everyone carries no caption.
    expect(screen.getByRole("radio", { name: "Shops" }).querySelector("[data-coming-soon]")).toBeNull();
  });

  it("the section row is the LIGHTER control: its picked tab is never the olive fill the view switch under it wears", () => {
    switches.on = new Set(["declutter", "shops", "rentals"]);
    renderExplore();
    const jobs = screen.getByRole("radio", { name: "Jobs" });
    expect(jobs.getAttribute("aria-checked")).toBe("true");
    expect(jobs.className.split(/\s+/)).toContain("segmented-option-quiet-selected");
    expect(jobs.className.split(/\s+/)).not.toContain("btn-grad-primary");
    const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");
    const rule = /\.segmented-option-quiet-selected\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/background-color:\s*hsl\(var\(--card\)\)/);
    expect(rule.match(/background(-color)?:/g)).toHaveLength(1);
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

  it("a live section open to testers only ALSO says 'Coming soon' (one word for everyone, owner 2026-10-22), and still opens for the tester", () => {
    switches.on = new Set(["rentals", "shops"]);
    everyone.open = new Set(["shops"]);
    renderExplore();
    const homes = screen.getByRole("radio", { name: "Homes, coming soon" });
    expect(homes.querySelector("[data-coming-soon]")?.textContent?.trim()).toBe("Soon");
    expect(homes.querySelector("[data-preview-pill]")).toBeNull();
    expect(screen.getByRole("radio", { name: "Shops" }).querySelector("[data-coming-soon]")).toBeNull();
    fireEvent.click(homes);
    expect(screen.getByTestId("where").textContent).toBe("/rentals");
  });

  // Owner 2026-10-30 (via the lead): the owner and admins HAVE Declutter, yet the chip said "Declutter / Soon".
  it("Declutter for someone who has it, before it opens to everyone: its plain name, no 'Soon', and a tap opens it", () => {
    switches.on = new Set(["declutter"]);
    everyone.open = new Set();
    renderExplore();
    const declutter = screen.getByRole("radio", { name: "Declutter" });
    expect(declutter.querySelector("[data-coming-soon]")).toBeNull();
    fireEvent.click(declutter);
    expect(screen.getByTestId("where").textContent).toBe("/declutter");
  });

  it("Declutter for someone WITHOUT it still says 'Soon', and a tap does nothing", () => {
    switches.on = new Set(["shops"]);
    everyone.open = new Set(["shops"]);
    renderExplore();
    const declutter = screen.getByRole("radio", { name: "Declutter, coming soon" });
    expect(declutter.querySelector("[data-coming-soon]")?.textContent?.trim()).toBe("Soon");
    fireEvent.click(declutter);
    expect(screen.getByTestId("where").textContent).not.toBe("/declutter");
  });

  it("while the open-to-everyone answer is loading or failed, no open tab says 'Coming soon'", () => {
    switches.on = new Set(["declutter", "shops", "rentals"]);
    renderExplore();
    expect(document.querySelector("[data-coming-soon]")).toBeNull();
    expect(exploreLabels()).toEqual(["Jobs", "Declutter", "Shops", "Homes"]);
  });

  // The desktop website's soft section "+" (owner 2026-10-28) is guarded in topBarAddMatchesBell.test.tsx.
  it("the top bar's right side is the bell, then the Profile avatar at the far right", () => {
    const bar = code("src/components/sections/AppTopBar.tsx");
    const bell = bar.indexOf('data-testid="top-bar-bell"');
    const avatar = bar.indexOf('data-testid="top-bar-profile"');
    expect(bell).toBeGreaterThan(0);
    expect(avatar).toBeGreaterThan(bell);
  });

  it("the LEFT sidebar (board 11): Home, Explore with the member's sections nested, Messages, You; no Posts row, no Post a job button, off sections greyed (Q2220)", () => {
    const rail = code("src/components/DesktopSidebarNav.tsx");
    expect(rail).toContain("const sectionTabs = useSectionTabs();");
    // The phone bar's own items (Home, Explore, Messages, You) with the Customize-ordered sections under Explore.
    expect(rail).toMatch(/leftItems\[0\],\s*exploreItem,\s*\.\.\.visibleSections\.map\(/);
    expect(rail).toMatch(/badgeKey: "messages" \},\s*youItem,/);
    expect(rail).not.toMatch(/path: "\/posts"/);
    expect(rail).not.toMatch(/Post a job/);
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
