/**
 * Declutter safe meetup spots' plain words (Q2425, migration 20261027204500). Kept OUT of src/lib/lifecycleErrors.ts
 * and src/lib/declutter/errors.ts like haul-away's and seller delivery's (Q178: both sit in the signed-in-shared
 * chunk); this copy is read only by the meetup code, which loads with the Declutter screens.
 *
 * EXACT, both ways, like the shared tables:
 *   - src/test/declutterErrorCopy.test.ts reads every code the Declutter migrations RAISE against the shared table +
 *     HAUL_AWAY_ERROR_COPY + SELLER_DELIVERY_ERROR_COPY + MEETUP_ERROR_COPY;
 *   - src/test/rpcErrorCopyCoverage.test.ts reads each meetup RPC's codes against MEETUP_RPC_ERROR_COPY, and needs
 *     each call site to read its copy through this file's `rpcErrorMessage("<rpc>", e)`.
 */
import { DECLUTTER_ERROR_COPY as DC, declutterErrorMessage } from "./errors";

/** Server codes only the meetup RPCs raise. */
export const MEETUP_ERROR_COPY: Record<string, string> = {
  meetup_spot_needed: "Pick a safe meeting spot near the seller.",
  meetup_spot_unavailable: "That spot isn't available for these items. Pick another.",
  not_a_meetup: "This order isn't a meetup that's waiting.",
  too_early_to_check_in: "You can check in from an hour before the meeting time.",
  meetup_spot_invalid: "Fill in the parish, name and address, pick a type, and put the map point in Louisiana.",
  meetup_spot_not_found: "That spot no longer exists. Refresh the list.",
  admin_only: "Only an admin can add or edit meetup spots.",
  // B110 (20261101194608): the seller's own meet spots.
  invalid_meetup_spot: "Give the spot a name and pick its address from the list (a public place in Louisiana).",
  invalid_meetup_times: "Each time needs a day and at least 30 minutes.",
  too_many_meetup_spots: "You can save up to 10 meet spots.",
};
const M = MEETUP_ERROR_COPY;

/** Each meetup RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const MEETUP_RPC_ERROR_COPY = {
  declutter_meetup_spots_near: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
  declutter_set_meetup_spot: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    meetup_spot_unavailable: M.meetup_spot_unavailable,
    not_authenticated: DC.not_authenticated,
    under_18: DC.under_18,
  },
  declutter_meetup_here: {
    account_restricted: DC.account_restricted,
    item_not_found: DC.item_not_found,
    not_a_meetup: M.not_a_meetup,
    not_authenticated: DC.not_authenticated,
    not_booked_yet: "Book a time to meet first.",
    too_early_to_check_in: M.too_early_to_check_in,
  },
  declutter_my_meetup_spots: {
    not_authenticated: DC.not_authenticated,
  },
  declutter_save_my_meetup_spot: {
    account_restricted: DC.account_restricted,
    declutter_strikes_blocked: DC.declutter_strikes_blocked,
    feature_disabled: DC.feature_disabled,
    invalid_meetup_spot: M.invalid_meetup_spot,
    invalid_meetup_times: M.invalid_meetup_times,
    meetup_spot_not_found: M.meetup_spot_not_found,
    not_authenticated: DC.not_authenticated,
    too_many_meetup_spots: M.too_many_meetup_spots,
    under_18: DC.under_18,
  },
  declutter_remove_my_meetup_spot: {
    account_restricted: DC.account_restricted,
    meetup_spot_not_found: M.meetup_spot_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_chosen_meetup_hours: {
    not_authenticated: DC.not_authenticated,
  },
  declutter_meetup_spot_suggestions: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
} satisfies Record<string, Record<string, string>>;

export type MeetupRpc = keyof typeof MEETUP_RPC_ERROR_COPY;

/** Words for an error a meetup RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: MeetupRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = MEETUP_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

/** Plain words for any error a meetup step threw: its own words first, then the Declutter ones. */
export function meetupErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; userMessage?: unknown } | null;
  if (typeof e?.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(MEETUP_ERROR_COPY, message)) return MEETUP_ERROR_COPY[message];
  return declutterErrorMessage(err);
}
