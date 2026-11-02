/**
 * A3-17 (audit 11-01): Home's Needs you / Next up tasks named the step with no deadline ("Confirm you'll be at the job",
 * "Approve & release pay"). Each task now carries the status line's OWN clock while it is still ahead, as the cards'
 * next-step line does: "... · by Mon 8:00 AM" (Louisiana time), or for the review window "... · 23h 0m left".
 * Inventory: the Helpr's confirm-due row and the poster's approve row, the two clocks the audit named.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | applicants`) : withTodoBy(line.detail, line, now), | applicants`) : line.detail,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | ON_THE_WAY_TASK : withTodoBy(line.detail, line, now), | ON_THE_WAY_TASK : line.detail,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (!Number.isFinite(at) \|\| at < now \|\| / by (Mon\|Tue\|Wed\|Thu\|Fri\|Sat\|Sun)\b/.test(task)) return task; |   if (!Number.isFinite(at) \|\| / by (Mon\|Tue\|Wed\|Thu\|Fri\|Sat\|Sun)\b/.test(task)) return task;
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (line.deadline!.source === "auto_complete") { |   if (false) {
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deriveNeedsYouTodos, withTodoBy } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ShopOrder } from "@/lib/shops/orders";

// Sat Nov 7 2026, 4:00 PM in Louisiana (CST, UTC-6); the job is Sun Nov 8 at 10:00 AM.
const NOW = Date.parse("2026-11-07T22:00:00Z");
const none = { postedJobs: [] as Job[], pendingApplicantCounts: {} as Record<string, number>, appliedApps: [] as AppliedApp[], shopOrders: [] as ShopOrder[], backout: new Map() };
const job = (over: Partial<Job>): Job => ({
  id: "j1", title: "Haul off an old couch", status: "accepted", payment_status: "escrow", helper_id: "me", customer_id: "p",
  date_needed: "2026-11-08", start_time: "10:00", helper_confirmed_at: "2026-10-01T00:00:00Z", poster_confirmed_at: "2026-10-01T00:00:00Z",
  ...over,
}) as Job;
const app = (j: Job) => ({ id: "a1", job_id: j.id, helper_id: "me", status: "accepted", created_at: "2026-10-01T00:00:00Z", job: j }) as unknown as AppliedApp;

describe("A3-17: Home's tasks say by when", () => {
  // The status lines read the clock themselves (helperStatusLine takes no `now`).
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => vi.useRealTimers());
  it("the Helpr's confirm-due task: by the confirm deadline (2 hours before the start), Louisiana time", () => {
    const todos = deriveNeedsYouTodos({ ...none, appliedApps: [app(job({}))] }, NOW);
    expect(todos.length).toBeGreaterThan(0);
    expect(todos[0].title).toBe("Confirm you'll be at the job · by Sun 8:00 AM");
  });

  it("the poster's approve task: the review window as time left", () => {
    const done = job({ customer_id: "me", status: "in_progress", helper_arrived_at: "2026-11-07T19:00:00Z", helper_completed_at: "2026-11-07T21:00:00Z" } as Partial<Job>);
    const todos = deriveNeedsYouTodos({ ...none, postedJobs: [done] }, NOW);
    expect(todos.length).toBeGreaterThan(0);
    expect(todos[0].title).toMatch(/ · 23h 0m left$/);
  });

  it("a passed clock or no clock adds nothing; a task that already names a day keeps its words", () => {
    const ahead = { deadline: { source: "confirm_deadline" as const, at: "2026-11-08T14:00:00Z", consequenceText: "", expiredText: "" } };
    expect(withTodoBy("Do it", { deadline: null }, NOW)).toBe("Do it");
    expect(withTodoBy("Do it", { deadline: { ...ahead.deadline, at: "2026-11-07T21:00:00Z" } }, NOW)).toBe("Do it");
    expect(withTodoBy("Do it by Sun 8:00 AM", ahead, NOW)).toBe("Do it by Sun 8:00 AM");
    expect(withTodoBy("Do it", ahead, NOW)).toBe("Do it · by Sun 8:00 AM");
  });
});
