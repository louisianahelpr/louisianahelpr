// oauthRedirectError — the outcome of a web Apple/Google sign-in that FAILED
// at the auth server, which the app used to throw away (OA-018).
//
// THE DEAD END. On the web, "Continue with Google/Apple" leaves the page
// (supabase.auth.signInWithOAuth). When GoTrue refuses the sign-in it does not
// come back with a session; it redirects to `redirectTo` (/home) with the
// reason in BOTH the query and the fragment:
//
//   /home?error=access_denied&error_code=provider_email_needs_verification
//        &error_description=Unverified+email+with+google...#error=...&sb=
//
// (supabase/auth internal/api/external.go `redirectErrors` +
// `getErrorQueryString`). Nothing in src/ read those params. /home is
// protected, so ProtectedRoute bounced the signed-out visitor to
// /login?redirect=%2Fhome%3Ferror%3D... and Login showed "That page needs an
// account. Log in and we'll take you straight back to it." — wrong reason,
// and the real one (verify your Google email; more than one account uses this
// address; this account is banned) was never shown. Measured 2026-09-25 by
// loading that URL on the local build: screenshot evidence in the OA-018 note.
//
// The identity-linking cases OA-018 asked about all end here on the web when
// they fail: GoTrue links a provider identity to an existing account only by a
// VERIFIED email, and an unverified provider email or two accounts with the
// same address come back as exactly these redirects.
//
// HOW. `captureOAuthRedirectError()` runs once at boot (imported second in
// main.tsx, before the Supabase client module evaluates), and ONLY when this
// tab started a web OAuth sign-in (`markOAuthPending`, written by socialAuth
// just before it leaves). That scoping matters: /reset-password reads its own
// `error_description` from the URL (an expired recovery link), and must keep
// it. When it fires it holds the error in memory for Login, and strips the error
// params from the URL so ProtectedRoute's `?redirect=` carries a clean path.
//
// Native sign-in never redirects; its errors arrive as AuthApiError.code and
// go through the same `socialAuthErrorCopy` (socialAuth.ts).

export type OAuthProvider = "apple" | "google";

export type OAuthRedirectError = {
  provider: OAuthProvider;
  /** GoTrue `error_code`, or the OAuth `error` when no code was sent. */
  code: string;
  /** Copy for the Login notice. */
  message: string;
};

const PENDING_KEY = "helpr_oauth_pending";
// A round trip through the provider's consent screen is seconds to a couple of
// minutes. Anything older is an abandoned attempt, not this redirect.
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const ERROR_PARAMS = ["error", "error_code", "error_description"] as const;

function label(provider: OAuthProvider): string {
  return provider === "apple" ? "Apple" : "Google";
}

/**
 * Every GoTrue `error_code` the social sign-in path can end in, taken from
 * supabase/auth `createAccountFromExternalIdentity` (external.go), the id-token
 * grant (token_oidc.go) and the callback/state handling. The class guard
 * (src/test/socialAuthOutcomes.test.ts) holds each one to specific copy.
 */
export const SOCIAL_AUTH_ERROR_CODES = [
  "provider_email_needs_verification",
  "user_banned",
  "signup_disabled",
  "provider_disabled",
  "oauth_provider_not_supported",
  "bad_oauth_state",
  "bad_oauth_callback",
  "flow_state_expired",
  "flow_state_not_found",
  "identity_already_exists",
  "multiple_accounts",
] as const;

/**
 * Specific copy for a social sign-in failure, or null when the code is not one
 * we know (the caller keeps its own fallback). Returns "" for a user who
 * backed out at the provider — that is not an error and gets no notice.
 */
export function socialAuthErrorCopy(
  provider: OAuthProvider,
  code: string | null | undefined,
  description?: string | null,
): string | null {
  const p = label(provider);
  const desc = (description ?? "").toLowerCase();
  // GoTrue's MultipleAccounts decision is a 500 with no dedicated code; the
  // description is the only thing that names it.
  const c = desc.includes("multiple accounts with the same email") ? "multiple_accounts" : (code ?? "");
  switch (c) {
    case "provider_email_needs_verification":
      return `${p} says the email on that account isn't verified yet, so we can't match it to a Helpr account. Verify it with ${p}, then try again — or log in with your email and password.`;
    case "user_banned":
      return "This account can't sign in right now. If you think that's a mistake, contact Helpr support from the Help page.";
    case "signup_disabled":
      return "New accounts can't be created right now. If you already have a Helpr account, log in with your email and password.";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return `${p} sign-in isn't available right now. Log in with your email and password instead.`;
    case "bad_oauth_state":
    case "bad_oauth_callback":
    case "flow_state_expired":
    case "flow_state_not_found":
      return `${p} sign-in took too long or was interrupted. Give it another try.`;
    case "identity_already_exists":
      return `That ${p} account is already connected to a different Helpr account. Sign out and continue with ${p} to use that one.`;
    case "multiple_accounts":
      return "More than one Helpr account uses this email, so we couldn't tell which one is yours. Contact Helpr support from the Help page and we'll sort it out.";
    case "access_denied":
      // The OAuth `error` with no GoTrue code: the person declined on the
      // provider's own screen. Same as a native cancel — nothing to say.
      return "";
    default:
      return null;
  }
}

