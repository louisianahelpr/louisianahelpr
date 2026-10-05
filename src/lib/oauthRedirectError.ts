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
  /**
   * null when the redirect came back with no pending marker (Q445a): the URL
   * says the sign-in was refused but not which provider was used.
   */
  provider: OAuthProvider | null;
  /** GoTrue `error_code`, or the OAuth `error` when no code was sent. */
  code: string;
  /** Copy for the Login notice. */
  message: string;
  /**
   * Q446: the auth server found no account for this Apple/Google identity and
   * created none (Before User Created hook, migration 20261005182630). The
   * person chooses: an existing account, or a new one.
   */
  choice?: AccountChoiceRef;
};

/** The pending choice the server recorded (public.social_signup_choices). */
export type AccountChoiceRef = { choiceId: string; relay: boolean };

/**
 * The refusal text public.hook_one_account_per_person returns:
 * `lh_account_choice:<uuid>` plus `:relay` for an Apple Hide My Email address.
 * src/test/oneAccountPerPerson.test.ts holds the server and this prefix equal.
 */
const ACCOUNT_CHOICE_PREFIX = "lh_account_choice:";
const ACCOUNT_CHOICE_RE = new RegExp(`${ACCOUNT_CHOICE_PREFIX}([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(:relay)?`, "i");

export function parseAccountChoice(text: string | null | undefined): AccountChoiceRef | null {
  const m = ACCOUNT_CHOICE_RE.exec(text ?? "");
  return m ? { choiceId: m[1].toLowerCase(), relay: Boolean(m[2]) } : null;
}

/** Fallback copy when the choice cannot be shown as a dialog. */
const ACCOUNT_CHOICE_COPY =
  "We couldn't find a Louisiana Helpr account for that sign-in, so we didn't make one. Choose below whether you already have an account or you're new here.";

const PENDING_KEY = "helpr_oauth_pending";
// A round trip through the provider's consent screen is seconds to a couple of
// minutes. Anything older is an abandoned attempt, not this redirect.
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;
const ERROR_PARAMS = ["error", "error_code", "error_description"] as const;

function label(provider: OAuthProvider): string {
  return provider === "apple" ? "Apple" : "Google";
}

/** Sentence fragments for a known provider, or provider-neutral ones (Q445a). */
function words(provider: OAuthProvider | null) {
  if (provider) {
    const p = label(provider);
    return { says: p, withP: p, signIn: `${p} sign-in`, account: `That ${p} account`, continueWith: `continue with ${p}` };
  }
  return {
    says: "Your sign-in provider",
    withP: "your sign-in provider",
    signIn: "That sign-in",
    account: "That sign-in account",
    continueWith: "sign in with it again",
  };
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
  // Q445b: GoTrue's callback rejects a reused PKCE flow state with this code.
  "flow_state_already_used",
  "identity_already_exists",
  "multiple_accounts",
  "manual_linking_disabled",
] as const;

/**
 * A refusal that is the person's own outcome, not a fault anyone should be
 * paged about: they declined, their provider email is unverified, or the
 * account is banned. Everything else (a server_error from a failing trigger,
 * provider_disabled, two accounts on one address, an unknown code) is
 * reported to monitoring by the caller (lh-silent-failure review of #1806:
 * the web path showed copy and told ops nothing).
 */
export function isExpectedSocialRefusal(code: string | null | undefined): boolean {
  // Q446: the no-account choice is a question for the person, not a fault.
  if (code === "account_choice") return true;
  return code === "access_denied" || code === "provider_email_needs_verification" || code === "user_banned";
}

/**
 * Specific copy for a social sign-in failure, or null when the code is not one
 * we know (the caller keeps its own fallback). Returns "" for a user who
 * backed out at the provider — that is not an error and gets no notice.
 */
