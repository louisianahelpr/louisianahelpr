/**
 * Is the session REALLY gone? The one question every involuntary sign-out or
 * /login redirect must ask first (owner incident, 2026-10-09 21:45Z).
 *
 * What happened, measured on prod: the owner's Mac tab made no request from
 * 20:04Z (its access token expired at ~20:40Z) until 21:45:12Z. On wake, the
 * token refresh failed on the network ("Failed to fetch", status 0), so
 * `getSession()` returned `session: null` (auth-js does that when the stored
 * access token is expired and the refresh errored, even though the session is
 * still in storage), supabase-js fell back to the anon key, ~35 requests went
 * out with no JWT, two came back "permission denied", and ProtectedRoute's
 * session-lost net saw `getSession()` null and sent the owner to /login. 230 ms
 * later the same device's refresh succeeded (POST /auth/v1/token 200); the
 * server session was never revoked.
 *
 * So a null `getSession()` is not proof. This asks the server: it tries
 * `refreshSession()` and answers `true` ONLY on a definite auth answer
 * (no session stored at all, or the auth server refusing the refresh token
 * with a 4xx). A network failure, a 5xx, a timeout, an offline device or any
 * error it cannot classify answers `false`: nobody is ever signed out because
 * the network blinked.
 */
import { supabase } from "@/integrations/supabase/client";

type AuthishError = { name?: unknown; status?: unknown; message?: unknown } | null | undefined;

/** A failure that says nothing about the session: network, timeout, server. */
export const isTransientAuthError = (err: AuthishError): boolean => {
  if (!err) return false;
  const name = typeof err.name === "string" ? err.name : "";
  const status = typeof err.status === "number" ? err.status : undefined;
  const message = typeof err.message === "string" ? err.message : "";
  if (name === "AuthRetryableFetchError") return true;
  if (status === undefined || status === 0 || status >= 500 || status === 408 || status === 429) return true;
  return /failed to fetch|network|load failed|timed? ?out|abort/i.test(message);
};

/** A definite "this device has no valid session" from auth itself. */
const isDefiniteAuthLoss = (err: AuthishError): boolean => {
  if (!err) return false;
  if (err.name === "AuthSessionMissingError") return true;
  if (isTransientAuthError(err)) return false;
  const status = typeof err.status === "number" ? err.status : 0;
  return status >= 400 && status < 500;
};

/**
 * `true` only when the session is definitely gone (redirect / sign out is
 * then correct). Never throws; any doubt answers `false`.
 */
export async function confirmSessionLost(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    const { data: current } = await supabase.auth.getSession();
    if (current.session) return false;
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) return false;
    return isDefiniteAuthLoss(error);
  } catch {
    // refreshSession threw something that is not an AuthError: unknown, so
    // the session is NOT treated as lost.
    return false;
  }
}
