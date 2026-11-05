/**
 * Q1918 + Q2148 (2): what to subtract from Stripe's Tax report.
 *
 * Stripe Tax never lowers the tax it reports on a Checkout `automatic_tax`
 * charge for a LOST dispute or for the uncaptured part of a PARTIAL capture
 * (docs.stripe.com/tax/reports, "Tax calculations recorded in reports", read
 * 2026-11-04), and a Checkout charge has no Tax API transaction to reverse
 * (Stripe TEST probe run 41930346999). Lead 2026-11-04: never change how a
 * card is charged; record the correction in public.sales_tax_adjustments and
 * file from Stripe's report minus these rows (admin_sales_tax_adjustments).
 *
 * Charges taxed at the JOB SITE (automatic_tax off, a taxcalc_ id in the
 * metadata) are Tax API transactions we reverse ourselves (Q1724, Q2716), so
 * they are never written here.
 *
 * Rules (lead 8:25 PM): idempotent on dedupe_ref; a failure to write never
 * blocks or changes the money flow (logged + one ops alert, never thrown).
 * It imports only caughtMessage (the caller hands in its ops-alert poster),
 * so the edge harness runs the REAL module.
 */
import { caughtMessage } from "./caughtMessage.ts";

type Log = (step: string, details?: unknown) => void;
/** The caller's _shared/slack-alerts postSlackOpsAlert, typed structurally. */
export type OpsAlert = (input: {
  kind: "money_at_risk";
  severity: "warning";
  seed?: boolean;
  title: string;
  message: string;
  fields?: Record<string, string>;
}) => Promise<unknown>;

export type TaxAdjustmentFlow = "job" | "gift_card" | "boost" | "bgc" | "pro" | "shop_order" | "other";

/** The one Stripe read this module needs, typed structurally. */
export interface SessionTaxReader {
  checkout: {
    sessions: {
      list(p: { payment_intent: string; limit: number }): Promise<{
        data?: Array<{
          total_details?: { amount_tax?: number | null } | null;
          metadata?: Record<string, string> | null;
          customer_details?: { address?: { state?: string | null; postal_code?: string | null } | null } | null;
        }>;
      } | null | undefined>;
    };
  };
}

export interface CheckoutAutomaticTax {
  taxCents: number;
  stateCode: string | null;
  postalCode: string | null;
  flow: TaxAdjustmentFlow;
}

const isJobSiteTaxed = (md: Record<string, string> | null | undefined) =>
  String(md?.tax_calculation_id ?? "").startsWith("taxcalc_");

/** Which Checkout flow took a charge, from its session / PaymentIntent metadata. */
export function taxAdjustmentFlow(md: Record<string, string> | null | undefined): TaxAdjustmentFlow {
  const kind = md?.kind ?? "";
  if (kind === "shop_order" || md?.shop_order_id) return "shop_order";
  if (kind === "gift_card_purchase") return "gift_card";
  if (kind === "job_boost") return "boost";
  if (kind === "background_check") return "bgc";
  if (md?.tier) return "pro";
  if (md?.job_id) return "job";
  return "other";
}

/**
 * The Stripe Tax figure a Checkout automatic_tax charge carries, or null when
 * there is nothing to correct: no session, a job-site-taxed charge (our own
 * Tax API transaction) or no tax. A failed Stripe read throws (the caller
 * logs it and raises one ops alert).
 */
export async function checkoutAutomaticTax(
  stripe: SessionTaxReader,
  pi: { id: string; metadata?: Record<string, string> | null },
): Promise<CheckoutAutomaticTax | null> {
  if (isJobSiteTaxed(pi.metadata)) return null;
  // A failed read THROWS: the caller alerts, because a correction we could
  // not build leaves Stripe's report over-stated (lead condition 3).
  const session = (await stripe.checkout.sessions.list({ payment_intent: pi.id, limit: 1 }))?.data?.[0];
  if (!session || isJobSiteTaxed(session.metadata)) return null;
  const taxCents = Math.max(0, Math.round(Number(session.total_details?.amount_tax ?? 0)));
  if (!(taxCents > 0)) return null;
  const addr = session.customer_details?.address;
  return {
    taxCents,
    stateCode: addr?.state ?? null,
    postalCode: addr?.postal_code ?? null,
    flow: taxAdjustmentFlow({ ...(pi.metadata ?? {}), ...(session.metadata ?? {}) }),
  };
}

