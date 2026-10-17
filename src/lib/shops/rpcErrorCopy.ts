/**
 * Words for every refusal the shops_* RPCs (Shops slices 1 and 2,
 * 20261017061155 and 20261017061157) can raise. They live here, not in
 * RPC_ERROR_COPY (src/lib/lifecycleErrors.ts), because that table is in the
 * bundle every signed-in page loads, and only the Shops screens call these
 * RPCs: keeping them out holds /posts inside its critical-path budget
 * (2026-10-17), as src/lib/helprTasks/errorCopy.ts does for the Helpr tasks.
 *
 * The words themselves are SHOPS_ERROR_COPY's (src/lib/shops/errors.ts),
 * exact against the migrations. src/test/rpcErrorCopyCoverage.test.ts checks
 * this table with RPC_ERROR_COPY: every code each shops_* RPC can raise has a
 * line here, and no line names a code it no longer raises.
 */
import { SHOPS_ERROR_COPY as SC } from "./errors";

export const SHOPS_RPC_ERROR_COPY = {
  shops_add_item_photo: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    photo_already_attached: SC.photo_already_attached,
    photo_not_uploaded: SC.photo_not_uploaded,
    shop_hidden: SC.shop_hidden,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    too_many_photos: SC.too_many_photos,
    under_18: SC.under_18,
  },
  shops_admin_pending_items: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    not_admin: SC.not_admin,
  },
  shops_admin_review_item: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_decision: SC.invalid_decision,
    item_changed: SC.item_changed,
    item_not_pending: SC.item_not_pending,
    not_admin: SC.not_admin,
    own_item: SC.own_item,
    owner_not_eligible: SC.owner_not_eligible,
    review_note_required: SC.review_note_required,
    review_note_too_long: SC.review_note_too_long,
  },
  shops_attest_item: {
    account_restricted: SC.account_restricted,
    attestation_incomplete: SC.attestation_incomplete,
    feature_disabled: SC.feature_disabled,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_hidden: SC.shop_hidden,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_confirm_cottage_year: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_not_found: SC.shop_not_found,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_create_item: {
    account_restricted: SC.account_restricted,
    description_too_long: SC.description_too_long,
    feature_disabled: SC.feature_disabled,
    invalid_kind: SC.invalid_kind,
    invalid_lead_time: SC.invalid_lead_time,
    invalid_price: SC.invalid_price,
    invalid_stock: SC.invalid_stock,
    invalid_subtype: SC.invalid_subtype,
    invalid_title: SC.invalid_title,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    rental_not_available: SC.rental_not_available,
    shop_hidden: SC.shop_hidden,
    shop_not_found: SC.shop_not_found,
    shop_not_selling: SC.shop_not_selling,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    too_many_items: SC.too_many_items,
    under_18: SC.under_18,
  },
  shops_my_cottage_status: {
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
  },
  shops_my_item_review: {
    feature_disabled: SC.feature_disabled,
    item_not_found: SC.item_not_found,
  },
  shops_publish_item: {
    account_restricted: SC.account_restricted,
    attestation_required: SC.attestation_required,
    cottage_cap_reached: SC.cottage_cap_reached,
    cottage_confirmation_required: SC.cottage_confirmation_required,
    feature_disabled: SC.feature_disabled,
    item_not_a_draft: SC.item_not_a_draft,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    order_days_required: SC.order_days_required,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    photos_required: SC.photos_required,
    rental_not_available: SC.rental_not_available,
    shop_hidden: SC.shop_hidden,
    shop_not_selling: SC.shop_not_selling,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_remove_item_photo: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    photo_not_found: SC.photo_not_found,
    shop_hidden: SC.shop_hidden,
  },
  shops_set_daily_order_cap: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_daily_cap: SC.invalid_daily_cap,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_not_found: SC.shop_not_found,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_set_item_stock: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_lead_time: SC.invalid_lead_time,
    invalid_stock: SC.invalid_stock,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_hidden: SC.shop_hidden,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_shop_items: {
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
    shop_not_found: SC.shop_not_found,
  },
  shops_update_item: {
    account_restricted: SC.account_restricted,
    description_too_long: SC.description_too_long,
    feature_disabled: SC.feature_disabled,
    invalid_kind: SC.invalid_kind,
    invalid_lead_time: SC.invalid_lead_time,
    invalid_price: SC.invalid_price,
    invalid_stock: SC.invalid_stock,
    invalid_subtype: SC.invalid_subtype,
    invalid_title: SC.invalid_title,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    rental_not_available: SC.rental_not_available,
    shop_hidden: SC.shop_hidden,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_withdraw_item: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    item_not_editable: SC.item_not_editable,
    item_not_found: SC.item_not_found,
    not_authenticated: SC.not_authenticated,
  },
  shops_attach_photo: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_photo_kind: SC.invalid_photo_kind,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    photo_already_attached: SC.photo_already_attached,
    photo_not_uploaded: SC.photo_not_uploaded,
    shop_not_found: SC.shop_not_found,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    too_many_photos: SC.too_many_photos,
    under_18: SC.under_18,
  },
  shops_browse: {
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
  },
  shops_close_my_shop: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
    shop_hidden: SC.shop_hidden,
    shop_not_found: SC.shop_not_found,
  },
  shops_get_shop: {
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
    shop_not_found: SC.shop_not_found,
  },
  shops_my_shop_id: {
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
  },
  shops_remove_photo: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    not_authenticated: SC.not_authenticated,
    photo_not_found: SC.photo_not_found,
  },
  shops_save_my_shop: {
    about_too_long: SC.about_too_long,
    account_restricted: SC.account_restricted,
    area_looks_like_address: SC.area_looks_like_address,
    feature_disabled: SC.feature_disabled,
    invalid_area: SC.invalid_area,
    invalid_category: SC.invalid_category,
    invalid_location: SC.invalid_location,
    invalid_name: SC.invalid_name,
    invalid_parishes: SC.invalid_parishes,
    invalid_sos_number: SC.invalid_sos_number,
    not_authenticated: SC.not_authenticated,
    offers_required: SC.offers_required,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_set_follow: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_follow: SC.invalid_follow,
    not_authenticated: SC.not_authenticated,
    own_shop: SC.own_shop,
    shop_not_found: SC.shop_not_found,
  },
  shops_set_hours: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_hours: SC.invalid_hours,
    not_authenticated: SC.not_authenticated,
    payout_setup_incomplete: SC.payout_setup_incomplete,
    shop_not_found: SC.shop_not_found,
    shop_strikes_blocked: SC.shop_strikes_blocked,
    under_18: SC.under_18,
  },
  shops_set_paused: {
    account_restricted: SC.account_restricted,
    feature_disabled: SC.feature_disabled,
    invalid_paused: SC.invalid_paused,
    not_authenticated: SC.not_authenticated,
    shop_not_found: SC.shop_not_found,
  },
} as const;

export type ShopsRpc = keyof typeof SHOPS_RPC_ERROR_COPY;

/**
 * The shops_* twin of lifecycleErrors' rpcErrorMessage, with the same name so
 * the coverage check's call-site rule (every .rpc("shops_x") reads its copy
 * through rpcErrorMessage) holds unchanged: the first code of the RPC's table
 * that appears as a whole word in the error message, mapped to its words.
 */
export function rpcErrorMessage(rpc: ShopsRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table = SHOPS_RPC_ERROR_COPY[rpc] as Record<string, string>;
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
