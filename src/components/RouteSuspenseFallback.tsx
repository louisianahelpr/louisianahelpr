import helprLogoSm from "@/assets/helpr-logo-96.webp";

import { Skeleton } from "@/components/ui/skeleton";
import { useReducedMotion } from "@/lib/accessibility";

/**
 * Per-route Suspense fallback. Rendered while a lazy() route chunk is
 * resolving — see `lazyRoute()` in `src/App.tsx`.
 *
 * Why this exists separately from `PageFallback` (a spinner-only fullscreen
 * overlay): the per-route boundary lives INSIDE `<main>`, below the
 * persistent shell. We want a calm, branded card — not a spinning circle
 * over the whole viewport — because the header, mobile nav, and banners
 * stay mounted while one route swaps for another.
 *
 * Performance: this renders dozens of times per session for every
 * navigation, so it stays lightweight. No router imports, no HelprMark
 * (which pulls in `<Link>` and dual-size logo srcsets we don't need at
 * loader scale), no animation libs. A static webp + the existing Skeleton
 * primitive + a single CSS fade keyframe.
 *
 * Accessibility:
 * - Honors `useReducedMotion()` — skip the fade-in entrance animation.
 * - `aria-busy` + `aria-live="polite"` so screen readers announce the
 *   loading state without interrupting the user mid-action.
 * - Marked decorative for the logo (`alt=""`) — the announcement comes
 *   from the visible "Loading…" caption, not the brand mark.
 */
export const RouteSuspenseFallback = () => {
  const reducedMotion = useReducedMotion();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`w-full min-h-[60vh] flex items-center justify-center bg-[hsl(var(--parchment))] px-4 py-10 ${
        reducedMotion ? "" : "animate-in fade-in duration-300"
      }`}
      data-testid="route-suspense-fallback"
    >
      <div className="w-full max-w-md flex flex-col items-center gap-5">
        <img
          src={helprLogoSm}
          alt=""
          aria-hidden="true"
          className="h-8 w-auto select-none opacity-70"
          draggable={false}
        />
        <div className="w-full space-y-3">
          <Skeleton className="h-4 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-1/2 mx-auto" />
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    </div>
  );
};

export default RouteSuspenseFallback;
