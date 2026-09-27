/**
 * Client-side MIME allow-lists for the upload sites that had none (Q54).
 *
 * Supabase Storage refuses any type outside a bucket's `allowed_mime_types`
 * (matched literally). A picker that offers `image/*` with no check here lets
 * a GIF, SVG or desktop HEIC through to a raw storage error, so each list is
 * the subset of its bucket's newest `allowed_mime_types` that the site takes,
 * and every site checks the file against it BEFORE uploading.
 * src/test/uploadMimeParity.test.ts proves each list stays inside its bucket.
 */

/** proof-photos: jpeg/png/webp/heic (20260921092104_cap_private_storage_buckets.sql). */
export const PROOF_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** Review photos go to job-photos, which takes no HEIC (20260915055517_storage_bucket_limits.sql). */
export const REVIEW_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Support screenshots go to user-documents (images only here; the bucket also takes PDF). */
export const SUPPORT_SCREENSHOT_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic"];

/** application-attachments: jpeg/png/webp/heic/pdf. No Word documents. */
export const APPLICATION_ATTACHMENT_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
];

/** True when the file's reported MIME type is on the list. An empty type never is. */
export function isAllowedUploadType(file: { type: string }, allowed: readonly string[]): boolean {
  return allowed.includes((file.type || "").toLowerCase());
}

/** The toast for a refused file, naming the formats the site takes. */
export function unsupportedUploadCopy(file: { name: string }, formats: string): string {
  return `"${file.name}" isn't a supported file type. Use ${formats}.`;
}
