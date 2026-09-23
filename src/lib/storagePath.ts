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

/**
 * A stored value that is NOT a storage path, made safe to hand to the DOM as
 * an href / src / window.open target — or null.
 *
 * "Not a storage path" is not "safe to render". `profiles.id_document_url` and
 * `helper_credentials.license_url` / `insurance_url` are client-writable on the
 * caller's own row with no shape CHECK, so a user can store
 * `javascript:fetch(…document.cookie)`. React 18 renders a `javascript:` href
 * (warning only) and the CSP allows 'unsafe-inline', so an admin clicking
 * "Open" on that document ran the script in the admin session (review of
 * 12285cc92, 2026-09-23). Only two shapes pass: `https:` and a raster
 * `data:image/…` (the seed fixtures). Everything else — `javascript:`,
 * `vbscript:`, `data:text/html`, `data:image/svg+xml`, `http:`, `blob:`,
 * `file:`, protocol-relative — is refused.
 *
 * `src/test/storagePathRenderIsAllowlisted.test.ts` requires every
 * `!isStorageObjectPath(…)` branch that renders or opens the value to go
 * through this.
 */
export function safeDocumentUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (/^https:\/\/[^\s]+$/i.test(v)) {
    try {
      return new URL(v).protocol === "https:" ? v : null;
    } catch {
      // Unparseable as a URL: refusing it IS the answer, not a swallowed error.
      return null;
    }
  }
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  return null;
}
