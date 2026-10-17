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
  helpr_set_vehicle: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    invalid_vehicle: DC.invalid_vehicle,
    not_authenticated: DC.not_authenticated,
    vehicle_photo_required: DC.vehicle_photo_required,
  },
  helpr_task_accept: {
    too_many_taken: DC.too_many_taken,
    too_many_releases: DC.too_many_releases,
    account_restricted: DC.account_restricted,
    already_paid_out: DC.already_paid_out,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    delivery_not_done: DC.delivery_not_done,
    feature_disabled: DC.feature_disabled,
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
  },
  helpr_task_customer_confirm: {
    account_restricted: DC.account_restricted,
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
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
  },
  helpr_task_delivered: {
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
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
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
    problem_open: DC.problem_open,
    refund_amount_unknown: DC.refund_amount_unknown,
    task_not_active: DC.task_not_active,
    task_not_found: DC.task_not_found,
    unknown_task_source: DC.unknown_task_source,
  },
  helpr_task_pickup_no_show: {
    account_restricted: DC.account_restricted,
    location_required: DC.location_required,
    not_at_pickup: DC.not_at_pickup,
    photo_not_uploaded: DC.photo_not_uploaded,
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
    already_picked_up: DC.already_picked_up,
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
