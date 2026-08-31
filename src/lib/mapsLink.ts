import { isNativePlatform } from "@/lib/nativeInit";

/**
 * A "get directions" URL that does not hand somebody's front door to Google.
 *
 * The job cards linked to `https://www.google.com/maps?q=<lat>,<lng>` with four
 * decimal places — about eleven metres, which on a residential job is the house.
 * The recipient is entitled to the address; that is not the issue. The issue is
 * that the precise coordinates of a private home travelled to a third party in
 * a URL query string, on every tap, for a convenience the ADDRESS serves just
 * as well (owner: "stop sending coordinates to Google").
 *
 * So: the address goes, the coordinates stay. A maps search on a street address
 * lands the driver in the same place, and the poster typed that address into a
 * form knowing the helpr would receive it.
 *
 * Provider by platform, because "open directions" should use the maps app the
 * device actually has:
 *   - iOS (native shell)  → `maps://` opens Apple Maps directly.
 *   - Android (native)    → `geo:` is the platform's own intent, so the user's
 *                           default maps app answers rather than a hardcoded one.
 *   - Web                 → `maps.apple.com`'s documented search URL (owner,
 *                           2026-08-31: "in browser it should open to Apple
 *                           Maps also") — Apple Maps' own web front end,
 *                           consistent with the app's Browse map already
 *                           being Apple MapKit. On iOS Safari it deep-links
 *                           straight into the native Apple Maps app the same
 *                           as the `maps://` branch; every other browser
 *                           lands on Apple's own web map, which needs no
 *                           account and resolves an address the same way
 *                           Google's did.
 */
export function mapsSearchUrl(address: string): string {
  const q = encodeURIComponent(address.trim());
  if (!q) return "";
  if (isNativePlatform) {
    // `navigator.platform` is unreliable inside a WebView; Capacitor's own
    // platform string is not, but importing @capacitor/core here would pull the
    // bridge onto the web bundle for a link. The UA check is enough to pick
    // between two schemes that both degrade to "the OS opens its maps app".
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return isIOS ? `maps://?q=${q}` : `geo:0,0?q=${q}`;
  }
  return `https://maps.apple.com/?q=${q}`;
}

export default mapsSearchUrl;
