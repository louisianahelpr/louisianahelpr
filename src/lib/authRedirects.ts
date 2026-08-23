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
  // Tab / newline / NUL and other C0 controls are STRIPPED by the URL parser
  // before a browser resolves a location, so `"/\t/evil.com"` becomes
  // `"//evil.com"` — a protocol-relative URL — after the prefix checks below
  // have already waved it through. Reject anything carrying a control
  // character outright rather than trying to normalize it. Space (0x20) goes
  // with them: leading/trailing spaces are trimmed by the same parser, and no
  // route in this app has one in its path, so there is nothing to lose.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  // Must be a relative path anchored at root, and NOT a protocol-relative
  // (`//host`) or backslash (`/\host`) URL that browsers treat as absolute.
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // Belt-and-braces: a same-origin path has no scheme. Anything with a colon
  // before the first `?`/`#` is not a path we recognize.
  if (/^[^?#]*:/.test(value)) return null;
  // Never loop a user back onto an auth screen.
  if (/^\/(login|signup|forgot-password|reset-password)\b/.test(value)) return null;
  return value;
};