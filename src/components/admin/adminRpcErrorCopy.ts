/**
 * WORDS FOR THE CODES ADMIN-ONLY RPCs RAISE — the admin console's half of
 * RPC_ERROR_COPY (src/lib/lifecycleErrors.ts).
 *
 * An RPC belongs here when its definition refuses anyone without the admin role
 * (`has_role(..., 'admin')`); src/test/rpcErrorCopyCoverage.test.ts derives that
 * set from the migrations and fails if one of them is mapped in the shared
 * table instead, or if an RPC here is not admin-gated. The split is for bytes:
 * the shared table rides in a chunk every signed-in first screen downloads, and
 * this one is imported statically only by src/components/admin/ (lazy chunks)
 * and fetched on demand everywhere else (loadAdminRpcErrorCopy).
 *
 * It lives under src/components/admin/, not src/lib/, on purpose: a src/lib
 * module that two chunks import is captured into the signed-in-shared chunk
 * (vite.config.ts codeSplitting), which would put it straight back on every
 * signed-in first screen.
 *
 * Same rules as the shared table: per RPC, every code the RPC raises, plain
 * words, never addressed to one role. `rpcErrorMessage` here reads BOTH
 * tables, so an admin file imports it from this module only; the coverage
 * guard counts reads by that name.
 */
import { DECLUTTER_ERROR_COPY as DC } from "@/lib/declutter/errors";
import { codeNamedIn, RPC_ERROR_COPY, type MappedRpc } from "@/lib/lifecycleErrors";

