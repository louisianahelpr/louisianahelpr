/**
 * JA-39 (Jobs audit 2026-11-01): the Helpr's Home Next up, on the way to a job, read "You're on the way" over
 * "You're working · Haul off an old couch...", saying working before they had arrived. The side word now says
 * where they are ("You're on the way · ..."), and the task is the arrival tap, not the status repeated.
 * Inventory: the Helpr's own stages that reach Next up (on the way, and the day-before confirm for contrast).
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   return lineId === "on_the_way" ? "You're on the way" : "You're working"; |   return "You're working";
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | title: line.id === "on_the_way" ? ON_THE_WAY_TASK : line.detail, | title: line.detail,
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | ...(line.id === "on_the_way" && !a.job!.is_group_job | ...(false
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts |   if (t.helperStep) request(t.helperStep.jobId, t.helperStep.key); |   void request;
 * @mutate src/pages/home/HomeDashboard.tsx | onClick={() => navigate(todoTarget(next, requestHelperStep))} | onClick={() => navigate(next.to)}
 *
 * Lead 11-01 (B107): the button is the arrival step ("I've arrived"), not "Open job": it leaves the Working card's
 * one-shot step request (helperStepRequest.ts) and opens that card, whose tracker presses its own I've arrived.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ARRIVED_ACTION, deriveNeedsYouTodos, ON_THE_WAY_TASK, todoTarget } from "@/pages/home/homeDashboard/needsYouTodos";
import { takeHelperStepRequest, requestHelperStep } from "@/components/job-card/helperStepRequest";
import { blankComments } from "./helpers/blankNonCode";
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

  it("the button is I've arrived, and it asks the Working card's tracker to take that step", () => {
    const t = deriveNeedsYouTodos({ ...none, appliedApps: [app({ helper_on_the_way_at: new Date(NOW - 600_000).toISOString() })] }, NOW).find((x) => x.id === "a-a1")!;
    expect(t.action).toBe(ARRIVED_ACTION);
    expect(t.action).not.toBe("Open job");
    expect(t.to).toBe("/jobs?tab=working&job=j1&open=1");
    expect(todoTarget(t, requestHelperStep)).toBe(t.to);
    expect(takeHelperStepRequest("j1", "arrived")).toBe(true);
  });

  it("a stage with no step to run (confirmed, not yet set off) keeps Open job and leaves no request", () => {
    const t = deriveNeedsYouTodos({ ...none, appliedApps: [app({ helper_dayof_confirmed_at: null })] }, NOW).find((x) => x.id === "a-a1");
    expect(t).toBeDefined();
    expect(t!.action).toBe("Open job");
    expect(t!.helperStep).toBeUndefined();
    todoTarget(t!, requestHelperStep);
    expect(takeHelperStepRequest("j1", "arrived")).toBe(false);
  });

  it("Home's Next up button and its See all rows both run the to-do through todoTarget", () => {
    const src = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
    expect(src.match(/navigate\(todoTarget\((next|t), requestHelperStep\)\)/g)?.length).toBe(2);
  });
});
