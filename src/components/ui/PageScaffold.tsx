import type { CSSProperties, ReactNode } from "react";
import { useHiddenAtMount } from "@/hooks/useHiddenAtMount";
import AppShell from "@/components/AppShell";
// The two-step title-card / panel material. Lives in its own module because
// the document-scroll pages that wear the same treatment (Family & care, Home
// History) cannot render through this scaffold — it brings AppShell's 100dvh
// lock with it. See the note in pageCardSurfaces.ts.
import {
  TITLE_CARD_CLASS,
  TITLE_CARD_STYLE,
  panelSurfaceStyle,
  type PanelElevation,
} from "@/components/ui/pageCardSurfaces";

/**
 * PageScaffold — the shared "two-card" page shell used by Dashboard,
 * Messages, Activity (My Posts / My Jobs), and the guest dashboard.
 *
 * Renders the full-height page shell (header → main → centered column)
 * with a frosted title card on top and a panel below that drops its
 * bottom radius + border so it bleeds beneath the floating dock with no
 * hard edge. Callers supply only the card bodies — the liquid-glass
 * styling lives here instead of being copy-pasted per screen.
 *
 * The fixed-viewport lock (100dvh, safe-area-top header inset) is NOT
 * re-implemented here: PageScaffold is a thin wrapper over {@link AppShell},
 * the single fixed-viewport primitive. PageScaffold only adds the two-card
 * layout. `scrollable={false}` because the panel has no scroll padding —
 * it bleeds beneath the dock — and any internal scrolling happens inside
 * the panel's own children.
 */

interface PageScaffoldProps {
  /** Sticky page header — <DashboardHeader /> on signed-in pages, a
   *  bespoke guest header on DashboardGuest.
   *
   *  Optional. My Jobs, My Posts and Messages pass nothing: their page name
   *  lives inside the panel's own toolbar, so an app bar above it would be a
   *  second header stating the same thing — the stacked-bar problem already
   *  removed from the message thread. When omitted, AppShell renders no
   *  header slot and this scaffold takes on the top safe-area inset that the
   *  bar used to absorb. */
  header?: ReactNode;
  /** Body of the top title card (greeting / page-title block). Optional —
   *  when omitted, no title card (or its layout gap) is rendered and the
   *  panel sits flush below the header. */
  titleCard?: ReactNode;
  /** Body of the bottom panel — the card that bleeds beneath the dock. */
  children: ReactNode;
  /** Banners rendered above the title card (Dashboard's broadcast banner
   *  + push-permission prompt). */
  aboveTitle?: ReactNode;
  /** Nudges/banners rendered between the title card and the panel. */
  beforePanel?: ReactNode;
  /** Centered-column max width. "wide" runs out to 2xl:max-w-7xl (the
   *  signed-in pages); "narrow" stops at lg:max-w-5xl (guest dashboard). */
  maxWidth?: "wide" | "narrow";
  /** Panel drop-shadow weight. "raised" is the standalone elevation used
   *  by Messages / Activity / guest; "flat" is the lighter shadow used
   *  when the panel nests its own elevated content box (Dashboard). */
  panelElevation?: PanelElevation;
  /** Play the shared page-entry transition (title card + panel rise in
   *  together, matching the `ds-page-in` keyframe used elsewhere). */
  animate?: boolean;
  /** Extra classes appended to the title card (e.g. a tighter `py` when
   *  the card holds only a single-line headline and the default padding
   *  leaves it floating in dead space). */
  titleCardClassName?: string;
  /** Extra classes appended to the scaffold root (e.g. a CSS mount fade). */
  className?: string;
}

// `page-panel` is a styling HOOK, not a look: `panelSurfaceStyle` zeroes the
// bottom radii and border INLINE so the card bleeds under the floating mobile
// dock with no hard edge. That dock is hidden on desktop, so there the squared
// bottom is just a square corner on a rounded card — which is exactly what the
// owner pointed at on 2026-09-07. Only a stylesheet `!important` rule can beat
// an inline style, and it needs a stable selector to hang on.
const PANEL_CLASS = "page-panel liquid-glass overflow-hidden flex-1 min-h-0 flex flex-col";

