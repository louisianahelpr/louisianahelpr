/**
 * Q1174: the web service worker used to route every `https://*.supabase.co/*`
 * GET through Workbox NetworkFirst into Cache Storage `api-cache` (50 entries,
 * 300 s), so the signed-in user's rows (profile, applications, messages) were
 * written to disk on every load. vite.config.ts no longer has that rule, but a
 * device that already ran the old worker still holds the cache, and Workbox
 * only expires entries when a rule writes to it, so with the rule gone nothing
 * would ever evict them. This deletes it: on sign-out (a shared device must not
 * keep the previous account's rows) and once per page load in production (a
 * device whose last user already signed out).
 *
 * Never throws and never blocks: cache cleanup is not worth a failed sign-out.
 * A failure is logged, not dropped, because a swallowed error here is the leak.
 */
const LEGACY_API_CACHE_NAME = "api-cache";

export async function purgeApiCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await caches.delete(LEGACY_API_CACHE_NAME);
  } catch (err) {
    console.error("[apiCachePurge] could not delete the api-cache — signed-in responses may persist on disk", err);
  }
}