/**
 * The tax inside a partial capture: the capture keeps the non-tax part first
 * (the same rule as void-cancelled-payments' capturedSiteTaxCents, Q2716), so
 * only what reaches past the authorised pre-tax amount is tax.
 */
export function taxInsideCaptureCents(i: { authorisedCents: number; capturedCents: number; taxCents: number }): number {
  const pretax = Math.max(0, i.authorisedCents - i.taxCents);
  return Math.min(i.taxCents, Math.max(0, i.capturedCents - pretax));
}

export interface TaxAdjustmentRow {
  kind: "partial_capture" | "dispute_lost";
  flow: TaxAdjustmentFlow;
  job_id: string | null;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  dedupe_ref: string;
  tax_reported_cents: number;
  tax_collected_cents: number;
  state_code: string | null;
  postal_code: string | null;
  livemode: boolean;
  is_seed: boolean;
  occurred_at: string;
}

/** The tax already subtracted for this PaymentIntent by earlier rows (>= 0), or null on a failed read. */
// deno-lint-ignore no-explicit-any
async function alreadySubtractedCents(supabase: any, piId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("sales_tax_adjustments")
    .select("adjustment_cents")
    .eq("stripe_payment_intent_id", piId);
  if (error) return null;
  return -((data ?? []) as Array<{ adjustment_cents: number }>).reduce((s, r) => s + Number(r.adjustment_cents ?? 0), 0);
}

/** Write one correction. Never throws: a failure is logged and raises one ops alert. */
// deno-lint-ignore no-explicit-any
export async function recordTaxAdjustment(supabase: any, row: TaxAdjustmentRow, logStep: Log, alert: OpsAlert): Promise<"written" | "nothing" | "failed"> {
  if (row.tax_collected_cents >= row.tax_reported_cents) return "nothing";
  try {
    const { error } = await supabase
      .from("sales_tax_adjustments")
      .upsert(row, { onConflict: "dedupe_ref", ignoreDuplicates: true });
    if (error) throw error;
    logStep("Sales-tax adjustment recorded", { ref: row.dedupe_ref, reported: row.tax_reported_cents, collected: row.tax_collected_cents });
    return "written";
  } catch (e) {
    const msg = caughtMessage(e);
    console.error(`[salesTaxAdjustment] could not record ${row.dedupe_ref}: ${msg}`);
    try {
      await alert({
        kind: "money_at_risk",
        severity: "warning",
        seed: row.is_seed || !row.livemode,
        title: "Sales-tax correction NOT recorded",
        message: `Stripe's Tax report will over-state the tax on ${row.stripe_payment_intent_id} by ${((row.tax_reported_cents - row.tax_collected_cents) / 100).toFixed(2)} (${row.kind}) until this row is written. The money itself is unaffected.`,
        fields: { "Dedupe ref": row.dedupe_ref, "Error": msg.slice(0, 200) },
      });
    } catch (alertErr) {
      console.error(`[salesTaxAdjustment] ops alert failed too: ${caughtMessage(alertErr)}`);
    }
    return "failed";
  }
}

/**
 * payment_intent.succeeded on a manual-capture Checkout charge that captured
 * less than it authorised: Stripe still reports the whole authorisation's tax.
 */
export async function recordPartialCaptureTax(args: {
  stripe: SessionTaxReader;
  // deno-lint-ignore no-explicit-any
  supabase: any;
  pi: { id: string; amount: number; amount_received?: number | null; livemode: boolean; metadata?: Record<string, string> | null; latest_charge?: unknown };
  jobId: string | null;
  isSeed: boolean;
  logStep: Log;
  alert: OpsAlert;
}): Promise<void> {
  const { pi } = args;
  const captured = Number(pi.amount_received ?? 0);
  if (!(captured > 0) || !(captured < Number(pi.amount))) return;
  let tax: CheckoutAutomaticTax | null;
  try {
    tax = await checkoutAutomaticTax(args.stripe, pi);
  } catch (e) {
    // The capture itself already happened; only the correction is missing.
    await alertNotBuilt(args.alert, `capture:${pi.id}`, pi.id, args.isSeed || !pi.livemode, caughtMessage(e));
    return;
  }
  if (!tax) return;
  const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : ((pi.latest_charge as { id?: string } | null)?.id ?? null);
  await recordTaxAdjustment(args.supabase, {
    kind: "partial_capture",
    flow: args.jobId ? "job" : tax.flow,
    job_id: args.jobId,
    stripe_payment_intent_id: pi.id,
    stripe_charge_id: chargeId,
    dedupe_ref: `capture:${pi.id}`,
    tax_reported_cents: tax.taxCents,
    tax_collected_cents: taxInsideCaptureCents({ authorisedCents: Number(pi.amount), capturedCents: captured, taxCents: tax.taxCents }),
    state_code: tax.stateCode,
    postal_code: tax.postalCode,
    livemode: pi.livemode,
    is_seed: args.isSeed,
    occurred_at: new Date().toISOString(),
  }, args.logStep, args.alert);
}

