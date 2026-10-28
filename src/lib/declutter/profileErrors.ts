/**
 * The profile's Declutter reads' plain words (deep audit 2026-10-28 #61; migration 20261028202132). Kept OUT of
 * src/lib/lifecycleErrors.ts like the other Declutter add-ons (Q178); read only by src/lib/declutter/profile.ts.
 *
 * EXACT, both ways: src/test/rpcErrorCopyCoverage.test.ts (each RPC's codes, read at the call site through this
 * file's `rpcErrorMessage("<rpc>", e)`).
 */
import { DECLUTTER_ERROR_COPY as DC } from "./errors";

/** Each profile RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const PROFILE_RPC_ERROR_COPY = {
  declutter_seller_sold_count: {
    feature_disabled: DC.feature_disabled,
    not_authenticated: DC.not_authenticated,
  },
} satisfies Record<string, Record<string, string>>;

type ProfileRpc = keyof typeof PROFILE_RPC_ERROR_COPY;

/** Words for an error a profile RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: ProfileRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = PROFILE_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
