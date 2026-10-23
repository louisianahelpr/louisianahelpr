/**
 * paypal-refunds: PayPal refunds that no member screen starts (PayPal Plan A, phase 5).
 * SERVICE ONLY: pg_cron's service key (verifyCronSecret). The admin refund door is create-payment's
 * admin_refund_general (_shared/payments/paypalRefundDoors.ts), so the admin screen is unchanged.
 *
 *   {"action":"sweep"}  every 10 minutes (cron paypal-refunds, 20261023232438):
 *     1. cancelled PayPal-funded jobs whose cancel refund has not started
 *        (paypal_cancelled_job_refunds_due): fee-0 ones are refunded (less PayPal's fee); a late-cancel
 *        fee, a crew or a series waits for phase 6 and pages ops once a day.
 *     2. claims whose PayPal answer was lost: asked again with the same key (same refund back).
 *   {"action":"settle_refund_agreement","dispute_id":"<uuid>"}  refund-request-sweep's door for an
 *     agreed refund request on a PayPal job (a full one; a partial one needs phase 4).
 *
 * Crons have no user: this acts only on rows that already exist (provider_payments, which the
 * database lets exist only for members the paypal_payments switch is on for). While no PayPal rows
 * exist the sweep never builds a PayPal client, so an unconfigured PayPal never pages.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { refundCancelledJob, retryLostRefunds, settleRefundAgreement, type CancelledDueRow, type JobRefundDeps } from "../_shared/payments/paypalJobRefunds.ts";
import { payPalFromEnv } from "../_shared/payments/paypalRefundDoors.ts";

const FN = "paypal-refunds";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  let body: { action?: unknown; dispute_id?: unknown };
  try {
    body = await req.json();
  } catch {
    // A cron call always sends JSON; anything else is not ours to guess at.
    return json(400, { error: "body must be JSON" });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "";
  if (!url || !serviceKey) return cronError(FN, "missing SUPABASE_URL or the service key", corsHeaders);
  const db = createClient(url, serviceKey, { auth: { persistSession: false }, global: { fetch: boundedFetch() } });

  let deps: JobRefundDeps | null = null;
  const paypalDeps = (): JobRefundDeps => {
    if (deps) return deps;
    const pp = payPalFromEnv(); // throws when PAYPAL_* is unset or not sandbox: the caller reports it
    deps = { db, provider: pp.provider, client: pp.client, alert: postSlackOpsAlert as never };
    return deps;
  };

  if (body.action === "settle_refund_agreement") {
    if (typeof body.dispute_id !== "string" || !UUID_RE.test(body.dispute_id)) return json(400, { error: "dispute_id must be a uuid" });
    let d: JobRefundDeps;
    try {
      d = paypalDeps();
    } catch (e) {
      return json(503, { error: `PayPal is not configured: ${caughtMessage(e)}` });
    }
    const res = await settleRefundAgreement(d, body.dispute_id);
    return json(res.status, { ...res.body, success: res.status === 200 });
  }

  if (body.action !== "sweep") return json(400, { error: "unknown action" });
  const startedAt = Date.now();
  try {
    const defects = defectTracker();
    const { data: dueData, error: dueErr } = await db.rpc("paypal_cancelled_job_refunds_due", { p_limit: 20 });
    if (dueErr) {
      defects.record(`paypal_cancelled_job_refunds_due failed: ${dueErr.message}`);
      return cronResult(FN, { due: null }, defects.defects, corsHeaders);
    }
    const due = (dueData ?? []) as CancelledDueRow[];
    const { count: lostCount, error: lostErr } = await db.from("provider_refunds")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending").is("provider_refund_id", null).like("idempotency_key", "lh:%");
    if (lostErr) defects.record(`lost-refund count failed: ${lostErr.message}`);
    if (due.length === 0 && (lostCount ?? 0) === 0) {
      return cronResult(FN, { due: 0, lost: 0 }, defects.defects, corsHeaders);
    }
    let d: JobRefundDeps;
    try {
      d = paypalDeps();
    } catch (e) {
      defects.record(`PayPal is not configured but ${due.length} cancelled job(s) and ${lostCount ?? 0} refund(s) wait: ${caughtMessage(e)}`);
      return cronResult(FN, { due: due.length, lost: lostCount ?? 0 }, defects.defects, corsHeaders);
    }
    const outcomes: Record<string, number> = {};
    for (const row of due) {
      if (!row || typeof row.job_id !== "string" || !UUID_RE.test(row.job_id)) {
        defects.record(`due row with no usable job id: ${JSON.stringify(row).slice(0, 200)}`);
        continue;
      }
      let outcome: string;
      try {
        outcome = await refundCancelledJob(d, row);
      } catch (e) {
        outcome = "error";
        defects.record(`cancel refund ${row.job_id}: ${caughtMessage(e)}`);
      }
      const word = outcome.split(":")[0];
      outcomes[word] = (outcomes[word] ?? 0) + 1;
      // Work this run meant to do and could not: a defect, not an outcome.
      if (/^(job_read_failed|payment_read_failed|amount_unknown|retry|recorded_late)/.test(outcome)) defects.record(`cancel refund ${row.job_id}: ${outcome}`);
    }
    let lost = { retried: 0, finished: 0, stale: 0 };
    try {
      lost = await retryLostRefunds(d);
    } catch (e) {
      defects.record(`lost-refund retry: ${caughtMessage(e)}`);
    }
    return cronResult(FN, { due: due.length, outcomes, lost, ms: Date.now() - startedAt }, defects.defects, corsHeaders);
  } catch (e) {
    return cronError(FN, caughtMessage(e), corsHeaders);
  }
});
