/**
 * Cold-launch navigation mutex.
 *
 * Two cold-launch code paths can both call navigate() on the same tick:
 *   1. NativeLaunchRouter — runs in a useEffect, resolves async, then
 *      replaces "/" with the right post-auth route.
 *   2. nativePush.ts — App.getLaunchUrl() + the appUrlOpen listener,
 *      both async. If the app was opened from a Universal Link
 *      (/jobs/:id, /m/:id, /post-job), this calls navigate(internal).
 *
 * Their order is non-deterministic, so a deep-link arrival could win
 * the race and navigate to /m/abc, then NativeLaunchRouter resolves
 * (still holding initialPath="/") and overrides with /dashboard.
 *
 * This shared flag lets the deep-link handler claim navigation first.
 * NativeLaunchRouter checks the flag before its own navigate() call and
 * bails out if a deep-link already steered us somewhere intentional.
 *
 * Module-level singleton; no React state needed. Safe to re-import.
 */
let deepLinkClaimed = false;

/** Called by the deep-link handler before its first navigate() on cold launch. */
export function claimDeepLinkLaunch(): void {
  deepLinkClaimed = true;
}

/** Called by NativeLaunchRouter to decide whether to skip its own navigate(). */
export function wasDeepLinkClaimed(): boolean {
  return deepLinkClaimed;
}
