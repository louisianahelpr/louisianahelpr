import { supabase } from "@/integrations/supabase/client";

/**
 * Private buckets require signed URLs; public buckets can use getPublicUrl.
 */
const PRIVATE_BUCKETS = new Set([
  "id-documents",
  "user-documents",
  "proof-photos",
  "application-attachments",
]);

/**
 * Extracts the storage path from a full Supabase storage URL.
 * Returns the original string if it's already a bare path.
 */
function extractPath(bucket: string, urlOrPath: string): string {
  if (!urlOrPath.startsWith("http")) return urlOrPath;
  // URL format: .../storage/v1/object/public/<bucket>/<path>
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = urlOrPath.indexOf(marker);
  if (idx !== -1) return urlOrPath.slice(idx + marker.length).split("?")[0];
  // Also handle signed URL format
  const signedMarker = `/storage/v1/object/sign/${bucket}/`;
  const sIdx = urlOrPath.indexOf(signedMarker);
  if (sIdx !== -1) return urlOrPath.slice(sIdx + signedMarker.length).split("?")[0];
  return urlOrPath;
}

/**
 * Get a usable URL for a file in any bucket (handles private + public).
 * Returns null on failure.
 */
export async function getStorageUrl(
  bucket: string,
  urlOrPath: string
): Promise<string | null> {
  if (!urlOrPath) return null;

  // If it's already a full URL to a PUBLIC bucket, return as-is
  if (urlOrPath.startsWith("http") && !PRIVATE_BUCKETS.has(bucket)) {
    return urlOrPath;
  }

  const path = extractPath(bucket, urlOrPath);

  if (PRIVATE_BUCKETS.has(bucket)) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600); // 1 hour
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * After uploading to a bucket, get the storable reference (just the path).
 * For private buckets we store the path only; for public buckets we store the full URL.
 */
export function getStorableUrl(bucket: string, path: string): string {
  if (PRIVATE_BUCKETS.has(bucket)) {
    return path; // store path only
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
