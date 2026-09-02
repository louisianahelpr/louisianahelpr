// Maps raw Supabase auth error messages to warm, user-facing copy so we
// never leak internal phrasing (e.g. "Invalid login credentials") into a
// toast. Falls back to a generic line for anything unrecognised.

/** The line `friendlyAuthError` returns when nothing matched. */
const GENERIC_SIGN_IN_FALLBACK = "Couldn't sign you in — give it another try?";

/**
 * The recognised copy for `raw`, or `null` when nothing matched.
 *
 * WHY THIS IS SEPARATE FROM `friendlyAuthError`. That function must return a
 * string, so it answers "here is something to show" and "I recognised this"
 * with the same value — and its fallback says "sign you in", which is the
 * wrong sentence on any screen that is not a sign-in. A caller with its own
 * fallback (signup: "Couldn't create your account") therefore had no way to
 * ask whether the match was real, and would have to choose between leaking a
 * raw backend string and overwriting good copy with a wrong one.
 *
 * The one existing caller that needed this — `friendlyProviderError` in
 * lib/socialAuth.ts:90-95 — resorted to comparing the returned string against
 * the fallback LITERAL, which silently stops working the day that copy is
 * reworded. It should adopt this function; it is left alone here only because
 * changing the social flow is outside this change's approved scope.
 */
export function matchAuthError(raw: string | undefined | null): string | null {
  const msg = (raw ?? "").toLowerCase();

  if (msg.includes("invalid login credentials")) {
    return "That email or password doesn't match. Give it another try.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please verify your email first — check your inbox for the link.";
  }
  if (msg.includes("rate") && msg.includes("limit")) {
    return "Too many attempts just now. Give it a moment and try again.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout") || msg.includes("timed out")) {
    return "Connection trouble. Check your signal and try again.";
  }
  if (msg.includes("user already registered") || msg.includes("already registered")) {
    return "An account already uses that email. Try signing in instead.";
  }

  return null;
}

export function friendlyAuthError(raw: string | undefined | null): string {
  return matchAuthError(raw) ?? GENERIC_SIGN_IN_FALLBACK;
}