export function socialAuthErrorCopy(
  provider: OAuthProvider | null,
  code: string | null | undefined,
  description?: string | null,
): string | null {
  const w = words(provider);
  const desc = (description ?? "").toLowerCase();
  // GoTrue's MultipleAccounts decision is a 500 with no dedicated code; the
  // description is the only thing that names it.
  const c = desc.includes("multiple accounts with the same email") ? "multiple_accounts" : (code ?? "");
  switch (c) {
    case "provider_email_needs_verification":
      return `${w.says} says the email on that account isn't verified yet, so we can't match it to a Helpr account. Verify it with ${w.withP}, then try again — or log in with your email and password.`;
    case "user_banned":
      return "This account can't sign in right now. If you think that's a mistake, contact Helpr support from the Help page.";
    case "signup_disabled":
      return "New accounts can't be created right now. If you already have a Helpr account, log in with your email and password.";
    case "provider_disabled":
    case "oauth_provider_not_supported":
      return `${w.signIn} isn't available right now. Log in with your email and password instead.`;
    case "bad_oauth_state":
    case "bad_oauth_callback":
    case "flow_state_expired":
    case "flow_state_not_found":
    case "flow_state_already_used":
      return `${w.signIn} took too long or was interrupted. Give it another try.`;
    case "identity_already_exists":
      return `${w.account} is already connected to a different Helpr account. Sign out and ${w.continueWith} to use that one.`;
    case "manual_linking_disabled":
      return `Connecting ${w.withP} to an existing account isn't switched on yet. Your account is unchanged; try again later.`;
    case "multiple_accounts":
      return "More than one Helpr account uses this email, so we couldn't tell which one is yours. Contact Helpr support from the Help page and we'll sort it out.";
    // The OAuth `error` with no GoTrue code: the person declined on the
    // provider's own screen. Same as a native cancel — nothing to say.
    // Q445c: Apple's web flow can report a cancel as
    // error=user_cancelled_authorize with no GoTrue code. Also a decline.
    case "access_denied":
    case "user_cancelled_authorize":
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
  if (!pending) return captureUnmarked(loc, hist, query, hash, get);
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

  const description = get("error_description");
  // Q446 first: GoTrue sends the hook's refusal as error=access_denied with
  // no error_code, which the generic map below reads as "declined".
  const choice = parseAccountChoice(description);
  if (choice) return hold(loc, hist, query, hash, { provider: pending.provider, code: "account_choice", message: ACCOUNT_CHOICE_COPY, choice });
  const code = get("error_code") || get("error") || "unspecified";
  const copy = socialAuthErrorCopy(pending.provider, code, description);
  const message = copy ?? `${label(pending.provider)} sign-in didn't work — give it another try?`;
  return hold(loc, hist, query, hash, { provider: pending.provider, code, message });
}

/**
 * Q445a: no usable marker (sessionStorage blocked, the attempt older than 15
 * min, or GoTrue sent the error to the Site URL because redirect_to was not
 * allow-listed). Capture only what is unmistakably a GoTrue social refusal:
 * GoTrue's `sb` fragment marker AND an error_code from SOCIAL_AUTH_ERROR_CODES
 * (or the two-accounts description). An expired email link's otp_expired, which
 * /reset-password reads, is not in the list and is left alone.
 */
const UNMARKED_RETURN_PATHS = ["/home", "/"];

function captureUnmarked(
  loc: Location,
  hist: History,
  query: URLSearchParams,
  hash: URLSearchParams,
  get: (k: string) => string | null,
): OAuthRedirectError | null {
  if (!hash.has("sb")) return null;
  // Only where a social round trip lands: socialAuth's default return path, or
  // the Site URL root GoTrue falls back to. An email/PKCE link's flow_state_*
  // error on /reset-password stays that page's to read (lh-authz-rls review).
  if (!UNMARKED_RETURN_PATHS.includes(loc.pathname)) return null;
  const description = get("error_description");
  const choice = parseAccountChoice(description);
  if (choice) return hold(loc, hist, query, hash, { provider: null, code: "account_choice", message: ACCOUNT_CHOICE_COPY, choice });
  const multiple = (description ?? "").toLowerCase().includes("multiple accounts with the same email");
  const code = multiple ? "multiple_accounts" : get("error_code");
  if (!code || !(SOCIAL_AUTH_ERROR_CODES as readonly string[]).includes(code)) return null;
  const message = socialAuthErrorCopy(null, code, description);
  if (message === null) return null;
  return hold(loc, hist, query, hash, { provider: null, code, message });
}

function hold(
  loc: Location,
  hist: History,
  query: URLSearchParams,
  hash: URLSearchParams,
  err: OAuthRedirectError,
): OAuthRedirectError | null {
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

  if (err.message === "") return null; // declined at the provider — no notice
  // Held in memory only. The /home -> /login bounce is a client-side route
  // change in the same page load, so nothing needs to survive a reload, and
  // an auth error from the URL is not persisted to storage (CodeQL
  // js/clear-text-storage-of-sensitive-data on the first version of this).
  captured = err;
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
