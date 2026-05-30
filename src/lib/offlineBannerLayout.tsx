import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Shared layout plumbing for the global {@link OfflineBanner}.
 *
 * The banner is `position: fixed; top: 0` so it can paint over the device
 * notch (status-bar / safe-area) on every screen. Because it's fixed, it
 * does NOT take up flow space — historically it *overlaid* the page header
 * (the "Helpr · LA" logo, back arrows, top-right icons), slicing the top
 * chrome whenever the banner was visible.
 *
 * This context lets the banner publish its measured height to the rest of
 * the app so the two page-shell types can RESERVE that space instead of
 * being overlaid:
 *
 *   - Document-scroll pages (`min-h-screen` wrappers in normal flow inside
 *     `#root`) → a global CSS rule pads `#root` down by the offset.
 *   - Fixed `AppShell` pages (`fixed inset-0`, which ignore `#root` padding)
 *     → `AppShell` reads `offset` and shifts its own `top`.
 *
 * Safe-area double-count gotcha: the banner already includes
 * `env(safe-area-inset-top)` in its own padding so it covers the notch. The
 * shells ALSO own the top inset (glass-header / AppShell header). So the
 * amount we reserve is the banner's CONTENT height MINUS the safe-area
 * inset — that way the shell's own inset exactly fills the notch region the
 * banner already painted, and there's no stray gap or double inset. The
 * banner reports this already-adjusted value (see OfflineBanner).
 */
interface OfflineBannerLayout {
  /**
   * Reserved space (px) the shells should leave at the top while the banner
   * is visible. 0 when hidden. Already net of `env(safe-area-inset-top)`.
   */
  offset: number;
  /** Banner calls this to publish/clear its reserved height. */
  setOffset: (px: number) => void;
}

const OfflineBannerLayoutContext = createContext<OfflineBannerLayout | null>(
  null,
);

export const OfflineBannerLayoutProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [offset, setOffset] = useState(0);

  // Mirror the offset to the DOM so a single global CSS rule can reserve
  // space for the banner on document-scroll pages (which live in normal
  // flow inside `#root` and can't read React context without editing every
  // wrapper). The `offline-banner-visible` class gates the `#root` padding;
  // the `--offline-banner-offset` var carries the measured height. Fixed
  // AppShell pages read the React `offset` directly (see useOfflineBannerOffset).
  useEffect(() => {
    const html = document.documentElement;
    html.style.setProperty("--offline-banner-offset", `${offset}px`);
    html.classList.toggle("offline-banner-visible", offset > 0);
    return () => {
      html.classList.remove("offline-banner-visible");
      html.style.removeProperty("--offline-banner-offset");
    };
  }, [offset]);

  const value = useMemo<OfflineBannerLayout>(
    () => ({ offset, setOffset }),
    [offset],
  );

  return (
    <OfflineBannerLayoutContext.Provider value={value}>
      {children}
    </OfflineBannerLayoutContext.Provider>
  );
};

/**
 * Read the current banner offset (px). Returns 0 when no provider is mounted
 * (e.g. isolated component tests), so consumers degrade gracefully.
 */
export function useOfflineBannerOffset(): number {
  return useContext(OfflineBannerLayoutContext)?.offset ?? 0;
}

/**
 * Used by the banner itself to publish its measured reserved height. Returns
 * a no-op when no provider is mounted.
 */
export function useSetOfflineBannerOffset(): (px: number) => void {
  const ctx = useContext(OfflineBannerLayoutContext);
  const setter = ctx?.setOffset;
  return useCallback((px: number) => (setter ? setter(px) : undefined), [setter]);
}
