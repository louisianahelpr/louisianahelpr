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

/**
 * The same vocabulary, with a fallback that fits a surface where NOTHING was
 * being signed in.
 *
 * `friendlyAuthError`'s fallback is "Couldn't sign you in — give it another
 * try?", and /reset-password used it. So when GoTrue answered
 * `PUT /auth/v1/user` with 422 `weak_password` — an error about the password
 * the user had just typed — the screen said the sign-in had failed. It had
 * not: opening the recovery link IS the sign-in, and it had already succeeded
 * (`last_sign_in_at` moved). External QA read that as an unrelated toast
 * appearing on its own, which is precisely what it looked like, and the real
 * reason for the refusal was never shown at all.
 *
 * Weak-password rejections are handled by the CALLER rather than here, because
 * the caller can say which rule is missing (`passwordProblem`) where this
 * function only has a string. `resetPasswordError` is the last line for
 * everything else.
 */
export function resetPasswordError(raw: string | undefined | null): string {
  return recognizedAuthError(raw) ?? "Couldn't update your password — give it another try?";
}

/**
 * Restate GoTrue's weak-password message in this app's voice, WITHOUT losing
 * what it said.
 *
 * The raw string is a configuration dump — "Password should be at least 12
 * characters. Password should contain at least one character of each:
 * abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789,
 * !@#$%^&*()_+-=[]{};'\:\"|<>?,./`~." — four lines of alphabet in a form
 * field. This is only ever reached when the client's own rule list and the
 * project policy have drifted apart (normally `passwordProblem` answers
 * first), and the whole point of reaching it is that we do NOT know which rule
 * is missing, so the requirement has to be reproduced faithfully rather than
 * summarised away.
 *
 * Anything this does not recognise is returned verbatim. A vague sentence on
 * the account-recovery path is a locked-out user.
 */
export function describeWeakPassword(raw: string | undefined | null): string {
  const msg = raw ?? "";
  const parts: string[] = [];
  const length = /at least (\d+) characters/i.exec(msg);
  if (length) parts.push(`at least ${length[1]} characters`);
  if (/one character of each/i.test(msg)) {
    parts.push("an uppercase letter, a lowercase letter, a number and a symbol");
  }
  if (parts.length === 0) return msg;
  return `Your password needs ${parts.join(", plus ")}.`;
}

/**
 * True when Supabase refused a password as too weak.
 *
 * Matched on `code`/`name` first — `AuthWeakPasswordError` (auth-js
 * `lib/errors.ts`) is thrown with `code: "weak_password"` for any 422 the API
 * tags that way — and on the message only as a fallback, so a future GoTrue
 * that drops the code still lands here rather than in the generic bucket.
 */
export function isWeakPasswordError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; name?: unknown; message?: unknown };
  if (e.code === "weak_password") return true;
  if (e.name === "AuthWeakPasswordError") return true;
  return typeof e.message === "string" && /password (?:is too weak|should )/i.test(e.message);
}
