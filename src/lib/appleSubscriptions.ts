/**
 * Q1797 (App Store 3.1.1, lh-compliance-store@c16b0f0dc#4): a membership bought
 * through Apple is managed, cancelled and refunded by Apple, never by our
 * Stripe portal (which has no record of it). This is Apple's own
 * manage-subscriptions page; on iOS the WebView hands this external host to the
 * system, which opens the App Store's subscriptions sheet.
 */
export const APPLE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

export function openAppleSubscriptions(): void {
  window.location.assign(APPLE_SUBSCRIPTIONS_URL);
}
