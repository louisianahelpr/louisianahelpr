/**
 * Q379: no Session Replay for a test profile.
 *
 * The Sentry replay quota (50/month) was spent by the seed and e2e accounts:
 * of the replays accepted 2026-09-13..14, every one but the owner's belonged
 * to a helpr-e2e-* or helpr-seed-* account. navigator.webdriver (Q275) stops a
 * Playwright-LAUNCHED browser, but Playwright attached over CDP to a normally
 * launched Chrome reports webdriver=false. `profiles.is_seed` is the one flag
 * every test account carries (measured 2026-09-25: all 54 mailinator accounts
 * are is_seed), so the boot path reads it once per sign-in and blocks replay.
 *
 * A failed read keeps replay as it was: it is the real user's session that a
 * wrong "block" would lose, and replay is diagnostics, not a user-facing path.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type ProfileReader = Pick<SupabaseClient, "from">;

/** Resolves true when the profile is a test profile and replay was blocked. */
export async function blockReplayIfTestProfile(
  client: ProfileReader,
  userId: string,
  block: () => void,
): Promise<boolean> {
  const { data, error } = await client
    .from("profiles")
    .select("is_seed")
    .eq("user_id", userId)
    .maybeSingle();
  // A read error leaves replay on (see the header): nothing to block on.
  if (error || !data) return false;
  if ((data as { is_seed?: boolean | null }).is_seed !== true) return false;
  block();
  return true;
}
