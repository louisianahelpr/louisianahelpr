/**
 * Makes sign-out's time cap a real CANCEL, not an abandonment.
 *
 * signOutWithPushCleanup caps auth.signOut() at 3 s (owner, 2026-10-09: "I
 * pressed Log Out and nothing happened"). Merely racing a timer left the
 * /logout request running: when it finally failed, auth-js's _signOut ran
 * _removeSession() on whatever session was stored THEN, so a new sign-in made
 * after the cap was wiped (reproduced on auth-js 2.117.2). And because the
 * floor (clearPersistedAuthToken) emits no SIGNED_OUT, the app kept the old
 * user in memory meanwhile.
 *
 * So the client is built with `global.fetch: signOutAwareFetch`. Outside a
 * sign-out it is a plain pass-through to `fetch` (nothing added, nothing
 * read). While signOutWithPushCleanup has an abort scope open, every
 * /auth/v1/ request carries the scope's AbortSignal; on the cap the scope is
 * aborted, auth-js sees a fetch error, removes the session and emits
 * SIGNED_OUT while the "Logging Out…" dialog is still up, and nothing is left
 * running to wipe a later session. src/lib/authSignOut.lateLogout.test.ts
 * drives the real supabase-js client through it.
 */

let active: AbortController | null = null;

/** Open the abort scope for one sign-out. */
export function beginSignOutAbortScope(): AbortController {
  active = new AbortController();
  return active;
}

/** Close it. Only the scope that is still current is cleared. */
export function endSignOutAbortScope(scope: AbortController): void {
  if (active === scope) active = null;
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

export const signOutAwareFetch: typeof fetch = (input, init) => {
  const scope = active;
  if (!scope || !urlOf(input).includes("/auth/v1/")) return fetch(input, init);
  return fetch(input, { ...init, signal: eitherSignal(init?.signal, scope.signal) });
};

/** Aborts when either does. The caller's own signal is never dropped. */
function eitherSignal(own: AbortSignal | null | undefined, scope: AbortSignal): AbortSignal {
  if (!own) return scope;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([own, scope]);
  // Older WebKit (no AbortSignal.any): combine by hand.
  const both = new AbortController();
  const abort = (from: AbortSignal) => both.abort(from.reason);
  if (own.aborted) abort(own);
  else if (scope.aborted) abort(scope);
  else {
    own.addEventListener("abort", () => abort(own), { once: true });
    scope.addEventListener("abort", () => abort(scope), { once: true });
  }
  return both.signal;
}
