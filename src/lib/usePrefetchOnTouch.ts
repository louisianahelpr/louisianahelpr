/**
 * usePrefetchOnTouch — fire a prefetch in the ~80ms gap between
 * `touchstart` and `click` on mobile. iOS/Android wait that long to
 * disambiguate a tap from a swipe; warming the destination's data
 * (React Query cache, lazy chunk, Supabase request) during that window
 * makes the eventual tap feel instant.
 *
 * Returns DOM event handlers ready to spread onto a button/link/card:
 *   const prefetch = usePrefetchOnTouch(() => warmJobDialogData(job.id));
 *   <button {...prefetch} onClick={...}>…</button>
 *
 * Behaviour:
 *  - Fires once per mounted component. The internal `primed` flag means
 *    a touchstart followed by repeated hover/touch events does not
 *    re-issue the request — important because the consumer is usually
 *    React-Query-shaped: re-firing a `prefetchQuery` with a hot cache
 *    is cheap but not free, and we want the prefetch to be a true
 *    one-shot ahead of the tap.
 *  - Re-mounts (e.g. a list re-render replacing a card) reset the flag,
 *    so each new card prefetches once on first hover/touch.
 *  - Both `onTouchStart` (mobile) and `onMouseEnter` (web/keyboard +
 *    mouse on iPad) trigger the handler so the same primitive covers
 *    both platforms.
 *  - The returned `prefetch` is invoked fire-and-forget; any rejection
 *    is swallowed so a slow/failed prefetch never aborts the eventual
 *    real navigation.
 */
import { useCallback, useRef } from "react";

export interface PrefetchOnTouchHandlers {
  onTouchStart: () => void;
  onMouseEnter: () => void;
}

export function usePrefetchOnTouch(
  prefetch: () => Promise<unknown> | unknown,
): PrefetchOnTouchHandlers {
  // useRef instead of a module-level flag so each card instance gets
  // its own primed state — otherwise the first card's tap would mark
  // every other card as primed and silently disable their prefetch.
  const primedRef = useRef(false);

  const handler = useCallback(() => {
    if (primedRef.current) return;
    primedRef.current = true;
    try {
      const result = prefetch();
      // Fire-and-forget — swallow rejection so a failed prefetch
      // never propagates up into the touch handler and breaks the
      // actual tap-to-navigate.
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(() => {
          // Intentionally silent: prefetch is best-effort.
        });
      }
    } catch {
      // Synchronous throw from a prefetcher is treated the same as a
      // promise rejection — never let it surface to the tap path.
    }
  }, [prefetch]);

  return { onTouchStart: handler, onMouseEnter: handler };
}
