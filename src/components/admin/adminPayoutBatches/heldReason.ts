/**
 * A held row's `review_reason` in words (AUD31-43). payout_hold_for_review
 * (20261019070737) stores "<category>: <detail>"; the categories are
 * declutter-money's WaitCategory (supabase/functions/declutter-money/index.ts,
 * WAIT_WORDS). An unknown category, or free text (a Shops hold's p_why), is
 * shown as it was written.
 */
const REASON_WORDS: Record<string, string> = {
  rejected: "Stripe rejected the payee's payout account",
  unusable: "The payee's payout account is gone or unusable",
  payee_deleted: "The payee deleted their account",
  mixed_parties: "The order mixes a test account and a real one",
  banned: "The payee is banned",
  data_defect: "The row can't be paid as recorded (a data defect)",
  needs_reconcile: "A transfer may already exist (check Stripe by hand)",
  transfer_failed: "The Stripe transfer failed",
};

export function heldReasonWords(reason: string | null): string {
  if (!reason || !reason.trim()) return "No reason recorded";
  const m = /^([a-z_]+)(?::\s*([\s\S]*))?$/.exec(reason.trim());
  const words = m ? REASON_WORDS[m[1]] : undefined;
  if (!m || !words) return reason;
  const detail = (m[2] ?? "").trim();
  return detail ? `${words}. Detail: ${detail}` : `${words}.`;
}
