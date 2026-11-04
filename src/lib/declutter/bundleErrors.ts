/**
 * Declutter bundle discounts' plain words (Q2427, migration 20261027211754). Kept OUT of src/lib/lifecycleErrors.ts
 * and src/lib/declutter/errors.ts like the other Declutter add-ons (Q178); read only by the bundle code.
 *
 * EXACT, both ways: src/test/declutterErrorCopy.test.ts (every code the Declutter migrations raise) and
 * src/test/rpcErrorCopyCoverage.test.ts (each bundle RPC's codes, read at the call site through this file's
 * `rpcErrorMessage("<rpc>", e)`).
 */
import { DECLUTTER_ERROR_COPY as DC, declutterErrorMessage } from "./errors";

/** Server codes only the bundle RPCs raise. */
export const BUNDLE_ERROR_COPY: Record<string, string> = {
  invalid_bundle_percent: "Pick from 5% to 50% off.",
  invalid_request: "Ask about at most 200 items at a time.",
  // Q2268 bundle requests (20261104103528).
  bundle_size: "Pick 2 to 20 items from one seller.",
  bundle_one_seller: "A bundle request is for one seller's items.",
  bundle_free_item: "Free items are claimed on their own, not in a bundle request.",
  bundle_already_open: "You already asked this seller. Wait for their answer or take it back.",
  bundle_rate_limited: "You can ask one seller 3 times a day. Try again tomorrow.",
  bundle_not_found: "That bundle request isn't available anymore.",
  bundle_not_open: "This bundle request is already closed.",
  bundle_item_not_in_request: "Pick only items from this request.",
};

/** Each bundle RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const BUNDLE_RPC_ERROR_COPY = {
  declutter_set_bundle_discount: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_bundle_percent: BUNDLE_ERROR_COPY.invalid_bundle_percent,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_bundle_rule: {
    feature_disabled: DC.feature_disabled,
  },
  // Deep audit #36 (20261028214524): which listings the seller's bundle discount can apply to.
  declutter_bundle_applies: {
    feature_disabled: DC.feature_disabled,
    invalid_request: BUNDLE_ERROR_COPY.invalid_request,
    not_authenticated: DC.not_authenticated,
  },
  declutter_bundle_preview: {
    not_authenticated: DC.not_authenticated,
  },
  // D-NEW12 (20261030135334): which sellers on a Browse page have a bundle discount ("Bundle deal" chip).
  declutter_bundle_sellers: {
    feature_disabled: DC.feature_disabled,
    invalid_request: "Ask about at most 200 sellers at a time.",
    not_authenticated: DC.not_authenticated,
  },
  // Q2268 (20261104103528): ask one seller for several items; the seller answers Accept all / Pick some / Decline.
  declutter_request_bundle: {
    account_restricted: DC.account_restricted,
    bundle_already_open: BUNDLE_ERROR_COPY.bundle_already_open,
    bundle_free_item: BUNDLE_ERROR_COPY.bundle_free_item,
    bundle_one_seller: BUNDLE_ERROR_COPY.bundle_one_seller,
    bundle_rate_limited: BUNDLE_ERROR_COPY.bundle_rate_limited,
    bundle_size: BUNDLE_ERROR_COPY.bundle_size,
    card_required: DC.card_required,
    own_item: DC.own_item,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    // The first-purchase ID check (review 11-04); rpcData opens the one ID sheet for it.
    identity_required_to_buy: DC.identity_required_to_buy,
    // The gate's other branch; never taken here (the ask passes 'identity_required_to_buy'), read for completeness.
    identity_required_to_list: DC.identity_required_to_list,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_answer_bundle: {
    account_restricted: DC.account_restricted,
    bundle_item_not_in_request: BUNDLE_ERROR_COPY.bundle_item_not_in_request,
    bundle_not_found: BUNDLE_ERROR_COPY.bundle_not_found,
    bundle_not_open: BUNDLE_ERROR_COPY.bundle_not_open,
    // The buyer's checks again at the answer (declutter_lock_buyable_item / declutter_take_item). The SELLER reads
    // these, so a buyer-side refusal is said about the buyer, never "Save a card first".
    card_required: "The buyer has no card saved right now, so this can't go ahead yet. Try again later, or decline.",
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    offer_not_open: DC.offer_not_open,
    own_item: DC.own_item,
    sale_mode_unavailable: DC.sale_mode_unavailable,
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
    other_side_unavailable: DC.other_side_unavailable,
    under_18: DC.under_18,
  },
  declutter_withdraw_bundle: {
    bundle_not_found: BUNDLE_ERROR_COPY.bundle_not_found,
    not_authenticated: DC.not_authenticated,
  },
} satisfies Record<string, Record<string, string>>;

export type BundleRpc = keyof typeof BUNDLE_RPC_ERROR_COPY;

/** Words for an error a bundle RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: BundleRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = BUNDLE_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

/** Plain words for any error a bundle step threw: its own words first, then the Declutter ones. */
export function bundleErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; userMessage?: unknown } | null;
  if (typeof e?.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(BUNDLE_ERROR_COPY, message)) return BUNDLE_ERROR_COPY[message];
  return declutterErrorMessage(err);
}
