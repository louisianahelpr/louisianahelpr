// Uploading marketing art to the PUBLIC `marketing-media` bucket.
//
// The bucket is public by necessity, not by preference: Instagram's Content
// Publishing API fetches the image from a URL server-side, so a signed URL
// cannot be used (the migration says the same thing at the bucket definition).
// Only admin-uploaded marketing art belongs here — never user content, never
// job photos.
//
// Follows the `job-photos` pattern in `ReviewForm.tsx` (public bucket, upload
// then `getPublicUrl`, permanent URL) rather than the signed-URL pattern used
// for private buckets like `proof-photos`.

import { supabase } from "@/integrations/supabase/client";

export const MARKETING_MEDIA_BUCKET = "marketing-media";

/**
 * Client-side size guard. The bucket declares no `file_size_limit` of its own,
 * so this is OUR ceiling, not the bucket's — it exists to fail fast with a
 * sentence instead of letting a 40MB Canva export turn into a slow upload and
 * a raw 413 the recovery path would read as a network error.
 */
export const MARKETING_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Accepted types, mapped to the one canonical extension each — derived from
 * the content type, never from the file name, for the reason `avatarStorage`
 * documents at length (a name is user-controlled text that happens to end in a
 * dot and some letters).
 */
export const MARKETING_MEDIA_MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MARKETING_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Instagram's Content Publishing API is documented as accepting JPEG for image
 * posts; PNG and WebP are NOT confirmed to work and may be rejected at publish
 * time. This is surfaced to the owner as a warning rather than enforced as a
 * rule, because it has not been verified against current platform docs here —
 * blocking on an unverified limit is its own failure.
 */
export const INSTAGRAM_PREFERRED_MIME = "image/jpeg";

export class MarketingMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketingMediaError";
  }
}

/** Reject a file the upload would fail on, with copy the owner can act on. */
export function assertUploadableMarketingMedia(file: { type: string; size: number }): void {
  if (!MARKETING_MEDIA_MIME_EXT[(file.type || "").toLowerCase()]) {
    throw new MarketingMediaError(
      `That file type isn't supported${file.type ? ` (${file.type})` : ""} — use JPG, PNG or WebP.`,
    );
  }
  if (file.size > MARKETING_MEDIA_MAX_BYTES) {
    throw new MarketingMediaError(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — marketing images are capped at 8 MB.`,
    );
  }
}

/**
 * Upload one image and return its PUBLIC url — the value that goes into
 * `media_urls`.
 *
 * Every upload gets a fresh key rather than overwriting a per-post one. That is
 * deliberate and is the opposite of the avatar rule: a PUBLISHED post's image
 * is referenced by a live Instagram/Facebook post, so reusing a key would
 * change the picture under a post that is already out in the world. Replacing
 * an image on a draft therefore leaves the previous object in the bucket; it is
 * admin-only marketing art in a bucket with no user data in it, so an orphan
 * costs storage and nothing else.
 */
export async function uploadMarketingMedia(file: File): Promise<string> {
  assertUploadableMarketingMedia(file);

  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) {
    throw new MarketingMediaError("You're signed out — sign in again to upload an image.");
  }

  const ext = MARKETING_MEDIA_MIME_EXT[file.type.toLowerCase()];
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(MARKETING_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from(MARKETING_MEDIA_BUCKET).getPublicUrl(path);
  const publicUrl = urlData?.publicUrl;
  // A missing URL is the same outcome as a failed upload — an image the owner
  // believes is attached and isn't — so it is treated as one rather than
  // returning an empty string that would later fail the Instagram CHECK.
  if (!publicUrl) {
    throw new MarketingMediaError(
      "The image uploaded but no public URL came back — Instagram needs one, so try again.",
    );
  }
  return publicUrl;
}