export function PageScaffold({
  header,
  titleCard,
  children,
  aboveTitle,
  beforePanel,
  maxWidth = "wide",
  panelElevation = "raised",
  animate = false,
  className,
  titleCardClassName,
}: PageScaffoldProps) {
  const titleCardClass = titleCardClassName
    ? `${TITLE_CARD_CLASS} ${titleCardClassName}`
    : TITLE_CARD_CLASS;
  // The app-shell frame caps desktop width (.app-shell-frame, 680px), so the
  // old lg/xl/2xl column ramps never took effect — they were dead classes.
  // A single max-w lets the frame govern width on every breakpoint.
  // On the desktop website (html.web-desktop) the `ds-desktop-wide` class
  // lifts the centered-column cap (see index.css) so the content can spread
  // into a true multi-column layout instead of staying in a phone column. On
  // mobile/native the class is a no-op (no CSS rule fires), so the existing
  // max-w-xl / max-w-3xl caps govern exactly as before.
  const columnWidth =
    (maxWidth === "narrow" ? "max-w-xl" : "max-w-3xl") + " ds-desktop-wide";

  const panelStyle: CSSProperties = panelSurfaceStyle(panelElevation);

  /**
   * PAGE ENTRY IS CSS NOW, NOT framer-motion.
   *
   * This component animated the title card and panel with `motion.div` for a
   * 0.28s fade-and-rise. The values were already duplicated in Tailwind's
   * `ds-page-in` keyframe — the comment here said so: "the exact same
   * opacity/translate/timing as the `ds-page-in` keyframe used by the
   * non-scaffold pages (PostJob etc.)". Identical, checked:
   *   framer   opacity 0->1, y 8->0, duration 0.28, ease [0.22,1,0.36,1]
   *   keyframe opacity 0->1, translateY(8px)->0, 280ms cubic-bezier(same)
   *
   * WHAT IT COST. `vite.config.ts` says framer-motion is deliberately NOT
   * manually chunked because "letting framer-motion ride with those
   * lazy-loaded consumers keeps it off the critical path entirely", and lists
   * them: PageTransition, ScrollToTop, MobileNav, DesktopSidebarNav.
   * PageScaffold is not on that list and is NOT lazy — it is the shared page
   * primitive. Measured on the real build, the shortest static chain from the
   * entry was:  index -> PageScaffold -> proxy (framer-motion), 38.1 kB gzip
   * on the critical path of every page, for a fade.
   *
   * REDUCE MOTION is preserved exactly, and moves to the media query it
   * belongs in: `motion-reduce:` gets `ds-page-in-fade` (opacity only, 120ms),
   * which is what the framer branch did. `useReducedMotion()` goes with it.
   *
   * useHiddenAtMount STAYS. Its docblock names `the ds-page-in keyframe`
   * among the animations that freeze at `opacity: 0` on a hidden tab, so this
   * hazard is not framer-specific and CSS does not fix it. When the document
   * was hidden at mount there is nothing to watch, so render the final state
   * with no animation class at all.
   */
  const hiddenAtMount = useHiddenAtMount();
  const enterClass =
    animate && !hiddenAtMount
      ? " motion-safe:animate-ds-page-in motion-reduce:animate-ds-page-in-fade"
      : "";

  const titleEl = !titleCard ? null : (
    <div className={titleCardClass + enterClass} style={TITLE_CARD_STYLE}>
      {titleCard}
    </div>
  );

  const panelEl = (
    <section className={PANEL_CLASS + enterClass} style={panelStyle}>
      {children}
    </section>
  );

  return (
    <AppShell
      header={header}
      scrollable={false}
      reserveBottomNav={false}
      // No header slot → nothing else owns the top safe-area inset, so the
      // scaffold takes it. Merged into the single className rather than passed
      // twice; two className props on one element silently drops the first.
      className={
        "bg-premium-page" +
        (header ? "" : " pt-safe-top") +
        (className ? ` ${className}` : "")
      }
    >
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pt-3 lg:pt-5 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          className={`w-full ${columnWidth} mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 overflow-hidden`}
        >
          {aboveTitle}
          {titleEl}
          {beforePanel}
          {panelEl}
        </div>
      </div>
    </AppShell>
  );
}
