import { supabase } from "@/integrations/supabase/client";
import { unregisterPushOnSignOut } from "@/lib/nativePush";
import { clearRememberedRoute } from "@/lib/lastRoute";
import { queryClient } from "@/lib/queryClient";
import { removePersistedClient } from "@/lib/queryPersister";
import { clearPersistedAuthToken } from "@/lib/persistedAuthToken";
import { markIntentionalSignOut } from "@/lib/unexpectedSignOut";
import { clearNativeSessionMirror } from "@/integrations/supabase/keychainStorageAdapter";
import { resetProofPhotoSignCache } from "@/lib/proofPhotoStorage";
import { purgeApiCache } from "@/lib/apiCachePurge";
import { beginSignOutAbortScope, endSignOutAbortScope } from "@/lib/signOutAbort";

// "others" is deliberately absent: everything below tears down THIS device
// (push token, remembered route, caches). Ending only the other sessions is
// signOutOtherDevices(), which touches none of it.
type SignOutOptions = { scope?: "global" | "local" };

// ── NO NETWORK CALL IN HERE MAY BE AWAITED UNBOUNDED ──────────────────────
// Owner, 2026-10-09: "I pressed Log Out and nothing happened." Sign-out used to
// await, one after the other and with no limit: getUser() (a round trip to
// /auth/v1/user), the push_tokens delete, and signOut() (a POST to
// /auth/v1/logout, which may first refresh an expired token). On a slow or
// hung line each of those can take as long as the network does, while the
// person looks at a screen that has not changed. So each step has a cap and
// sign-out always finishes; the Log Out buttons show "Logging Out…" meanwhile
// (useSignOutAction). src/lib/authSignOut.test.ts hangs EVERY network call
// and asserts sign-out still completes.
//
// Worst case, every step hanging: push cleanup 2 s + signOut 3 s + the
// aborted signOut settling 0.5 s + Keychain clear 1.5 s + cache wipe 1.5 s
// = 8.5 s. Usually it is one round trip.
//
// The signOut cap CANCELS, it does not abandon: /auth/v1/ requests made while
// it runs carry an AbortSignal (src/lib/signOutAbort.ts) and the cap aborts
// them. Abandoned, a /logout that failed later made auth-js remove whatever
// session was stored by then, a fresh sign-in included.
export const PUSH_CLEANUP_CAP_MS = 2_000;
export const SIGN_OUT_CAP_MS = 3_000;
export const ABORT_SETTLE_CAP_MS = 500;
export const CACHE_WIPE_CAP_MS = 1_500;

/** A cap that fired is reported, not only logged (severity warning). */
function reportCap(message: string, area: "auth" | "push" | "cache") {
  console.error(`[signOut] ${message}`);
  void import("@/lib/errorLogger")
    .then(({ report }) => report(new Error(message), { severity: "warning", tags: { area, op: "signOutCap" } }))
    .catch(() => { /* Silent by design: the logger itself failed to load; the console line above still says it. */ });
}

