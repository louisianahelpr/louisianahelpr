/**
 * Declutter seller delivery's plain words (migration 20261021181258; switch
 * declutter_seller_delivery). Kept OUT of src/lib/lifecycleErrors.ts and
 * src/lib/declutter/errors.ts, as haul-away's are (Q178: both sit in the
 * signed-in-shared chunk on /posts' critical path); this copy is read only by
 * the seller-delivery code, which loads with the Declutter screens.
 *
 * EXACT, both ways, like the shared tables:
 *   - src/test/declutterErrorCopy.test.ts reads every code the Declutter
 *     migrations RAISE against DECLUTTER_ERROR_COPY + HAUL_AWAY_ERROR_COPY +
 *     SELLER_DELIVERY_ERROR_COPY;
 *   - src/test/rpcErrorCopyCoverage.test.ts reads each seller-delivery RPC's
 *     codes against SELLER_DELIVERY_RPC_ERROR_COPY, and needs each call site
 *     to read its copy through this file's `rpcErrorMessage("<rpc>", e)`.
 */
import { DECLUTTER_ERROR_COPY as DC, declutterErrorMessage } from "./errors";

/** Server codes only the seller-delivery RPCs raise. */
export const SELLER_DELIVERY_ERROR_COPY: Record<string, string> = {
  invalid_delivery_setting: "Choose whether you deliver, then save.",
  invalid_delivery_rate: "Pick a whole-dollar delivery rate from $5 to $150.",
  invalid_delivery_distance: "Pick one of the distances shown.",
  invalid_delivery_windows: "Each delivery time needs a day, and a start at least an hour before its end, with no repeats.",
  invalid_days_off: "Pick up to 60 days off within the next year.",
  delivery_out_of_range: "This seller doesn't deliver that far. Choose pickup or another delivery.",
  seller_delivery_unavailable: "This seller can't deliver these items. Choose another way to get them.",
  slot_unavailable: "That delivery time was just taken or is no longer open. Pick another time.",
  not_a_seller_delivery: "This sale isn't a delivery by the seller.",
  before_delivery_time: "You can mark it delivered from the booked delivery time.",
  seller_delivered: "The seller marked it delivered with a photo. If something is wrong, report a problem.",
  not_reschedulable: "This delivery can't be moved now.",
  no_proposal: "There's no new time waiting for an answer.",
};

/** Delivery words for codes the shared table words for pickups. */
const D = {
  not_booked_yet: "The delivery time isn't booked yet.",
  too_early: "You can say it wasn't delivered 15 minutes after the delivery time ends.",
  wrong_side_delivered: "Only the seller marks it delivered.",
  wrong_side_not_delivered: "Only the buyer can say it wasn't delivered.",
  wrong_side_cancel: "Only the seller can cancel the delivery.",
  wrong_side_accept: "The other side accepts the time you asked for.",
  reschedule_used: "You can't ask for another new time on this order.",
};
const S = SELLER_DELIVERY_ERROR_COPY;

/** Each seller-delivery RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const SELLER_DELIVERY_RPC_ERROR_COPY = {
  declutter_my_seller_delivery: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_seller_delivery: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_delivery_distance: S.invalid_delivery_distance,
    invalid_delivery_rate: S.invalid_delivery_rate,
    invalid_delivery_setting: S.invalid_delivery_setting,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_delivery_schedule: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_days_off: S.invalid_days_off,
    invalid_delivery_windows: S.invalid_delivery_windows,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_set_item_seller_delivery: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_seller_delivery_offer: {
    account_restricted: DC.account_restricted,
    cart_empty: DC.cart_empty,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_seller_delivery_booking: {
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_seller_delivered: {
    account_restricted: DC.account_restricted,
    before_delivery_time: S.before_delivery_time,
    item_not_found: DC.item_not_found,
    not_a_seller_delivery: S.not_a_seller_delivery,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: D.not_booked_yet,
    photo_not_uploaded: DC.photo_not_uploaded,
    wrong_side: D.wrong_side_delivered,
  },
  declutter_report_not_delivered: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_a_seller_delivery: S.not_a_seller_delivery,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: D.not_booked_yet,
    problem_open: DC.problem_open,
    seller_delivered: S.seller_delivered,
    too_early: D.too_early,
    wrong_side: D.wrong_side_not_delivered,
  },
  declutter_seller_cancel_delivery: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_a_seller_delivery: S.not_a_seller_delivery,
    not_authenticated: DC.not_authenticated,
    problem_open: DC.problem_open,
    seller_delivered: "You already marked it delivered. Report a problem instead.",
    wrong_side: D.wrong_side_cancel,
  },
  declutter_propose_delivery_time: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_a_seller_delivery: S.not_a_seller_delivery,
    not_authenticated: DC.not_authenticated,
    not_reschedulable: S.not_reschedulable,
    problem_open: DC.problem_open,
    reschedule_used: D.reschedule_used,
    slot_unavailable: S.slot_unavailable,
  },
  declutter_answer_delivery_time: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    no_proposal: S.no_proposal,
    not_a_seller_delivery: S.not_a_seller_delivery,
    not_authenticated: DC.not_authenticated,
    wrong_side: D.wrong_side_accept,
  },
} satisfies Record<string, Record<string, string>>;

export type SellerDeliveryRpc = keyof typeof SELLER_DELIVERY_RPC_ERROR_COPY;

/**
 * Words for an error a seller-delivery RPC returned, or null when it is not a
 * code we have words for (matched as a whole token, as lifecycleErrors does).
 */
export function rpcErrorMessage(rpc: SellerDeliveryRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = SELLER_DELIVERY_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

/** Plain words for any error a seller-delivery step threw: its own words first, then the Declutter ones. */
export function sellerDeliveryErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; userMessage?: unknown } | null;
  if (typeof e?.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(SELLER_DELIVERY_ERROR_COPY, message)) return SELLER_DELIVERY_ERROR_COPY[message];
  return declutterErrorMessage(err);
}
