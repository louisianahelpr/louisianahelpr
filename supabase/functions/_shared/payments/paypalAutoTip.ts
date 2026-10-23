/**
 * An automatic tip on a job paid through PayPal (PayPal Plan A, phase 6).
 *
 * TODAY'S RULES, UNCHANGED (auto-tip-charge, measured 2026-10-23): the same candidates
 * (auto_tip_candidates), the same claim row written BEFORE the charge (tips, source 'auto', one
 * per job+Helpr by a UNIQUE index), the same $3 minimum, the same re-read of the job's state
 * (auto_tip_job_state) right before the charge, the same money shape (tipChargeBreakdown: the
 * poster pays the tip plus the card fee, the Helpr receives 100% of the tip), the same "never
 * silent" outcomes (a failed row and a word to the poster; an unknown outcome stays 'pending'
 * with its reason and pages).
 *
 * WHAT CHANGES: the card is the poster's SAVED PayPal method (chargeSavedPayment), and the
 * Helpr's tip is not a Stripe destination charge: it is queued for the owner to pay by hand
 * (ManualPayoutQueue, source 'auto_tip'). A tip charged but not yet queued is retried every run
 * by retryOwedTipPayouts until it is, so the Helpr's money is never only in our account.
 *
 * The caller (auto-tip-charge) owns the claim row and its writes (settleTip / giveUp /
 * releaseClaimForRetry); this module decides, and says which of them to call.
 */
import type { TipChargeBreakdown } from "../tipFees.ts";
import { chargeSavedPayment, type SavedChargeDeps } from "./paypalSavedCharge.ts";
import type { ManualPayoutQueue } from "./manualPayoutQueue.ts";

export interface PayPalAutoTipInput {
  /** The claim row this run just wrote (tips.id). It is the charge's subject: one key per claim. */
  tipId: string;
  jobId: string;
  posterId: string;
  helperId: string;
  quote: TipChargeBreakdown;
}

export interface PayPalAutoTipDeps {
  charge: SavedChargeDeps;
  queue: ManualPayoutQueue;
  /** auto_tip_job_state(job): 'chargeable' | 'held' | 'closed', or an Error when unreadable. */
  jobStateNow(jobId: string): Promise<string | Error>;
}

export type PayPalAutoTipOutcome =
  /** Charged; the Helpr's tip is on the pay queue (or will be, by retryOwedTipPayouts). */
  | { outcome: "charged"; paymentId: string; payoutQueued: boolean; payoutReason: string | null }
  /** The job changed since the candidate list: release the claim (closed: record it unsent). */
  | { outcome: "state_changed"; state: string }
  /** The job's state could not be re-read: release the claim, a defect. */
  | { outcome: "state_unreadable"; message: string }
  /** Mark the claim failed with this reason and tell the poster. Nothing was charged. */
  | { outcome: "give_up"; reason: string; posterMessage: string }
  /** Captured but not settled: the claim says so; the webhook reconciles. */
  | { outcome: "capture_pending"; paymentId: string }
  /** Outcome unknown: the claim stays 'pending' with this reason; a defect pages. */
  | { outcome: "ambiguous"; reason: string };

const NO_METHOD_MESSAGE =
  "We couldn't charge your automatic tip because there's no saved PayPal payment method on file. You can send it in a tap.";

export async function chargePayPalAutoTip(deps: PayPalAutoTipDeps, i: PayPalAutoTipInput): Promise<PayPalAutoTipOutcome> {
  if (i.quote.helperCents !== i.quote.tipCents) throw new Error("a tip pays the Helpr 100% of the tip");
  const state = await deps.jobStateNow(i.jobId);
  if (state instanceof Error) return { outcome: "state_unreadable", message: state.message };
  if (state !== "chargeable") return { outcome: "state_changed", state };

  const res = await chargeSavedPayment(deps.charge, {
    subjectKind: "tip",
    subjectId: i.tipId,
    payerId: i.posterId,
    amountCents: i.quote.chargeCents,
  });
  switch (res.outcome) {
    case "switch_off":
      return { outcome: "give_up", reason: "paypal_switch_off", posterMessage: "We couldn't charge your automatic tip. You can send your Helpr a tip in a tap." };
    case "no_saved_method":
      return { outcome: "give_up", reason: "no_saved_paypal_method", posterMessage: NO_METHOD_MESSAGE };
    case "declined":
      return { outcome: "give_up", reason: `paypal_declined: ${res.reason}`.slice(0, 200), posterMessage: "Your automatic tip didn't go through. You can send it in a tap." };
    case "retry":
    case "needs_review":
      return { outcome: "ambiguous", reason: `paypal ${res.outcome}: ${res.reason}`.slice(0, 200) };
    case "pending":
      return { outcome: "capture_pending", paymentId: res.paymentId };
    case "charged": {
      const q = await deps.queue.queue({
        jobId: i.jobId,
        helperId: i.helperId,
        amountCents: i.quote.tipCents,
        platformFeeCents: 0,
        source: "auto_tip",
        providerPaymentId: res.paymentId,
      });
      return { outcome: "charged", paymentId: res.paymentId, payoutQueued: q.recorded, payoutReason: q.recorded ? null : `${q.outcome}${q.reason ? `: ${q.reason}` : ""}` };
    }
  }
}

/** A captured tip whose Helpr payout is not on the queue yet. */
export interface OwedTipPayout {
  paymentId: string;
  tipId: string;
  jobId: string;
  helperId: string;
  tipCents: number;
}

/**
 * Every run: tips charged through PayPal whose Helpr payout is not queued yet are queued again
 * (the queue answers already_queued for one that is). Returns what is still owed after the run.
 */
export async function retryOwedTipPayouts(queue: ManualPayoutQueue, owed: readonly OwedTipPayout[]): Promise<OwedTipPayout[]> {
  const still: OwedTipPayout[] = [];
  for (const o of owed) {
    const q = await queue.queue({ jobId: o.jobId, helperId: o.helperId, amountCents: o.tipCents, platformFeeCents: 0, source: "auto_tip", providerPaymentId: o.paymentId });
    if (!q.recorded) still.push(o);
  }
  return still;
}
