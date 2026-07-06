import { supabase } from "@/integrations/supabase/client";
import { unregisterPushOnSignOut } from "@/lib/nativePush";

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
  return supabase.auth.signOut(options);
}
