/**
 * Declutter haul-away's plain words (migration 20261017070827;
 * docs/specs/declutter-haul-away.md). Kept OUT of src/lib/lifecycleErrors.ts
 * and src/lib/declutter/errors.ts on purpose: both sit in the signed-in-shared
 * chunk on /posts' critical path (Q178), and this copy is only ever read by
 * the haul-away code, which loads on demand (src/lib/declutter/haulAway.ts,
 * My listings, a haul-away post). Measured 2026-10-17, production vite build:
 * in the shared tables it put /posts at 362 KB gz, here 361 (the Declutter
 * stack alone).
 *
 * EXACT, both ways, like the shared tables:
 *   - src/test/declutterErrorCopy.test.ts reads every code the Declutter
 *     migrations RAISE against DECLUTTER_ERROR_COPY + HAUL_AWAY_ERROR_COPY;
 *   - src/test/rpcErrorCopyCoverage.test.ts reads each haul-away RPC's codes
 *     against RPC_ERROR_COPY + HAUL_AWAY_RPC_ERROR_COPY, and needs each call
 *     site to read its copy through `rpcErrorMessage("<rpc>", e)` (this file's,
 *     the same whole-token match as lifecycleErrors' one, on this table).
 */
import { DECLUTTER_ERROR_COPY as DC, declutterErrorMessage } from "./errors";

/** Server codes only the haul-away RPCs raise. */
export const HAUL_AWAY_ERROR_COPY: Record<string, string> = {
  haul_away_too_many: "One haul-away can take up to 10 items.",
  haul_away_job_not_found: "That job isn't open any more. Post the haul-away again.",
  haul_away_job_taken: "That job is already hauling other items. Post a new one.",
  haul_away_addresses_differ: "These items are at different pickup addresses. Book one haul-away per address.",
  haul_away_already_booked: "A Helpr is already booked to haul this away. To change that, cancel the job first.",
  haul_away_in_sale: "A buyer is getting this item, so it can't be hauled away.",
  haul_away_too_soon: "Give it a little longer. An item can be hauled away 14 days after it went up for sale.",
  haul_away_not_unsold: "Only an item that's for sale or off sale without selling can be hauled away.",
  haul_away_not_found: "There's no haul-away to cancel on this item.",
  haul_away_checkout_open:
    "A checkout for this haul-away is still open. Pay there, or try again in an hour when it runs out.",
  haul_away_job_open: "The unpaid haul-away job is still open. Try again in a moment.",
};

/** App-only codes (never raised by a migration). */
export const HAUL_AWAY_CLIENT_ERROR_COPY: Record<string, string> = {
  // My listings: a never-paid haul-away job its poster can't delete (a declined card).
  haul_away_job_stuck:
    "This haul-away job can't be removed from here because its card payment didn't go through. We've been told and will clear it.",
};

const H = HAUL_AWAY_ERROR_COPY;

/** Each haul-away RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const HAUL_AWAY_RPC_ERROR_COPY = {
  declutter_haul_away_state: {
    feature_disabled: DC.feature_disabled,
    haul_away_too_many: H.haul_away_too_many,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_link_haul_away: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    haul_away_addresses_differ: H.haul_away_addresses_differ,
    haul_away_already_booked: H.haul_away_already_booked,
    haul_away_checkout_open: H.haul_away_checkout_open,
    haul_away_in_sale: H.haul_away_in_sale,
    haul_away_job_not_found: H.haul_away_job_not_found,
    haul_away_job_open: H.haul_away_job_open,
    haul_away_job_taken: H.haul_away_job_taken,
    haul_away_not_unsold: H.haul_away_not_unsold,
    haul_away_too_many: H.haul_away_too_many,
    haul_away_too_soon: H.haul_away_too_soon,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_cancel_haul_away: {
    account_restricted: DC.account_restricted,
    feature_disabled: DC.feature_disabled,
    haul_away_already_booked: H.haul_away_already_booked,
    haul_away_checkout_open: H.haul_away_checkout_open,
    haul_away_job_open: H.haul_away_job_open,
    haul_away_not_found: H.haul_away_not_found,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
} satisfies Record<string, Record<string, string>>;

export type HaulAwayRpc = keyof typeof HAUL_AWAY_RPC_ERROR_COPY;

/**
 * Words for an error a haul-away RPC returned, or null when it is not a code
 * we have words for. The code is matched as a whole token (as
 * lifecycleErrors' rpcErrorMessage does).
 */
export function rpcErrorMessage(rpc: HaulAwayRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = HAUL_AWAY_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}

/** Plain words for any error a haul-away step threw: its own words first, then the Declutter ones. */
export function haulAwayErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; userMessage?: unknown } | null;
  if (typeof e?.userMessage === "string" && e.userMessage) return e.userMessage;
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  if (message && Object.prototype.hasOwnProperty.call(HAUL_AWAY_ERROR_COPY, message)) return HAUL_AWAY_ERROR_COPY[message];
  if (message && Object.prototype.hasOwnProperty.call(HAUL_AWAY_CLIENT_ERROR_COPY, message)) return HAUL_AWAY_CLIENT_ERROR_COPY[message];
  return declutterErrorMessage(err);
}
