// Maps raw Supabase auth error messages to warm, user-facing copy so we
// never leak internal phrasing (e.g. "Invalid login credentials") into a
// toast. Falls back to a generic line for anything unrecognised.
export function friendlyAuthError(raw: string | undefined | null): string {
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

  return "Couldn't sign you in — give it another try?";
}
