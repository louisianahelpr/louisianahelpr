/**
 * Q1415(b): the ONE sentence a party hears when a payout cannot be scheduled
 * because an account on the job is under a ban-settlement review
 * (trg_refuse_payout_pending_during_ban_review raises ban_review_open).
 * Retrying cannot help until an admin confirms or lifts the review, so it is a
 * final answer, not "please try again", and it is neutral (owner 10-05: never
 * name the other account or its reason). Zero imports: create-payment throws
 * it and the client callers of action "release" recognise it, from this file.
 */
export const REVIEW_HOLD_MESSAGE =
  "This job's payment is on hold while we review it. There's nothing more you need to do; we'll send you a notification when it's settled.";

/** True when an error (or its message) is the review-hold answer. */
export function isReviewHold(err: unknown): boolean {
  const msg = typeof err === "string" ? err : (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.trim() === REVIEW_HOLD_MESSAGE;
}
