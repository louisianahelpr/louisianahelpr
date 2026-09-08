/**
 * THE FAILURE THIS PREVENTS
 *
 * 2026-09-06, external QA: a helper completed a job, the poster approved and
 * released it, and Earnings & Payouts said "$0.00 · total earned · 0 jobs",
 * "No earnings yet", and a wallet reading Available $0.00 / Pending $0.00 —
 * while My Jobs → Done showed the same job at $105 with its proof photos. The
 * money was never lost. It was `payout_pending` on the job row with a
 * `payout_scheduled_at` a day out, sitting on the PLATFORM's Stripe balance,
 * which is in neither bucket the wallet reads.
 *
 * Two separate mistakes produced that screen, and this file guards both:
 *
 *  1. The source query filtered `is_seed = false`, so a fixture-flagged job on
 *     a REAL helper's real account vanished from every figure on the tab while
 *     still appearing everywhere else in the app. Guarded by
 *     `useProfileEarnings` having no `is_seed` clause.
 *  2. "Earned" was `status === "completed"` alone, which both counts a refunded
 *     or charged-back job as income and says nothing about money that is
 *     approved but not yet transferred. Guarded by the classification below.
 *
 * THE VOCABULARY IS READ FROM THE MIGRATION, NOT RESTATED HERE. A list that is
 * both the test's input and its definition of correctness cannot fail for a
 * missing member — this repo has been bitten by that three times. The set of
 * legal `jobs.payment_status` values is parsed out of the CHECK constraint in
 * `supabase/migrations/`, so a migration that adds an eleventh state fails this
 * suite until someone decides whether it is the helper's money.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AWAITING_TRANSFER_PAYMENT_STATUSES,
  EARNED_PAYMENT_STATUSES,
  UNEARNED_PAYMENT_STATUSES,
  isAwaitingTransfer,
  isEarnedJob,
} from "@/components/profile/earningsTab/earningsTabHelpers";

const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

/** Every value `jobs_payment_status_check` admits, per the LAST migration to
 *  define it — that is the constraint prod is actually running. */
