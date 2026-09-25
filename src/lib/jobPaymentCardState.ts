import type { PaymentStatus } from "@/lib/statusLabels";

/**
 * WHAT THE MONEY ON A JOB MEANS FOR ITS CARD — one explicit answer per
 * `jobs.payment_status` value (Q360, audit ME-009 remainder, 2026-09-25).
 *
 * THE DEFECT. Every job card (the poster's My Posts card, the Helpr's My Jobs
 * card, the collapsed status line on both) keyed its state on `jobs.status`
 * alone. The stripe-webhook moves money on a different column: a card's bank
 * dispute (`charge.dispute.created` / `funds_withdrawn`) writes
 * `payment_status = 'chargeback'` and leaves `status` where it was, and a
 * declined card (`payment_intent.payment_failed`) writes `'failed'`. So a job
 * whose money the bank had just taken back still read "Done · paid and closed"
 * to the poster and "Paid out" to the Helpr.
 *
 * THE RULE. `Record<PaymentStatus, …>` over the tuple that
 * `src/test/paymentStatusExhaustive.test.ts` pins to the database CHECK, so a
 * value the database gains is a compile error here, not a silently healthy
 * card. `src/test/cardPaymentStateCoversWebhook.test.ts` also reads every value
 * the stripe-webhook writes to a job and requires it to land here.
 *
 * Most states need nothing extra on the card, because `jobs.status` already
 * tells the truth for them (held money under an active job, a refund under a
 * cancelled one). Exactly two are MONEY PROBLEMS the job status cannot show,
 * and those are the ones `jobPaymentProblem` returns.
 */
export type CardPaymentState =
  /** No money has landed (never paid, or checkout left unfinished). */
  | "unfunded"
  /** Held by the platform while the work happens. */
  | "held"
  /** Work approved; the Helpr's transfer is queued. */
  | "paying_out"
  /** Paid out to the Helpr. */
  | "paid_out"
  /** Returned to the card. */
  | "refunded"
  /** The authorisation was voided (or is being voided) before any capture. */
  | "voided"
  /** MONEY PROBLEM: the card was declined. */
  | "failed"
  /** MONEY PROBLEM: the card's bank disputed the charge and withdrew the funds. */
  | "chargeback";

export const CARD_PAYMENT_STATE: Record<PaymentStatus, CardPaymentState> = {
  unpaid: "unfunded",
  abandoned: "unfunded",
  escrow: "held",
  payout_pending: "paying_out",
  released: "paid_out",
  refunded: "refunded",
  cancelled: "voided",
  cancelling: "voided",
  failed: "failed",
  chargeback: "chargeback",
};

export type JobPaymentProblem = "failed" | "chargeback";

/** The card states that the job status alone would hide. */
export const PAYMENT_PROBLEM_STATES: readonly JobPaymentProblem[] = ["failed", "chargeback"];

/**
 * The money problem a job's card must show, or null.
 *
 * An unknown value (a client older than a new CHECK value) is null — the card
 * falls back to what `jobs.status` says, which is where it was before this
 * existed, never a crash.
 */
export function jobPaymentProblem(paymentStatus: string | null | undefined): JobPaymentProblem | null {
  if (!paymentStatus) return null;
  const state = CARD_PAYMENT_STATE[paymentStatus as PaymentStatus];
  return state === "failed" || state === "chargeback" ? state : null;
}

/**
 * The money problem a job CARD shows — `jobPaymentProblem`, except that a
 * declined card on a cancelled job is not one: nothing was charged and nothing
 * will be, so the job's own "didn't happen" is the whole truth. A chargeback
 * shows whatever the job status: the bank took money back regardless.
 * The collapsed status line and the expanded notice both ask this, so the two
 * halves of one card can never disagree.
 */
export function cardPaymentProblem(job: {
  payment_status?: string | null;
  status?: string | null;
}): JobPaymentProblem | null {
  const problem = jobPaymentProblem(job.payment_status);
  if (problem === "failed" && job.status === "cancelled") return null;
  return problem;
}

/**
 * The words, shared by BOTH parties (never role-based: the poster and the
 * Helpr read the same fact about the same job). `eyebrow` + `detail` are the
 * collapsed status line; `title` + `body` the notice on the expanded card.
 *
 * Every clause is what the server actually does: a chargeback blocks the
 * job's payouts (chargeDisputeCreated writes the block; a paid-out job has its
 * transfer reversed) until the dispute closes; a failed payment is only ever
 * stamped on a job that was still unpaid (paymentIntentPaymentFailed's
 * precondition), and unpaid jobs are hidden from every browse feed
 * (open_jobs_browse requires escrow / payout_pending / released).
 */
export const PAYMENT_PROBLEM_COPY: Record<
  JobPaymentProblem,
  { eyebrow: string; detail: string; title: string; body: string }
> = {
  chargeback: {
    eyebrow: "Bank dispute",
    detail: "Payment taken back by the bank",
    title: "The bank took this payment back",
    body: "The card's bank opened a dispute on this charge and withdrew the funds. Payouts for this job stop until the bank decides.",
  },
  failed: {
    eyebrow: "Payment failed",
    detail: "The card was declined",
    title: "The card payment didn't go through",
    body: "The card was declined, so this job isn't funded and isn't listed for anyone to see.",
  },
};
