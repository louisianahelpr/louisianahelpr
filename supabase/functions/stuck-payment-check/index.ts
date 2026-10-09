// seed-policy: raises no alert of its own. It records Stripe's answer for seed
// and real jobs alike; detect_stuck_payments decides the channel (seed -> the
// '-seed' digest source) from the job's is_seed.
//
// stuck-payment-check: asks STRIPE whether each unpaid job's checkout took
// the money, so "Stuck payment — webhook may be failing" pages only when it
// did (owner report, 2026-10-09).
//
// detect_stuck_payments (pg_cron, SQL) used to page for every real job with a
// Checkout Session still 'unpaid' 10 minutes after posting. SQL cannot ask
// Stripe, so a poster who opened checkout and walked away looked identical to
// a payment our webhook dropped: Ben's "Grass cutting" job paged the owner at
// 12:15Z on 2026-10-09 while its session was open/unpaid with no
// PaymentIntent (measured read-only in live Stripe). This function runs 3
// minutes before each detector run (cron job stuck-payment-check,
// 12-59/15), reads each candidate's session, and records the answer in
// stuck_payment_stripe_checks. The detector alerts only on money_moved.
//
// READ-ONLY toward Stripe: checkout.sessions.retrieve, nothing else. It never
// settles, refunds or expires anything; settling a paid-but-unsettled job is
// a person's call after the page.
//
// Migration: 20261009223355_stuck_payment_needs_stripe_proof.sql.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";

const FN = "stuck-payment-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * The whole definition of a stuck payment, on Stripe's side: the checkout is
 * COMPLETE and Stripe collected what it was owed. 'open' is a person still on
 * (or gone from) the checkout page; 'expired' can never be paid; 'complete' +
 * 'unpaid' is an async method (bank debit / bank transfer) still settling,
 * which checkout.session.async_payment_succeeded settles later.
 */
function checkoutTookMoney(session: { status?: string | null; payment_status?: string | null }): boolean {
  return session.status === "complete"
    && (session.payment_status === "paid" || session.payment_status === "no_payment_required");
}

/**
 * Wider than the detector's window on purpose (5 minutes, not 10; no
 * cancelled-job grace): every job the detector will read 3 minutes later must
 * already have an answer. Checking a few extra sessions costs only reads.
 */
const MIN_AGE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 200;
const CONCURRENCY = 5;

type Candidate = { id: string; stripe_session_id: string };
type Check = {
  job_id: string;
  stripe_session_id: string;
  session_status: string;
  payment_status: string;
  money_moved: boolean;
  payment_intent_id: string | null;
  checked_at: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = verifyCronSecret(req);
  if (denied) return denied;
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { global: { fetch: boundedFetch() } },
    );
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", { apiVersion: "2025-08-27.basil" });
    const defects = defectTracker();

    const now = Date.now();
    const { data, error } = await supabase
      .from("jobs")
      .select("id, stripe_session_id")
      .not("stripe_session_id", "is", null)
      .eq("payment_status", "unpaid")
      .lt("created_at", new Date(now - MIN_AGE_MS).toISOString())
      .gt("created_at", new Date(now - MAX_AGE_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(MAX_JOBS);
    // An unreadable candidate list is a failed run, never "nothing to check".
    if (error) return cronError(FN, `candidate read failed: ${error.message}`, corsHeaders);
    const candidates = ((data ?? []) as Candidate[]).filter((j) => !!j.stripe_session_id);

    // An answer that can never change for the SAME session is not re-read:
    // 'expired' and 'missing' can never take money, and money that moved
    // stays moved. A failed read of the old answers only costs extra Stripe
    // reads, so it is logged, not a defect.
    const terminal = new Set<string>();
    if (candidates.length > 0) {
      const { data: prior, error: priorErr } = await supabase
        .from("stuck_payment_stripe_checks")
        .select("job_id, stripe_session_id, session_status, money_moved")
        .in("job_id", candidates.map((j) => j.id));
      if (priorErr) {
        console.warn(`[${FN}] earlier answers unreadable, re-reading every session: ${priorErr.message}`);
      } else {
        for (const r of (prior ?? []) as Array<{ job_id: string; stripe_session_id: string; session_status: string; money_moved: boolean }>) {
          if (r.money_moved === true || r.session_status === "expired" || r.session_status === "missing") {
            terminal.add(`${r.job_id}|${r.stripe_session_id}`);
          }
        }
      }
    }
    const toCheck = candidates.filter((j) => !terminal.has(`${j.id}|${j.stripe_session_id}`));

    let checked = 0;
    let paid = 0;
    /** One job: read Stripe, record its answer on its own row. */
    const checkOne = async (job: Candidate): Promise<void> => {
      let row: Check;
      try {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
        const moved = checkoutTookMoney(session);
        const pi = session.payment_intent;
        row = {
          job_id: job.id,
          stripe_session_id: job.stripe_session_id,
          session_status: String(session.status ?? "unknown"),
          payment_status: String(session.payment_status ?? "unknown"),
          money_moved: moved,
          payment_intent_id: typeof pi === "string" ? pi : (pi && typeof pi === "object" && "id" in pi ? String(pi.id) : null),
          checked_at: new Date().toISOString(),
        };
      } catch (e) {
        if (!isTestObjectUnderLiveKey(e)) {
          // Anything else, a 404 included, is NOT proof the checkout took no
          // money: a wrong or rotated key answers 404 for every live session.
          // No answer is recorded, so the detector counts this job as
          // awaiting_stripe and files it, and this run answers 500.
          defects.record(`session ${job.stripe_session_id} (job ${job.id}) could not be read: ${caughtMessage(e)}`);
          return;
        }
        // A test-mode session under the live key can never take live money.
        logTestObjectUnderLiveKey(FN, { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });
        row = {
          job_id: job.id,
          stripe_session_id: job.stripe_session_id,
          session_status: "missing",
          payment_status: "missing",
          money_moved: false,
          payment_intent_id: null,
          checked_at: new Date().toISOString(),
        };
      }
      // One row per write: a job deleted mid-run (FK) loses only its own answer.
      const { error: writeErr } = await supabase
        .from("stuck_payment_stripe_checks")
        .upsert(row, { onConflict: "job_id" });
      if (writeErr) {
        defects.record(`answer for job ${job.id} not saved: ${writeErr.message}`);
        return;
      }
      checked++;
      if (row.money_moved) paid++;
    };
    // Bounded concurrency: a long list must finish well inside pg_net's 90 s.
    for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
      await Promise.all(toCheck.slice(i, i + CONCURRENCY).map(checkOne));
    }

    return cronResult(FN, { candidates: candidates.length, skipped_final: candidates.length - toCheck.length, checked, paid }, defects.defects, corsHeaders);
  } catch (e) {
    return cronError(FN, caughtMessage(e), corsHeaders);
  }
});