function paymentStatusesFromMigrations(): string[] {
  const defining = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      return /ADD\s+CONSTRAINT\s+jobs_payment_status_check/i.test(sql);
    });
  const newest = defining[defining.length - 1];
  if (!newest) throw new Error("No migration defines jobs_payment_status_check");
  const sql = readFileSync(join(MIGRATIONS_DIR, newest), "utf8");
  // Bounded to the ARRAY[...] literal of THAT constraint, so a later statement
  // in the same file cannot leak its own quoted values into the vocabulary.
  const after = sql.slice(sql.search(/ADD\s+CONSTRAINT\s+jobs_payment_status_check/i));
  const array = /ARRAY\s*\[([^\]]*)\]/.exec(after);
  if (!array) throw new Error(`No ARRAY[...] under the constraint in ${newest}`);
  const values = [...array[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  if (values.length === 0) throw new Error(`Could not parse states out of ${newest}`);
  return [...new Set(values)];
}

describe("jobs.payment_status → is it the helper's money?", () => {
  const dbStatuses = paymentStatusesFromMigrations();

  it("parses a real vocabulary out of the migration (guards the parser itself)", () => {
    // If the regex ever silently matched nothing the classification test below
    // would pass over an empty set. Anchor it on two states that have existed
    // since the column did, plus a floor on the count.
    expect(dbStatuses).toContain("escrow");
    expect(dbStatuses).toContain("released");
    expect(dbStatuses.length).toBeGreaterThanOrEqual(8);
  });

  it("classifies every state the database can hold, exactly once", () => {
    const classified = [...EARNED_PAYMENT_STATUSES, ...UNEARNED_PAYMENT_STATUSES];
    // Nothing unclassified: a new state must be decided, not defaulted.
    expect([...dbStatuses].sort()).toEqual([...classified].sort());
    // Nothing double-classified: money cannot be both earned and not.
    expect(new Set(classified).size).toBe(classified.length);
    // Awaiting-transfer is a SUBSET of earned, never a third bucket beside it —
    // approved money is the helper's whether or not Stripe has been told.
    for (const s of AWAITING_TRANSFER_PAYMENT_STATUSES) {
      expect(EARNED_PAYMENT_STATUSES).toContain(s);
    }
  });

  it("counts approved-but-not-yet-transferred money as earned", () => {
    // The QA job, verbatim: completed, approved, transfer scheduled ~24h out.
    const job = { status: "completed", payment_status: "payout_pending" };
    expect(isEarnedJob(job)).toBe(true);
    expect(isAwaitingTransfer(job)).toBe(true);
  });

  it("counts a fired transfer as earned, but no longer awaiting", () => {
    const job = { status: "completed", payment_status: "released" };
    expect(isEarnedJob(job)).toBe(true);
    expect(isAwaitingTransfer(job)).toBe(false);
  });

  it("does not count money that was returned or never arrived", () => {
    // `refunded` and `chargeback` are reachable ON A COMPLETED JOB — a dispute
    // resolved for the poster, or a card dispute after the fact. The job stays
    // `completed` forever, so the old `status === "completed"` test paid the
    // helper on screen for money that had gone back.
    for (const payment_status of UNEARNED_PAYMENT_STATUSES) {
      expect(isEarnedJob({ status: "completed", payment_status })).toBe(false);
      expect(isAwaitingTransfer({ status: "completed", payment_status })).toBe(false);
    }
  });

  it("does not count escrowed money on work that is not signed off", () => {
    // Funded by the poster and refundable — not the helper's yet, however
    // certain it feels.
    expect(isEarnedJob({ status: "in_progress", payment_status: "escrow" })).toBe(false);
    expect(isEarnedJob({ status: "accepted", payment_status: "escrow" })).toBe(false);
    // And a scheduled payout on a job that somehow is not completed is not
    // earnings either — both halves have to agree.
    expect(isAwaitingTransfer({ status: "in_progress", payment_status: "payout_pending" })).toBe(
      false,
    );
  });

  it("treats a legacy completed row with no payment_status as earned", () => {
    // Prod holds zero of these (every `completed` row is payout_pending or
    // released), so this is purely about not deleting history from a helper's
    // own screen if one ever turns up.
    expect(isEarnedJob({ status: "completed", payment_status: null })).toBe(true);
    expect(isEarnedJob({ status: "completed" })).toBe(true);
    expect(isAwaitingTransfer({ status: "completed", payment_status: null })).toBe(false);
  });
});

describe("the earnings source query", () => {
  const source = readFileSync(join(process.cwd(), "src/hooks/useProfileTabData.ts"), "utf8");
  // Bounded to this one function — the file also holds the schedule and
  // violations queries, and an assertion over the whole file would pass or
  // fail on their contents instead.
  const start = source.indexOf("export function useProfileEarnings");
  const rest = source.slice(start + 1);
  const end = rest.indexOf("\nexport function ");
  const earningsFn = end === -1 ? rest : rest.slice(0, end);

  it("does not filter the helper's own jobs by is_seed", () => {
    // This one clause was the entire reason every figure on the QA helper's
    // screen was zero: their only non-cancelled job carried `is_seed = true`
    // while their profile did not, so Earnings hid a job My Jobs, the profile
    // stats and the Work Record all showed. `is_seed` marks a fixture row, not
    // money that failed to move — the honest axis is `payment_status`, which
    // now lives in `isEarnedJob`. Admin aggregates still exclude it (see
    // src/config/showSeedJobs.ts); one person's own ledger is not a
    // platform-wide money figure.
    expect(earningsFn).not.toMatch(/\.eq\(\s*["']is_seed["']/);
  });

  it("still excludes cancelled jobs", () => {
    // Guards the assertion above from passing because the query was deleted.
    expect(earningsFn).toMatch(/\.neq\("status", "cancelled"\)/);
  });
});
