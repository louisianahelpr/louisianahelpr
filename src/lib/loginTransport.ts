import { supabase } from "@/integrations/supabase/client";
import { isCaptchaError } from "@/lib/turnstile";

// Login's password sign-in with a 15s race timeout, and the classifier that
// keeps a failure that says nothing about the password out of the lockout
// ledger. Split out of Login.tsx when the call gained its Turnstile token (Q1314).

const LOGIN_TIMEOUT_MS = 15000;

export const signInWithTimeout = async (email: string, password: string, captchaToken: string | undefined) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      supabase.auth.signInWithPassword({ email, password, options: { captchaToken } }),
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
