/**
 * The one App Store listing URL.
 *
 * It lived only in Footer.tsx until the force-update gate needed it too, and
 * the two copies must not be allowed to drift: on the Footer a stale URL is a
 * broken marketing link, but on the force-update screen it is the PRIMARY way
 * out of a blocked app. A user turned away by the gate has no navigation, no
 * tabs, and no route anywhere else.
 *
 * LIVE since 2026-11-19 (1.0.4 on sale). Re-probed 2026-11-23:
 *
 *   curl -sIL https://apps.apple.com/us/app/helpr/id6754470134
 *     → HTTP 200 (redirects to /us/app/louisiana-helpr/id6754470134)
 *   itunes.apple.com/lookup?id=6754470134&country=us → resultCount 1, com.Helpr 1.0.4
 *
 * `npm run launch:appstore` re-runs both probes and compares them with this
 * file and index.html's Smart App Banner.
 */
export const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";

/**
 * Is the listing live? YES, since Apple released 1.0.4 on 2026-11-19 (Q1289).
 * Every App Store link and badge was hidden while it 404'd (owner, 2026-10-04,
 * Q1124). Footer's Apple chip and ForceUpdateGate's "Update on the App Store"
 * button still render only when this is true, and index.html's Smart App
 * Banner carries the same id; src/test/appStoreLinksHiddenUntilLive.test.ts
 * holds all three to this flag (and to fastlane's apple_id).
 */
export const APP_STORE_LISTING_LIVE: boolean = true;
