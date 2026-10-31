import { useEffect } from "react";
import { prefetchRoutesWhenIdle } from "@/lib/routePrefetch";
import { transformedImageUrl } from "@/lib/imageUrl";

/**
 * Warm the tab chunks while the user is reading the page they're already on.
 * The per-tab `onPrefetch` (hover / focus / touchstart) was the only caller of
 * `prefetchRoute`, and on a phone touchstart lands a handful of ms before the
 * tap — so every tab switch still paid the full lazy-chunk waterfall.
 * Messages is the worst of them: three dependent levels of chunk before its
 * first inbox query is even issued. See `prefetchRoutesWhenIdle` for the
 * measurement. Skipped whenever the dock isn't shown (guests, marketing
 * pages), so nobody prefetches tabs they can't reach.
 *
 * `/post-job` is in the list even though it is not a tab: it is reached from
 * the Jobs top bar's "+", so it was the one authed destination this never warmed,
 * and its chunk load sat in front of the entry screen's own query.
 */
export function useWarmTabChunks(dockHidden: boolean, tabPaths: string[]) {
  useEffect(() => {
    if (dockHidden) return;
    return prefetchRoutesWhenIdle([...tabPaths, "/post-job"]);
  }, [dockHidden]); // the dock's tabs are fixed for the session
}

/**
 * Warm the profile photo the INSTANT `useCurrentUser` produces a URL, so the
 * top bar's avatar (AppTopBar, pixelSize 72) paints from the memory cache in
 * its first frame instead of sitting on its monogram (measured cold at
 * 375/slow-3G: up to 12s when the dock still drew it). The dock's "You" tab is
 * a person icon now (2026-10-20), so this warms the TOP BAR's exact URL; a
 * different size is a different CDN transform and would warm nothing.
 * Fire-and-forget: the Image is not retained and nothing here decides anything.
 */
export function useWarmAvatar(avatarUrl: string | null | undefined) {
  useEffect(() => {
    if (!avatarUrl || typeof Image === "undefined") return;
    const img = new Image();
    img.decoding = "async";
    img.src = transformedImageUrl(avatarUrl, { width: 72, height: 72 });
  }, [avatarUrl]);
}
