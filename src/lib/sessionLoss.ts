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
 * (no session stored at all, or the auth server itself refusing the refresh
 * token: an AuthApiError with a 4xx). A network failure, a 5xx, a timeout, an
 * offline device, a refresh auth-js itself discarded (AuthRefreshDiscardedError)
 * or any error it cannot classify answers `false`, so THIS net never signs
 * anyone out because the network blinked. (auth-js can still drop the session
 * on its own after a non-retryable refresh failure once the access token has
 * expired; that path is auth-js's SIGNED_OUT, not this net.)
 *
 * Every `false` that absorbed a would-be sign-out is reported once a minute at
 * most (source "sessionLoss.transient", error name and status only), so
 * error_logs shows how often this net saves a session.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

type AuthishError = { name?: unknown; status?: unknown; message?: unknown } | null | undefined;

/** A failure that says nothing about the session: network, timeout, server. */
const isTransientAuthError = (err: AuthishError): boolean => {
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
  // Only the auth server's own refusal counts, so two different 409s differ:
  // - AuthRefreshDiscardedError (auth-js's OWN status-409 error: storage changed
  //   under the refresh, another tab or a sign-out got there first) never
  //   reached the server's verdict; it is not lost (the name check below).
  // - GoTrue's 409 "Too many concurrent token refresh requests" arrives as an
  //   AuthApiError (auth-js lib/fetch.ts handleError: only 500 and 501-530 are
  //   retryable) and IS counted lost. That is right because auth-js does not
  //   keep the session on it: _callRefreshToken (auth-js 2.116.0 installed,
  //   2.117.2 locked; read 2026-10-11) calls _removeSession() on every
  //   non-retryable AuthError once the access token has expired, and keeps it
  //   only while the access token is still valid. In that kept case the
  //   "last look" getSession() below returns it, so the answer is still false.
  // AuthUnknownError has no reliable status, so it is not lost either.
  if (err.name !== "AuthApiError") return false;
  if (isTransientAuthError(err)) return false;
  const status = typeof err.status === "number" ? err.status : 0;
  return status >= 400 && status < 500;
};

/** One report a minute at most per kind, so a burst of denials reports once. */
const REPORT_EVERY_MS = 60_000;
const lastReportAt: Record<"transient" | "threw", number> = { transient: -Infinity, threw: -Infinity };
const shouldReport = (kind: "transient" | "threw"): boolean => {
  const now = Date.now();
  if (now - lastReportAt[kind] < REPORT_EVERY_MS) return false;
  lastReportAt[kind] = now;
  return true;
};

/**
 * A would-be sign-out this net absorbed. Name and status only: never the
 * message, a token or anything about the person.
 */
const reportTransient = (reason: string, err?: AuthishError): void => {
  if (!shouldReport("transient")) return;
  report(new Error(`Session check kept a signed-in member signed in (${reason})`), {
    severity: "warning",
    tags: {
      source: "sessionLoss.transient",
      reason,
      error_name: typeof err?.name === "string" ? err.name : "none",
      error_status: typeof err?.status === "number" ? err.status : -1,
    },
  });
};

/**
 * `true` only when the session is definitely gone (redirect / sign out is
 * then correct). Never throws; any doubt answers `false`.
 */
export async function confirmSessionLost(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      reportTransient("offline");
      return false;
    }
    const { data: current } = await supabase.auth.getSession();
    // A session is present: the denial was a real refusal, not a lost sign-in,
    // and nothing would have signed anyone out, so there is nothing to report.
    if (current.session) return false;
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) {
      reportTransient("refreshed");
      return false;
    }
    if (!isDefiniteAuthLoss(error)) {
      reportTransient("not-definite", error);
      return false;
    }
    // Last look: another tab may have stored a fresh session meanwhile.
    const { data: after } = await supabase.auth.getSession();
    if (after.session) {
      reportTransient("last-look", error);
      return false;
    }
    return true;
  } catch (err) {
    // getSession/refreshSession threw something that is not an AuthError (a
    // storage read failure, say): unknown, so the session is NOT treated as
    // lost, but it is reported (once a minute at most) so it is seen.
    if (shouldReport("threw")) {
      report(err, { severity: "warning", tags: { source: "sessionLoss.threw" } });
    }
    return false;
  }
}
