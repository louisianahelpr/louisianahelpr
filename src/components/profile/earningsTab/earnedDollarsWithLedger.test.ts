/**
 * Q1272 (8) / Q1273 (lh-money-escrow review of Q753): a job already PAID OUT
 * counts what was transferred, so the one transfer that bore the one-time setup
 * fee reads that much lower and "total earned" matches what landed. Before,
 * every released job counted its computed take-home and the total read the fee
 * ($2) above the money that arrived.
 *
 * @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |   const paidOut = jobs.reduce((s, j) => s + (transferred.get(j.id) ?? 0), 0) / 100; |   const paidOut = 0;
 */
import { describe, it, expect } from "vitest";
import { earnedDollarsWithLedger } from "./earningsTabHelpers";

const job = (id: string, payment_status: string) => ({ id, status: "completed", payment_status, budget: 100, helper_fee_percent: 10 });

describe("earnedDollarsWithLedger", () => {
  it("a paid-out job counts its transfer: the one that bore the $2 setup fee reads $88, not $90", () => {
    const jobs = [job("a", "released"), job("b", "released")];
    const ledger = [
      { job_id: "a", amount_cents: 8800, status: "paid" as const }, // bore the fee
      { job_id: "b", amount_cents: 9000, status: "paid" as const },
    ];
    expect(earnedDollarsWithLedger(jobs, 10, 0, ledger)).toBe(178);
  });

  it("a failed transfer does not count; that job falls back to its computed take-home", () => {
    const jobs = [job("a", "released")];
    expect(earnedDollarsWithLedger(jobs, 10, 0, [{ job_id: "a", amount_cents: 8800, status: "failed" as const }])).toBe(90);
  });

  // Second lh-money-escrow review: a reversed row counts what was kept
  // (amount_cents - metadata.amount_reversed_cents), and a won dispute's re-pay
  // row adds back on top.
  // @mutate src/components/profile/earningsTab/earningsTabHelpers.ts |     const kept = Math.max(0, Number(t.amount_cents ?? 0) - reversed); |     const kept = Number(t.amount_cents ?? 0);
  it("a partly reversed transfer counts what was kept; a fully reversed one plus its re-pay counts the re-pay", () => {
    const partly = [{ job_id: "a", amount_cents: 9000, status: "reversed" as const, metadata: { amount_reversed_cents: 3000 } }];
    expect(earnedDollarsWithLedger([job("a", "released")], 10, 0, partly)).toBe(60);
    const repaid = [
      { job_id: "a", amount_cents: 9000, status: "reversed" as const, metadata: { amount_reversed_cents: 9000, fully_reversed: true } },
      { job_id: "a", amount_cents: 9000, status: "paid" as const },
    ];
    expect(earnedDollarsWithLedger([job("a", "released")], 10, 0, repaid)).toBe(90);
  });

  it("unpaid jobs still lose the setup fee once while it is owed", () => {
    const jobs = [job("a", "payout_pending"), job("b", "payout_pending")];
    expect(earnedDollarsWithLedger(jobs, 10, 2, [])).toBe(178);
  });

  it("no ledger read yet: everything is computed, as before", () => {
    expect(earnedDollarsWithLedger([job("a", "released")], 10, 0, null)).toBe(90);
  });
});
