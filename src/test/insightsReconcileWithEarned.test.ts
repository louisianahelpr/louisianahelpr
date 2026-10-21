/**
 * Money > More insights adds up to Earned (owner 2026-10-21: the category bars
 * summed to $804 while Earned said $802; the $2 setup fee came off one and not
 * the other). earnedByJob gives each job the Earned card's own figure, and
 * sum(byJob) - feeOwed === earnedDollarsWithLedger for every mix of paid-out and
 * awaiting jobs.
 *
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   return { byJob, feeOwed: Math.min(due, Math.max(0, restSum)) }; |   return { byJob, feeOwed: 0 };
 */
import { describe, it, expect } from "vitest";
import { earnedByJob, earnedDollarsWithLedger } from "@/components/profile/earningsTab/earningsTabHelpers";

const job = (id: string, budget: number, payment_status: string) =>
  ({ id, budget, status: "completed", payment_status, helper_fee_flat_cents: 70, helper_fee_percent: 5, urgent_fee: 0, is_group_job: false, helpers_needed: 1 }) as never;

describe("insights reconcile with Earned", () => {
  const cases: [string, ReturnType<typeof job>[], { job_id: string; amount_cents: number; status: string }[]][] = [
    ["all awaiting payout, fee owed", [job("a", 400, "payout_pending"), job("b", 450, "payout_pending")], []],
    ["one paid out, one awaiting", [job("a", 400, "released"), job("b", 450, "payout_pending")], [{ job_id: "a", amount_cents: 37230, status: "paid" }]],
    ["all paid out", [job("a", 400, "released")], [{ job_id: "a", amount_cents: 37230, status: "paid" }]],
  ];
  for (const [name, jobs, ledger] of cases) {
    it(name, () => {
      const { byJob, feeOwed } = earnedByJob(jobs as never, 12, 2, ledger as never);
      const sum = [...byJob.values()].reduce((s, v) => s + v, 0);
      expect(Math.round((sum - feeOwed) * 100)).toBe(Math.round(earnedDollarsWithLedger(jobs as never, 12, 2, ledger as never) * 100));
    });
  }
  it("the fee shows only while it is still owed", () => {
    expect(earnedByJob([job("a", 400, "payout_pending")] as never, 12, 2, []).feeOwed).toBe(2);
    expect(earnedByJob([job("a", 400, "released")] as never, 12, 2, [{ job_id: "a", amount_cents: 37230, status: "paid" }] as never).feeOwed).toBe(0);
  });
});
