/**
 * Declutter donate-what-doesn't-sell's plain words (Q2428, migration 20261027222743). Kept apart from the shared
 * Declutter tables like haul-away's (the /posts critical path, Q178): only the haul-away card and Post a Job's
 * donation prefill read it, both loaded on demand.
 *
 * EXACT, both ways: src/test/declutterErrorCopy.test.ts reads every code the Declutter migrations RAISE against
 * the Declutter tables including DONATE_ERROR_COPY; src/test/rpcErrorCopyCoverage.test.ts reads each donate RPC's
 * codes against DONATE_RPC_ERROR_COPY, and needs each call site to read its copy through
 * `rpcErrorMessage("<rpc>", e)` (this file's).
 */
import { DECLUTTER_ERROR_COPY as DC } from "./errors";
import { HAUL_AWAY_ERROR_COPY as H } from "./haulAwayErrors";

/** Server codes only the donate RPCs raise. */
export const DONATE_ERROR_COPY: Record<string, string> = {
  donation_partner_unavailable: "That charity isn't taking items near you right now. Pick another one.",
  donation_locked: "A haul-away job is already posted for this item, with its charity. To change the charity, take the job back first.",
  donation_already_done: "This item was already donated.",
  // Admin -> Settings: partner charities.
  donation_partner_invalid: "Fill in the parish, name and address, and put the map point in Louisiana.",
  donation_partner_not_found: "That partner no longer exists. Refresh the list.",
  admin_only: "Only an admin can add or edit partner charities.",
};
const D = DONATE_ERROR_COPY;

/** Each donate RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const DONATE_RPC_ERROR_COPY = {
  declutter_donation_partners_near: {
    feature_disabled: DC.feature_disabled,
    haul_away_too_many: H.haul_away_too_many,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_choose_donation: {
    account_restricted: DC.account_restricted,
    donation_already_done: D.donation_already_done,
    donation_locked: D.donation_locked,
    donation_partner_unavailable: D.donation_partner_unavailable,
    feature_disabled: DC.feature_disabled,
    haul_away_not_unsold: H.haul_away_not_unsold,
    haul_away_too_many: H.haul_away_too_many,
    item_not_found: DC.item_not_found,
    not_authenticated: DC.not_authenticated,
  },
  declutter_my_donations: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
} satisfies Record<string, Record<string, string>>;

export type DonateRpc = keyof typeof DONATE_RPC_ERROR_COPY;

/** Words for an error a donate RPC returned, or null (the code matched as a whole token). */
export function rpcErrorMessage(rpc: DonateRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = DONATE_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
