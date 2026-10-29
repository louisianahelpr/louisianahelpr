/**
 * "Did this person prove who they are in the last few minutes?" (A3-I5,
 * owner 2026-10-29: deleting an account asks for the password first).
 *
 * The answer comes from the `amr` claim of the access token the request
 * carries. Supabase Auth writes one entry per way the session was proven
 * (password, otp, oauth, ...) with the Unix time it happened, and keeps that
 * time when the token is refreshed. Measured on prod 2026-10-29
 * (auth.mfa_amr_claims joined to auth.sessions): sessions refreshed 9 to 170
 * hours after sign-in still carry their sign-in time, so a refreshed token
 * does NOT look like a fresh sign-in.
 *
 * The client proves it fresh just before it asks for the delete: members with
 * a password type it (supabase.auth.signInWithPassword), members without one
 * (Google / Apple only: 34 accounts on 2026-10-29) or who forgot it get an
 * emailed code (signInWithOtp + verifyOtp). Either one starts a new session
 * whose amr time is now. See src/lib/deleteAccountReauth.ts.
 *
 * Call this ONLY after auth.getUser(token) has accepted the token: that is
 * what makes its payload trustworthy. This function only reads it.
 */

/** How recent the proof must be. Long enough to read the dialog, short enough that a phone left unlocked a while ago cannot be used. */
export const REAUTH_WINDOW_SECONDS = 10 * 60;

/** Shown when the token is older than the window. The dialog asks again. */
export const REAUTH_REQUIRED_MESSAGE =
  "Please confirm it's you first: enter your password, or the code we email you.";

/** Machine-readable reason, so the client can tell this refusal apart. */
export const REAUTH_REQUIRED_CODE = "reauth_required";

function decodePayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(atob(b64));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (err) {
    // A token getUser accepted always decodes; a payload that does not is
    // treated as "no proof", which refuses the delete (fail closed).
    console.warn("[recentSignIn] token payload did not decode", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Newest amr timestamp in the token (Unix seconds), or null when there is none. */
export function lastSignInAt(jwt: string): number | null {
  const amr = decodePayload(jwt)?.amr;
  if (!Array.isArray(amr)) return null;
  let newest: number | null = null;
  for (const entry of amr) {
    const ts = (entry as { timestamp?: unknown } | null)?.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts) && (newest === null || ts > newest)) newest = ts;
  }
  return newest;
}

/** True when the token's newest proof of identity is at most `windowSeconds` old. */
export function signedInWithin(jwt: string, windowSeconds: number, nowSeconds: number): boolean {
  const at = lastSignInAt(jwt);
  if (at === null) return false;
  return nowSeconds - at <= windowSeconds;
}
