import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { fetchFunction, invocationDeadline } from "../_shared/functionFetch.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { readPayPalJobPayment } from "../_shared/payments/paypalJobRefunds.ts";

// Board 141, Jobs side (docs/OPEN.md Q2272; owner 2026-10-21: the money moves
// AUTOMATICALLY when the other side agrees). Every 10 minutes
// (refund-request-sweep, 20261021102943). SERVICE ONLY: pg_cron's service key,
// checked by verifyCronSecret; nothing here is reachable by a member.
//
//   1. refund_requests_sweep (SQL): closes a request whose job moved on, and
//      opens a normal dispute for a request the Helpr declined or did not
//      answer within 2 days.
//   2. refund_agreements_due (SQL) hands out each AGREED refund whose money
//      has not moved (once per 30 minutes, 3 times at most; it closes the job
//      as an admin decision does), and this function asks execute-dispute-split
//      to move it with the service key. That door settles a dispute only when
//      refund_agreement_for_dispute proves the other side's recorded agreement,
//      so nothing here can move money without one
//      (src/test/edge/refundAgreementGuard.test.ts). The split itself is the ONE
//      settlement path: the refund less the kept card fee
//      (_shared/refundAmount.ts), the Helpr's share after their fee, the
//      settlement claim, the ledger reads and the dispute-keyed Stripe
//      idempotency keys that make it one money move per agreement.
//
// Outcomes vs defects (_shared/cron-result.ts): a split that REFUSES (the
// Helpr has no payout account, a payout hold, a chargeback) has recorded that
// on the dispute itself (execution_status 'failed' + its reason), which
// auto-resolve-disputes reminds admins about after an hour; that is an
// outcome. An unreachable split, a 5xx, a 401/403 or an unreadable answer is
// a defect: work this run meant to do and could not.

const FN = "refund-request-sweep";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Agreements settled per run; each split makes several Stripe calls. */
const SETTLE_LIMIT = 20;

type SweepSummary = { closed?: number; expired?: number; declined?: number; failed?: number; errors?: string[] };
/** `held`: a party is banned, suspended, under a ban review or on a payout hold; the SQL already sent it to an admin. */
type DueRow = { request_id: string; dispute_id: string; job_id: string; held?: boolean };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  const startedAt = Date.now();
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "";
    if (!url || !serviceKey) return cronError(FN, "missing SUPABASE_URL or the service key", corsHeaders);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
      global: { fetch: boundedFetch() },
    });
    const defects = defectTracker();

    // ── 1. Close, expire, and file the declined ────────────────────────────
    const { data: sweepData, error: sweepErr } = await admin.rpc("refund_requests_sweep");
    if (sweepErr) defects.record(`refund_requests_sweep failed: ${sweepErr.message}`);
    const sweep = (sweepData ?? {}) as SweepSummary;
    if ((sweep.failed ?? 0) > 0) {
      defects.record(`refund_requests_sweep: ${sweep.failed} request(s) failed: ${(sweep.errors ?? []).join("; ").slice(0, 400)}`);
    }

    // ── 2. Settle each agreement through the one split path ────────────────
    const { data: dueData, error: dueErr } = await admin.rpc("refund_agreements_due", { p_limit: SETTLE_LIMIT });
    // An unreadable hand-out is a failed run, never "nothing agreed".
    if (dueErr) {
      defects.record(`refund_agreements_due failed: ${dueErr.message}`);
      return cronResult(FN, { ...counts(sweep), agreements_due: null }, defects.defects, corsHeaders);
    }
    const due = (dueData ?? []) as DueRow[];
    let settled = 0;
    let heldForAdmin = 0;
    const refused: Array<{ dispute_id: string; status: number; error: string }> = [];
    for (const row of due) {
      if (!row || typeof row.dispute_id !== "string" || !UUID_RE.test(row.dispute_id)) {
        defects.record(`refund_agreements_due returned a row with no usable dispute id: ${JSON.stringify(row).slice(0, 200)}`);
        continue;
      }
      // A banned, suspended or held party (lead, 2026-10-21): no money moves
      // automatically. The SQL marked the decided dispute for an admin (the
      // admin queue lists it unsettled) and will not hand it out again; this
      // pages ops once, and the split is never asked.
      if (row.held === true) {
        heldForAdmin++;
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "warning",
          title: "Agreed refund held for an admin",
          message:
            `A refund the poster and Helpr agreed on job ${row.job_id} was not settled automatically: one of them is banned, suspended, under a ban review or on a payout hold. ` +
            "No automatic move was attempted. An admin settles it (Retry settlement) or supersedes it from the dispute page once that is resolved; auto-resolve-disputes pages again once the hold lifts.",
          fields: { dispute_id: row.dispute_id, job_id: row.job_id, request_id: row.request_id },
          oncePerDayKey: `refund-agreement-held:${row.dispute_id}`,
        });
        continue;
      }
      // PayPal Plan A, phase 5: a job paid through PayPal settles through paypal-refunds (the
      // split is Stripe code). Fails closed: an unreadable answer is a defect, never a Stripe split.
      const pp = await readPayPalJobPayment(admin, row.job_id);
      if (pp.error) {
        defects.record(`PayPal payment read failed for job ${row.job_id}: ${pp.error}`);
        continue;
      }
      const settler = pp.payment ? "paypal-refunds" : "execute-dispute-split";
      let res: Response;
      try {
        res = await fetchFunction(
          `${url}/functions/v1/${settler}`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(pp.payment ? { action: "settle_refund_agreement", dispute_id: row.dispute_id } : { dispute_id: row.dispute_id }),
          },
          { deadlineAt: invocationDeadline(startedAt) },
        );
      } catch (e) {
        defects.record(`${settler} unreachable for dispute ${row.dispute_id}: ${caughtMessage(e)}`);
        continue;
      }
      let body: { success?: unknown; error?: unknown } | null = null;
      try {
        body = await res.json();
      } catch (e) {
        defects.record(`${settler} answered ${res.status} with no JSON for dispute ${row.dispute_id}: ${caughtMessage(e)}`);
        continue;
      }
      if (res.ok && body?.success === true) {
        settled++;
        continue;
      }
      const error = String(body?.error ?? "").slice(0, 200);
      // 401/403: the door refused the key or found no recorded agreement for an
      // agreement this run was handed: never an outcome. 5xx: the split could
      // not tell or reach Stripe; the next hand-out retries it.
      if (res.status === 401 || res.status === 403 || res.status >= 500) {
        defects.record(`${settler} ${res.status} for dispute ${row.dispute_id}: ${error}`);
        continue;
      }
      refused.push({ dispute_id: row.dispute_id, status: res.status, error });
    }

    return cronResult(FN, { ...counts(sweep), agreements_due: due.length, settled, held_for_admin: heldForAdmin, refused }, defects.defects, corsHeaders);
  } catch (e) {
    return cronError(FN, caughtMessage(e), corsHeaders);
  }
});

function counts(s: SweepSummary) {
  return { closed: s.closed ?? 0, expired: s.expired ?? 0, declined: s.declined ?? 0, failed: s.failed ?? 0 };
}
