/**
 * Is this stored value an object path that Supabase Storage can sign?
 *
 * `createSignedUrl(path)` is a POST to `/storage/v1/object/sign/<bucket>/<path>`.
 * Hand it something that is already a URL and the path segment becomes that
 * URL, and Storage answers HTTP 400. Measured on prod 2026-09-22: 52 seed
 * profiles carry `id_document_url = 'data:image/png;base64,…'` (a 1x1 PNG
 * fixture), so opening any of them on admin → People fired
 * `POST …/object/sign/id-documents/data:image/png;base64,…` → 400, and the
 * Documents tab sat on "Loading document…" forever. The press-every-control
 * sweep (issue #1582) recorded it as `400 POST data:image/png;base64,…`.
 *
 * A value with a URL scheme (`data:`, `blob:`, `http(s):`, …) is already
 * something a browser can open; it is not ours to sign. Callers show it as-is
 * (or not at all) instead of sending it to Storage.
 *
 * `src/test/signedUrlOnlyForStoragePaths.test.ts` requires every
 * `createSignedUrl(s)` call in `src/` to be gated by this function.
 */
export function isStorageObjectPath(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v) return false;
  // Any URI scheme: `data:`, `blob:`, `http:`, `https:`, `file:` …
  // A storage path never contains a colon before its first slash.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;
  // Protocol-relative URL.
  if (v.startsWith("//")) return false;
  return true;
}
