// Small, dependency-free helpers used by edge functions that handle
// user-supplied notification copy or links. Two failure modes drove these:
//
//   1. send-notification-email interpolated ${title} / ${message} straight
//      into an HTML template, so a single `<script>` from a malicious caller
//      would render in the recipient's mail client.
//   2. create-notification accepted any `link` string and stored it on a
//      notification row, so `https://evil.com` could ride alongside an
//      otherwise-legitimate-looking push.
//
// Both functions now route copy through htmlEscape and links through
// sanitizeSameOriginLink before persisting or rendering.

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "/": "&#x2F;",
};

export function htmlEscape(input: unknown): string {
  if (input == null) return "";
  return String(input).replace(/[&<>"'/]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

// Same-origin path: must be a server-relative path starting with `/` (but
// not `//`, which is protocol-relative), containing no scheme separator,
// no backslashes (Windows path tricks), and no whitespace.
// Returns the cleaned link, or null when the input fails any check.
export function sanitizeSameOriginLink(link: unknown): string | null {
  if (link == null) return null;
  if (typeof link !== "string") return null;
  if (link.length === 0) return null;
  if (link.length > 2048) return null;
  if (!link.startsWith("/")) return null;
  if (link.startsWith("//")) return null;
  if (link.includes("://")) return null;
  if (link.includes("\\")) return null;
  if (/\s/.test(link)) return null;
  return link;
}

// Constant-time string compare. Use for any secret comparison (service-role
// bearer, CRON_SECRET, webhook signing secret) to deny timing-based oracles.
// Returns false immediately on length mismatch — the lengths of these
// secrets are not themselves secret, so this is the standard pattern.
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
