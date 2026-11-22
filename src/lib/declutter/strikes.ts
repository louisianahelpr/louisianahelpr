import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * When each active Declutter strike goes away (rows 7, 16, 17: not removed, not expired), soonest first. THE one
 * strikes read: Declutter's "You have N of 3 strikes" (fetchMyActiveStrikes, below) and the account's Warnings and
 * strikes tab (deep audit 1122 #136: it said "Good standing, no warnings or violations on record" to a member
 * Declutter counted at 1 of 3) both count these rows.
 */
export async function fetchMyActiveStrikeEnds(userId: string): Promise<string[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_strikes")
      .select("id, expires_at")
      .eq("user_id", userId)
      .is("removed_at", null)
      .gt("expires_at", new Date().toISOString()),
  ) as { expires_at: string | null }[] | null;
  return (rows ?? []).map((r) => r.expires_at ?? "").sort();
}

/** Active Declutter strikes (rows 7, 16, 17): not removed, not expired. The count of fetchMyActiveStrikeEnds. */
export async function fetchMyActiveStrikes(userId: string): Promise<number> {
  return (await fetchMyActiveStrikeEnds(userId)).length;
}

/** Deep audit 11-22 #40: why each active strike was given and when it goes away (read only when "Why?" is tapped). */
export async function fetchMyActiveStrikeReasons(userId: string): Promise<{ reason: string; expires_at: string }[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_strikes")
      .select("reason, expires_at")
      .eq("user_id", userId)
      .is("removed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("given_at", { ascending: true }),
  );
  return (rows ?? []) as { reason: string; expires_at: string }[];
}
