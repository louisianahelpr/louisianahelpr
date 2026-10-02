/**
 * Storage key extension, derived from the file's MIME TYPE — never the name.
 *
 * `file.name.split(".").pop()` was the extension for a storage object key at
 * ~11 upload sites across the app. `File.name` is client-chosen text: a file
 * named `x.php`, `x.html`, or `x` (no dot, so `.split(".").pop()` returns the
 * whole name) lands with an attacker-chosen or garbage extension. See
 * `docs/OPEN.md` LIVE DEFECT #5 and, for the same class already fixed
 * server-side, `supabase/functions/_shared/storageKeys.ts`.
 *
 * This map is the one allowlist every upload site now shares. Checked
 * 2026-10-02 against prod's `select id, allowed_mime_types from
 * storage.buckets` (read-only): application-attachments, avatars,
 * job-photos, marketing-media, message-attachments, proof-photos and
 * user-documents between them allow exactly the image/video types this map
 * has entries for (plus audio types on message-attachments and a `gif`
 * entry no site here still emits) — no value in this map resolves to a type
 * any relevant bucket refuses.
 */
const MIME_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * The extension to use in a storage object key for `file`, derived ONLY from
 * `file.type`. Falls back to `fallbackExt` (caller-supplied, e.g. the site's
 * own pre-existing default) when the MIME type isn't in the map above — never
 * falls back to anything read off `file.name`.
 */
export function storageExtFor(file: { type: string }, fallbackExt: string): string {
  return MIME_EXT[(file.type || "").toLowerCase()] ?? fallbackExt;
}
