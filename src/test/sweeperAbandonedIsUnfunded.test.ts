/**
 * nightly-red #2435/#2436 (2026-10-06): the prod lifecycle sweeper read every
 * payment_status but 'unpaid' as FUNDED. Ten e2e jobs that void-cancelled-payments
 * had marked 'abandoned' (a Checkout nobody paid; no PaymentIntent, no session)
 * were sent to cancel_escrow, which rightly answered 409 "never held in escrow",
 * and the pre-sweep failed the money loop, the gift-card journey and both
 * journeys legs (runs 37401225883, 37401228416). The poster's own DELETE policy
 * allows exactly these rows (open AND abandoned).
 *
 * Inventory: every value of jobs_payment_status_check, read from the migration
 * that last defines it (matches prod, read live 2026-10-06). Each has an
 * expected answer below, and the map is exact both ways, so a new status
 * cannot reach the sweeper unclassified.
 *
 * @mutate scripts/e2e/sweepSummary.mjs | export const NEVER_HELD_PAYMENT_STATUSES = ["unpaid", "abandoned"]; | export const NEVER_HELD_PAYMENT_STATUSES = ["unpaid"];
 * @mutate scripts/e2e/prod-lifecycle-sweeper.mjs |   const funded = wasFunded(job.payment_status); |   const funded = job.payment_status !== "unpaid";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs helper shared with the sweeper script
import { wasFunded } from "../../scripts/e2e/sweepSummary.mjs";

const ROOT = join(__dirname, "..", "..");
const CONSTRAINT_MIGRATION = "supabase/migrations/20260824210000_r19_r20_latent_leaks_and_cancelling_status.sql";

// true = money was held at some point (cancel_escrow or settle-forward territory);
// false = never held (the poster's DELETE, or poster_cancel_job).
// @two-way src/test/sweeperAbandonedIsUnfunded.test.ts:EXPECTED is exact: every jobs_payment_status_check value, nothing else
const EXPECTED: Record<string, boolean> = {
  unpaid: false,
  abandoned: false,
  escrow: true,
  cancelling: true,
  payout_pending: true,
  released: true,
  refunded: true,
  chargeback: true,
  // A failed charge holds nothing, but the poster's DELETE policy does not
  // take it either: left as funded so the sweep REPORTS it instead of a
  // zero-row DELETE passing silently.
  failed: true,
  cancelled: true,
};

function constraintValues(): string[] {
  const sql = readFileSync(join(ROOT, CONSTRAINT_MIGRATION), "utf8");
  const at = sql.indexOf("ADD CONSTRAINT jobs_payment_status_check");
  expect(at, "the migration that defines jobs_payment_status_check moved").toBeGreaterThan(-1);
  const body = sql.slice(at, sql.indexOf(";", at));
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("the prod sweeper sends only held money to cancel_escrow", () => {
  it("every payment_status in the constraint is classified, and nothing else", () => {
    const values = constraintValues();
    expect(values.length).toBeGreaterThanOrEqual(10);
    expect([...values].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("an abandoned checkout is not funded (the 2026-10-06 nightly-red)", () => {
    expect(wasFunded("abandoned")).toBe(false);
    expect(wasFunded("unpaid")).toBe(false);
  });

  it.each(Object.entries(EXPECTED))("%s -> funded %s", (status, funded) => {
    expect(wasFunded(status)).toBe(funded);
  });

  it("the sweeper decides funded through wasFunded", () => {
    const src = readFileSync(join(ROOT, "scripts/e2e/prod-lifecycle-sweeper.mjs"), "utf8");
    expect(src).toMatch(/const funded = wasFunded\(job\.payment_status\);/);
  });
});
