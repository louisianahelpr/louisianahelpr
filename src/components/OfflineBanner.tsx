import { useEffect, useState } from "react";
import { WifiOff, Check } from "lucide-react";
import { useOnlineStatus } from "@/lib/useOnlineStatus";

/**
 * Global connectivity indicator. Reads from the shared `useOnlineStatus`
 * hook so detection lives in exactly one place (see that file for the
 * Capacitor / `@capacitor/network` notes).
 *
 * Three visual states:
 *   1. online + no recent transition → renders nothing.
 *   2. offline → burnt-sienna brand banner with the "no retry queue"
 *      copy. We do NOT promise an automatic retry because the app has
 *      no offline mutation queue — promising one is worse than saying
 *      nothing.
 *   3. just-came-back-online (within 1.5s of the offline → online
 *      transition) → bark-green confirmation banner with a Check icon,
 *      "Back online — refreshing". Auto-hides after 1.5s.
 *
 * Brand-token gotcha: brand tokens are CSS variables in `src/index.css`,
 * NOT in `tailwind.config.ts theme.colors`. Tailwind classes like
 * `bg-burnt-sienna` would compile to nothing — we MUST use the inline
 * `bg-[hsl(var(--burnt-sienna)/0.95)]` form so the variable resolves
 * at runtime.
 */
const BACK_ONLINE_HOLD_MS = 1500;

const OfflineBanner = () => {
  const { online, lastChangedAt } = useOnlineStatus();
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    if (!online) {
      // Going offline: clear any lingering "back online" pulse so the
      // offline banner takes over immediately.
      setShowBackOnline(false);
      return;
    }
    // online === true. Only flash the confirmation if we *just* came
    // back — guards against the initial mount (where `online` is true
    // from the start) rendering a stray green banner.
    const sinceTransition = Date.now() - lastChangedAt;
    if (sinceTransition > BACK_ONLINE_HOLD_MS) return;

    setShowBackOnline(true);
    const remaining = Math.max(0, BACK_ONLINE_HOLD_MS - sinceTransition);
    const timer = window.setTimeout(() => setShowBackOnline(false), remaining);
    return () => window.clearTimeout(timer);
  }, [online, lastChangedAt]);

  if (online && !showBackOnline) return null;

  const safeAreaPad = { paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" } as const;

  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 left-0 right-0 z-[60] bg-[hsl(var(--burnt-sienna)/0.95)] text-[hsl(var(--parchment))] text-ds-11 font-medium py-2 px-4 flex items-center justify-center gap-2 shadow-md"
        style={safeAreaPad}
      >
        <WifiOff className="w-3.5 h-3.5" />
        You're offline. Showing the last data we have.
      </div>
    );
  }

  // Back-online pulse.
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[60] bg-[hsl(var(--bark)/0.95)] text-[hsl(var(--parchment))] text-ds-11 font-medium py-2 px-4 flex items-center justify-center gap-2 shadow-md"
      style={safeAreaPad}
    >
      <Check className="w-3.5 h-3.5" />
      Back online — refreshing
    </div>
  );
};

export default OfflineBanner;
