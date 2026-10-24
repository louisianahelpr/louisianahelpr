/**
 * What happens after a PayPal job payment is settled (PayPal Plan A, phase 3),
 * shared by the return page (create-payment `paypal_capture`) and paypal-webhook.
 *
 * - A FRESHLY funded job is pushed to nearby Helprs (instant-job-match), as the
 *   Stripe checkout webhook does once money is captured. Best effort: a failed
 *   fan-out costs reach, never correctness (the job is funded and browsable).
 * - Every outcome where PayPal holds money the job does not (money_at_risk), and
 *   a one-time setup fee collected twice, pages ops. Never silent: these are a
 *   refund someone has to make (phase 5 builds the refund path).
 */
import type { SettleOutcome } from "./paypalJobCheckout.ts";

/** postSlackOpsAlert, passed in by the edge function (so this module stays free of its I/O). */
// deno-lint-ignore no-explicit-any
export type OpsAlert = (input: any) => Promise<unknown>;

// deno-lint-ignore no-explicit-any
type Supabase = any;

export async function followUpJobSettle(
  supabase: Supabase,
  jobId: string,
  outcome: SettleOutcome,
  source: "return_page" | "webhook" | "checkout",
  postSlackOpsAlert: OpsAlert,
): Promise<void> {
  if (outcome.kind === "money_at_risk") {
    console.error(`[paypal-job] money at risk on job ${jobId} (${source}): ${outcome.reason}; capture ${outcome.captureId ?? "none"}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "PayPal and the app disagree about a job's money",
      message: `Job ${jobId}: PayPal capture ${outcome.captureId ?? "(none)"} does not fund the job (${outcome.reason}). Check the order in PayPal: refund the payer, or settle the job by hand.`,
      fields: { job_id: jobId, capture_id: outcome.captureId ?? "(none)", reason: outcome.reason, source },
      oncePerDayKey: `paypal-job-money-at-risk:${jobId}`,
    });
    return;
  }
  if (outcome.kind === "refused" && outcome.reason !== "feature_disabled" && !outcome.reason.startsWith("row_moved")) {
    // An order PayPal would let us capture that the app refused (its total is not the row's): an anomaly.
    console.error(`[paypal-job] job ${jobId} (${source}): capture refused: ${outcome.reason}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "PayPal order refused for capture",
      message: `Job ${jobId}: an approved PayPal order was not captured (${outcome.reason}). Nothing was taken; check the order in PayPal.`,
      fields: { job_id: jobId, reason: outcome.reason, source },
      oncePerDayKey: `paypal-job-refused:${jobId}`,
    });
    return;
  }
  if (outcome.kind !== "funded" || !outcome.fresh) return;
  if (outcome.onboardingFeeDuplicate) {
    console.error(`[paypal-job] job ${jobId}: the one-time setup fee was already paid; this order collected it again`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "PayPal order collected the setup fee twice",
      message: `Job ${jobId}'s PayPal order carried the one-time setup fee, but the poster had already paid it. Refund the setup fee to the poster in PayPal.`,
      fields: { job_id: jobId, source },
      oncePerDayKey: `paypal-job-onboarding-dup:${jobId}`,
    });
  }
  try {
    // Same call shape as stripe-webhook's post-funding fan-out: the secret as a Bearer, because
    // instant-job-match only trusts `Authorization: Bearer <secret>`.
    const secret = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const { error } = await supabase.functions.invoke("instant-job-match", {
      body: { jobId },
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (error) console.warn(`[paypal-job] instant-job-match failed after funding job ${jobId}: ${error.message}`);
  } catch (e) {
    console.warn(`[paypal-job] instant-job-match threw after funding job ${jobId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
