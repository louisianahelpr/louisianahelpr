/**
 * JA-39 (Jobs audit 2026-11-01): the Helpr's Home Next up, on the way to a job, read "You're on the way" over
 * "You're working · Haul off an old couch...", saying working before they had arrived. The side word now says
 * where they are ("You're on the way · ..."), and the task is the arrival tap, not the status repeated.
 * Inventory: the Helpr's own stages that reach Next up (on the way, and the day-before confirm for contrast).
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   return lineId === "on_the_way" ? "You're on the way" : "You're working"; |   return "You're working";
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | title: line.id === "on_the_way" ? ON_THE_WAY_TASK : line.detail, | title: line.detail,
 */
import { describe, expect, it } from "vitest";
import { deriveNeedsYouTodos, ON_THE_WAY_TASK } from "@/pages/home/homeDashboard/needsYouTodos";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import type { ShopOrder } from "@/lib/shops/orders";
import { jobLocalDateISO } from "./helpers/jobLocalDate";

const NOW = Date.now();
const none = { postedJobs: [] as Job[], pendingApplicantCounts: {} as Record<string, number>, appliedApps: [] as AppliedApp[], shopOrders: [] as ShopOrder[], backout: new Map() };
const app = (over: Partial<Job>): AppliedApp => ({
  id: "a1", job_id: "j1", helper_id: "me", status: "accepted", created_at: "2026-10-01T00:00:00Z",
  job: {
    id: "j1", title: "Haul off an old couch and two chairs", status: "accepted", payment_status: "escrow", helper_id: "me",
    customer_id: "p", date_needed: jobLocalDateISO(0), start_time: null, helper_confirmed_at: "2026-10-01T00:00:00Z",
    helper_dayof_confirmed_at: "2026-10-01T00:00:00Z", poster_confirmed_at: "2026-10-01T00:00:00Z", ...over,
  } as Job,
}) as unknown as AppliedApp;

describe("JA-39: Next up for a Helpr on the way", () => {
  it("says on the way, never working, and asks for the arrival tap", () => {
    const todos = deriveNeedsYouTodos({ ...none, appliedApps: [app({ helper_on_the_way_at: new Date(NOW - 600_000).toISOString() })] }, NOW);
    expect(todos.length).toBeGreaterThan(0);
    const t = todos.find((x) => x.id === "a-a1")!;
    expect(t.meta).toBe("You're on the way · Haul off an old couch and two chairs");
    expect(t.title).toBe(ON_THE_WAY_TASK);
    expect(t.title).not.toBe("You're on the way");
  });
});
