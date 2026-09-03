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
  // GoTrue's per-address email throttle. It is the same situation as the rate
  // limit above and it is far more common, but it is worded as a sentence that
  // shares not one word with it — "For security purposes, you can only request
  // this after 47 seconds." — so it went straight to the toast. It reads as a
  // security accusation, and "for security purposes" is the backend's
  // vocabulary, not ours.
  if (msg.includes("for security purposes")) {
    return "Too many attempts just now. Give it a moment and try again.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout") || msg.includes("timed out")) {
    return "Connection trouble. Check your signal and try again.";
  }
  // The SAME failure as the line above, on the platform this app actually
  // ships on. A rejected fetch surfaces as `AuthRetryableFetchError(<the
  // TypeError's message>)`, and that message is the browser's, not Supabase's:
  // Chromium says "Failed to fetch" (caught above), WebKit says "Load failed"
  // and Firefox "NetworkError when attempting to fetch resource". So an offline
  // signup or login was handled on every machine we test on and showed "Load
  // failed" inside the WKWebView we ship — the Chromium-cannot-see-WebKit gap
  // CLAUDE.md describes, arriving as copy rather than as layout.
  if (msg.includes("load failed") || msg.includes("networkerror")) {
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
