import { supabase } from "@/integrations/supabase/client";

/**
 * `profiles.avatar_url` for this user as it is right now.
 *
 * The `read` half of the `AvatarProfileRow` handed to `replaceAvatarObject`:
 * the sweep keeps whatever object this names, so a second replacement racing
 * from another tab cannot delete the photo the row was just pointed at.
 * Throws on a failed read — the sweep then removes nothing, rather than
 * guessing.
 */
export async function readProfileAvatarUrl(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.avatar_url ?? null;
}
