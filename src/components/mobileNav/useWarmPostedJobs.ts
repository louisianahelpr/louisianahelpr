import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChromeReadsMayStart } from "@/hooks/usePageReadsSettled";
import { prefetchRecentPostedJobs } from "@/hooks/useRecentPostedJobs";

/**
 * Warm the post-job entry screen's DATA too, not just its chunk. "Repost a
 * recent job" is the only data-backed tile there and its request could not
 * be ISSUED until the lazy chunk had loaded and mounted — measured 293ms
 * behind the static tiles beside it (375px, production build, 200ms/request).
 * Warming it here spends that round trip in the user's reading time instead
 * of on their tap. Deliberately a separate idle pass from the chunk warm so a
 * slow data fetch can never hold up the chunk prefetch. It also waits for
 * Declutter's own reads, which an idle callback alone did not.
 */
export function useWarmPostedJobs(enabled: boolean, userId: string | undefined) {
  const queryClient = useQueryClient();
  const chromeReadsMayStart = useChromeReadsMayStart();
  useEffect(() => {
    if (!enabled || !userId || !chromeReadsMayStart) return;
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const run = () => prefetchRecentPostedJobs(queryClient, userId);
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    // Safari / WKWebView has no requestIdleCallback — same fallback timer
    // prefetchRoutesWhenIdle uses, held back until the current route settles.
    const t = window.setTimeout(run, 1500);
    return () => window.clearTimeout(t);
  }, [enabled, userId, queryClient, chromeReadsMayStart]);
}
