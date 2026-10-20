/**
 * Next up's ORDER is spec v2 §5.2: (1) a deadline in under 24 hours, soonest
 * first; (2) someone waiting on the member (applicants, an offer, an order to
 * answer); (3) money waiting on the member (no to-do source yet: see rank()
 * in needsYouTodos.ts); (4) everything else, by date. Built on the real bucket and
 * status-line rules (no mocks) with a pinned clock. Before 2026-10-20 the
 * list was shop orders, then posted jobs, then working jobs, whatever their
 * clocks.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (due !== null && due - now < 24 * HOUR) return [1, due]; |   if (due !== null && due - now < 24 * HOUR) return [4, due];
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (waiting) return [2, due ?? date]; |   if (waiting) return [4, due ?? date];
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   return ranked.sort((x, y) => x.tier - y.tier \|\| x.at - y.at).map((r) => r.item); |   return ranked.map((r) => r.item);
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (Number.isFinite(clock) && clock >= now) return clock; |   if (Number.isFinite(clock)) return clock;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   return Number.isFinite(start) && start >= now ? start : null; |   return Number.isFinite(start) ? start : null;
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ShopOrder } from "@/lib/shops/orders";
import { jobLocalDateISO } from "./helpers/jobLocalDate";

// Tue Oct 20 2026, 10:00 in Louisiana (15:00Z); every job day is relative to it.
const NOW = Date.parse("2026-10-20T15:00:00Z");
const day = (n: number) => jobLocalDateISO(n, new Date(NOW));
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const job = (over: Partial<Job>): Job =>
  ({
    id: "j", title: "Mow the lawn", status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_1", helper_id: null,
    customer_id: "me", date_needed: day(5), start_time: "09:00:00", updated_at: "2026-10-01T00:00:00Z", ...over,
  }) as Job;
/** A held order to answer, lapsing `hours` from now. */
const order = (id: string, hours = 5): ShopOrder =>
  ({ id, status: "held", accept_by: inHours(hours), total_cents: 1240, shop_order_lines: [{ title: "Pecan pralines" }] }) as unknown as ShopOrder;
const none = { postedJobs: [] as Job[], pendingApplicantCounts: {} as Record<string, number>, appliedApps: [] as AppliedApp[], shopOrders: [] as ShopOrder[], backout: new Map() };

describe("Next up ranks by spec v2 §5.2", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it("is not vacuous: each fixture is a to-do on its own", () => {
    expect(deriveNeedsYouTodos({ ...none, postedJobs: [job({ id: "a" })], pendingApplicantCounts: { a: 2 } }, NOW)).toHaveLength(1);
    expect(deriveNeedsYouTodos({ ...none, shopOrders: [order("o")] }, NOW)).toHaveLength(1);
    expect(deriveNeedsYouTodos({ ...none, postedJobs: [job({ id: "late", status: "in_progress", helper_id: "h", date_needed: day(-3) })] }, NOW)).toHaveLength(1);
  });

  it("under 24 hours beats someone waiting, which beats the rest", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      postedJobs: [
        // (4) in progress, its day passed: overdue, no clock ahead.
        job({ id: "late", title: "Overdue job", status: "in_progress", helper_id: "h", date_needed: day(-3) }),
        // (2) two applicants, the job next week.
        job({ id: "apps", title: "Applicants job", date_needed: day(6) }),
      ],
      pendingApplicantCounts: { apps: 2 },
      // (1) an order to answer, lapsing in 5 hours.
      shopOrders: [order("soon")],
    }, NOW);
    expect(todos.map((t) => t.id)).toEqual(["s-soon", "p-apps", "p-late"]);
  });

  it("inside tier 1 the soonest clock wins, from any section; a clock already passed does not count", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      // Applicants on a job that starts in 3 hours: its start is the clock.
      postedJobs: [job({ id: "today", title: "Today job", date_needed: day(0), start_time: "13:00:00" })],
      pendingApplicantCounts: { today: 1 },
      shopOrders: [order("o5", 5), order("gone", -1)],
    }, NOW);
    expect(todos.map((t) => t.id)).toEqual(["p-today", "s-o5", "s-gone"]);
  });

  it("a status-line clock that has run out does not jump the queue", () => {
    const disputed = job({ id: "dis", status: "disputed", helper_id: "h", date_needed: day(-4), dispute_deadline: inHours(-1) } as Partial<Job>);
    expect(deriveNeedsYouTodos({ ...none, postedJobs: [disputed] }, NOW)).toHaveLength(1);
    const todos = deriveNeedsYouTodos({ ...none, postedJobs: [disputed, job({ id: "apps", date_needed: day(6) })], pendingApplicantCounts: { apps: 1 } }, NOW);
    expect(todos.map((t) => t.id)).toEqual(["p-apps", "p-dis"]);
  });

  it("a clock more than a day out is not tier 1: it sorts by date among the waiting", () => {
    const todos = deriveNeedsYouTodos({
      ...none,
      postedJobs: [job({ id: "wk", date_needed: day(2) })],
      pendingApplicantCounts: { wk: 1 },
      shopOrders: [order("far", 30)],
    }, NOW);
    expect(todos.map((t) => t.id)).toEqual(["s-far", "p-wk"]);
  });
});
