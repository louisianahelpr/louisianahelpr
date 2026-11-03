import type Stripe from "https://esm.sh/stripe@18.5.0";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import { JOB_TAX_CALC_KEY, JOB_TAX_CENTS_KEY } from "../../_shared/jobTaxAddress.ts";

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
export async function commitJobSiteTax(args: {
  stripe: Stripe;
  pi: Stripe.PaymentIntent;
  logStep: (step: string, details?: unknown) => void;
  seed?: boolean;
}): Promise<"none" | "already" | "committed" | "failed_paged"> {
  const { stripe, pi, logStep, seed } = args;
  const md = (pi.metadata ?? {}) as Record<string, string>;
  const calc = md[JOB_TAX_CALC_KEY];
  const cents = Number(md[JOB_TAX_CENTS_KEY]);
  if (!md.job_id || typeof calc !== "string" || !calc.startsWith("taxcalc_")) return "none";
  // A $0 figure reports nothing (Stripe Tax has no tax to record).
  if (!Number.isInteger(cents) || cents <= 0) return "none";
  if (md.tax_transaction_id) return "already";
  let txId: string;
  try {
    const tx = await stripe.tax.transactions.createFromCalculation(
      { calculation: calc, reference: pi.id },
      { idempotencyKey: `job-site-tax:${pi.id}` },
    );
    txId = tx.id;
  } catch (e) {
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
  return "committed";
}
