import { supabase } from "@/integrations/supabase/client";

const BUCKET = "application-attachments";

/**
 * Extracts the storage path from either a raw path or a legacy public URL.
 * Legacy URLs look like: .../storage/v1/object/public/application-attachments/<path>
 */
export function extractAttachmentPath(urlOrPath: string): string {
  if (!urlOrPath) return "";
  const marker = `/${BUCKET}/`;
  const idx = urlOrPath.indexOf(marker);
  if (idx >= 0) return urlOrPath.slice(idx + marker.length);
  return urlOrPath; // already a path
}

/**
 * Returns a short-lived signed URL for an attachment.
 * Accepts either a storage path or a legacy public URL.
 */
export async function getAttachmentSignedUrl(
  urlOrPath: string,
  expiresInSeconds = 60 * 10
): Promise<string | null> {
  const path = extractAttachmentPath(urlOrPath);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Derives a friendly filename from a path or URL.
 */
export function getAttachmentFilename(urlOrPath: string, fallback = "File"): string {
  try {
    const path = extractAttachmentPath(urlOrPath);
    const last = path.split("/").pop() || fallback;
    return decodeURIComponent(last);
  } catch {
    return fallback;
  }
}
