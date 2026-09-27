/**
 * The payment states of a job whose money never landed: `unpaid` (checkout
 * never completed), `abandoned` (walked away), `failed` (card declined). To the
 * poster such a job does not exist (owner, 2026-09-27: "Unpaid jobs should not
 * show in post anywhere. Even hidden."). One list, read by My Posts
 * (`jobIsUnfundedDraft`) and Post a Job's Repost query, so they cannot disagree.
 */
export const NEVER_PAID_STATUSES = ["unpaid", "abandoned", "failed"] as const;
