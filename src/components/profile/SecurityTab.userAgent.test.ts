/**
 * The native app must not be listed as a browser in a user's session list.
 *
 * This is the regression these tests exist for: the WKWebView UA satisfies
 * BOTH the Safari test and the Helpr-app test, and the app test used to sit
 * LAST — so a user's own phone showed up as "iPhone · Safari" on the one
 * screen people read to spot an intrusion.
 */
import { describe, it, expect } from "vitest";
import { parseUserAgent } from "./SecurityTab";

// A real iOS WKWebView UA with capacitor.config.ts's appendUserAgent applied.
// Note it contains "Safari" AND "HelprApp" — that overlap is the whole point.
const IOS_APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 HelprApp";

const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const ANDROID_APP_UA =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/120.0.0.0 Mobile Safari/537.36 HelprApp";

describe("parseUserAgent", () => {
  it("labels the iOS app as the app, not Safari", () => {
    expect(parseUserAgent(IOS_APP_UA).label).toBe("iPhone · Helpr app");
  });

  it("still labels real mobile Safari as Safari", () => {
    expect(parseUserAgent(IOS_SAFARI_UA).label).toBe("iPhone · Safari");
  });

  it("labels the Android app as the app, not Chrome", () => {
    // The Android WebView UA contains "Chrome/" too, so this pins the same
    // precedence rule against a different competing branch.
    expect(parseUserAgent(ANDROID_APP_UA).label).toBe("Android phone · Helpr app");
  });

  it("keeps the phone icon for the app, not a desktop fallback", () => {
    expect(parseUserAgent(IOS_APP_UA).icon).toBe("phone");
  });

  it("falls back safely with no UA at all", () => {
    expect(parseUserAgent(null).label).toBe("Unknown device");
  });
});
