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
//   - sent with no session, complete-signup answers "Profile already
//     completed" (handled as finished, Q1643), with or without a bio: a
//     finished completion stamps terms_accepted_at, and the no-session path
//     refuses any row that has it (Q1887). An overlapping send that arrives while the first still runs
//     loses the one-shot claim (one conditional UPDATE on terms_accepted_at IS
//     NULL, taken before the photo upload or any write) and gets the same
//     answer, so it writes nothing: no second photo, consent row or referral.
//     If the first then fails, it releases the claim and the member finishes
//     through Log In.
//
// Only FunctionsFetchError is retried: an HTTP answer (FunctionsHttpError) is
// the function's decision and a relay error is Supabase's; resending either
// would just repeat it.

import { track, AhaEvent } from "@/lib/analytics";

/** The shape `supabase.functions.invoke` resolves to. */
export type InvokeResult = { data: unknown; error: unknown };

export function isUnsentRequest(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "FunctionsFetchError";
}

/** How long a hidden page is waited on before the second send goes anyway. */
const MAX_HIDDEN_WAIT_MS = 20_000;

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
      const finish = () => {
        doc.removeEventListener("visibilitychange", onChange);
        clearTimeout(cap);
        resolve();
      };
      const onChange = () => {
        if (doc.visibilityState !== "hidden") finish();
      };
      doc.addEventListener("visibilitychange", onChange);
      // Declared after the listener: finish only runs on a later event or this
      // timer, by which time cap is set.
      const cap = setTimeout(finish, maxHiddenMs);
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
  // Q2090 (lh-silent-failure@773651052#6): a retry that worked used to drop the first FunctionsFetchError, so
  // nobody could count how often the second send fires or what it does. An analytics event, not a Sentry report:
  // sentryLedgerSync maps every non-fatal level to an alert row, which would page once per retry.
  const atFailure = {
    hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
    online: typeof navigator === "undefined" ? null : navigator.onLine,
  };
  const startedAt = Date.now();
  await wait();
  const waitedMs = Date.now() - startedAt;
  if (signal?.aborted) {
    track(AhaEvent.SignupCompletionRetried, { ...atFailure, waited_ms: waitedMs, outcome: "caller_gave_up" });
    return first;
  }
  const second = await send();
  const outcome = !second.error ? "ok" : isUnsentRequest(second.error) ? "unsent_again" : "answered_error";
  track(AhaEvent.SignupCompletionRetried, { ...atFailure, waited_ms: waitedMs, outcome });
  return second;
}
