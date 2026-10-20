/**
 * Q1734: the Jobs badge counted pending applications on never-paid jobs that
 * My Posts hides (prod 2026-10-12, helper-e2e at 375: badge 1, all five
 * buckets empty). Measured 2026-10-14 with the badge's paid-only query on prod
 * as the test accounts: helper-e2e 1 -> 0, poster-e2e 2 -> 0.
 *
 * Since badge = To-do (owner, 2026-10-20) the badge IS Home's to-do list
 * (deriveNeedsYouTodos), so the rule lives there: a never-paid job (any of
 * NEVER_PAID_STATUSES, the list My Posts reads through jobIsUnfundedDraft)
 * is never a to-do, however many applicants or however overdue it is.
 *
 * @mutate src/pages/home/homeDashboard/needsYouTodos.ts | const posted = i.postedJobs.filter((j) => !jobIsUnfundedDraft(j)).map( | const posted = i.postedJobs.map(
 */
import { describe, expect, it } from "vitest";
import { NEVER_PAID_STATUSES } from "@/lib/neverPaidStatuses";
import { deriveNeedsYouTodos } from "@/pages/home/homeDashboard/needsYouTodos";
import type { Job } from "@/components/job-card/activityConstants";

const job = (id: string, payment_status: string | null) =>
  ({ id, title: `Job ${id}`, status: "open", payment_status, date_needed: null, expires_at: null }) as unknown as Job;

describe("the To-do badge counts only jobs that were paid for (Q1734)", () => {
  it("a never-paid job with pending applicants is no to-do; a paid one (or a NULL status) is", () => {
    expect(NEVER_PAID_STATUSES.length).toBeGreaterThan(2);
    const jobs = [...NEVER_PAID_STATUSES.map((s) => job(`np-${s}`, s)), job("paid", "escrow"), job("legacy", null)];
    const pending = Object.fromEntries(jobs.map((j) => [j.id, 3]));
    const todos = deriveNeedsYouTodos({ postedJobs: jobs, pendingApplicantCounts: pending, appliedApps: [], shopOrders: [], backout: new Map() });
    expect(todos.map((t) => t.id).sort()).toEqual(["p-legacy", "p-paid"]);
  });
});
