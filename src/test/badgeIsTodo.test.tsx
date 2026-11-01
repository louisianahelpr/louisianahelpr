/**
 * BADGE = TO-DO (owner decision, 2026-10-20). The Explore badge (phone dock),
 * the desktop sidebar's Explore / Jobs / Shops counts and Home's Next up /
 * To do count the SAME thing: jobs and items that NEED YOU, one per job,
 * never unseen applicants.
 *
 * Before: the dock badge was useActivityBadgeCounts (unseen pending applicants
 * + pending direct offers), Home's list was the needs-you buckets. One job
 * with 21 new applicants plus one order waiting for my shop read "9+" on the
 * Explore badge and "To do 2" on Home.
 *
 * One fixture through the real bridge, the real dock, the real sidebar and the
 * real Home (only the network is faked): badge == to-dos == "See all (n)".
 *
 * @mutate src/components/MobileNav.tsx |         : badgeKey === "todo"\n          ? todo.total | : badgeKey === "todo"\n          ? todo.jobs
 * @mutate src/components/NeedsYouBridge.tsx | publishNeedsYou(uid, { total: jobs + shops, jobs, shops }); | publishNeedsYou(uid, { total: jobs, jobs, shops });
 * @mutate src/components/DesktopSidebarNav.tsx |     if (key === "todoShops") return todo.shops; |     if (key === "todoShops") return 0;
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |   const { todos } = useNeedsYouTodos(user); |   const todos = useNeedsYouTodos(user).todos.slice(1);
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   const postedNeeds = posted.filter((j) => postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you"); |   const postedNeeds = posted.flatMap((j) => (postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you" ? Array.from({ length: Math.max(1, i.pendingApplicantCounts[j.id] ?? 0) }, () => j) : []));
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User as SupaUser } from "@supabase/supabase-js";

const fx = vi.hoisted(() => {
  const paidOpen = (id: string) => ({
    id, title: `Job ${id}`, status: "open", payment_status: "escrow", helper_id: null,
    date_needed: "2099-01-02", start_time: "09:00:00", expires_at: "2099-02-01T00:00:00Z", location: "Baton Rouge, LA", budget: 50,
  });
  return {
    posted: {
      // One job with 21 unseen applicants (ONE to-do) and one with none (waiting: no to-do).
      postedJobs: [paidOpen("j21"), paidOpen("quiet")],
      applicantCounts: { j21: 21 },
      pendingApplicantCounts: { j21: 21 } as Record<string, number>,
      closedApplicantSummaries: {},
    },
    applied: { appliedApps: [], declinedJobIds: new Set<string>(), helperReviewedJobIds: new Set<string>() },
    // One order waiting for my shop's answer (ONE to-do) and one already handed over.
    shopOrders: [
      { id: "o-held", status: "held", accept_by: "2099-01-01T00:00:00Z", total_cents: 1240, shop_order_lines: [{ title: "Pecan pralines" }] },
      { id: "o-done", status: "handed_over", accept_by: null, total_cents: 500, shop_order_lines: [{ title: "Done" }] },
    ],
  };
});

// Board 143's Home card reads payout_failures; it has its own test (moneyAndSafetyMounts, payoutProblems).
vi.mock("@/components/money/PayoutFailedCard", () => ({ PayoutFailedCard: () => null }));
// Board 189's first-job Home has its own reads (applications); not what this file is about.
vi.mock("@/pages/home/homeDashboard/FirstJobHome", () => ({ FirstJobHome: () => null, useFirstJobState: () => null }));
// The "Preview" mark's read (useSectionTabs) stubbed as not loaded: no section is marked here (src/test/previewMark.test.tsx owns it).
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => true }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-todo", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useActivityData", () => ({
  CORE_STALE: 60_000,
  fetchPostedActivity: async () => fx.posted,
  fetchAppliedActivity: async () => fx.applied,
  useActivityData: (_u: unknown, tab: string) => ({
    loading: false,
    postedJobs: tab === "posted" ? fx.posted.postedJobs : [],
    appliedApps: [],
    pendingApplicantCounts: tab === "posted" ? fx.posted.pendingApplicantCounts : {},
  }),
}));
vi.mock("@/lib/backoutNotices", () => ({
  backoutNoticeApplies: () => false,
  backoutNoticesKey: (u: string) => ["activity", "backout", u],
  useBackoutNotices: () => new Map(),
}));
vi.mock("@/lib/shops/orders", () => ({
  fetchMyOrders: async () => [],
  fetchShopOrders: async () => fx.shopOrders,
  formatCents: (c: number) => `$${(c / 100).toFixed(2)}`,
}));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyItems: async () => [], fetchMyCart: async () => [] }));
// B87: Home reads these two through their own module.
vi.mock("@/lib/declutter/myReads", () => ({ fetchMyItems: async () => [], fetchMyCart: async () => [] }));
vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
// Home's money tiles read the Money tab's own queries; homeMoneyTiles/homeMoneyGating prove them.
vi.mock("@/pages/home/homeDashboard/homeMoney", () => ({ useHomeMoney: () => ({ coming: null, held: null }) }));
vi.mock("@/lib/rentals/api", () => ({ fetchMyProperties: async () => [] }));
vi.mock("@/lib/shops/api", () => ({ fetchMyShopId: async () => null }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0, markAllRead: () => {} }) }));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ prefetchRecentPostedJobs: () => {} }));
vi.mock("@/lib/routePrefetch", () => ({ prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));
vi.mock("@/components/mobileNav/useDockSheets", async () => { const m = await import("@/components/mobileNav/dockSheets"); return { useDockSheetsLoader: () => m }; }); // sheets at once: their lazy load is dockSheetsLoadOnTap.test.tsx
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticMedium: () => {} }));
vi.mock("@/components/mobileNav/useDockMotion", async (orig) => ({ ...(await orig<object>()), useDockMotionLoader: () => null }));
vi.mock("@/components/mobileNav/useRecentConversationsPreview", () => ({ useRecentConversationsPreview: () => ({ data: [] }) }));
vi.mock("@/hooks/useStoredSessionHint", () => ({ useStoredSessionHint: () => true }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/components/NotificationPanel", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({ default: () => <button type="button" aria-label="Notifications" /> }));
// Home mounts FirstRun (board 53 tour), which reads the account's tour stamp: answered here, never the network.
vi.mock("@/lib/onboardingTourCompletion", () => ({ fetchTourCompletion: async () => ({ status: "completed" }), markTourCompleted: async () => true }));

import NeedsYouBridge from "@/components/NeedsYouBridge";
import MobileNav from "@/components/MobileNav";
import DesktopSidebarNav from "@/components/DesktopSidebarNav";
import HomeDashboard from "@/pages/home/HomeDashboard";
import { clearNeedsYou } from "@/lib/needsYouStore";

afterEach(() => {
  cleanup();
  act(() => clearNeedsYou());
});

async function mountAll() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/home"]}>
        <NeedsYouBridge user={{ id: "u-todo" } as SupaUser} />
        <HomeDashboard />
        <MobileNav />
        <DesktopSidebarNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The bridge and Home settle on the same to-do list.
  await screen.findByTestId("next-up-see-all");
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const sidebarCount = (path: string) => document.querySelector(`[data-sidebar-item="${path}"] [data-sidebar-badge]`)?.textContent ?? "0";

describe("badge = To-do (owner, 2026-10-20)", () => {
  it("21 new applicants on one job + one order to answer = 2 everywhere: Explore badge, sidebar, Next up, See all", async () => {
    await mountAll();
    // Home: the to-do list is one per job / order.
    expect(screen.getByTestId("next-up-label").textContent).toBe("Next up · 1 of 2");
    expect(screen.getByTestId("next-up-see-all").textContent).toBe("See all (2)");
    // The phone dock's Explore badge is the same number (never "9+" from 21 applicants).
    expect(document.querySelector('[data-dock-badge="/explore"]')?.textContent).toBe("2");
    // Desktop sidebar: Explore = total, Jobs and Shops = their share.
    expect(sidebarCount("/explore")).toBe("2");
    expect(sidebarCount("/jobs")).toBe("1");
    expect(sidebarCount("/shops")).toBe("1");
    expect(sidebarCount("/declutter")).toBe("0");
  });

  it("the navs read only the published counts: the old applicant-count hook is gone", async () => {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(existsSync(resolve(__dirname, "../hooks/useActivityBadgeCounts.ts"))).toBe(false);
  });
});
