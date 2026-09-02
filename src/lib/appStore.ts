/**
 * The one App Store listing URL.
 *
 * It lived only in Footer.tsx until the force-update gate needed it too, and
 * the two copies must not be allowed to drift: on the Footer a stale URL is a
 * broken marketing link, but on the force-update screen it is the PRIMARY way
 * out of a blocked app. A user turned away by the gate has no navigation, no
 * tabs, and no route anywhere else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️  THIS URL DOES NOT RESOLVE TODAY. VERIFY IT BEFORE ARMING THE GATE.
 *
 * Probed 2026-09-01, from four storefronts and by name, all negative:
 *
 *   curl -sIL https://apps.apple.com/us/app/helpr/id6754470134   → HTTP 404
 *   curl -sIL https://apps.apple.com/app/id6754470134            → HTTP 404
 *   itunes.apple.com/lookup?id=6754470134&country=us|gb|ca|au    → resultCount 0
 *   itunes.apple.com/search?term=louisiana+helpr&entity=software → no Helpr result
 *
 * The lookup API keys on the numeric id, not the slug, so this is not a
 * renamed-slug problem: id 6754470134 is not a publicly listed app in any of
 * those storefronts. Either the listing has never gone live (consistent with
 * the app sitting in review — the very situation force-update exists for), or
 * the id is wrong.
 *
 * Two consequences, and the second is the one that bites:
 *   · On the Footer this has always been a dead "Download on the App Store"
 *     badge. Bad, but cosmetic, and it has been shipping that way.
 *   · On the force-update screen a dead link turns a hard block into a DEAD
 *     END — the exact outcome that screen is designed to avoid. Which is why
 *     ForceUpdateGate also carries the support address: that escape does not
 *     depend on this string being right.
 *
 * So: confirm this resolves (the two curls above, expecting 200) before
 * setting `platform_settings.min_supported_build` to anything above 0. The
 * Admin → Settings card says the same thing where an operator will see it.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