export const ADMIN_RPC_ERROR_COPY = {
  // UserAuditLog (admin).
  admin_reverse_violation: {
    not_authorized: "You don't have permission to reverse this.",
    violation_not_found: "That strike no longer exists — it may already have been reversed. Refresh the log.",
  },
  // AdminBanEvasionReview — Q1324 ban settlement reviews and name matches.
  admin_ban_settlement_reviews: {
    admin_only: "Only admins can see ban settlement reviews.",
  },
  admin_confirm_ban_settlement: {
    admin_only: "Only admins can confirm a ban.",
    no_open_review: "This account has no open review any more. Another admin may have decided it. Refresh the list.",
  },
  admin_resolve_ban_evasion_match: {
    admin_only: "Only admins can mark a name match checked.",
  },
  // AdminPayoutBatches — the server-side payout hold (Q764).
  admin_set_payout_hold: {
    admin_only: "Only admins can hold payouts.",
    helper_required: "Pick the Helpr whose payouts to hold.",
    reason_required: "Add a reason for the hold. Other admins see it.",
  },
  admin_deny_payout_hold: {
    admin_only: "Only admins can deny a payout.",
    no_payout_hold: "This Helpr is no longer on hold. Another admin may have released it, so refresh the queue.",
    reason_required: "Add a reason for the denial.",
  },
  admin_release_payout_hold: {
    admin_only: "Only admins can release a payout hold.",
    // Q1415 (d): the review decides the money; a hold release cannot pre-empt it.
    ban_review_open: "This Helpr is under an open ban review, so their payouts stay held until it's decided. Lifting the review in the Ban review queue releases the hold; confirming the ban keeps it.",
  },
  // AdminAnalytics → Sign-up leads card (Q1587, 20261012030524).
  admin_list_signup_leads: {
    admin_only: "Only admins can see sign-up leads.",
  },
  // The "Louisiana Helpr Team" thread (20261011161100): the admin's message
  // (AdminMessageUserDialog, and a reply typed in the thread, sendHandlers.ts).
  admin_send_team_message: {
    admin_only: "Only admins can send this. Check your admin role.",
    cannot_message_self: "You can't message your own account.",
    empty_message: "Write a message first.",
    message_too_long: "That message is too long. Messages are limited to 4,000 characters.",
    user_not_found: "That account no longer exists.",
  },
  // Hidden feature switches (20261012031120): Admin -> Settings card.
  admin_list_feature_switches: {
    not_authorized: "Only admins can see the feature switches. Check your admin role.",
  },
  admin_set_feature_switch: {
    invalid_audience: "That isn't a switch setting. Choose Off, Testers only or Everyone.",
    not_authorized: "Only admins can change a feature switch. Check your admin role.",
    unknown_switch: "That switch no longer exists. Refresh the list.",
  },
  // AdminDisputes — closing a decided dispute whose job has no payment on file
  // (Q235, 20260923205812). Admin-facing.
  rpc_settle_dispute_without_payment: {
    settle_note_required: "Write why there's no payment to move. It's the only record of this close.",
    dispute_not_decided: "This dispute hasn't been decided yet, so there's no settlement to close.",
    dispute_already_settled: "This dispute's settlement is already closed. Refresh to see it.",
    dispute_settlement_in_progress: "A settlement run holds this dispute right now. Refresh in a few minutes.",
    dispute_has_payment: "This job has a payment on file, so the split has to move it. Use Retry settlement.",
    // 20260924013122: payment_status says money moved, or a transfer / refund /
    // restored gift exists for the job.
    dispute_payment_not_unfunded: "This job's payment record says money moved, so it can't be closed as unpaid. Reconcile it against Stripe.",
    dispute_money_moved: "A transfer, refund or restored gift exists for this job, so it can't be closed as unpaid. Reconcile it against Stripe.",
    admin_is_party: "You're a party to this job, so another admin has to close its settlement.",
  },
  // Declutter (DECLUTTER_ERROR_COPY, src/lib/declutter/errors.ts), slice 4 (20261015042253).
  declutter_admin_decide_problem: {
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    invalid_decision: DC.invalid_decision,
    invalid_payout: DC.invalid_payout,
    item_not_found: DC.item_not_found,
    not_authorized: DC.not_authorized,
    order_not_paid: DC.order_not_paid,
    problem_already_decided: DC.problem_already_decided,
    problem_not_found: DC.problem_not_found,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
  },
  // Declutter's admin queue (row 33, B8): DeclutterReviewCard via src/lib/declutter/api.ts.
  declutter_admin_pending_items: {
    feature_disabled: DC.feature_disabled,
    not_admin: DC.not_admin,
  },
  declutter_admin_review_item: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_decision: DC.invalid_decision,
    item_not_pending: DC.item_not_pending,
    not_admin: DC.not_admin,
    own_listing: DC.own_listing,
    review_note_required: DC.review_note_required,
    review_note_too_long: DC.review_note_too_long,
    seller_not_eligible: DC.seller_not_eligible,
  },
  // "Suggest a category" review (I1, migration 20261015051141): CategorySuggestionsCard.
  admin_list_category_suggestions: {
    feature_disabled: "Category suggestions are switched off for your account.",
    invalid_status: "That list doesn't exist.",
    not_authorized: "Only admins can see category suggestions.",
  },
  admin_review_category_suggestion: {
    already_reviewed: "Someone already decided this suggestion.",
    feature_disabled: "Category suggestions are switched off for your account.",
    invalid_arguments: "Something went wrong. Please try again.",
    not_authorized: "Only admins can decide category suggestions.",
    note_too_long: "Keep the note under 300 characters.",
    unknown_suggestion: "That suggestion no longer exists.",
  },
} satisfies Record<string, Record<string, string>>;

export type AdminMappedRpc = keyof typeof ADMIN_RPC_ERROR_COPY;
type AnyMappedRpc = MappedRpc | AdminMappedRpc;

function codesFor(rpc: AnyMappedRpc): Record<string, string> {
  return (rpc in ADMIN_RPC_ERROR_COPY
    ? ADMIN_RPC_ERROR_COPY[rpc as AdminMappedRpc]
    : RPC_ERROR_COPY[rpc as MappedRpc]) as Record<string, string>;
}

/** Human copy for an error `rpc` returned (either table), or `null` so the caller keeps its fallback. */
export function rpcErrorMessage(rpc: AnyMappedRpc, error: unknown): string | null {
  const code = codeNamedIn(codesFor(rpc), error);
  return code ? codesFor(rpc)[code] : null;
}
