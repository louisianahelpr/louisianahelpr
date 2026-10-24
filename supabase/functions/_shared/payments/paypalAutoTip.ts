/**
 * An automatic tip on a job paid through PayPal (PayPal Plan A, phase 6), on the tips lane's ONE
 * tip shape (wip/pp-tips: paypal_open_tip, settlePayPalTip, paypalTipChargeBreakdown), so manual
 * and automatic PayPal tips are recorded, paid out and reconciled the same way.
 *
 * TODAY'S RULES, UNCHANGED (auto-tip-charge, measured 2026-10-23): the same candidates
 * (auto_tip_candidates), the same claim row written BEFORE the charge (tips, source 'auto', one
 * per job+Helpr by the UNIQUE index tips_one_auto_per_job_member), the same $3 minimum, the same
 * re-read of the job's state (auto_tip_job_state) right before the charge, the same money shape
 * (the poster pays the tip plus the processing cost, the Helpr receives 100% of the tip), the same
 * "never silent" outcomes.
 *
 * ORDER (lead 2026-10-23, the tips lane's round-3 contract):
 *   1. the caller has CLAIMED the job with the pending auto tips row (tipId);
 *   2. the switch is asked for the POSTER right before the charge (phase 1's trigger refuses the
 *      payment row when it is off, and money taken between charge and write would be unrecorded);
 *   3. chargeSaved with a key derived from the claim row, `lh:autotip:<tipId>:charge:amt<c>:a1`,
 *      reused on every retry, and invoice_id = the claim row id (PayPal refuses a second order for
 *      it even past request-id memory);
 *   4. paypal_open_tip(..., p_source 'auto', p_tip_id = the claim row) takes the claimed row over
 *      and writes its provider_payments row;
 *   5. settlePayPalTip records the capture and queues ONE payout named by tip_id.
 * The fee is paypalTipChargeBreakdown at the saved method's own rate: a card token at
 * card_standard (2.99% + 49c), a PayPal-wallet token at paypal_checkout (3.49% + 49c).
 */
import { paypalTipChargeBreakdown, type TipChargeBreakdown } from "../tipFees.ts";
import type { PayPalMethod } from "./providerFees.ts";
import { ProviderApiError, type PaymentProvider, type ProviderEnv, type VaultSource } from "./types.ts";

export interface AutoTipMethod {
  vaultId: string;
  source: VaultSource;
}

/** What settlePayPalTip answered, reduced to what this path needs. */
export type AutoTipSettle =
  | { state: "recorded"; payoutId: string | null; payoutReason: string; paymentStatus: string }
  | { state: "declined"; issue: string | null }
  | { state: "not_approved"; orderStatus: string };

export interface PayPalAutoTipDeps {
  provider: Pick<PaymentProvider, "chargeSaved">;
  env: ProviderEnv;
  /** auto_tip_job_state(job): 'chargeable' | 'held' | 'closed', or an Error when unreadable. */
  jobStateNow(jobId: string): Promise<string | Error>;
  /** paypal_payments for the poster, or an Error when it could not be read. */
  switchOnFor(userId: string): Promise<boolean | Error>;
  activeMethod(userId: string, env: ProviderEnv): Promise<AutoTipMethod | null>;
  /** public.paypal_open_tip(..., p_source 'auto', p_tip_id): the tip's provider_payments id. Throws on refusal. */
  openTip(a: {
    jobId: string; tipperId: string; helperId: string; tipCents: number; chargeCents: number;
    env: ProviderEnv; idempotencyKey: string; orderId: string; tipId: string;
  }): Promise<{ providerPaymentId: string }>;
  /** settlePayPalTip(db, provider, client, providerPaymentId). Throws when it cannot finish. */
  settle(providerPaymentId: string): Promise<AutoTipSettle>;
}

export interface PayPalAutoTipInput {
  /** The claim row this run just wrote (tips.id, source 'auto', pending). */
  tipId: string;
  jobId: string;
  posterId: string;
  helperId: string;
  tipCents: number;
}

export type PayPalAutoTipOutcome =
  /** Charged and recorded; the Helpr's tip is on the pay queue, or owed (payoutId null) and alerted. */
  | { outcome: "charged"; paymentId: string; quote: TipChargeBreakdown; payoutId: string | null; payoutReason: string }
  /** The job changed since the candidate list: release the claim (closed: record it unsent). */
  | { outcome: "state_changed"; state: string }
  /** A read failed BEFORE any charge: release the claim, a defect. Nothing was charged. */
  | { outcome: "unreadable"; message: string }
  /** Mark the claim failed with this reason and tell the poster. Nothing was charged. */
  | { outcome: "give_up"; reason: string; posterMessage: string }
  /** Charged but not settled (PENDING): recorded; the tips lane's webhook finishes it. */
  | { outcome: "capture_pending"; paymentId: string; quote: TipChargeBreakdown }
  /** Outcome unknown or money not recorded: the claim stays 'pending' with this reason; a defect pages. */
  | { outcome: "ambiguous"; reason: string };

