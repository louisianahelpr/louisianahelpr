
/**
 * The device-label parser for You › Security's "Signed in on" rows
 * (SignedInDevicesCard, board 175). The old login_history grouping read that
 * lived here went with the old "Active sessions" card it fed.
 */
type DeviceIcon = "phone" | "tablet" | "desktop";

// Coarse device fingerprint from a User-Agent string. Two sessions on
// the same physical device produce identical labels (e.g. "iPhone ·
// Safari") so we group instead of listing N near-duplicate rows.
export function parseUserAgent(ua: string | null): { label: string; icon: DeviceIcon } {
  if (!ua) return { label: "Unknown device", icon: "desktop" };
  const lower = ua.toLowerCase();
  let device = "Desktop";
  let icon: DeviceIcon = "desktop";
  if (lower.includes("iphone")) { device = "iPhone"; icon = "phone"; }
  else if (lower.includes("ipad")) { device = "iPad"; icon = "tablet"; }
  else if (lower.includes("android")) {
    device = lower.includes("mobile") ? "Android phone" : "Android tablet";
    icon = device.includes("tablet") ? "tablet" : "phone";
  } else if (lower.includes("macintosh") || lower.includes("mac os")) device = "Mac";
  else if (lower.includes("windows")) device = "Windows PC";
  else if (lower.includes("linux")) device = "Linux PC";

  // Browser hint — keeps two devices that share a chassis distinguishable.
  //
  // ORDER MATTERS, and it used to be wrong. The native shell is a WKWebView,
  // whose UA is Safari's with our own token appended — so it satisfies BOTH
  // the Safari test and this one. With the app test last, Safari always won
  // and a user's own phone was listed as a browser in their session list,
  // which is actively misleading on a screen people read to spot intrusions.
  // The app test now runs FIRST, so the more specific match wins.
  //
  // The token comes from `appendUserAgent: 'HelprApp'` in capacitor.config.ts.
  // Before that existed this branch was unreachable no matter where it sat.
  let browser = "";
  if (lower.includes("helprapp") || lower.includes("capacitor")) browser = "Helpr app";
  else if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("chrome/") && !lower.includes("chromium")) browser = "Chrome";
  else if (lower.includes("firefox")) browser = "Firefox";
  else if (lower.includes("safari") && !lower.includes("chrome")) browser = "Safari";

  const label = browser ? `${device} · ${browser}` : device;
  return { label, icon };
}
