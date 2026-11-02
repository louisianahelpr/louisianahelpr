/**
 * Q1978: a bank-payment failure that lands while the Helpr's payout is already moving never cancels or un-escrows
 * the job. cancel_job_after_failed_bank_payment decides it under the job's row lock, BEFORE anything else (even
 * not_hired): any payout_transfers row but a 'failed' one, or a held dispute_settlement_claims row, answers
 * 'payout_moving' and writes nothing; stripe-webhook pages ops on that answer (src/test/edge/fundedJobPaymentFailed.test.ts).
 * Behaviour (real Postgres, base = prod's live definition by md5): src/test/pglite/payoutMovingBlocksFailedBankCancel.pglite.mjs
 * (9 PASS; 6 FAIL on prod's definition; 5 planted SQL defects each red).
 *
 * @mutate supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql |               WHERE pt.job_id = v_job.id AND pt.status IS DISTINCT FROM 'failed') |               WHERE pt.job_id = v_job.id)
 * @mutate supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql |     RETURN jsonb_build_object('outcome', 'payout_moving', 'payment_status', v_job.payment_status); |     NULL;
 * @mutate supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql | FROM PUBLIC, anon, authenticated; | FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const FN = "cancel_job_after_failed_bank_payment";

describe("Q1978: the failed-bank cancel waits for a moving payout", () => {
  it("the newest definition checks payout_transfers and the settlement claim under the lock, before deciding anything", () => {
    const d = effectiveDefs("supabase/migrations").get(FN);
    expect(d, `no live ${FN}`).toBeTruthy();
    const body = blankSqlComments(d!.stmt).replace(/\s+/g, " ");
    const lock = body.indexOf("FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;");
    const check = body.indexOf(
      "IF EXISTS (SELECT 1 FROM public.payout_transfers pt WHERE pt.job_id = v_job.id AND pt.status IS DISTINCT FROM 'failed') OR EXISTS (SELECT 1 FROM public.dispute_settlement_claims c WHERE c.job_id = v_job.id) THEN RETURN jsonb_build_object('outcome', 'payout_moving', 'payment_status', v_job.payment_status); END IF;",
    );
    const hired = body.indexOf("RETURN jsonb_build_object('outcome', 'not_hired');");
    const write = body.indexOf("UPDATE public.jobs SET status = 'cancelled'::job_status");
    // Inventory floor: the real function (it locks the job, answers not_hired, and cancels).
    expect(lock).toBeGreaterThan(-1);
    expect(hired).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(lock);
    expect(check).toBeLessThan(hired);
    expect(check).toBeLessThan(write);
  });

  it("only service_role may call it (anon's default grant revoked by name)", () => {
    const sql = blankSqlComments(readFileSync("supabase/migrations/20261102055222_payout_moving_blocks_failed_bank_cancel.sql", "utf8"));
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${FN}(uuid, text, uuid) FROM PUBLIC, anon, authenticated;`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${FN}(uuid, text, uuid) TO service_role;`);
  });

  it("the webhook answers 'payout_moving' with a page and no write (never the unknown-outcome throw)", () => {
    const src = readFileSync("supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts", "utf8");
    expect(src).toContain('} else if (cancelOutcome === "payout_moving") {');
  });
});
