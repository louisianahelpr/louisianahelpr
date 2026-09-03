import { supabase } from "@/integrations/supabase/client";
import { unregisterPushOnSignOut } from "@/lib/nativePush";
import { clearRememberedRoute } from "@/lib/lastRoute";
import { queryClient } from "@/lib/queryClient";
import { removePersistedClient } from "@/lib/queryPersister";

type SignOutOptions = { scope?: "global" | "local" | "others" };

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
export async function signOutWithPushCleanup(options?: SignOutOptions) {
  try {
    const { data } = await supabase.auth.getUser();
    if (data.user) await unregisterPushOnSignOut(data.user.id);
  } catch {
    /* best-effort: never block sign-out on token cleanup */
  }
  // Same hand-off concern as the push tokens above, one notch milder: the
  // remembered resume route is only ever read for a signed-in session, so a
  // guest can't restore it — but without this, user B signing in on user A's
  // phone would land on A's last screen (a job detail, someone's profile).
  // No data leaks (ProtectedRoute and RLS still gate it), yet it plainly
  // isn't B's app. Cheap to clear, so clear it.
  clearRememberedRoute();
  const result = await supabase.auth.signOut(options);

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
  try {
    queryClient.clear();
    await removePersistedClient();
  } catch (err) {
    console.error("[signOut] cache wipe failed — prior user data may persist", err);
  }

  return result;
}
