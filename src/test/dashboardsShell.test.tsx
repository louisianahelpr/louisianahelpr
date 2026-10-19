/**
 * THE DASHBOARDS SHELL (owner final decisions, 2026-10-19).
 *
 * - The app opens on HOME: /home renders the Home dashboard (not the job feed).
 * - Home: greeting, three stat boxes (To do / This week / Unread), the To do
 *   list COLLAPSED on load and opened by a tap on the To do box, the member's
 *   sections as boxes, Coming up. No "+" and no row of category pills.
 * - Bottom nav: Home, Jobs, Declutter, Shops, Homes, MESSAGES (unread badge),
 *   no "+".
 * - Every section opens on Browse, and Browse is the leftmost segment.
 * - Status boxes filter: tap = only that group (pressed), tap again = all.
 * - Customize hides a section from the bottom nav AND Home; the last one
 *   cannot be hidden.
 *
 * The @mutate lines break each sentence; this file must go red.
 *
 * @mutate src/App.tsx | <ProtectedRoute fallback={<DashboardRouteSkeleton />}><HomeDashboard /></ProtectedRoute> | <ProtectedRoute fallback={<DashboardRouteSkeleton />}><Dashboard /></ProtectedRoute>
 * @mutate src/pages/home/homeDashboard/useTodoOpen.ts |     return window.sessionStorage.getItem(KEY) === "1"; |     return true;
 * @mutate src/components/mobileNav/dockItems.ts |   return [home, ...sections, { path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" }]; |   return [home, ...sections];
 * @mutate src/components/mobileNav/dockItems.ts |   const sections: DockItem[] = visible.map((s) => { |   const sections: DockItem[] = [...visible].reverse().map((s) => {
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map( |   const options = [...tabs.map(
 * @mutate src/components/sections/StatusBoxes.tsx |           if (p.get("status") === k) p.delete("status"); |           if (false) p.delete("status");
 * @mutate src/components/sections/useSectionPrefs.ts |   const visible = prefs.order.filter((k) => !prefs.hidden.includes(k)) |   const visible = prefs.order.filter(() => true)
 * @mutate src/components/sections/useSectionPrefs.ts |       if (hidden.length >= ALL.length) return false; |       if (hidden.length > ALL.length) return false;
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-shell", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
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
const job = (id: string, status: string) => ({ id, title: `Job ${id}`, status, date_needed: "2099-01-02", start_time: "09:00:00", location: "Baton Rouge, LA", budget: 50, helper_id: null });
vi.mock("@/hooks/useActivityData", () => ({
  useActivityData: (_u: unknown, tab: string) => ({
    loading: false,
    postedJobs: tab === "posted" ? [job("a", "open"), job("b", "open")] : [],
    appliedApps: [],
    pendingApplicantCounts: { a: 1, b: 2 },
  }),
}));
vi.mock("@/components/job-card/activityFilters", () => ({
  postedActivityBucket: () => "needs_you",
  appliedActivityBucket: () => "waiting",
}));
vi.mock("@/lib/declutter/api", () => ({ fetchMyItems: async () => [] }));
vi.mock("@/lib/shops/orders", () => ({ fetchMyOrders: async () => [] }));
vi.mock("@/lib/rentals/api", () => ({ fetchMyProperties: async () => [] }));

import MobileNav from "@/components/MobileNav";
import HomeDashboard from "@/pages/home/HomeDashboard";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { SECTIONS } from "@/components/sections/sectionsConfig";

const ROOT = resolve(__dirname, "../..");
const code = (rel: string) => blankComments(readFileSync(resolve(ROOT, rel), "utf8"));
const PREFS = "helpr_section_prefs:u-shell";

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname + l.search}</span>;
}
function wrap(ui: React.ReactNode, at = "/home") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[at]}>
        {ui}
        <Routes><Route path="*" element={<Where />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dockLabels = () =>
  [...document.querySelectorAll('nav[aria-label="Bottom navigation"] button[aria-label]')].map((b) => b.getAttribute("aria-label"));

beforeEach(() => {
  switches.on = new Set(["declutter", "shops", "rentals"]);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("the app opens on Home (owner 2026-10-19)", () => {
  it("/home renders the Home dashboard, not the job feed", () => {
    const app = code("src/App.tsx");
    const home = app.split("\n").find((l) => l.includes('path="/home"'))!;
    expect(home).toContain("<HomeDashboard />");
    expect(home).not.toMatch(/<Dashboard \/>/);
  });
});

describe("the bottom nav", () => {
  it("is Home, Jobs, Declutter, Shops, Homes, Messages (with its unread badge) and has no +", () => {
    wrap(<MobileNav />);
    const labels = dockLabels();
    expect(labels).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes", "Messages"]);
    expect(labels.some((l) => /post a|^\+$|new job/i.test(l ?? ""))).toBe(false);
    const msgs = screen.getByRole("button", { name: "Messages" });
    expect(msgs.textContent).toContain("3");
  });

  it("Customize: a hidden section leaves the bottom nav; Home and Messages stay", () => {
    localStorage.setItem(PREFS, JSON.stringify({ hidden: ["declutter", "shops"] }));
    wrap(<MobileNav />);
    expect(dockLabels()).toEqual(["Home", "Jobs", "Homes", "Messages"]);
  });

  it("Customize's switch refuses to hide the LAST section (setHidden answers false, nothing saved)", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSectionPrefs } = await import("@/components/sections/useSectionPrefs");
    const keys = SECTIONS.map((s) => s.key);
    localStorage.setItem(PREFS, JSON.stringify({ hidden: keys.slice(0, -1) }));
    const { result } = renderHook(() => useSectionPrefs());
    let ok = true;
    act(() => { ok = result.current.setHidden(keys[keys.length - 1], true); });
    expect(ok).toBe(false);
    expect(result.current.prefs.hidden).toEqual(keys.slice(0, -1));
  });

  it("the last section can never be hidden", () => {
    localStorage.setItem(PREFS, JSON.stringify({ hidden: SECTIONS.map((s) => s.key) }));
    wrap(<MobileNav />);
    expect(dockLabels()).toEqual(["Home", "Jobs", "Declutter", "Shops", "Homes", "Messages"]);
  });
});

describe("Home", () => {
  it("has the three stat boxes, no + and no category pill row", () => {
    wrap(<HomeDashboard />);
    expect([...document.querySelectorAll("[data-stat]")].map((e) => e.getAttribute("data-stat"))).toEqual(["todo", "week", "unread"]);
    expect(document.querySelector('[data-testid="section-add"]')).toBeNull();
    expect(document.querySelector(".category-chip-row, [data-category-pill], [aria-label='Categories']")).toBeNull();
  });

  it("the To do list is COLLAPSED on load and a tap on the To do box opens and closes it", () => {
    wrap(<HomeDashboard />);
    expect(screen.queryByTestId("todo-list")).toBeNull();
    const box = document.querySelector('[data-stat="todo"]') as HTMLElement;
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(box);
    expect(screen.getByTestId("todo-list")).toBeTruthy();
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(box);
    expect(screen.queryByTestId("todo-list")).toBeNull();
  });

  it("shows the member's sections as boxes and Customize hides one from Home too", () => {
    const { unmount } = wrap(<HomeDashboard />);
    expect([...document.querySelectorAll("[data-section-tile]")].map((e) => e.getAttribute("data-section-tile"))).toEqual(["jobs", "declutter", "shops", "homes"]);
    unmount();
    localStorage.setItem(PREFS, JSON.stringify({ hidden: ["shops"] }));
    wrap(<HomeDashboard />);
    expect([...document.querySelectorAll("[data-section-tile]")].map((e) => e.getAttribute("data-section-tile"))).toEqual(["jobs", "declutter", "homes"]);
  });
});

function TabsProbe() {
  const [tab, setTab] = useSectionTab(["posted", "working"] as const);
  const [status, toggle] = useStatusFilter(["needs_you", "done"] as const);
  return (
    <>
      <SectionTabs label="Jobs" tabs={[{ value: "posted", label: "Posted" }, { value: "working", label: "Working" }]} value={tab} onChange={setTab} />
      <StatusBoxes boxes={[{ key: "needs_you", label: "Needs you", count: 2 }, { key: "done", label: "Done", count: 1 }]} value={status} onToggle={toggle} />
    </>
  );
}

describe("section toggle + filter boxes", () => {
  it("opens on Browse, and Browse is the leftmost segment", () => {
    wrap(<TabsProbe />, "/jobs");
    const segs = [...screen.getByTestId("section-tabs").querySelectorAll('[role="tab"]')];
    expect(segs[0].textContent).toMatch(/^Browse/);
    expect(segs[0].getAttribute("aria-selected")).toBe("true");
  });

  it("a status box shows only its group (pressed); a second tap shows all", () => {
    wrap(<TabsProbe />, "/jobs?tab=posted");
    const box = document.querySelector('[data-status-box="needs_you"]') as HTMLElement;
    act(() => box.click());
    expect(screen.getByTestId("where").textContent).toContain("status=needs_you");
    expect(box.getAttribute("aria-pressed")).toBe("true");
    act(() => box.click());
    expect(screen.getByTestId("where").textContent).not.toContain("status=");
    expect(box.getAttribute("aria-pressed")).toBe("false");
  });

  it("every section's toggle is built on SectionTabs (Browse cannot be moved)", () => {
    expect(SECTIONS.length).toBeGreaterThan(3);
    for (const f of ["src/components/declutter/DeclutterHomeView.tsx", "src/components/shops/ShopsHomeView.tsx", "src/components/rentals/RentalsHomeView.tsx"]) {
      expect(code(f), f).toMatch(/<SectionTabs\b/);
    }
  });
});
