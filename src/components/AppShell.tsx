import { ReactNode, CSSProperties, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useOfflineBannerOffset } from "@/lib/offlineBannerLayout";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

interface AppShellProps {
  /** Optional fixed header (back button + title, tabs, etc.) */
  header?: ReactNode;
  /** When true (default), the inner content area scrolls vertically. Set false for fit-to-screen pages. */
  scrollable?: boolean;
  /** When true, reserves space at the bottom for the floating MobileNav dock + FAB (default: true). */
  reserveBottomNav?: boolean;
  /** Extra classes for the inner scroll container. */
  contentClassName?: string;
  /** Extra inline styles for the inner scroll container. */
  contentStyle?: CSSProperties;
  /** Extra classes for the outer shell container. */
  className?: string;
  children: ReactNode;
}

/**
 * Global app shell — locks the viewport to 100dvh, pins the optional header at the
 * top, and provides an internal scroll box between the header and the floating
 * bottom navigation. The MobileNav remains mounted at the App root so it never
 * remounts between routes (no flicker).
 *
 * Public marketing pages (Index, Heroes, ForBusiness, Features, legal) intentionally
 * do NOT use this shell — they use normal document scroll for SEO and long-form content.
 */
const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  (
    {
      header,
      scrollable = true,
      reserveBottomNav = true,
      contentClassName,
      contentStyle,
      className,
      children,
    },
    ref,
  ) => {
    const bottomPad = reserveBottomNav
      ? "calc(var(--safe-area-bottom, 0px) + 96px)"
      : "var(--safe-area-bottom, 0px)";

    // The global OfflineBanner is `position: fixed; top: 0`. Because this
    // shell is also `fixed inset-0`, the banner would overlay the header.
    // `#root` padding (which fixes the document-scroll pages) can't move a
    // fixed element, so we shift this shell's own top down by the banner's
    // reserved height and shrink its height to match — keeping the 100dvh
    // lock intact. 0 when the banner is hidden, so this is a no-op normally.
    const bannerOffset = useOfflineBannerOffset();

    // The desktop website also carries a fixed global app bar (DesktopTopNav,
    // h-14 = 3.5rem, rendered from App.tsx). Like the banner, it is out of
    // flow, so this shell has to give the space back or the page's first row
    // renders UNDERNEATH it — which is exactly what happened: the title card's
    // status pill and its search/filter icons were clipped by the bar.
    //
    // It has to be folded in HERE rather than in a stylesheet rule, because
    // `top`/`height` below are INLINE styles and an inline style always beats
    // a stylesheet declaration — a `top: 3.5rem` rule in index.css was simply
    // ignored. Both offsets stack: banner + bar.
    //
    // `useIsWebDesktop()` is `!isNativePlatform() && >= 900px`, so this is 0 on
    // phone web and 0 in the native app, leaving both byte-identical.
    const topBarOffset = useIsWebDesktop() ? 56 : 0;
    const topOffset = bannerOffset + topBarOffset;

    return (
      <div
        className={cn(
          "app-shell-frame fixed inset-x-0 bottom-0 flex flex-col bg-background overflow-hidden",
          className,
        )}
        style={{
          top: topOffset ? `${topOffset}px` : 0,
          height: topOffset
            ? `calc(100dvh - ${topOffset}px)`
            : "100dvh",
        }}
      >
        {header ? (
          // The header itself owns the top safe-area inset, applied exactly
          // once: a `.glass-header` (e.g. DashboardHeader) gets it from the
          // base `.glass-header` rule in index.css, and a bespoke non-glass
          // header sets its own `padding-top: env(safe-area-inset-top)`.
          // This wrapper is a transparent positioning shell only — it must
          // NOT add the inset, or the frosted-glass background would start
          // below the status bar (visible seam) or the notch gap would
          // double-count.
          <div className="app-shell-header shrink-0 z-30">{header}</div>
        ) : null}

        <div
          ref={ref}
          className={cn(
            // flex flex-col so child <main>'s `flex-1 min-h-0` actually
            // resolves to a definite height. Without this the height
            // chain stops here and downstream `h-full` / `overflow-y-auto`
            // containers can't establish a scrollable viewport, which is
            // why non-landing Profile tabs (Schedule / Reviews /
            // Availability / Saved Helprs) appeared frozen — there was
            // overflow but no scroll surface to handle it.
            "flex-1 min-h-0 flex flex-col",
            // `app-shell-scroll` marks the real scroll container so
            // MobileNav's scroll-shadow logic targets it (rather than
            // <main>, which is never itself a scroll surface).
            // `overflow-x-hidden` is load-bearing: `overflow-y-auto` alone
            // computes `overflow-x` to `auto`, so any edge-bleeding panel
            // (e.g. the Browse map) lets the WHOLE page drag left/right.
            // Pinning x to hidden clips that; inner horizontal scrollers
            // (chip rows) keep their own nested `overflow-x-auto`.
            scrollable ? "overflow-y-auto overflow-x-hidden no-scrollbar app-shell-scroll" : "overflow-hidden",
            contentClassName,
          )}
          style={{
            paddingBottom: scrollable ? bottomPad : undefined,
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            ...contentStyle,
          }}
        >
          {children}
        </div>
      </div>
    );
  },
);
AppShell.displayName = "AppShell";

export default AppShell;
