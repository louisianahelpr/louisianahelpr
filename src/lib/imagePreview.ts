/**
 * Validates that a URL is safe to render in an <img src>. Only accepts
 * `blob:` URLs (created via URL.createObjectURL for in-memory file
 * previews) to prevent javascript: or other unsafe schemes from being
 * injected as preview sources.
 */
export function isSafePreviewUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "blob:";
  } catch {
    return false;
  }
}
