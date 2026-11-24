import { supabase } from "@/integrations/supabase/client";
import { isCaptchaError } from "@/lib/turnstile";
import { track, AhaEvent } from "@/lib/analytics";

// Login's password sign-in with a 15s race timeout, and the classifier that
// keeps a failure that says nothing about the password out of the lockout
// ledger. Split out of Login.tsx when the call gained its Turnstile token (Q1314).

const LOGIN_TIMEOUT_MS = 15000;

/**
 * Flow audit 11-23 (A3): why a password log-in failed, as a short code for analytics (never the email or the server's
 * words). Transport first: a timeout or offline says nothing about the password.
 */
const loginFailReason = (error: unknown): string => {
  const msg = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  if (isCaptchaError(msg)) return "captcha";
  if (isTransportFailure(error)) return "transport";
  if (msg.includes("invalid login credentials")) return "credentials";
  if (msg.includes("email not confirmed")) return "unconfirmed";
  if ((msg.includes("rate") && msg.includes("limit")) || msg.includes("for security purposes")) return "rate_limit";
  return "other";
};

export const signInWithTimeout = async (email: string, password: string, captchaToken: string | undefined) => {
  const result = await signInRace(email, password, captchaToken).catch((e: unknown) => {
    track(AhaEvent.LoginFailed, { method: "password", reason: loginFailReason(e) });
    throw e;
  });
  if (result.error) track(AhaEvent.LoginFailed, { method: "password", reason: loginFailReason(result.error) });
  else track(AhaEvent.LoginSucceeded, { method: "password" });
  return result;
};

const signInRace = async (email: string, password: string, captchaToken: string | undefined) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      // The address is trimmed HERE, at the one call: the form's own check trims, so a
      // trailing space (keyboard suggestion, autofill, paste) showed a green tick and
      // then got "invalid credentials" from the server (owner, 2026-10-20).
      supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken } }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(
          Object.assign(new Error("Login timed out. Please check your connection and try again."), { isTransport: true }),
        ), LOGIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

/**
 * A failure that says nothing about the credentials: our own 15s race timeout,
 * or a fetch that never reached the auth server. These must NOT enter the
 * failed-attempt ledger — flaky wifi would otherwise soft-lock a legitimate
 * user out for LOGIN_LOCKOUT_MS while their password was correct all along.
 * A wrong password still counts, which is the point of the ledger.
 */
export const isTransportFailure = (error: unknown): boolean => {
  const e = error as { isTransport?: boolean; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.isTransport === true) return true;
  // A refused/missing Turnstile token (Q1314) says nothing about the password
  // either, so it must not spend an attempt.
  if (isCaptchaError(e.message)) return true;
  // supabase-js wraps an unreachable/5xx auth endpoint in this retryable class.
  if (e.name === "AuthRetryableFetchError") return true;
  return /failed to fetch|networkerror|network error|load failed|timed out/i.test(e.message ?? "");
};
