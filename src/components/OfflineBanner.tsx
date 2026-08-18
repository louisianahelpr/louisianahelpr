import { useLayoutEffect, useRef } from "react";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { useSetOfflineBannerOffset } from "@/lib/offlineBannerLayout";

/**
 * Global connectivity indicator. Reads from the shared `useOnlineStatus`
 * hook so detection lives in exactly one place (see that file for the
 * Capacitor / `@capacitor/network` notes).
 *
 * Two visual states:
 *   1. online → renders nothing. Being online is the assumed default, so
 *      we never flash a "back online" confirmation — it's noise.
 *   2. offline → burnt-sienna brand banner with the "no retry queue"
 *      copy. We do NOT promise an automatic retry because the app has
 *      no offline mutation queue — promising one is worse than saying
 *      nothing.
 *
 * Layout: the banner is `position: fixed; top: 0` so it can paint over the
 * device notch. To stop it OVERLAYING / slicing the page header, it
 * publishes the height of its CONTENT ROW (the icon + text, which excludes
 * the safe-area inset painted above it) to `OfflineBannerLayoutProvider`.
 * The shells reserve exactly that much space — see `offlineBannerLayout`
 * for why we report the content-row height (not the full banner height).
 *
 * Brand-token gotcha: brand tokens are CSS variables in `src/index.css`,
 * NOT in `tailwind.config.ts theme.colors`. Tailwind classes like
 * `bg-burnt-sienna` would compile to nothing — we MUST use the inline
 * `bg-[hsl(var(--burnt-sienna)/0.95)]` form so the variable resolves
 * at runtime.
 */
const OfflineBanner = () => {
  const { online } = useOnlineStatus();
  const setOffset = useSetOfflineBannerOffset();
  const contentRef = useRef<HTMLDivElement | null>(null);

  const visible = !online;

  // Publish the content-row height so the shells reserve space for it.
  // Measured (not hard-coded) so a font-size / line-wrap change can't drift
  // the reserved space out of sync with the real banner. The cleanup resets
  // the offset to 0 whenever the banner is hidden/unmounted.
  useLayoutEffect(() => {
    if (!visible) {
      setOffset(0);
      return;
    }
    const el = contentRef.current;
    if (!el) return;

    const publish = () => setOffset(el.getBoundingClientRect().height);
    publish();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(publish)
        : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      setOffset(0);
    };
  }, [visible, setOffset]);

  if (!visible) return null;

  // Outer wrapper paints the safe-area (notch) region; the inner content
  // row is what we measure + reserve. Keeping the inset on the OUTER element
  // (not the content row) is what makes the reported offset already net of
  // `var(--safe-area-top, 0px)` — see offlineBannerLayout.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] bg-[hsl(var(--burnt-sienna)/0.80)] text-[hsl(var(--parchment))] shadow-md"
      style={{ paddingTop: "var(--safe-area-top, 0px)" }}
    >
      <div
        ref={contentRef}
        className="text-ds-11 font-normal py-2 px-4 flex items-center justify-center gap-2"
      >
        <WifiOff className="w-3.5 h-3.5" />
        You're offline. Showing the last data we have.
      </div>
    </div>
  );
};

export default OfflineBanner;
