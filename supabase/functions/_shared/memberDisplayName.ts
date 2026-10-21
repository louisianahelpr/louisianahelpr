/**
 * A member's name as another member may see it: "First L." (owner rule 2026-10-21: never a last name,
 * only its first letter). The same rule as formatName (src/lib/utils.ts) and the SQL helper
 * public.member_display_name (20261021061341_member_display_name.sql), for text an edge function writes
 * into a notification, push or email that another member reads (Q2292). Staff screens keep full names.
 */
import { caughtMessage } from "./caughtMessage.ts";
export function memberDisplayName(fullName: string | null | undefined, fallback = "A neighbor"): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}.`;
}

/** What a deleted member is called in another member's notice (src/lib/deletedPerson.ts FORMER_MEMBER_LABEL, in a sentence). */
const FORMER_MEMBER_IN_A_SENTENCE = "A former member";

/**
 * Member `userId`'s name for a notice `reader` reads, through memberDisplayName ("First L.").
 * No profile row (the account was deleted) reads "A former member"; a block between the two (either way),
 * a blank name, a failed read or no id reads `fallback`. Never throws: the name is words in a notice, and
 * the money path that writes it must not stop for it (a failed read is logged).
 */
export async function memberDisplayNameOf(
  db: { from: (t: string) => any },
  userId: string | null | undefined,
  reader: string,
  fallback: string,
): Promise<string> {
  if (!userId) return fallback;
  try {
    // Never across a block (the SQL producers' rule, notify_on_application): the ids are server-side uuids.
    const { data: blocks, error: blockErr } = await db
      .from("user_blocks")
      .select("blocker_id")
      .or(`and(blocker_id.eq.${userId},blocked_id.eq.${reader}),and(blocker_id.eq.${reader},blocked_id.eq.${userId})`)
      .limit(1);
    if (blockErr) {
      console.warn(`[memberDisplayNameOf] block read failed for ${userId}: ${blockErr.message}; the notice says "${fallback}"`);
      return fallback;
    }
    if (Array.isArray(blocks) && blocks.length > 0) return fallback;
    const { data, error } = await db.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
    if (error) {
      console.warn(`[memberDisplayNameOf] profile read failed for ${userId}: ${error.message}; the notice says "${fallback}"`);
      return fallback;
    }
    if (!data) return FORMER_MEMBER_IN_A_SENTENCE;
    return memberDisplayName((data as { full_name?: string | null }).full_name, fallback);
  } catch (e) {
    // A thrown read (network) is the same as a failed one: logged, and the notice says the fallback.
    console.warn(`[memberDisplayNameOf] profile read threw for ${userId}: ${caughtMessage(e)}`);
    return fallback;
  }
}
