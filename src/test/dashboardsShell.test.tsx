/**
 * THE DASHBOARDS SHELL (owner final decisions, 2026-10-19).
 *
 * - The app opens on HOME: /home renders the Home dashboard (not the job feed).
 * - Home: greeting, the NEXT UP card (2026-10-20, replacing the three stat
 *   boxes: the most urgent to-do with its action), the To do list COLLAPSED on
 *   load and opened by Next up's "See all", the member's sections as boxes,
 *   Coming up. No "+" and no row of category pills.
 * - Bottom nav (owner-approved mock-up, 2026-10-20, superseding 10-19's six
 *   tabs): Home, Explore, the center "+", MESSAGES (unread badge), You. The
 *   sections live in Explore (src/test/centerCreateNav.test.tsx).
 * - Every section opens on Browse, and Browse is the leftmost segment.
 * - Status boxes filter: tap = only that group (pressed), tap again = all.
 * - Customize hides a section from Explore AND Home; the last one cannot be
 *   hidden.
 *
 * The @mutate lines break each sentence; this file must go red.
 *
 * @mutate src/App.tsx | <ProtectedRoute fallback={<DashboardRouteSkeleton />}><HomeDashboard /></ProtectedRoute> | <ProtectedRoute fallback={<DashboardRouteSkeleton />}><Dashboard /></ProtectedRoute>
 * @mutate src/pages/home/HomeDashboard.tsx |   const [todoOpen, setTodoOpen] = useState(false); |   const [todoOpen, setTodoOpen] = useState(true);
 * @mutate src/pages/home/HomeDashboard.tsx | useState(false);\n  const toggleTodo = () => setTodoOpen((o) => !o); | useState(() => sessionStorage.getItem("t") === "1");\n  const toggleTodo = () => setTodoOpen((o) => { sessionStorage.setItem("t", o ? "0" : "1"); return !o; });
 * @mutate src/pages/home/HomeDashboard.tsx |   useOnTabReselect("/home", () => setTodoOpen(false)); |   useOnTabReselect("/home", () => undefined);
 * @mutate src/pages/home/HomeDashboard.tsx |         {todoOpen && ( |         {todoCount > 0 && !todoOpen && <button type="button" onClick={toggleTodo} aria-expanded={false}>To do ({todoCount})</button>}\n        {todoOpen && (
 * @mutate src/pages/home/HomeDashboard.tsx |   const next = summary.todos[at]; |   const next = summary.todos[summary.todos.length - 1];
 * @mutate src/pages/home/HomeDashboard.tsx |                       onClick={() => setShown(i)} |                       onClick={() => setShown(0)}
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   for (const o of shopWaiting) { |   for (const o of shopWaiting.filter(() => false)) {
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |         title: n > 0 ? (n === 1 ? "Review 1 applicant" |         title: j.title, _t: n > 0 ? (n === 1 ? "Review 1 applicant"
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |     const liveNow = deriveLiveNow(pj, aa, posted.helperNames ?? {}); |     const liveNow = null;
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |       waiting: todos.length ? null : deriveWaiting( |       waiting: true ? null : deriveWaiting(
 * @mutate src/components/mobileNav/dockItems.ts |     right: [{ path: messages.path, icon: messages.icon, label: messages.label, badgeKey: "messages" }, youItem], |     right: [youItem],
 * @mutate src/components/sections/ExploreSwitcher.tsx |   const options = visible.filter(isListed).map((s) => { |   const options = [...visible].reverse().filter(isListed).map((s) => {
 * @mutate src/components/sections/SectionTabs.tsx |   const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map( |   const options = [...tabs.map(
 * @mutate src/components/sections/StatusBoxes.tsx |           if (p.get("status") === k) p.delete("status"); |           if (false) p.delete("status");
 * @mutate src/components/sections/useSectionPrefs.ts |   const visible = prefs.order.filter((k) => !prefs.hidden.includes(k)) |   const visible = prefs.order.filter(() => true)
 * @mutate src/components/sections/useSectionPrefs.ts |   if (next.size >= ALL.length) return true; |   if (next.size > ALL.length) return true;
 * @mutate src/components/mobileNav/mobileNavHelpers.ts |   "/explore": ["/jobs", "/posts", "/declutter", "/shops", "/rentals", "/quotes"], |   "/explore": [],
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
// Backstop: any read no module mock above covers answers "nothing" and never reaches prod (B84's /home cut; see the helper).
vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
const noTodos = vi.hoisted(() => ({ on: false }));
// Boards 83/165: what Home's posted jobs are instead of the two to-dos.
const homeJobs = vi.hoisted(() => ({ mode: "todos" as "todos" | "waiting" | "live" }));
// Board 143's Home card reads payout_failures; it has its own test (moneyAndSafetyMounts, payoutProblems).
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/components/money/PayoutFailedCard", () => ({ PayoutFailedCard: () => null }));
// Board 189's first-job Home has its own reads (applications); this file is about the shell.
vi.mock("@/pages/home/homeDashboard/FirstJobHome", () => ({ FirstJobHome: () => null, useFirstJobState: () => null }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
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
vi.mock("@/lib/needsYouStore", () => ({ useNeedsYouCounts: () => ({ total: 3, jobs: 3, shops: 0 }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
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
// Home mounts FirstRun (board 53 tour), which reads the account's tour stamp: answered here, never the network.
vi.mock("@/lib/onboardingTourCompletion", () => ({ fetchTourCompletion: async () => ({ status: "completed" }), markTourCompleted: async () => true }));
const job = (id: string, status: string) => ({ id, title: `Job ${id}`, status, date_needed: "2099-01-02", start_time: "09:00:00", location: "Baton Rouge, LA", budget: 50, helper_id: null });
vi.mock("@/hooks/useActivityData", () => ({
  // Home's to-do list (badge = To-do) reads the same posted core.
  CORE_STALE: 60_000,
  fetchPostedActivity: async () => ({ postedJobs: noTodos.on ? [] : [job("a", "open"), job("b", "open")], applicantCounts: {}, pendingApplicantCounts: { a: 1, b: 2 }, closedApplicantSummaries: {} }),
  fetchAppliedActivity: async () => ({ appliedApps: [], declinedJobIds: new Set(), helperReviewedJobIds: new Set() }),
  useActivityData: (_u: unknown, tab: string) => ({
    loading: false,
    postedJobs:
      tab !== "posted" ? []
      : homeJobs.mode === "waiting" ? [job("w", "open")]
      : homeJobs.mode === "live" ? [{ ...job("l", "in_progress"), helper_id: "h-1", helper_confirmed_at: "2099-01-01T10:00:00", helper_arrived_at: "2099-01-02T14:04:00", poster_confirmed_arrival_at: "2099-01-02T14:06:00" }]
      : !noTodos.on ? [job("a", "open"), job("b", "open")] : [],
    appliedApps: [],
    pendingApplicantCounts: { a: 1, b: 2 },
  }),
}));
vi.mock("@/components/job-card/activityFilters", async (orig) => ({
  ...(await orig<object>()),
  postedActivityBucket: (j: { status: string }) => (homeJobs.mode === "waiting" ? "waiting" : j.status === "in_progress" ? "scheduled" : "needs_you"),
  appliedActivityBucket: () => "waiting",
  jobIsUnfundedDraft: () => false,
}));
vi.mock("@/lib/backoutNotices", () => ({
  backoutNoticeApplies: () => false,
  backoutNoticesKey: (u: string) => ["activity", "backout", u],
  useBackoutNotices: () => new Map(),
}));
vi.mock("@/lib/declutter/api", () => ({ fetchMyItems: async () => [], fetchMyCart: async () => [] }));
// B87: Home reads these two through their own module.
vi.mock("@/lib/declutter/myReads", () => ({ fetchMyItems: async () => [], fetchMyCart: async () => [] }));
// Home's money tiles read the Money tab's own queries; homeMoneyTiles/homeMoneyGating prove them.
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));
vi.mock("@/lib/shops/orders", () => ({
  fetchMyOrders: async () => [],
  fetchShopOrders: async () => [
    { id: "o-late", status: "held", accept_by: "2099-01-03T00:00:00Z", total_cents: 999, shop_order_lines: [{ title: "Later order" }] },
    { id: "o-soon", status: "held", accept_by: "2099-01-01T00:00:00Z", total_cents: 1240, shop_order_lines: [{ title: "Pecan pralines" }] },
    { id: "o-done", status: "handed_over", accept_by: null, total_cents: 500, shop_order_lines: [{ title: "Done order" }] },
  ],
  formatCents: (c: number) => `$${(c / 100).toFixed(2)}`,
}));
vi.mock("@/lib/rentals/api", () => ({ fetchMyProperties: async () => [] }));
// The dock mounts the + sheet, which reads whether the member has a shop (CreateSheet).
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));

import MobileNav from "@/components/MobileNav";
import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import HomeDashboard from "@/pages/home/HomeDashboard";
import { announceTabReselect } from "@/components/mobileNav/tabReselect";
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

const exploreLabels = () =>
  [...document.querySelectorAll('[data-testid="explore-switcher"] [role="radio"]')].map((b) => b.getAttribute("aria-label") || b.textContent);

describe("the bottom nav", () => {
  it("is Home, Explore, the center +, Messages (with its unread badge), You", () => {
    wrap(<MobileNav />);
    expect(dockLabels()).toEqual(["Home", "Explore", "Create", "Messages", "You"]);
    const msgs = screen.getByRole("button", { name: "Messages" });
    expect(msgs.textContent).toContain("3");
  });

  it.each(["/jobs", "/jobs/settings", "/jobs/00000000-0000-4000-8000-000000000001", "/posts", "/declutter", "/shops/mine", "/rentals"])(
    "%s lights Explore, not Home (every section lives in Explore)",
    (at) => {
      wrap(<MobileNav />, at);
      expect(screen.getByRole("button", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
      expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    },
  );

  it("Customize: a hidden section leaves Explore; the rest keep their order", () => {
    localStorage.setItem(PREFS, JSON.stringify({ hidden: ["declutter", "shops"] }));
    wrap(<ExploreSwitcher current="jobs" />, "/jobs");
    expect(exploreLabels()).toEqual(["Jobs", "Homes"]);
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
    wrap(<ExploreSwitcher current="jobs" />, "/jobs");
    expect(exploreLabels()).toEqual(["Jobs", "Declutter", "Shops", "Homes"]);
  });
});

describe("Home", () => {
  it("Next up is the most urgent to-do with its one action: an order my shop must answer comes before my jobs", async () => {
    wrap(<HomeDashboard />);
    expect(await screen.findByText("Answer an order for Pecan pralines")).toBeTruthy();
    expect(screen.getByTestId("next-up-title").textContent).toBe("Answer an order for Pecan pralines");
    expect(screen.getByTestId("next-up").textContent).toContain("$12.40 order total");
    const action = screen.getByTestId("next-up-action");
    expect(action.textContent).toBe("Answer order");
    fireEvent.click(action);
    expect(screen.getByTestId("where").textContent).toBe("/shops/dashboard");
    // Soonest deadline first; a handed-over order is not a to-do. Two held orders + two jobs I posted.
    expect(screen.getByTestId("next-up-see-all").textContent).toBe("See all (4)");
    // A carousel over all four (mock-up 7): "1 of 4", and a dot shows the next one.
    expect(screen.getByTestId("next-up-label").textContent).toBe("Next up · 1 of 4");
    // Spec v2 §5.2: these orders' clocks are years out, so they rank with the other "someone is
    // waiting on you" to-dos, by date: the applicants on Job a (Jan 2) come before the Jan 3 order.
    fireEvent.click(document.querySelector('[data-next-up-dot="1"]') as HTMLElement);
    expect(screen.getByTestId("next-up-title").textContent).toBe("Review 1 applicant");
    expect(screen.getByTestId("next-up-label").textContent).toBe("Next up · 2 of 4");
  });

  it("a job's to-do is titled by its TASK, with your side and the job under it (spec v2 §5.2, board 165)", async () => {
    switches.on = new Set();
    wrap(<HomeDashboard />);
    expect(await screen.findByText("Review 1 applicant")).toBeTruthy();
    expect(screen.getByTestId("next-up-title").textContent).toBe("Review 1 applicant");
    expect(screen.getByTestId("next-up").textContent).toContain("You posted · Job a");
    expect(screen.getByTestId("next-up-action").textContent).toBe("See applicants");
  });

  it("with nothing to do but someone else's move, Next up says who is up and links the job (board 83)", async () => {
    switches.on = new Set();
    noTodos.on = true;
    homeJobs.mode = "waiting";
    try {
      wrap(<HomeDashboard />);
      expect(screen.getByTestId("next-up-label").textContent).toBe("Waiting on Helprs");
      expect(screen.getByTestId("next-up-title").textContent).toBe("Job w");
      expect(screen.queryByText("You're all caught up")).toBeNull();
      expect(screen.queryByTestId("next-up-action")).toBeNull();
      fireEvent.click(screen.getByTestId("next-up-see-job"));
      expect(screen.getByTestId("where").textContent).toBe("/jobs/w");
    } finally {
      noTodos.on = false;
      homeJobs.mode = "todos";
    }
  });

  it("a job happening now sits ABOVE Next up as Live now, with the tracker on Working (board 165)", () => {
    switches.on = new Set();
    noTodos.on = true;
    homeJobs.mode = "live";
    try {
      wrap(<HomeDashboard />);
      const live = screen.getByTestId("live-now");
      expect(screen.getByTestId("live-now-title").textContent).toBe("Job l");
      expect(live.textContent).toContain("You hired");
      expect(live.textContent).toContain("Started 2:04 PM");
      // The one tracker (owner, 2026-10-21; 8 steps 2026-10-22): the same bar and next line as every job surface.
      expect(live.querySelector("[data-job-steps]")?.getAttribute("aria-label")).toMatch(/^Job progress, step 7 of 8: Working, waiting on the other person\./);
      expect(live.querySelector("[data-job-progress-next]")?.textContent).toBe("Your Helpr is working"); // Working has begun: the line matches the bar (workHasBegun, lead 2026-10-31)
      expect(live.compareDocumentPosition(screen.getByTestId("next-up")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(screen.getByTestId("live-now-action"));
      expect(screen.getByTestId("where").textContent).toBe("/jobs/l");
    } finally {
      noTodos.on = false;
      homeJobs.mode = "todos";
    }
  });

  it("no Live now card when nothing is happening", () => {
    wrap(<HomeDashboard />);
    expect(screen.queryByTestId("live-now")).toBeNull();
  });

  it("with nothing to do, Next up says so and shows no task, no button and no number", () => {
    switches.on = new Set();
    noTodos.on = true;
    wrap(<HomeDashboard />);
    const card = screen.getByTestId("next-up");
    expect(card.textContent).toContain("You're all caught up");
    expect(card.querySelector("button")).toBeNull();
    expect(card.textContent).not.toMatch(/\$|\d/);
    noTodos.on = false;
  });

  it("has the Next up card (no stat boxes), no + and no category pill row", () => {
    wrap(<HomeDashboard />);
    expect(screen.getByTestId("next-up")).toBeTruthy();
    expect(document.querySelectorAll("[data-stat]").length).toBe(0);
    expect(document.querySelector('[data-testid="section-add"]')).toBeNull();
    expect(document.querySelector(".category-chip-row, [data-category-pill], [aria-label='Categories']")).toBeNull();
  });

  // The to-dos arrive from the query cache (badge = To-do), so each test waits for them.
  it("the To do list is COLLAPSED on load and Next up's See all opens and closes it", async () => {
    wrap(<HomeDashboard />);
    const box = await screen.findByTestId("next-up-see-all");
    expect(screen.queryByTestId("todo-list")).toBeNull();
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(box);
    expect(screen.getByTestId("todo-list")).toBeTruthy();
    expect(box.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(box);
    expect(screen.queryByTestId("todo-list")).toBeNull();
  });

  // Owner, 2026-10-19 ("only show To do expanded when it's clicked"): the To do
  // STAT BOX is the only control for the list (the separate "To do (n)" bar
  // duplicated it), and nothing remembers the open state.
  it("Next up's See all is the ONLY control for the list: no second collapsed bar", async () => {
    wrap(<HomeDashboard />);
    await screen.findByTestId("next-up-see-all");
    const controls = [...document.querySelectorAll("[aria-expanded]")];
    expect(controls.map((e) => e.getAttribute("data-testid"))).toEqual(["next-up-see-all"]);
    expect(screen.queryByTestId("todo-collapsed")).toBeNull();
    expect(screen.queryByText(/^To do \(\d+\)$/)).toBeNull();
  });

  it("arrives collapsed after a remount even when it was open before (never remembered)", async () => {
    const first = wrap(<HomeDashboard />);
    fireEvent.click(await screen.findByTestId("next-up-see-all"));
    expect(screen.getByTestId("todo-list")).toBeTruthy();
    first.unmount();
    wrap(<HomeDashboard />);
    const again = await screen.findByTestId("next-up-see-all");
    expect(screen.queryByTestId("todo-list")).toBeNull();
    expect(again.getAttribute("aria-expanded")).toBe("false");
  });

  it("a re-tap of the Home tab folds the open list back up", async () => {
    wrap(<HomeDashboard />);
    fireEvent.click(await screen.findByTestId("next-up-see-all"));
    expect(screen.getByTestId("todo-list")).toBeTruthy();
    act(() => announceTabReselect("/home"));
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