/**
 * Called by socialAuth right before the web OAuth redirect leaves the page.
 * `path` is the pathname of `redirectTo`: GoTrue returns there, and only there
 * is an error in the URL this attempt's (lh-authz-rls review of #1806: a
 * marker scoped by time alone captured an expired /reset-password link's
 * error in the same tab).
 */
export function markOAuthPending(provider: OAuthProvider, path: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider, path, at: Date.now() }));
  } catch {
    // Silent by design: storage blocked (private mode, site data off). The
    // sign-in still proceeds; only the failure explanation is lost, and the
    // URL is then left for the page to render as it always did.
  }
}

function readPending(): { provider: OAuthProvider; path: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { provider?: unknown; path?: unknown; at?: unknown };
    if ((v.provider !== "apple" && v.provider !== "google") || typeof v.at !== "number") return null;
    if (typeof v.path !== "string" || !v.path.startsWith("/")) return null;
    return { provider: v.provider, path: v.path, at: v.at };
  } catch {
    // Silent by design: an unreadable or corrupt marker means "no web OAuth
    // attempt we can vouch for", which is the safe answer — capture skips.
    return null;
  }
}

/** Called by socialAuth when the redirect never left (signInWithOAuth failed). */
export function clearOAuthPending(): void {
  clearPending();
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Silent by design: the marker also expires by age (PENDING_MAX_AGE_MS).
  }
}

let captured: OAuthRedirectError | null = null;
let capturedAt = 0;
// The /home -> /login bounce happens within a second or two of boot. A
// captured reason older than this is not that bounce: it must not surface on
// a later, unrelated Login visit in the same page load (a signed-in user whose
// refused attempt landed on /home, then signed out).
const CAPTURED_MAX_AGE_MS = 60 * 1000;

/**
 * Boot-time capture. Returns what it captured (for tests); the page reads it
 * through `takeOAuthRedirectError`.
 */
export function captureOAuthRedirectError(loc: Location = window.location, hist: History = window.history): OAuthRedirectError | null {
  const query = new URLSearchParams(loc.search);
  const hash = new URLSearchParams(loc.hash.startsWith("#") ? loc.hash.slice(1) : loc.hash);
  const get = (k: string) => query.get(k) ?? hash.get(k);
  const hasError = ERROR_PARAMS.some((k) => get(k) !== null);

  const pending = readPending();
  if (!pending) return null;
  // Not where this attempt returns to: someone else's error (an email link's,
  // /reset-password's). Leave the URL and the marker alone.
  if (loc.pathname !== pending.path) return null;
  if (!hasError) {
    // A successful return carries the session in the fragment: the attempt is
    // over. Anything else (the user came back with the browser Back button)
    // leaves the marker to expire by age.
    if (hash.has("access_token")) clearPending();
    return null;
  }
  clearPending();
  if (Date.now() - pending.at > PENDING_MAX_AGE_MS) return null;

  const code = get("error_code") || get("error") || "unspecified";
  const description = get("error_description");
  const copy = socialAuthErrorCopy(pending.provider, code, description);
  const message = copy ?? `${label(pending.provider)} sign-in didn't work — give it another try?`;

  // Strip the error params (and GoTrue's `sb` marker) so ProtectedRoute's
  // ?redirect= and anything else reading the URL sees a clean path.
  for (const k of [...ERROR_PARAMS, "sb"]) {
    query.delete(k);
    hash.delete(k);
  }
  const q = query.toString();
  const h = hash.toString();
  try {
    hist.replaceState(hist.state, "", `${loc.pathname}${q ? `?${q}` : ""}${h ? `#${h}` : ""}`);
  } catch {
    // Silent by design: a refused replaceState leaves the params in the URL;
    // the notice below still renders, which is the part that matters.
  }

  if (message === "") return null; // declined at the provider — no notice
  // Held in memory only. The /home -> /login bounce is a client-side route
  // change in the same page load, so nothing needs to survive a reload, and
  // an auth error from the URL is not persisted to storage (CodeQL
  // js/clear-text-storage-of-sensitive-data on the first version of this).
  captured = { provider: pending.provider, code, message };
  capturedAt = Date.now();
  return captured;
}

/** Read-and-clear, for the Login notice. */
export function takeOAuthRedirectError(): OAuthRedirectError | null {
  const out = captured;
  captured = null;
  if (out && Date.now() - capturedAt > CAPTURED_MAX_AGE_MS) return null;
  return out;
}

// Boot side effect: main.tsx imports this module for exactly this call.
if (typeof window !== "undefined" && typeof window.location !== "undefined") {
  captureOAuthRedirectError();
}
