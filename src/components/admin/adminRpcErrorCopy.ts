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
import { RENTALS_ERROR_COPY as RC } from "@/lib/rentals/errorCopy";
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
  // Shops M4 (20261019071055): the Shops orders queue.
  shops_admin_queue: {
    admin_only: "Only admins can see the Shops queue.",
  },
  shops_admin_pay_shop: {
    admin_only: "Only admins can decide a Shops order.",
    invalid_note: "Add a note of up to 500 characters. Other admins see it.",
    invalid_method: "That action isn't available. Reload and try again.",
    invalid_payout: "Something went wrong paying the shop. Reload and try again.",
    order_final: "This order was already picked up and is final.",
    order_not_charged_yet: "The buyer's card isn't charged yet. Try again in a few minutes.",
    order_not_found: "This order isn't available any more. Refresh the list.",
    order_not_open: "This order is already closed. Refresh the list.",
    problem_open: "A problem is open on this order.",
    refunded_in_stripe: "This order was refunded in Stripe. Decide its held refund or payout in Payouts held for review.",
  },
  shops_admin_remove_strike: {
    admin_only: "Only admins can remove a Shops strike.",
    invalid_note: "Add a note of up to 500 characters. Other admins see it.",
    strike_not_found: "That strike was already removed or has ended. Refresh the list.",
  },
  shops_admin_give_strike: {
    admin_only: "Only admins can give a Shops strike.",
    invalid_note: "Add a note of up to 500 characters. Other admins see it.",
    invalid_side: "Pick the buyer or the shop.",
    member_gone: "That member's account is gone, so there is nobody to give a strike to.",
    order_not_found: "This order isn't available any more. Refresh the list.",
    strike_exists: "That side already has an admin strike for this order.",
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
  // AdminDisputes — closing a decided dispute on a Stripe TEST-mode payment
  // between test accounts as a test (Q1769, 20261015061949). Admin-facing.
  rpc_close_test_mode_dispute: {
    settle_note_required: "Write how you know this was a test. It's the only record of this close.",
    dispute_not_decided: "This dispute hasn't been decided yet, so there's no settlement to close.",
    dispute_already_settled: "This dispute's settlement is already closed. Refresh to see it.",
    dispute_crew_fanout: "A crew decision is settled by the payout run, so it can't be closed here.",
    dispute_settlement_in_progress: "A settlement run holds this dispute right now. Refresh in a few minutes.",
    dispute_not_test_mode: "This job wasn't paid in Stripe test mode, so it's a real dispute. Use Retry settlement.",
    dispute_not_test_accounts: "A real account is on this job, so it's a real dispute. Only a job between test accounts can be closed as a test.",
    dispute_has_live_gift: "A gift card paid toward this job, and gift cards are real money. Use Retry settlement.",
    dispute_payment_settled: "This job's payment record says it was already settled, so there's nothing to close. Refresh to see it.",
    dispute_money_moved: "Test-mode refund or transfer records exist for this job. Press Clear test-mode records and re-open first.",
    admin_is_party: "You're a party to this job, so another admin has to close its settlement.",
  },
  // AdminJobs — an admin ends a recurring series as the platform (Q417 (c),
  // rpc_admin_end_recurring_series, 20261012194707). Admin-facing.
  rpc_admin_end_recurring_series: {
    end_series_needs_reason: "Write why the platform is ending this series (10 characters or more). It goes in the audit log.",
    job_not_found: "This job no longer exists. Refresh and check.",
    admin_is_party: "You're a party to this series, so another admin has to end it.",
    not_a_series: "This job isn't part of a recurring series, so there's no series to end.",
  },
  // Declutter (DECLUTTER_ERROR_COPY, src/lib/declutter/errors.ts), slice 4 (20261015042253).
  declutter_admin_decide_problem: {
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_decision: DC.invalid_decision,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authorized: DC.not_authorized,
    order_not_paid: DC.order_not_paid,
    problem_already_decided: DC.problem_already_decided,
    problem_not_found: DC.problem_not_found,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    delivery_decision_needed: DC.delivery_decision_needed,
  },
  declutter_admin_decide_delivery_damage: {
    account_restricted: DC.account_restricted,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_a_delivery_in_transit: DC.not_a_delivery_in_transit,
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
  // Rentals S1 ownership review (20261017205605): RentalsOwnershipCard.
  rentals_admin_review_property: {
    account_restricted: RC.account_restricted,
    decision_required: RC.decision_required,
    feature_disabled: RC.feature_disabled,
    not_authorized: RC.not_authorized,
    not_pending_review: RC.not_pending_review,
    reason_required: "Add a reason. The landlord will see it.",
  },
  rentals_admin_review_landlord_id: {
    account_restricted: RC.account_restricted,
    decision_required: RC.decision_required,
    feature_disabled: RC.feature_disabled,
    not_authorized: "Only an admin can do that, and never for their own ID.",
    not_pending_review: "This ID isn't waiting for a review.",
    profile_not_found: RC.profile_not_found,
    reason_required: "Add a reason. The landlord will see it.",
    review_changed: "The landlord sent a new photo since you opened this. Refresh and look again.",
  },
  // Held-for-review payouts and refunds (admin money page, 20261019070737).
  // SMS alerts status (20261021193738): SmsStatusCard.
  admin_sms_status: {
    admin_only: "Only admins can see the text alert log.",
  },
  admin_payouts_held_for_review: {
    admin_only: "Only admins can see payouts held for review.",
  },
  admin_payout_release: {
    admin_only: "Only admins can release a held payout.",
    invalid_kind: "That isn't a payout or refund this page knows. Refresh and try again.",
    invalid_note: "Add a short note saying why it can go back to automatic.",
    not_held_for_review: "This row isn't held for review any more. Another admin may have handled it. Refresh the list.",
    confirm_no_transfer_required: "Tick the box once you have checked Stripe and found no transfer or refund for this row made outside the app.",
    refunded_in_stripe: "A refund made in Stripe stands on this order, so this stays held. Mark it settled by hand once you have decided.",
    shop_payout_not_due: "The shop isn't paid for this order automatically (a problem is open, or it wasn't handed over). Mark it settled by hand instead.",
  },
  admin_payout_settle_by_hand: {
    admin_only: "Only admins can mark a payout settled by hand.",
    invalid_kind: "That isn't a payout or refund this page knows. Refresh and try again.",
    invalid_note: "Add a short note saying how it was settled.",
    invalid_amount: "Enter the amount it was settled for.",
    invalid_stripe_ref: "Give the Stripe id it was settled with (tr_... or po_... for a payout, re_... for a refund), or \"other: how it was paid\".",
    not_held_for_review: "This row isn't held for review any more. Another admin may have handled it. Refresh the list.",
    ref_already_used: "That Stripe id is already recorded on another payout or refund. Check you have the right one.",
    settle_amount_short: "That's less than this refund owes. Refund the rest in Stripe first, then record the full amount.",
    settle_amount_differs: "A Shops refund is settled only for its whole amount. Enter the full amount shown.",
    stripe_check_required: "A Shops refund settled with a Stripe refund id is checked with Stripe first. Paste the re_... id in the Stripe id box, or use \"other:\".",
  },
  // Homes take-down and lift (20261019062540): HomesListingsCard.
  rentals_admin_remove_listing: {
    not_authorized: "Only an admin can take a listing down.",
    account_restricted: RC.account_restricted,
    reason_required: "Write the reason (5 to 500 characters). The owner sees it.",
    listing_not_found: "That listing is gone. Refresh the list.",
    listing_not_live: "Only a live or paused listing can be taken down. Refresh the list.",
  },
  rentals_admin_lift_takedown: {
    not_authorized: "Only an admin can lift a take-down.",
    account_restricted: RC.account_restricted,
    reason_required: "Write a note (5 to 500 characters) saying why it is lifted.",
    listing_not_found: "That take-down was already lifted. Refresh the list.",
    photos_purging: "Its photos are being deleted right now (30 days after the take-down). Try again in 15 minutes; any photo already gone must be added again by the owner.",
  },
  // Owner 2026-10-23: the approval queue's "Mark reviewed" (20261023143240).
  resolve_approval_escalation: {
    not_authorized: "Only an admin can close a job waiting on approval.",
  },
  // PayPal Plan A, phase 4: the hand-paid "Pay this Helpr" queue (20261023231811).
  admin_paypal_payout_queue: {
    admin_only: "Only admins can see the PayPal pay list.",
  },
  admin_mark_paypal_payout_paid: {
    feature_disabled: "PayPal payments are switched off for your account. Turn them on for testers in Admin > Settings.",
    admin_only: "Only an admin can mark a payout paid.",
    txn_id_required: "Paste the PayPal transaction ID from the Send Money receipt.",
    txn_id_invalid: "That doesn't look like a PayPal transaction ID. It's letters and numbers only, usually 17.",
    payouts_required: "Nothing was picked to mark paid. Refresh the list.",
    payout_not_found: "That payout isn't in the list any more. Refresh the list.",
    payouts_not_one_payee: "Mark paid one Helpr and one PayPal account at a time.",
    payout_already_marked_paid: "This was already marked paid with a different PayPal transaction ID. Nothing was changed.",
    payout_held_email_changed: "The Helpr changed their PayPal email after this was queued. Check the new email and queue it again.",
    payout_not_payable: "This payout was canceled or came back, so it can't be marked paid. Refresh the list.",
    payout_claim_not_pending: "This payout changed while you were looking at it. Refresh the list.",
    payout_amount_mismatch: "The amount changed since this list loaded. Refresh the list and check the total before you mark it paid.",
    txn_id_already_used: "That PayPal transaction ID was already used. Each Send Money is marked once, with all its lines together. Check the receipt.",
    payout_needs_recheck: "This payout goes to a PayPal email changed after the Helpr was hired. Check it with them and queue it again first.",
    payout_blocked: "Don't send this payout: it's on hold, under review or its payment is disputed. If you already sent it before that, tick the box to record it.",
  },
  admin_requeue_held_paypal_payout: {
    feature_disabled: "PayPal payments are switched off for your account. Turn them on for testers in Admin > Settings.",
    admin_only: "Only an admin can queue a payout again.",
    payout_not_found: "That payout isn't in the list any more. Refresh the list.",
    payout_not_held: "This payout isn't held any more. Refresh the list.",
    confirm_no_send_money: "Tick the box to confirm no PayPal Send Money went out for this payout. If one did, mark it paid instead.",
    payout_not_job_pay: "Only job pay can be queued again here.",
    payout_claim_not_pending: "This payout changed while you were looking at it. Refresh the list.",
    no_payable_paypal_account: "The Helpr has no PayPal email that can be paid yet.",
    payout_held: "This Helpr's payouts are on hold. Release the hold first.",
    payout_blocked: "This payout can't be queued again right now (a hold, a review or a payment dispute). Check the job first.",
  },
  admin_cancel_paypal_payout: {
    feature_disabled: "PayPal payments are switched off for your account. Turn them on for testers in Admin > Settings.",
    admin_only: "Only an admin can cancel a payout.",
    confirm_no_send_money: "Tick the box to confirm no PayPal Send Money went out for this payout. If one did, mark it paid instead.",
    reason_required: "Say why it is canceled (5 characters or more).",
    payout_not_found: "That payout isn't in the list any more. Refresh the list.",
    payout_not_payable: "This payout was already paid, canceled or returned. Refresh the list.",
    payout_not_job_pay: "Only job pay can be canceled here.",
    payout_cancel_not_here: "This payout belongs to an agreed refund or a cancellation fee. Settle it from that job instead.",
    payout_claim_not_pending: "This payout changed while you were looking at it. Refresh the list.",
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
