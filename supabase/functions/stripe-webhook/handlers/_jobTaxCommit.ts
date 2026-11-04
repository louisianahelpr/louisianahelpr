import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import { JOB_TAX_CALC_KEY, JOB_TAX_CENTS_KEY } from "../../_shared/jobTaxAddress.ts";
import { reverseVisitTaxForRefund } from "./_visitTaxReversal.ts";

/**
 * Q2083 (b) / Q1727 (a): commit a job's job-site sales tax to Stripe Tax once
 * the money is CAPTURED.
 *
 * A taxed job's Checkout prices its tax with tax.calculations at the job ZIP
 * and charges it as its own line with automatic_tax off (create-payment), so
 * Stripe Tax records nothing on its own. This runs on payment_intent.succeeded:
 * a card charged at once, a bank payment once it settles, a card HOLD once it
 * is captured at the hire (a hold that is cancelled never succeeds, so its tax
 * is never reported). It commits the calculation named on the PaymentIntent
 * (createFromCalculation, reference = the PaymentIntent, idempotent on it) and
 * stamps the transaction id on the PaymentIntent as metadata.tax_transaction_id:
 * the refund and lost-dispute handlers (_visitTaxReversal.ts) reverse any
 * transaction stamped there, so a refunded job's tax comes off the filing
 * reports exactly as a recurring visit's does.
 *
 * Never throws: the payment already stands. A failure pages ops with the exact
 * hand step (Stripe calculations expire, so it is a defect to fix, not retry).
 */
/** The one-time setup fee a hire may leave out of a hold's capture (onboarding_fee_cents NOT NULL DEFAULT 200). */
export const PARTIAL_CAPTURE_SETUP_FEE_CENTS = 200;

export async function commitJobSiteTax(args: {
  stripe: Stripe;
  pi: Stripe.PaymentIntent;
  logStep: (step: string, details?: unknown) => void;
  seed?: boolean;
  /** Service-role client; read only to mark a test job's reversal alert as seed. */
  // deno-lint-ignore no-explicit-any
  supabase?: any;
}): Promise<"none" | "already" | "committed" | "failed_paged"> {
  const { stripe, pi, logStep, seed, supabase } = args;
  const md = (pi.metadata ?? {}) as Record<string, string>;
  const calc = md[JOB_TAX_CALC_KEY];
  const cents = Number(md[JOB_TAX_CENTS_KEY]);
  if (!md.job_id || typeof calc !== "string" || !calc.startsWith("taxcalc_")) return "none";
  // A $0 figure reports nothing (Stripe Tax has no tax to record).
  if (!Number.isInteger(cents) || cents <= 0) return "none";
  if (md.tax_transaction_id) return "already";
  // Re-review of 49a8653d81 (C, HIGH): a card HOLD captured for less than it held (a late cancel that captures
  // only the fee) would commit the FULL calculation's tax, and the uncaptured rest is released, never refunded,
  // so no refund event ever reverses it: tax reported on money never collected. Not committed; a person records
  // the tax on what was captured.
  // Lead re-review (b): a hire captures the hold less the one-time setup fee when that fee was already claimed
  // elsewhere (cardHold.ts partial capture), a normal taxed hire; that shortfall is no part of the taxed price,
  // so it still commits. Only a shortfall larger than the omitted setup fee (default $2, the schema default of
  // onboarding_fee_cents) is a fee-only capture.
  const received = pi.amount_received;
  const setupFeeAllowanceCents = md.onboarding_fee_charged === "true" ? PARTIAL_CAPTURE_SETUP_FEE_CENTS : 0;
  if (typeof received === "number" && typeof pi.amount === "number" && pi.amount - received > setupFeeAllowanceCents) {
    console.error(`[stripe-webhook] job-site tax NOT committed for ${pi.id}: captured ${received} of ${pi.amount}`);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Job sales tax not recorded: the hold was captured only in part",
      message: `Job ${md.job_id}'s card hold (PaymentIntent ${pi.id}) was captured for $${(received / 100).toFixed(2)} of $${(pi.amount / 100).toFixed(2)}. Its Stripe Tax calculation ${calc} prices the whole $${(cents / 100).toFixed(2)} tax, so it was NOT committed (the uncaptured part is released, and no refund would ever reverse its tax). Record by hand only the tax inside what was captured, and set metadata.tax_transaction_id on the PaymentIntent.`,
      fields: { job_id: md.job_id, payment_intent: pi.id, calculation: calc, tax_cents: String(cents), captured_cents: String(received), held_cents: String(pi.amount) },
      oncePerDayKey: `job-site-tax-partial:${pi.id}`,
      seed: seed === true,
    });
    return "failed_paged";
  }
  let txId: string;
  try {
    const tx = await stripe.tax.transactions.createFromCalculation(
      { calculation: calc, reference: pi.id },
      { idempotencyKey: `job-site-tax:${pi.id}` },
    );
    txId = tx.id;
  } catch (e) {
    // Not rethrown: the payment stands and a webhook retry cannot revive an
    // expired calculation. Logged and paged with the exact hand step.
    console.error(`[stripe-webhook] job-site tax commit failed for ${pi.id} (calculation ${calc}):`, caughtMessage(e));
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Job sales tax collected but NOT recorded in Stripe Tax",
      message: `Job ${md.job_id} paid $${(cents / 100).toFixed(2)} sales tax at the job address (PaymentIntent ${pi.id}), but committing Stripe Tax calculation ${calc} failed (${caughtMessage(e)}). Record it by hand (Stripe Tax > Transactions, or tax.transactions.createFromCalculation with reference ${pi.id}) and set metadata.tax_transaction_id on the PaymentIntent, or the tax is not on the filing reports and a refund will not reverse it.`,
      fields: { job_id: md.job_id, payment_intent: pi.id, calculation: calc, tax_cents: String(cents) },
      oncePerDayKey: `job-site-tax-commit:${pi.id}`,
      seed: seed === true,
    });
    return "failed_paged";
  }
  try {
    await stripe.paymentIntents.update(pi.id, { metadata: { tax_transaction_id: txId } });
  } catch (e) {
    // Not rethrown: the transaction is recorded; only the stamp is missing,
    // which a person sets by hand from this page.
    console.error(`[stripe-webhook] tax transaction ${txId} not stamped on ${pi.id}:`, caughtMessage(e));
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Job sales tax recorded, but a refund will not reverse it",
      message: `Stripe Tax transaction ${txId} records job ${md.job_id}'s sales tax (PaymentIntent ${pi.id}), but stamping it on the PaymentIntent failed (${caughtMessage(e)}). Set metadata.tax_transaction_id=${txId} on ${pi.id} by hand.`,
      fields: { job_id: md.job_id, payment_intent: pi.id, tax_transaction: txId },
      oncePerDayKey: `job-site-tax-stamp:${pi.id}`,
      seed: seed === true,
    });
    return "failed_paged";
  }
  logStep("Job-site sales tax committed to Stripe Tax", { jobId: md.job_id, piId: pi.id, txId, cents });
  // Review fix (lh-money-escrow on 378f7b321 #1): a refund made BEFORE the
  // stamp above (a duplicate checkout refunded at once, a refund racing this
  // event) found no tax_transaction_id on charge.refunded and reversed
  // nothing, so its tax would stay reported as collected. Now that the stamp
  // is on, the PaymentIntent's refunds are re-read and each live one is
  // reversed by the same per-refund path (keyed on the refund id, so one the
  // refund event also reaches is never reversed twice). A refund made after
  // this read sees the stamp on its own charge.refunded event.
  if (await reverseRefundsMadeBeforeTheStamp({ stripe, pi, txId, logStep, seed, supabase, jobId: md.job_id }) === "failed_paged") {
    return "failed_paged";
  }
  return "committed";
}

