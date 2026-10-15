// One more try for `complete-signup` when its request never got an answer (Q1810).
//
// MEASURED (prod, Sentry JAVASCRIPT-3R, 2026-10-13 20:53:23Z, Facebook's in-app
// browser on iOS 26.2.1): the account was created at 20:53:21, and two seconds
// later `complete-signup` failed as a FunctionsFetchError ("the connection
// dropped"). The function's own logs hold no request of any kind for it between
// 20:53:00 and 20:55:00, so the call never reached Supabase. The person
// recovered by hand (email confirmed 20:53:45, profile finished through Log In),
// but the signup form had given up after ONE failed send and told them their
// details did not save.
//
// What a second send does. A FunctionsFetchError also covers a request that
// LANDED and only lost its answer (Safari's "Load failed" when the app goes to
// the background), so the second send can be a repeat:
//   - with a bio saved, complete-signup answers "Profile already completed"
//     (handled as finished, Q1643);
//   - with NO bio (the form allows a blank one), the function runs again: the
//     profile UPDATE writes the same values, the photo upload upserts the same
//     key, the admin new-member notice is sent at most once per member,
//     record_referral_signup answers an already-referred user with FALSE (so
//     the funnel event says referral_recorded false for a referral that was
//     recorded), and a second, identical legal_acceptances row is written.
//     Those last two are a misreported funnel flag and a duplicate of a true
//     event, never a false one (lh-silent-failure review of 773651052, #4).
//
// Only FunctionsFetchError is retried: an HTTP answer (FunctionsHttpError) is
// the function's decision and a relay error is Supabase's; resending either
// would just repeat it.

/** The shape `supabase.functions.invoke` resolves to. */
export type InvokeResult = { data: unknown; error: unknown };

export function isUnsentRequest(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "FunctionsFetchError";
}

/** How long a hidden page is waited on before the second send goes anyway. */
export const MAX_HIDDEN_WAIT_MS = 20_000;

/**
 * Wait before the second send: at least `minMs`, and if the page is hidden
 * (the person switched to their mail app to look for the confirm email), until
 * it is visible again, but never longer than `maxHiddenMs`. A hidden page's
 * fetch fails the same way the first one did.
 */
export function waitForAWorkingPage(
  minMs = 1500,
  doc: Document | undefined = typeof document === "undefined" ? undefined : document,
  maxHiddenMs = MAX_HIDDEN_WAIT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!doc || doc.visibilityState !== "hidden") return resolve();
      let cap: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        doc.removeEventListener("visibilitychange", onChange);
        if (cap !== undefined) clearTimeout(cap);
        resolve();
      };
      const onChange = () => {
        if (doc.visibilityState !== "hidden") finish();
      };
      doc.addEventListener("visibilitychange", onChange);
      cap = setTimeout(finish, maxHiddenMs);
    }, minMs);
  });
}

/**
 * `signal`: aborted once the caller has given up (Signup.tsx's 60 s
 * withTimeout). A second send after that would finish a profile the screen has
 * already told the person did not save, so an aborted wait hands back the
 * first result instead (lh-silent-failure review of 773651052, #3).
 */
export async function invokeWithOneRetryIfUnsent<T extends InvokeResult>(
  send: () => Promise<T>,
  wait: () => Promise<void> = () => waitForAWorkingPage(),
  signal?: AbortSignal,
): Promise<T> {
  const first = await send();
  if (!isUnsentRequest(first.error)) return first;
  await wait();
  if (signal?.aborted) return first;
  return send();
}
