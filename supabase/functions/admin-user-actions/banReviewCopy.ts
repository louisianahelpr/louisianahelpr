/**
 * What a confirmed ban is CALLED, per ladder — one source of truth.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The ban-review queue used to be the message scanner's alone, so the confirm
 * branch of admin-user-actions hard-coded a single sentence:
 *
 *   "An admin reviewed your blocked messages and permanently banned your
 *    account."
 *
 * …and a single default `user_bans.reason` ("Repeated off-platform contact
 * attempts in messages"). Migration 20260829030000 pointed two more ladders at
 * the same queue (`cancel_with_helper`, `job_denial`) and 20260831183302 added
 * a fourth (`no_show`), and none of them changed that copy. So a helper banned
 * for repeated no-shows was told, on the one notification that explains why
 * they lost their account and which is the entire basis for their appeal, that
 * it was about messages they never sent.
 *
 * The fix is not four `if` branches — that is the same bug waiting for the
 * fifth ladder. Every ladder that can reach `pending_ban_review` gets one entry
 * here, and both the user-facing sentence and the stored ban reason are derived
 * from it. Adding a ladder means adding a row; forgetting to add a row means
 * falling back to a sentence that is vague but TRUE, never one that is specific
 * and wrong.
 *
 * ── Vocabulary ─────────────────────────────────────────────────────────────
 *
 * `evidence` is deliberately the same vocabulary as the `caseNoun` map in
 * src/components/admin/AdminBanReview.tsx, which is what the deciding admin
 * reads ("3 blocked messages", "2 no-show reports"). The admin and the banned
 * user should be looking at the same words for the same case.
 *
 * ── Where each violation_type comes from ────────────────────────────────────
 *
 *   off_platform        message scanner — off-platform contact attempts
 *   cancel_with_helper  cancelling a job that already had a committed Helpr
 *   job_denial          reliability ladder
 *   no_show             reported no-shows (20260831183302)
 */

export type BanReviewCopy = {
  /**
   * What the admin actually reviewed, as a noun phrase that reads correctly
   * after "An admin reviewed your …". Plural: a case only reaches this queue
   * on repeat behaviour.
   */
  evidence: string;
  /**
   * Default `user_bans.reason` when the admin left the note blank. Stored on
   * the ban row itself, so it has to stand on its own without the queue.
   */
  banReason: string;
  /**
   * What to do differently, shown when a case is DISMISSED and the restriction
   * lifted. Same bug as the ban sentence: this used to be "Keep chats and
   * payments on Helpr and you're all set" for everyone, which is messaging
   * advice given to a helper whose case was about no-shows.
   */
  dismissAdvice: string;
};

/**
 * Neutral and truthful. Used for any violation_type not listed below, and for
 * a confirmation that closes several DIFFERENT kinds of case at once — naming
 * one of them would be as wrong as naming the wrong one.
 */
export const UNKNOWN_BAN_REVIEW_COPY: BanReviewCopy = {
  evidence: 'the violations on your account',
  banReason: 'Repeat platform policy violations (admin-confirmed)',
  dismissAdvice: 'Please review the platform rules so this does not come up again.',
};

const BAN_REVIEW_COPY: Record<string, BanReviewCopy> = {
  off_platform: {
    evidence: 'your blocked messages',
    banReason: 'Repeated off-platform contact attempts in messages (admin-confirmed)',
    dismissAdvice: "Keep chats and payments on Helpr and you're all set.",
  },
  cancel_with_helper: {
    evidence: 'your cancellations on jobs with a committed Helpr',
    banReason: 'Repeated cancellations on jobs with a committed Helpr (admin-confirmed)',
    dismissAdvice: "Only book what you can keep — cancelling on a committed Helpr is what opened this case.",
  },
  job_denial: {
    evidence: 'your reliability strikes',
    banReason: 'Repeated reliability strikes (admin-confirmed)',
    dismissAdvice: 'Follow through on the jobs you take and the strikes stop adding up.',
  },
  no_show: {
    evidence: 'the no-show reports on your account',
    banReason: 'Repeated reported no-shows (admin-confirmed)',
    dismissAdvice: "Show up for the jobs you accept, or cancel early enough that the other side can re-book.",
  },
};

/**
 * Copy for a confirmed ban.
 *
 * @param violationTypes every DISTINCT violation_type being closed by this
 *   decision. One recognised type → its own words. Zero types (the row could
 *   not be read), an unrecognised type, or a mix → the neutral fallback.
 */
export function banReviewCopy(violationTypes: readonly string[]): BanReviewCopy {
  const distinct = [...new Set(violationTypes.filter(Boolean))];
  if (distinct.length !== 1) return UNKNOWN_BAN_REVIEW_COPY;
  return BAN_REVIEW_COPY[distinct[0]] ?? UNKNOWN_BAN_REVIEW_COPY;
}

/**
 * The notification body a permanently banned user reads. Written ONCE — the
 * only thing that varies between ladders is `evidence`, so there is no second
 * sentence for a future ladder to inherit wrongly.
 */
export function banConfirmedMessage(copy: BanReviewCopy, supportEmail: string): string {
  return `An admin reviewed ${copy.evidence} and permanently banned your account. Email ${supportEmail} if you believe this is a mistake.`;
}

/** The notification body when a case is dismissed and the restriction lifted. */
export function banDismissedMessage(copy: BanReviewCopy): string {
  return `An admin reviewed ${copy.evidence} and lifted the restriction. ${copy.dismissAdvice}`;
}
