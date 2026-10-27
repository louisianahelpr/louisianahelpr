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
  declutter_bundle_preview: {
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
