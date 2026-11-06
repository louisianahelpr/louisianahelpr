/**
 * Declutter trades' plain words (20261106163703). Kept OUT of src/lib/lifecycleErrors.ts and
 * src/lib/declutter/errors.ts like the other Declutter add-ons (Q178); read only by the trade code.
 *
 * EXACT, both ways: src/test/rpcErrorCopyCoverage.test.ts (each trade RPC's codes, read at the call site through this
 * file's `rpcErrorMessage("<rpc>", e)`).
 */
import { DECLUTTER_ERROR_COPY as DC } from "./errors";

/** Server codes only the trade RPCs raise. */
export const TRADE_ERROR_COPY: Record<string, string> = {
  invalid_trade_rules: "Choose on or off.",
  free_item_no_trades: "Free items are claimed, not traded.",
  invalid_trade: "Pick one of your listings to offer.",
  offered_item_not_yours: "Pick one of your own listings to offer.",
  offered_item_not_available: "The item you offered isn't up for sale right now. Pick another one.",
  trades_off: "This seller isn't taking trades on this item.",
  trade_already_open: "You already offered a trade for this item. Wait for the answer or take it back.",
  offered_item_in_trade: "That item is already offered in another trade. Take that offer back first, or pick another item.",
  trade_rate_limited: "You can offer 10 trades a day. Try again tomorrow.",
  trade_not_found: "That trade offer isn't available anymore.",
  trade_not_open: "This trade offer is already closed.",
  trade_expired: "This trade offer ran out of time.",
};

const MEMBER = {
  account_restricted: DC.account_restricted,
  declutter_strikes_blocked: DC.declutter_strikes_blocked,
  feature_disabled: DC.feature_disabled,
  not_authenticated: DC.not_authenticated,
  under_18: DC.under_18,
};

/** Each trade RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const TRADE_RPC_ERROR_COPY = {
  declutter_set_trade_rules: {
    ...MEMBER,
    free_item_no_trades: TRADE_ERROR_COPY.free_item_no_trades,
    invalid_trade_rules: TRADE_ERROR_COPY.invalid_trade_rules,
    item_not_editable: DC.item_not_editable,
    item_not_found: DC.item_not_found,
  },
  declutter_offer_swap: {
    ...MEMBER,
    free_item_no_trades: TRADE_ERROR_COPY.free_item_no_trades,
    identity_required_to_buy: DC.identity_required_to_buy,
    identity_required_to_list: DC.identity_required_to_list,
    invalid_trade: TRADE_ERROR_COPY.invalid_trade,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    offered_item_in_trade: TRADE_ERROR_COPY.offered_item_in_trade,
    offered_item_not_available: TRADE_ERROR_COPY.offered_item_not_available,
    offered_item_not_yours: TRADE_ERROR_COPY.offered_item_not_yours,
    other_side_unavailable: DC.other_side_unavailable,
    own_item: DC.own_item,
    trade_already_open: TRADE_ERROR_COPY.trade_already_open,
    trade_rate_limited: TRADE_ERROR_COPY.trade_rate_limited,
    trades_off: TRADE_ERROR_COPY.trades_off,
  },
  declutter_respond_swap: {
    ...MEMBER,
    free_item_no_trades: TRADE_ERROR_COPY.free_item_no_trades,
    invalid_action: DC.invalid_action,
    item_not_available: DC.item_not_available,
    item_not_found: DC.item_not_found,
    offered_item_not_available: TRADE_ERROR_COPY.offered_item_not_available,
    offered_item_not_yours: TRADE_ERROR_COPY.offered_item_not_yours,
    other_side_unavailable: DC.other_side_unavailable,
    own_item: DC.own_item,
    trade_expired: TRADE_ERROR_COPY.trade_expired,
    trade_not_found: TRADE_ERROR_COPY.trade_not_found,
    trade_not_open: TRADE_ERROR_COPY.trade_not_open,
    offer_not_open: DC.offer_not_open,
    trades_off: TRADE_ERROR_COPY.trades_off,
  },
} satisfies Record<string, Record<string, string>>;

export type TradeRpc = keyof typeof TRADE_RPC_ERROR_COPY;

/** Words for an error a trade RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: TradeRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = TRADE_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
