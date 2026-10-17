import { supabase } from "@/integrations/supabase/client";
import { isStorageObjectPath } from "@/lib/storagePath";

/**
 * A signed URL (10 minutes) for a task photo the caller may read. A path that
 * is not one is null (nothing to show); a refusal or a storage error THROWS,
 * so the screen says the photo couldn't load instead of hiding the delivery's
 * evidence (lh-silent-failure review #6, 2026-10-16).
 */
export async function taskPhotoUrl(path: string): Promise<string | null> {
  if (!isStorageObjectPath(path)) return null;
  const { data: signed, error } = await supabase.storage.from("helpr-tasks").createSignedUrl(path, 600);
  if (error || !signed?.signedUrl) throw new Error("photo_unavailable");
  return signed.signedUrl;
}
