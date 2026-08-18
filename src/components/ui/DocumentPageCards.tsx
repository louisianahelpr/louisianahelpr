import type { ReactNode } from "react";
import BackButton from "@/components/BackButton";
import {
  TITLE_CARD_CLASS,
  TITLE_CARD_STYLE,
  panelSurfaceStyle,
  type PanelElevation,
} from "@/components/ui/pageCardSurfaces";

/**
 * DocumentPageCards — the app's title-card + panel treatment for a
 * DOCUMENT-SCROLL page.
 *
 * WHY THIS EXISTS RATHER THAN "just use PageScaffold"
 * ---------------------------------------------------
 * The card treatment and the viewport mode are two separate decisions, and
 * PageScaffold welds them together: it is a wrapper over AppShell, so using it
 * also imposes the 100dvh lock and moves scrolling into an internal container.
 * That is right for a fixed-height inbox or feed. It is wrong for an unbounded
 * long-form page — and per CLAUDE.md a page's shell choice has to agree with
 * its entry in `DOCUMENT_SCROLL_ROUTES`, so picking the wrong one is not a
 * cosmetic mistake: a `min-h-screen` page missing from that list gets
 * `html.app-shell { overflow: hidden }` and everything past the fold becomes
 * unreachable.
 *
 * So this component gives a document-scroll page the same material (see
 * pageCardSurfaces.ts — one definition, shared with PageScaffold) with none of
 * the viewport lock. Pages using it stay `min-h-screen`, stay in
 * `DOCUMENT_SCROLL_ROUTES`, and keep scrolling the document.
 *
 * It replaces `<PageHeader>` on the pages that adopt it: the back button and
 * the page's single `h1` move INTO the title card, which is the same
 * arrangement Activity uses (see ActivityHeader). Leaving PageHeader above a
 * title card would print the page name twice, one on top of the other.
 *
 * NOT `overflow-hidden` on the panel, deliberately. PageScaffold's panel clips,
 * but `overflow: hidden` makes an element the nearest scroll container for its
 * subtree, which silently kills `position: sticky` inside it — and Family &
 * care's desktop aside is `lg:sticky lg:top-6`. Nothing here needs clipping
 * anyway: the panel's own padding keeps content off the rounded corners.
 */

export interface DocumentPageCardsProps {
  /** The page's one and only h1. */
  title: string;
  /** Back-chevron target. Omitted → no back button. */
  onBack?: () => void;
  /** Optional content below the heading row, still inside the title card. */
  titleMeta?: ReactNode;
  /**
   * The centered column's max-width + gutter ladder. Pass the page's OWN
   * existing ladder verbatim so adopting the cards doesn't quietly re-width
   * the page (and so the title and the body can never fall out of column —
   * they are the same box now).
   */
  columnClassName: string;
  /** Padding for the panel body. */
  panelClassName?: string;
  /** Panel drop-shadow weight — see PANEL_SHADOW. */
  panelElevation?: PanelElevation;
  children: ReactNode;
}

export function DocumentPageCards({
  title,
  onBack,
  titleMeta,
  columnClassName,
  panelClassName = "px-4 py-5 lg:px-6 lg:py-6",
  panelElevation = "raised",
  children,
}: DocumentPageCardsProps) {
  return (
    // `flex flex-col` + `flex-1` on the panel is what makes a SHORT page still
    // look right: the panel always reaches the bottom of the viewport, so an
    // empty state doesn't leave the surface stopping in mid-air with a flat,
    // border-less bottom edge hanging over bare canvas. Long content just
    // grows past it and the document scrolls, exactly as before.
    <div className="min-h-screen bg-premium-page flex flex-col">
      <div
        className={`mx-auto w-full ${columnClassName} flex-1 flex flex-col gap-3 lg:gap-4`}
        // The top safe-area inset, absorbed here because this component
        // replaces PageHeader — which is where it used to be applied. Same
        // expression PageHeader uses, so the notch clearance is unchanged.
        style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 0.75rem)" }}
      >
        <div className={TITLE_CARD_CLASS} style={TITLE_CARD_STYLE}>
          <div className="flex items-center gap-3">
            {onBack && (
              <div className="shrink-0">
                <BackButton onClick={onBack} />
              </div>
            )}
            <h1 className="text-page-title leading-tight text-balance min-w-0">
              {title}
            </h1>
          </div>
          {titleMeta}
        </div>

        <section
          className={`liquid-glass flex-1 flex flex-col ${panelClassName} pb-safe-nav`}
          style={panelSurfaceStyle(panelElevation)}
        >
          {children}
        </section>
      </div>
    </div>
  );
}

export default DocumentPageCards;
