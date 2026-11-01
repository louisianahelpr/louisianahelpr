/**
 * What may reach a listing photo's <img src> (CodeQL #519, lead 2026-11-01): https on our own Supabase storage host
 * (photoPublicUrl, pagePhotoUrl, signed links), a same-origin path, or a blob: object URL (a local preview of a picked
 * file; only page script can mint one). Anything else is undefined, and FallbackImg shows its placeholder instead.
 */
const STORAGE_ORIGIN = (() => {
  try {
    return new URL(String(import.meta.env.VITE_SUPABASE_URL ?? "")).origin;
  } catch {
    // No or malformed VITE_SUPABASE_URL: no storage origin, so only same-origin paths and blob: previews pass.
    return null;
  }
})();

export function safePhotoSrc(raw: string | undefined, storageOrigin: string | null = STORAGE_ORIGIN): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) return raw;
  try {
    const url = new URL(raw, window.location.href);
    if (url.protocol === "blob:") return raw;
    if (url.protocol === "https:" && storageOrigin && url.origin === storageOrigin) return url.href;
  } catch {
    // not a URL: nothing to show
  }
  return undefined;
}

/** A srcSet whose every candidate passes safePhotoSrc, or undefined. */
export function safePhotoSrcSet(raw: string | undefined, storageOrigin: string | null = STORAGE_ORIGIN): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const ok = parts.map((p) => {
    const [u, ...rest] = p.split(/\s+/);
    const safe = safePhotoSrc(u, storageOrigin);
    return safe ? [safe, ...rest].join(" ") : null;
  });
  return ok.length > 0 && ok.every(Boolean) ? ok.join(", ") : undefined;
}
