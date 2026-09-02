/**
 * The one App Store listing URL.
 *
 * It lived only in Footer.tsx until the force-update gate needed it too, and
 * the two copies must not be allowed to drift: on the Footer a stale URL is a
 * broken marketing link, but on the force-update screen it is the ONLY way out
 * of a blocked app. A user turned away by the gate has no navigation, no tabs,
 * and no route to anywhere else — if this string is wrong they are stuck with
 * a support email and nothing else.
 *
 * `id6754470134` is the live listing (App Store Connect, Helpr).
 */
export const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
