import { supabase } from "@/integrations/supabase/client";
import { unregisterPushOnSignOut } from "@/lib/nativePush";
import { clearRememberedRoute } from "@/lib/lastRoute";

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
  return supabase.auth.signOut(options);
}
