/**
 * Words for every refusal the shared Helpr task RPCs (helpr_*, Declutter slice
 * 5, 20261017055505) can raise. They live here, not in RPC_ERROR_COPY
 * (src/lib/lifecycleErrors.ts), because that table is in the bundle every
 * signed-in page loads, and only the delivery screens call these RPCs: moving
 * them out kept /posts inside its critical-path budget (Q178, 2026-10-17).
 *
 * The words themselves are DECLUTTER_ERROR_COPY's, exact against the
 * migrations. src/test/rpcErrorCopyCoverage.test.ts checks this table with
 * RPC_ERROR_COPY: every code each helpr_* RPC can raise has a line here, and no
 * line names a code it no longer raises.
 */
import { DECLUTTER_ERROR_COPY as DC } from "@/lib/declutter/errors";

export const HELPR_TASK_RPC_ERROR_COPY = {
  helpr_my_tasks: {
    not_authenticated: DC.not_authenticated,
  },
  helpr_go_online: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_choice: "Something went wrong. Try again.",
    invalid_hours: "Choose 1 to 12 hours.",
    invalid_location: "We couldn't read your location. Try again, or go online from your saved area.",
    invalid_radius: "Choose 1 to 50 miles.",
    location_needed: "Add your area in your profile, or tap \"Nearest first\" to share your location, to go online.",
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    under_18: DC.under_18,
  },
  helpr_route_suggestions: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    task_not_found: DC.task_not_found,
    under_18: DC.under_18,
  },
  helpr_my_route: {
    feature_disabled: DC.feature_disabled,
    invalid_location: DC.invalid_location,
    not_authenticated: DC.not_authenticated,
  },
  helpr_set_vehicle: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_vehicle: DC.invalid_vehicle,
    not_authenticated: DC.not_authenticated,
    vehicle_photo_required: DC.vehicle_photo_required,
    // Q2452 (20261028012406): a held delivery must still fit the vehicle saved.
    vehicle_in_use: "You have a delivery that needs this vehicle. Finish it or back out of it first.",
  },
  helpr_task_accept: {
    too_many_taken: DC.too_many_taken,
    too_many_releases: DC.too_many_releases,
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    delivery_not_done: DC.delivery_not_done,
    feature_disabled: DC.feature_disabled,
    // ID once (20261020044552): taking a delivery is the Helpr's accept.
    helper_identity_unverified: "Verify your ID with Stripe to take this delivery. You only do it once: You, then Settings, then ID.",
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_slot: DC.invalid_slot,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    own_task: DC.own_task,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_found: DC.task_not_found,
    task_taken: DC.task_taken,
    under_18: DC.under_18,
    unknown_task_source: DC.unknown_task_source,
    vehicle_too_small: DC.vehicle_too_small,
    // Q2452 (20261028012406): every delivery needs a car.
    vehicle_needs_car: "Add your car under Your vehicle to take deliveries.",
  },
  helpr_task_customer_confirm: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    item_going_back: "This item is going back to the seller.",
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    delivery_on_the_way: DC.delivery_on_the_way,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
  },
  helpr_task_delivered: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    delivery_on_hold: "You reported this delivery. Follow the steps on it.",
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    location_required: DC.location_required,
    no_delivery_fee: DC.no_delivery_fee,
    not_at_dropoff: DC.not_at_dropoff,
    not_authenticated: DC.not_authenticated,
    not_picked_up_yet: DC.not_picked_up_yet,
    order_not_paid: DC.order_not_paid,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
  },
  // The Helpr's own pickup time at this seller, on the accept card (20261030152601): the same refusals.
  helpr_task_same_pickup_slot: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    task_not_found: DC.task_not_found,
    under_18: DC.under_18,
  },
  // The seller's pickup windows for an open delivery (20261028232930): helpr_task_assert_helpr's refusals and the task.
  helpr_task_pickup_windows: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    task_not_found: DC.task_not_found,
    under_18: DC.under_18,
  },
  helpr_task_picked_up: {
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    location_required: DC.location_required,
    no_delivery_fee: DC.no_delivery_fee,
    not_at_pickup: DC.not_at_pickup,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_active: DC.task_not_active,
    task_not_found: DC.task_not_found,
    // 20261030012018 (audit 1c #1): not before 30 minutes ahead of the pickup, unless the seller tapped Handed over.
    too_early: "You can mark it picked up 30 minutes before the pickup time, or once the seller taps Handed over.",
    unknown_task_source: DC.unknown_task_source,
  },
  // The seller's "Handed over" (20261030012018).
  helpr_task_cant_finish: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    item_not_found: DC.item_not_found,
    account_restricted: DC.account_restricted,
    already_reported: "You already reported this delivery. Follow the steps on it.",
    invalid_reason: DC.invalid_reason,
    not_authenticated: DC.not_authenticated,
    not_picked_up_yet: DC.not_picked_up_yet,
    note_required: DC.note_required,
    problem_open: DC.problem_open,
    task_not_found: DC.task_not_found,
  },
  helpr_task_buyer_fix: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    item_not_found: DC.item_not_found,
    account_restricted: DC.account_restricted,
    fix_too_far: "The new address has to be within 25 miles of the old one.",
    fix_too_late: "The 24 hours to fix this are over.",
    location_required: DC.location_required,
    not_authenticated: DC.not_authenticated,
    note_required: "Tell the Helpr what changed.",
    nothing_to_fix: "There's nothing to fix on this delivery now.",
    problem_open: DC.problem_open,
    task_not_found: DC.task_not_found,
  },
  helpr_task_buyer_choose: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    order_not_paid: DC.order_not_paid,
    refund_amount_unknown: DC.refund_amount_unknown,
    unknown_task_source: DC.unknown_task_source,
    account_restricted: DC.account_restricted,
    invalid_choice: "Something went wrong. Try again.",
    not_authenticated: DC.not_authenticated,
    note_required: "Tell the Helpr where and when you can meet.",
    nothing_to_choose: "There's nothing to choose on this delivery now.",
    problem_open: DC.problem_open,
    task_not_found: DC.task_not_found,
    too_late_to_collect: "The item is already back with the seller.",
  },
  helpr_task_returned: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    item_not_found: DC.item_not_found,
    account_restricted: DC.account_restricted,
    location_required: DC.location_required,
    not_at_pickup: DC.not_at_pickup,
    not_authenticated: DC.not_authenticated,
    not_returning: "This delivery isn't going back to the seller.",
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    problem_open: DC.problem_open,
    task_not_found: DC.task_not_found,
  },
  helpr_task_seller_return_answer: {
    // BUY-36 (20261031231150): reached through the steps it runs (the close, the confirm, the debt take, the lock).
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    order_not_paid: DC.order_not_paid,
    refund_amount_unknown: DC.refund_amount_unknown,
    unknown_task_source: DC.unknown_task_source,
    account_restricted: DC.account_restricted,
    invalid_input: DC.invalid_input,
    not_authenticated: DC.not_authenticated,
    not_returned: "The Helpr hasn't said it's back yet.",
    note_required: DC.note_required,
    problem_open: DC.problem_open,
    task_not_found: DC.task_not_found,
  },
  helpr_task_handed_over: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    problem_open: DC.problem_open,
    task_not_active: "This delivery has no Helpr on it right now.",
    task_not_found: DC.task_not_found,
  },
  // The seller's one move of a Helpr's pickup (BUY-42, 20261031095846).
  helpr_task_seller_move_pickup: {
    account_restricted: DC.account_restricted,
    already_moved: "You can move a Helpr's pickup once. Message the Helpr if this time still doesn't work.",
    feature_disabled: DC.feature_disabled,
    invalid_slot: "Pick a new time at least 2 hours away, inside your pickup times.",
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    problem_open: DC.problem_open,
    task_not_active: "This delivery has no Helpr booked to pick it up right now.",
    task_not_found: DC.task_not_found,
    too_late: "The pickup time has started. Message the Helpr instead.",
  },
  helpr_task_pickup_no_show: {
    account_restricted: DC.account_restricted,
    location_required: DC.location_required,
    not_at_pickup: DC.not_at_pickup,
    photo_not_uploaded: DC.photo_not_uploaded,
    photo_too_old: DC.photo_too_old,
    already_paid_out: DC.already_paid_out,
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_active: DC.task_not_active,
    task_not_found: DC.task_not_found,
    too_early: DC.too_early,
    unknown_task_source: DC.unknown_task_source,
  },
  helpr_task_release: {
    task_not_active: DC.task_not_active,
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    // AUD31-9: the Helpr pressing Back out after the pickup (a stale page) has the item; the buyer picked up nothing.
    // The server's own hint (helpr_task_release, 20261031102758).
    already_picked_up: "You already have the item. Deliver it, or report a problem.",
    delivery_not_done: DC.delivery_not_done,
    invalid_method: DC.invalid_method,
    invalid_payout: DC.invalid_payout,
    invalid_status: DC.invalid_status,
    item_not_found: DC.item_not_found,
    no_delivery_fee: DC.no_delivery_fee,
    not_authenticated: DC.not_authenticated,
    order_not_paid: DC.order_not_paid,
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
  },
  helpr_task_view: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    task_not_found: DC.task_not_found,
    under_18: DC.under_18,
  },
  // Q1929: the buyer's "Raise the pay" panel on a delivery (20261021185418). Read only from the
  // delivery screen, so its words live here with the other delivery-screen RPCs.
  declutter_delivery_raise_status: {
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  // Audit 1c D3-6: how many deliveries are open, for a Helpr with no car yet (20261030044539).
  helpr_tasks_open_count: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    under_18: DC.under_18,
  },
  helpr_tasks_open_near: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_location: DC.invalid_location,
    not_authenticated: DC.not_authenticated,
    payout_setup_incomplete: DC.payout_setup_incomplete,
    under_18: DC.under_18,
  },
} as const;

export type HelprTaskRpc = keyof typeof HELPR_TASK_RPC_ERROR_COPY;

/**
 * The helpr_* twin of lifecycleErrors' rpcErrorMessage, with the same name so
 * the coverage check's call-site rule (every .rpc("helpr_x") reads its copy
 * through rpcErrorMessage) holds unchanged: the first code of the RPC's table
 * that appears as a whole word in the error message, mapped to its words.
 */
export function rpcErrorMessage(rpc: HelprTaskRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table = HELPR_TASK_RPC_ERROR_COPY[rpc] as Record<string, string>;
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