/** The fee rate for a saved token: what PayPal bills that source. */
export function autoTipMethod(source: VaultSource): PayPalMethod {
  return source === "card" ? "card_standard" : "paypal_checkout";
}

export function autoTipChargeKey(tipId: string, chargeCents: number): string {
  if (!/^[0-9a-f-]{36}$/i.test(tipId)) throw new Error(`not a tips row id: ${tipId}`);
  return `lh:autotip:${tipId}:charge:amt${chargeCents}:a1`;
}

const NO_METHOD_MESSAGE =
  "We couldn't charge your automatic tip because there's no saved PayPal payment method on file. You can send it in a tap.";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function chargePayPalAutoTip(deps: PayPalAutoTipDeps, i: PayPalAutoTipInput): Promise<PayPalAutoTipOutcome> {
  // ── Before the charge: reads only; a failure here charged nothing. ──
  let method: AutoTipMethod | null;
  try {
    const state = await deps.jobStateNow(i.jobId);
    if (state instanceof Error) return { outcome: "unreadable", message: `job state: ${state.message}` };
    if (state !== "chargeable") return { outcome: "state_changed", state };
    method = await deps.activeMethod(i.posterId, deps.env);
    // The switch, for the POSTER, right before the charge (lead 2026-10-23).
    const sw = await deps.switchOnFor(i.posterId);
    if (sw instanceof Error) return { outcome: "unreadable", message: `switch: ${sw.message}` };
    if (!sw) return { outcome: "give_up", reason: "paypal_switch_off", posterMessage: "We couldn't charge your automatic tip. You can send your Helpr a tip in a tap." };
  } catch (e) {
    return { outcome: "unreadable", message: msg(e) };
  }
  if (!method) return { outcome: "give_up", reason: "no_saved_paypal_method", posterMessage: NO_METHOD_MESSAGE };

  const quote = paypalTipChargeBreakdown(i.tipCents, autoTipMethod(method.source));
  if (quote.helperCents !== quote.tipCents || quote.tipCents !== i.tipCents) throw new Error("a tip pays the Helpr 100% of the tip");
  const key = autoTipChargeKey(i.tipId, quote.chargeCents);

  // ── The charge ──
  let orderId: string;
  try {
    const cap = await deps.provider.chargeSaved({
      idempotencyKey: key,
      referenceId: i.tipId,
      vaultId: method.vaultId,
      amountCents: quote.chargeCents,
      vaultSource: method.source,
    });
    if (cap.amountCents !== quote.chargeCents) {
      return { outcome: "ambiguous", reason: `captured_amount_mismatch: asked ${quote.chargeCents}, PayPal captured ${cap.amountCents} (order ${cap.providerOrderId}, key ${key})` };
    }
    orderId = cap.providerOrderId;
  } catch (e) {
    if (e instanceof ProviderApiError && e.issue === "DUPLICATE_INVOICE_ID") {
      return { outcome: "ambiguous", reason: `duplicate_invoice: PayPal already has an order for tip ${i.tipId}; find it by invoice id` };
    }
    if (e instanceof ProviderApiError && !e.retryable) {
      return { outcome: "give_up", reason: `paypal_declined: ${e.issue ?? e.errorName ?? e.httpStatus}`.slice(0, 200), posterMessage: "Your automatic tip didn't go through. You can send it in a tap." };
    }
    return { outcome: "ambiguous", reason: `paypal charge outcome unknown (key ${key}): ${msg(e)}` };
  }

  // ── The record: the tips lane takes the claimed row over, then records the capture ──
  let paymentId: string;
  try {
    ({ providerPaymentId: paymentId } = await deps.openTip({
      jobId: i.jobId, tipperId: i.posterId, helperId: i.helperId, tipCents: quote.tipCents, chargeCents: quote.chargeCents,
      env: deps.env, idempotencyKey: key, orderId, tipId: i.tipId,
    }));
  } catch (e) {
    return { outcome: "ambiguous", reason: `CHARGED but not recorded: order ${orderId}, key ${key}: ${msg(e)}` };
  }
  let settled: AutoTipSettle;
  try {
    settled = await deps.settle(paymentId);
  } catch (e) {
    return { outcome: "ambiguous", reason: `charged and recorded (provider_payments ${paymentId}) but the capture record failed: ${msg(e)}` };
  }
  if (settled.state !== "recorded") {
    return { outcome: "ambiguous", reason: `charged order ${orderId} but PayPal reads it ${settled.state === "declined" ? `declined (${settled.issue})` : settled.orderStatus}` };
  }
  if (settled.paymentStatus === "capture_pending") return { outcome: "capture_pending", paymentId, quote };
  return { outcome: "charged", paymentId, quote, payoutId: settled.payoutId, payoutReason: settled.payoutReason };
}
