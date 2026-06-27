export const getPublicResetPasswordUrl = () => {
  const publishedUrl = "https://www.louisianahelpr.com";

  return `${publishedUrl}/reset-password`;
};

export const getPublicSiteUrl = () => {
  return "https://www.louisianahelpr.com";
};

/**
 * Sanitize a post-login `?redirect=` target. Returns the path only when it
 * is a safe SAME-ORIGIN relative path — guarding against open-redirect
 * attacks where a crafted `?redirect=https://evil.com` or `//evil.com`
 * would bounce an authenticated user off-site. Anything that isn't a single
 * leading-slash relative path (no scheme, no protocol-relative `//`, no
 * backslash trick) is rejected and the caller should fall back to its
 * default destination.
 */
export const safeInternalRedirect = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null; // malformed encoding
  }
  // Must be a relative path anchored at root, and NOT a protocol-relative
  // (`//host`) or backslash (`/\host`) URL that browsers treat as absolute.
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // Never loop a user back onto an auth screen.
  if (/^\/(login|signup|forgot-password|reset-password)\b/.test(value)) return null;
  return value;
};