/**
 * Words for every refusal the Homes message RPCs (20261106182837_homes_talk) can raise, per RPC. Like
 * src/lib/shops/rpcErrorCopy.ts, they live here and not in RPC_ERROR_COPY (src/lib/lifecycleErrors.ts): that table
 * is in the bundle every signed-in page loads, and only the Homes screens and the Messages Homes chip call these RPCs.
 *
 * src/test/rpcErrorCopyCoverage.test.ts reads this table: every code each rentals_*talk* RPC can raise has a line
 * here (or an UNREACHABLE reason there), each call site reads it through rpcErrorMessage, and no line names a code
 * the RPC no longer raises. src/test/homesTalkClient.test.tsx keeps HOME_TALK_ERROR_COPY exact against the migration.
 */
import { RENTALS_ERROR_COPY as RC } from "./errorCopy";

/** The Homes-message codes RENTALS_ERROR_COPY does not have, or words it has for another screen (own_listing). */
export const HOME_TALK_ERROR_COPY: Record<string, string> = {
  invalid_message: "Write a message of up to 1,000 characters.",
  message_rate_limited: "You've sent a lot of messages this hour. Try again later.",
  // RENTALS_ERROR_COPY's own_listing is the Save button's ("nothing to save").
  own_listing: "This is your own listing. Members who message you show up under Messages.",
  talk_blocked: "You can't message this person.",
  talk_closed: "This chat is closed. You can still read it.",
  talk_not_found: "This chat isn't available.",
};
const TC = HOME_TALK_ERROR_COPY;

export const HOME_TALK_RPC_ERROR_COPY = {
  rentals_open_talk: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    listing_not_found: RC.listing_not_found,
    not_authenticated: RC.not_authenticated,
    own_listing: TC.own_listing,
    talk_blocked: TC.talk_blocked,
  },
  rentals_talk_view: {
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
    talk_not_found: TC.talk_not_found,
  },
  rentals_send_talk_message: {
    account_restricted: RC.account_restricted,
    feature_disabled: RC.feature_disabled,
    invalid_message: TC.invalid_message,
    message_rate_limited: TC.message_rate_limited,
    not_authenticated: RC.not_authenticated,
    talk_blocked: TC.talk_blocked,
    talk_closed: TC.talk_closed,
    talk_not_found: TC.talk_not_found,
  },
  rentals_my_talks: {
    feature_disabled: RC.feature_disabled,
    not_authenticated: RC.not_authenticated,
  },
} as const satisfies Record<string, Record<string, string>>;

type HomeTalkRpc = keyof typeof HOME_TALK_RPC_ERROR_COPY;

/** The words for the code `error` names, for that RPC; null when it names none of them. */
export function rpcErrorMessage(rpc: HomeTalkRpc, error: unknown): string | null {
  const msg = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message).trim() : "";
  const codes: Record<string, string> = HOME_TALK_RPC_ERROR_COPY[rpc];
  return Object.prototype.hasOwnProperty.call(codes, msg) ? codes[msg] : null;
}
