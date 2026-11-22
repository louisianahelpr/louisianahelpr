/**
 * Did the session refresh just fail on the network? (Q1158, lead 2026-11-22.)
 *
 * A member restored from an expired session (src/hooks/useAuthReady.ts) sees
 * their screen at once while auth-js refreshes the token. When that refresh
 * fails on the network, auth-js retries with backoff for up to ~25 s before
 * getSession() answers, and every read waits that long. The profile gate
 * (src/hooks/useCurrentUser.ts) must not: it waits for the refresh, but the
 * moment a refresh attempt fails on the wire (a thrown fetch or a 5xx) it fails
 * fast as connection trouble, so ProtectedRoute shows its "connection hiccup,
 * you're still signed in" card in about a second instead of after the backoff.
 *
 * client.ts wraps the auth client's fetch with noteRefreshOutcome (auth-js
 * sends its refresh through the client's global fetch). A refusal (4xx) is not
 * a network failure: auth-js signs out on it, and ProtectedRoute sends the
 * person to Log In.
 *
 * Guard: src/hooks/useAuthReady.realRefresh.test.tsx.
 */

/** A failure older than this no longer speaks for the network (auth-js retries every 30 s tick). */
export const REFRESH_FAILURE_FRESH_MS = 30_000;

let failedAt: number | null = null;
const listeners = new Set<() => void>();

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const isRefreshRequest = (url: string): boolean =>
  url.includes("/auth/v1/token") && url.includes("grant_type=refresh_token");

const markFailed = () => {
  failedAt = Date.now();
  [...listeners].forEach((l) => l());
};

/** Wraps the auth client's fetch: records each refresh attempt's network outcome; every request passes unchanged. */
export function noteRefreshOutcome(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!isRefreshRequest(urlOf(input))) return fetchImpl(input, init);
    let res: Response;
    try {
      res = await fetchImpl(input, init);
    } catch (err) {
      markFailed();
      throw err;
    }
    if (res.status >= 500) markFailed();
    else failedAt = null;
    return res;
  };
}

/** Did a refresh attempt fail on the network within REFRESH_FAILURE_FRESH_MS, with none answered since? */
export function refreshFailedRecently(): boolean {
  return failedAt !== null && Date.now() - failedAt < REFRESH_FAILURE_FRESH_MS;
}

/** Told on every refresh attempt that fails on the network from now on. Returns the unsubscribe. */
export function onRefreshNetworkFailure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The message of the profile gate's fast failure ("Failed to fetch" = the transport family networkFailure.ts knows). */
export const REFRESH_OFFLINE_MESSAGE = "Failed to fetch: the sign-in could not be refreshed on this connection";