async function reverseRefundsMadeBeforeTheStamp(args: {
  stripe: Stripe;
  pi: Stripe.PaymentIntent;
  txId: string;
  jobId: string;
  logStep: (step: string, details?: unknown) => void;
  seed?: boolean;
  // deno-lint-ignore no-explicit-any
  supabase?: any;
}): Promise<"none" | "reversed" | "failed_paged"> {
  const { stripe, pi, txId, jobId, logStep, seed, supabase } = args;
  let all: Stripe.Refund[];
  try {
    const listed = await stripe.refunds.list({ payment_intent: pi.id, limit: 100 });
    if (listed?.has_more) throw new Error("more than 100 refunds listed; refusing to read a partial list");
    all = (listed?.data ?? []) as Stripe.Refund[];
  } catch (e) {
    console.error(`[stripe-webhook] refunds of ${pi.id} not read after its tax commit:`, caughtMessage(e));
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "warning",
      title: "Job sales tax recorded, but its earlier refunds were not checked",
      message: `Stripe Tax transaction ${txId} records job ${jobId}'s sales tax (PaymentIntent ${pi.id}), but the PaymentIntent's refunds could not be read (${caughtMessage(e)}). If any refund was made on it, reverse that refund's share of ${txId} in Stripe Tax with reference refund:<refund id>, then set metadata.tax_rev_<refund id>=<that reversal's id> on ${pi.id}, or the refunded tax stays reported as collected.`,
      fields: { job_id: jobId, payment_intent: pi.id, tax_transaction: txId },
      oncePerDayKey: `job-site-tax-refunds:${pi.id}`,
      seed: seed === true,
    });
    return "failed_paged";
  }
  // The same filter as charge.refunded: failed and canceled refunds moved no
  // money; an onboarding-fee correction is not a refund of the job.
  const ordinary = all.filter((r) =>
    !!r?.id && r.status !== "failed" && r.status !== "canceled"
    && (r?.metadata as Record<string, string> | null)?.reason !== "duplicate_onboarding_fee"
  );
  if (ordinary.length === 0) return "none";
  const chargeId = String(ordinary.find((r) => typeof r.charge === "string")?.charge ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id) ?? pi.id);
  const amountRefunded = ordinary.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  logStep("Job-site tax: reversing refunds made before the commit was stamped", { piId: pi.id, txId, refunds: ordinary.map((r) => r.id) });
  return await reverseVisitTaxForRefund({
    stripe,
    piId: pi.id,
    charge: { id: chargeId, amount: pi.amount_received || pi.amount, amount_refunded: amountRefunded } as Stripe.Charge,
    refunds: ordinary,
    listedAnyRefund: all.length > 0,
    supabase,
    logStep,
  });
}
