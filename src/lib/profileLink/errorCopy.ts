/**
 * The shareable profile link's plain words (LEAD-PROFILE-LINK, owner 2026-10-31; migration
 * 20261101034834_profile_handle). Kept OUT of src/lib/lifecycleErrors.ts like the other add-ons (Q178):
 * read only by src/lib/profileLink/api.ts, which only Settings and the Share my profile button load.
 *
 * EXACT, both ways: src/test/rpcErrorCopyCoverage.test.ts (each RPC's codes, read at the call site through
 * this file's `rpcErrorMessage("<rpc>", e)`).
 */
const SIGN_IN = "Sign in again to see your profile link.";
const NO_PROFILE = "We couldn't find your profile. Sign out and back in, then try again.";

/** Each profile-link RPC's codes and their words (the rpcErrorCopyCoverage rule). */
export const PROFILE_LINK_RPC_ERROR_COPY = {
  rpc_ensure_my_handle: {
    not_authenticated: SIGN_IN,
    profile_not_found: NO_PROFILE,
    handle_unavailable: "We couldn't make your profile link just now. Try again in a moment.",
  },
  rpc_set_my_handle: {
    not_authenticated: SIGN_IN,
    profile_not_found: NO_PROFILE,
    handle_invalid: "Use 3 to 30 letters, numbers or single hyphens.",
    handle_reserved: "That link is reserved. Try another.",
    handle_has_contact: "Leave phone numbers out of your link.",
    handle_taken: "Someone already has that link. Try another.",
    handle_already_changed: "You can change your profile link once, and you already have.",
  },
} satisfies Record<string, Record<string, string>>;

type ProfileLinkRpc = keyof typeof PROFILE_LINK_RPC_ERROR_COPY;

/** Words for an error a profile-link RPC returned, or null when it is not a code we have words for (whole-token match). */
export function rpcErrorMessage(rpc: ProfileLinkRpc, error: unknown): string | null {
  const m = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  const raw = typeof m === "string" ? m : "";
  if (!raw) return null;
  const table: Record<string, string> = PROFILE_LINK_RPC_ERROR_COPY[rpc];
  for (const code of Object.keys(table).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z0-9_])${code}($|[^a-z0-9_])`).test(raw)) return table[code];
  }
  return null;
}
