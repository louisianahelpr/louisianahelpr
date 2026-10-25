/**
 * Scanner-safe email confirmation links (lead, 2026-10-25).
 *
 * The old link was GoTrue's own GET /auth/v1/verify?token=..., which spends the
 * one-time token on the FIRST request. Microsoft and Google link scanners fetch
 * every link in a new email before the person sees it, so the person's own tap
 * found "One-time token not found" (prod auth logs 2026-10-20..25: 30 of those
 * and 13 "email link has expired", against 107 successes; 53 of 164 email
 * sign-ups since 10-15 never confirmed).
 *
 * The new link opens the app's own "Check your email" page with the token as
 * data: /signup-pending?token_hash=<hash>&type=signup. A GET only renders the
 * page; the token is spent by the person's tap on "Confirm my email", which
 * POSTs it (supabase.auth.verifyOtp). A scanner never taps.
 *
 * Zero imports on purpose: the auth email hook (Deno) and the app (Vite) both
 * load it, and a vitest reads it directly. Guard:
 * src/test/scannerSafeConfirmLinks.test.ts.
 */

/** The hidden switch (public.feature_switches.key) the new link ships behind. */
export const SCANNER_SAFE_CONFIRM_SWITCH = "scanner_safe_confirm_links";

/** Where the link opens: the page every unconfirmed account already lands on. */
export const CONFIRM_LINK_PATH = "/signup-pending";

/** The token kinds the page will spend. signup: the first email; magiclink: an admin-minted link. */
const CONFIRM_LINK_TYPES = ["signup", "magiclink"] as const;
export type ConfirmLinkType = (typeof CONFIRM_LINK_TYPES)[number];

/** The link for an email: the token travels as data and is spent only by a tap. */
export function confirmLinkUrl(appUrl: string, tokenHash: string, type: ConfirmLinkType): string {
  const url = new URL(CONFIRM_LINK_PATH, appUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  return url.toString();
}

/** What the page was opened with. */
export type ConfirmLinkState =
  | { kind: "none" }
  | { kind: "token"; tokenHash: string; type: ConfirmLinkType }
  /** GoTrue sent the person back with an expired or already-used link (the old GET link). */
  | { kind: "expired" };

/**
 * Read the page's own URL. `search` and `hash` as location gives them
 * ("?a=b", "#c=d"). GoTrue reports a failed verify in BOTH the query and the
 * fragment (error=access_denied, error_code=otp_expired).
 */
export function readConfirmLink(search: string, hash: string): ConfirmLinkState {
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const tokenHash = q.get("token_hash")?.trim() ?? "";
  const type = q.get("type") ?? "";
  if (tokenHash && /^[A-Za-z0-9_-]{8,200}$/.test(tokenHash) && (CONFIRM_LINK_TYPES as readonly string[]).includes(type)) {
    return { kind: "token", tokenHash, type: type as ConfirmLinkType };
  }
  const code = q.get("error_code") ?? h.get("error_code") ?? "";
  const err = q.get("error") ?? h.get("error") ?? "";
  if (code === "otp_expired" || code === "otp_disabled" || err === "access_denied") return { kind: "expired" };
  return { kind: "none" };
}

/** True when verifyOtp refused the token because it was spent or ran out (not a network fault). */
export function isSpentOrExpired(error: { code?: string; message?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "otp_expired" || error.code === "flow_state_expired") return true;
  const m = (error.message ?? "").toLowerCase();
  return /expired|invalid|not found|already been used/.test(m) || error.status === 403;
}
