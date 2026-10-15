// Store purchase pause (roadmap F5, owner 2026-10-14): boosts are NOT sold
// inside the iPhone app for now, job boosts and shop/business boosts alike.
// They sell on the website only until in-app purchase is revisited.
//
// This is one of the few places the app branches on the native platform, and
// it does so on purpose: CLAUDE.md's "phone web == native app, never branch on
// Capacitor.isNativePlatform()" rule covers layout and navigation, and makes an
// exception for a genuine native capability or constraint. Apple's App Store
// rules on selling digital goods inside an iOS app (guideline 3.1.1) are such a
// constraint: they bind the iOS binary, not the website in a phone browser.
//
// The server is the protection, not this flag: create-boost-payment refuses a
// paid boost for a request that says it comes from the iOS app.

/** The Capacitor runtime platform: "ios", "android" or "web". */
export function runtimePlatform(): string {
  if (typeof window === "undefined") return "web";
  return (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "web";
}

/** True inside the iPhone app, where boosts are not sold (F5). */
export function boostPurchasePausedHere(): boolean {
  return runtimePlatform() === "ios";
}
