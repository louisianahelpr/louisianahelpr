import type { CSSProperties, ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
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

const PANEL_CLASS = "liquid-glass overflow-hidden flex-1 min-h-0 flex flex-col";

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
  const reducedMotion = useReducedMotion();
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

  // Single unified page-entry: title card + panel rise together with the
  // exact same opacity/translate/timing as the `ds-page-in` keyframe used
  // by the non-scaffold pages (PostJob etc.), so every screen enters the
  // same way instead of some pages staggering and others snapping.
  // When the user has Reduce Motion on, skip the translate and shorten the
  // duration to a near-instant opacity crossfade so the page still "appears"
  // without the y-movement.
  const PAGE_IN = reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
      };

  const titleEl = !titleCard ? null : animate ? (
    <motion.div
      {...PAGE_IN}
      className={titleCardClass}
      style={TITLE_CARD_STYLE}
    >
      {titleCard}
    </motion.div>
  ) : (
    <div className={titleCardClass} style={TITLE_CARD_STYLE}>
      {titleCard}
    </div>
  );

  const panelEl = animate ? (
    <motion.section
      {...PAGE_IN}
      className={PANEL_CLASS}
      style={panelStyle}
    >
      {children}
    </motion.section>
  ) : (
    <section className={PANEL_CLASS} style={panelStyle}>
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
      <div className="container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
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

export default PageScaffold;
