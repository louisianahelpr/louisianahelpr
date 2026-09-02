// Maps raw Supabase auth error messages to warm, user-facing copy so we
// never leak internal phrasing (e.g. "Invalid login credentials") into a
// toast. Falls back to a generic line for anything unrecognised.

/**
 * The recognised copy for a Supabase auth error, or `null` when the message
 * is not one we know.
 *
 * Split out from `friendlyAuthError` because the generic fallback is
 * LOGIN-flavoured ("Couldn't sign you in…") and is wrong on other surfaces.
 * Signup needs the same vocabulary with its own fallback, so it asks this
 * and supplies its own last line — see Signup.tsx's catch.
 *
 * Returning null rather than a fallback also lets a caller distinguish
 * "this is an auth error I can phrase" from "this is something else
 * entirely", which is what stopped GoTrue's raw strings reaching the
 * signup wall: they are short lowercase prose, so `userFacingError`'s
 * machine-shape filter trusts them and passes them through verbatim.
 */
export function recognizedAuthError(raw: string | undefined | null): string | null {
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
  return recognizedAuthError(raw) ?? "Couldn't sign you in — give it another try?";
}