const CAPPED = Symbol("capped");
async function capped<T>(work: Promise<T>, ms: number): Promise<T | typeof CAPPED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof CAPPED>((resolve) => { timer = setTimeout(() => resolve(CAPPED), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type SignOutResult = Awaited<ReturnType<typeof supabase.auth.signOut>>;

/**
 * auth.signOut() under the cap, cancelled (not abandoned) when the cap fires:
 * the abort makes auth-js's pending request fail, so it removes the session
 * and emits SIGNED_OUT now, while the dialog is still up, instead of later
 * over whatever session is stored by then. A throw (navigator-lock timeout)
 * propagates to the caller's catch.
 */
async function cancellableSignOut(options: SignOutOptions): Promise<SignOutResult> {
  const scope = beginSignOutAbortScope();
  try {
    const work = supabase.auth.signOut(options);
    const outcome = await capped(work, SIGN_OUT_CAP_MS);
    if (outcome !== CAPPED) return outcome;
    reportCap(`auth.signOut() did not finish in ${SIGN_OUT_CAP_MS / 1000}s — cancelled`, "auth");
    scope.abort();
    const settled = await capped(
      work.catch((err: unknown) => ({ error: err }) as SignOutResult),
      ABORT_SETTLE_CAP_MS,
    );
    // Capped is never success: for "global" the other devices were not
    // confirmed signed out. auth-js's own error wins when it has one.
    const cappedError = new Error(`auth.signOut() did not finish in ${SIGN_OUT_CAP_MS / 1000}s`);
    if (settled === CAPPED || !settled?.error) return { error: cappedError as never };
    return settled;
  } finally {
    endSignOutAbortScope(scope);
  }
}

/**
 * Sign out AND clear this account's push tokens first, so a signed-out
 * (or handed-off) device stops receiving the user's notifications.
 *
 * The token delete MUST run before `auth.signOut()`: `push_tokens` is
 * RLS-scoped to `auth.uid()`, so once the session is torn down the
 * authenticated delete would no longer be permitted and the row would
 * linger — the exact privacy leak this closes (user A logs out, user B
 * signs in on the same phone, A keeps getting A's pushes). Cleanup is
 * best-effort and never blocks logout: a failed delete still signs out.
 */
export async function signOutWithPushCleanup(requested?: SignOutOptions) {
  // THIS DEVICE ONLY unless a caller asks for more. supabase-js defaults
  // signOut() to scope "global", so every plain "Log Out" (Profile, Dashboard,
  // Complete Profile, the timeout) ended the account's sessions on EVERY
  // device: log out on your phone, get logged out on the web. Verified live on
  // 2026-09-12 (another browser's refresh then returned refresh_token_not_found).
  // "Sign Out Everywhere" in SecurityTab passes scope "global" explicitly.
  const options: SignOutOptions = { scope: "local", ...requested };
  markIntentionalSignOut();
  // The user id comes from getSession() — the session this device already
  // holds — not getUser(), which asks the server. The delete itself is still
  // RLS-scoped to auth.uid(), so a local read cannot widen it. Capped: a push
  // cleanup that has not finished in 2 s is abandoned, never waited on.
  // `hadSession` stays undefined if the read never answered.
  let hadSession: boolean | undefined;
  const pushCleanup = (async () => {
    const { data } = await supabase.auth.getSession();
    hadSession = !!data.session;
    const userId = data.session?.user?.id;
    if (userId) await unregisterPushOnSignOut(userId);
  })().catch(() => {
    /* best-effort: never block sign-out on token cleanup (unregisterPushOnSignOut reports its own failures) */
  });
  if ((await capped(pushCleanup, PUSH_CLEANUP_CAP_MS)) === CAPPED) {
    reportCap(`push-token cleanup did not finish in ${PUSH_CLEANUP_CAP_MS / 1000}s — signing out anyway`, "push");
  }
  // Same hand-off concern as the push tokens above, one notch milder: the
  // remembered resume route is only ever read for a signed-in session, so a
  // guest can't restore it — but without this, user B signing in on user A's
  // phone would land on A's last screen (a job detail, someone's profile).
  // No data leaks (ProtectedRoute and RLS still gate it), yet it plainly
  // isn't B's app. Cheap to clear, so clear it.
  clearRememberedRoute();
  // ── THE FLOOR UNDER A FAILED SIGN-OUT ────────────────────────────────────
  // Owner, 2026-09-11: "i had to click log out twice to actually log out."
  //
  // `auth.signOut()` has two failure modes that both LEAVE THE PERSISTED
  // SESSION IN PLACE, and neither says a word:
  //
  //  1. It REJECTS. auth-js wraps every auth call in `_acquireLock`, which
  //     throws `NavigatorLockAcquireTimeoutError` when another tab (or an
  //     in-flight refresh in this one) holds `lock:sb-<ref>-auth-token` past
  //     the timeout. Desktop Chrome with the app open twice is the whole
  //     repro. The throw escapes this function, so every caller's
  //     `await signOutWithPushCleanup(); navigate("/")` never reaches the
  //     navigate: you stay on /profile, still signed in, and click again.
  //     Same throw, already recorded on the delete path — see the comment in
  //     `useDeleteAccount.handleDelete`.
  //  2. It RETURNS `{ error }` WITHOUT removing the session. Read
  //     `GoTrueClient._signOut`: if `_useSession` yields an error that is not
  //     AuthSessionMissingError (an expired token whose refresh just failed
  //     on the network, say) it returns that error *before* reaching
  //     `removeCurrentSession()`. Every other error path does remove it;
  //     that one does not.
  //
  // Either way the `sb-*-auth-token` key survives — and that key is exactly
  // what `MarketingRedirect`/`prePaintShellClasses`/`MobileNav` fast-path off,
  // so `navigate("/")` bounces straight back into the app as a signed-in user.
  // The second click then succeeds, because the lock is free or the refresh
  // has settled. Hence: twice.
  //
  // So sign-out is made terminal on the client. `clearPersistedAuthToken()`
  // already exists as this floor (`useDeleteAccount` reaches for it for the
  // same reason); it belongs HERE, under all ~12 call sites, not at one of
  // them.
  let result: Awaited<ReturnType<typeof supabase.auth.signOut>>;
  try {
    // Again here: the push cleanup above can take a while on a slow line.
    markIntentionalSignOut();
    if (options.scope === "global" && hadSession === false) {
      // No session on this device: auth-js would send no /logout at all and
      // answer { error: null }, so a "Sign Out Everywhere" retried after a
      // failed one would report success while revoking nothing. Never success.
      result = { error: new Error("no session on this device, so other devices could not be signed out") as never };
    } else {
      result = await cancellableSignOut(options);
    }
  } catch (err) {
    console.error("[signOut] auth.signOut() threw — clearing the session by hand", err);
    result = { error: err as never };
  }
  // `result?.` because a rejecting/undefined-returning stub must not become a
  // second failure inside the failure handler.
  if (result?.error) {
    // Loud, never dropped: this is the branch where the SDK did not do it.
    console.error("[signOut] auth.signOut() failed — clearing the persisted session by hand", result.error);
    clearPersistedAuthToken();
    // On the app the session is also mirrored in the Keychain and the
    // adapter's cache; left there, the next launch signs the person back in
    // (Q390 review S2).
    // Capped: the cache is cleared synchronously inside, so this process is
    // signed out at once; only the Keychain delete waits on the bridge, and a
    // bridge call that never settles must not stop sign-out finishing.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      clearNativeSessionMirror().then(() => "done" as const, () => "done" as const),
      new Promise<"capped">((resolve) => { timer = setTimeout(() => resolve("capped"), 1_500); }),
    ]);
    clearTimeout(timer);
    if (outcome === "capped") {
      // Signed out in this process; the Keychain copy may outlive it.
      console.error("[signOut] the Keychain clear did not finish in 1.5s — the next launch may restore the session");
      void import("@/lib/errorLogger")
        .then(({ report }) => report(new Error("sign-out Keychain clear exceeded its 1.5s cap"), { severity: "error", tags: { area: "keychain_session" }, context: { step: "sign-out cap" } }))
        .catch(() => { /* Silent by design: the logger itself failed to load; the console line above still says it. */ });
    }
  }

  // Wipe the in-memory React Query cache and the persisted IndexedDB copy, so
  // the next person on this device cannot rehydrate the previous user's data:
  // Stripe payouts, the admin payout ledger, job history, notification logs.
  // `queryPersister.ts` keys the persisted cache as a single NON-user-scoped
  // "helpr-rq-cache" with a 24h maxAge, and only 9 queries opt out via
  // `meta: { persist: false }` — so without this, a shared-device sign-out
  // leaks for a day. The in-memory half is the worse one: any query keyed by a
  // literal string is served straight from RAM to the next user in the same
  // page session, no expiry involved.
  //
  // WHY IT LIVES HERE AND NOT ONLY IN THE SIGNED_OUT LISTENER. It was only in
  // that listener, and the listener is registered inside `main.tsx`'s analytics
  // bootstrap: behind five dynamic imports, behind a first-interaction gate,
  // inside a `try` whose `catch` is empty and commented "analytics + error
  // tracking must never break the app". True of analytics; false of this.
  // `vite.config.ts` names those chunks literally `sentry-*.js` and
  // `posthog-*.js`, which is precisely what a content blocker matches on — so
  // the realistic failure is not an exotic throw, it is an ad blocker, and it
  // takes the cache wipe down with it. Sign-out then completes and looks
  // completely normal. These two calls were the only occurrences in the repo.
  //
  // Ordering: AFTER `signOut()`, deliberately. Clearing first lets any
  // in-flight query repopulate the cache using a session that is still valid.
  // Afterwards there is no session, so an active-query refetch returns nothing
  // to cache.
  //
  // Best-effort like the push cleanup above — a failed IndexedDB delete must
  // not strand someone in a half-signed-out state — but NOT silent: a swallowed
  // error here is the leak itself, so it is logged rather than dropped.
  // Signed proof-photo URLs are bearer links to another person's photos;
  // the next account on this device must not be handed them (Q724). First,
  // because it cannot throw and nothing before it may skip it.
  resetProofPhotoSignCache();
  // In-memory first: synchronous, so it is done before anything can hang.
  try {
    queryClient.clear();
  } catch (err) {
    console.error("[signOut] cache wipe failed — prior user data may persist", err);
  }
  // Cache Storage `api-cache` (signed-in Supabase responses an older service
  // worker wrote to disk, Q1174) and the persisted IndexedDB copy. Each is
  // started regardless of the other, and together they are capped: an
  // IndexedDB delete blocked by another tab must not hold "Logging Out…".
  const diskWipe = Promise.all([
    purgeApiCache(),
    Promise.resolve().then(() => removePersistedClient()),
  ]).catch((err) => {
    console.error("[signOut] cache wipe failed — prior user data may persist", err);
  });
  if ((await capped(diskWipe, CACHE_WIPE_CAP_MS)) === CAPPED) {
    reportCap(`the on-disk cache wipe did not finish in ${CACHE_WIPE_CAP_MS / 1000}s — prior user data may persist`, "cache");
  }

  return result;
}

/**
 * End every OTHER session of this account and keep this one: this device's
 * push token, cache and remembered route stay, because this device stays
 * signed in (ResetPassword after a password change, OA-006). Returns whether
 * the revoke succeeded; a throw (navigator-lock timeout) counts as failure.
 */
export async function signOutOtherDevices(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signOut({ scope: "others" });
    return !error;
  } catch (err) {
    console.error("[signOut] revoking other sessions threw", err);
    return false;
  }
}