/**
 * charge.dispute.closed, lost: the cardholder's bank took the money back, so
 * the disputed share of the tax our ledger still counts was never collected.
 * What our ledger still counts = Stripe's tax, less what Stripe's own refund
 * reversals took off (prorated by the refunded share, as Stripe does: Q1998
 * run 41951666207), less what earlier rows here already subtracted.
 */
export async function recordLostDisputeTax(args: {
  stripe: SessionTaxReader & { charges: { retrieve(id: string): Promise<{ id: string; amount_captured?: number | null; amount_refunded?: number | null; livemode?: boolean; metadata?: Record<string, string> | null }> } };
  // deno-lint-ignore no-explicit-any
  supabase: any;
  piId: string | null;
  dispute: { id: string; amount: number; charge: unknown; livemode: boolean; created?: number };
  logStep: Log;
  alert: OpsAlert;
}): Promise<void> {
  const { piId, dispute, logStep } = args;
  if (!piId) return;
  try {
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : ((dispute.charge as { id?: string } | null)?.id ?? null);
    if (!chargeId) return;
    const charge = await args.stripe.charges.retrieve(chargeId);
    const tax = await checkoutAutomaticTax(args.stripe, { id: piId, metadata: charge.metadata ?? null });
    if (!tax) return;
    const captured = Math.max(0, Number(charge.amount_captured ?? 0));
    const refunded = Math.max(0, Number(charge.amount_refunded ?? 0));
    if (!(captured > 0)) return;
    const before = await alreadySubtractedCents(args.supabase, piId);
    if (before === null) throw new Error("could not read the earlier corrections for this charge");
    const afterRefunds = tax.taxCents - Math.round(tax.taxCents * Math.min(1, refunded / captured));
    const stillCounted = Math.max(0, afterRefunds - before);
    const standing = Math.max(1, captured - refunded);
    const lost = Math.min(stillCounted, Math.round(stillCounted * Math.min(1, Number(dispute.amount) / standing)));
    const { data: job } = await args.supabase.from("jobs").select("id, is_seed").eq("stripe_payment_intent_id", piId).maybeSingle();
    await recordTaxAdjustment(args.supabase, {
      kind: "dispute_lost",
      flow: job?.id ? "job" : tax.flow,
      job_id: job?.id ?? null,
      stripe_payment_intent_id: piId,
      stripe_charge_id: chargeId,
      dedupe_ref: `dispute:${dispute.id}`,
      tax_reported_cents: stillCounted,
      tax_collected_cents: stillCounted - lost,
      state_code: tax.stateCode,
      postal_code: tax.postalCode,
      livemode: dispute.livemode,
      is_seed: job?.is_seed === true,
      occurred_at: new Date().toISOString(),
    }, logStep, args.alert);
  } catch (e) {
    // Reading Stripe or our earlier rows failed before a row could be built.
    // The dispute's own handling goes on; the alert names what to correct.
    await alertNotBuilt(args.alert, `dispute:${dispute.id}`, piId, !dispute.livemode, caughtMessage(e));
  }
}

/** A correction whose inputs could not be read: logged, and one ops alert. Never throws. */
async function alertNotBuilt(alert: OpsAlert, ref: string, piId: string, seed: boolean, msg: string): Promise<void> {
  console.error(`[salesTaxAdjustment] could not build ${ref}: ${msg}`);
  try {
    await alert({
      kind: "money_at_risk",
      severity: "warning",
      seed,
      title: "Sales-tax correction NOT recorded",
      message: `${ref} (${piId}): Stripe's Tax report may over-state this charge's tax, and our correction row could not be built. The money itself is unaffected.`,
      fields: { "Dedupe ref": ref, "Error": msg.slice(0, 200) },
    });
  } catch (alertErr) {
    console.error(`[salesTaxAdjustment] ops alert failed too: ${caughtMessage(alertErr)}`);
  }
}
