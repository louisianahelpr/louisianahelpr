/**
 * Owner decision 2026-10-18 (pop-up, "Q1981" in the lead's batch; the
 * question of lh-money-escrow@56346b5eb#3, which Q2074 made impossible by
 * design: no hire before a bank payment arrives):
 * a poster who cancelled while their bank debit was pending, and whose debit
 * then FAILED, KEEPS the cancel strike.
 *
 * Measured behaviour (2026-10-18, code read + live pg_get_functiondef): the
 * strike is the user_violations row 'cancel_with_helper' written by
 * poster_cancel_job (apply_cancellation_violation_consequence). When the debit
 * fails, stripe-webhook's paymentIntentPaymentFailed calls
 * cancel_job_after_failed_bank_payment, which answers 'not_cancellable' for a
 * job already cancelled, and the handler's un-fund sets payment_status
 * 'failed'. Nothing on that path touches user_violations, so the strike stays.
 * Live, only purge_user_data, admin_reverse_violation and
 * report_helper_no_show DELETE or UPDATE user_violations (read-only SQL,
 * 2026-10-18).
 *
 * This guard keeps it so:
 *   1. the functions that may remove or rewrite a strike are EXACTLY the
 *      allowlist (both ways), read from the effective migration definitions;
 *   2. the failed-payment path (the RPC it calls, the gift return it calls and
 *      the handler itself) never names user_violations or a reversal;
 *   3. poster_cancel_job still writes the strike (else this guard is vacuous).
 *
 * @mutate supabase/migrations/20261017205845_failed_bank_payment_cancels_hired_job.sql |   PERFORM set_config('app.sanctioned_cancel', 'on', true); |   DELETE FROM public.user_violations WHERE job_id = v_job.id AND violation_type = 'cancel_with_helper';\n  PERFORM set_config('app.sanctioned_cancel', 'on', true);
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |   const cancelNotDeployed = |   await supabase.rpc("admin_reverse_violation", { p_job_id: job.id });\n  const cancelNotDeployed =
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const defs = effectiveDefs(join(root, "supabase", "migrations"));
const body = (name: string): string => {
  const d = defs.get(name);
  if (!d) throw new Error(`no effective definition of ${name}`);
  return blankSqlComments(d.stmt);
};

const REMOVES_STRIKE = /\b(?:delete\s+from|update)\s+(?:public\.)?user_violations\b/i;

describe("a poster who cancelled while the bank debit was pending keeps the strike when the debit fails (owner, 2026-10-18)", () => {
  it("only these functions may delete or rewrite a strike (exact, both ways)", () => {
    // @two-way src/test/failedBankPaymentKeepsCancelStrike.test.ts:expect(found).toEqual(ALLOWED)
    // rpc_poster_report_member_no_show (JOBS-3, 20261101031804): like report_helper_no_show, it only stamps reported_by on
    // the no-show strike the ladder just wrote for that member on that job; it removes or lowers no strike.
    const ALLOWED = ["admin_reverse_violation", "purge_user_data", "report_helper_no_show", "rpc_poster_report_member_no_show"];
    const found = [...defs.keys()].filter((n) => REMOVES_STRIKE.test(body(n))).sort();
    expect(defs.size).toBeGreaterThan(500);
    expect(found).toEqual(ALLOWED);
  });

  it("the failed-payment cancel and the gift return never touch a strike", () => {
    for (const fn of ["cancel_job_after_failed_bank_payment", "return_bounced_gift_card"]) {
      const b = body(fn);
      expect(b.length, fn).toBeGreaterThan(200);
      expect(b, fn).not.toMatch(/user_violations|reverse_violation/i);
    }
    // It leaves an already-cancelled job alone: the outcome the handler un-funds.
    expect(body("cancel_job_after_failed_bank_payment")).toMatch(/v_job\.status::text NOT IN \('open', 'accepted', 'in_progress'\)[\s\S]*'not_cancellable'/);
  });

  it("the webhook handler never names a strike", () => {
    const src = blankComments(readFileSync(join(root, "supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts"), "utf8"));
    expect(src).toMatch(/cancel_job_after_failed_bank_payment/);
    expect(src).not.toMatch(/user_violations|reverse_violation|violation_type/i);
  });

  it("poster_cancel_job still writes the strike", () => {
    expect(body("poster_cancel_job")).toMatch(/apply_cancellation_violation_consequence\s*\(/);
  });
});
