import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * ScreenHeaderRow — the ONE header row the panelled screens share.
 *
 * My Posts / My Jobs (`ActivityHeader`) and the Browse feed
 * (`BrowseTasksToolbar`) render the same row: the screen's name on the left,
 * an optional small state label beside it, and an icon cluster (search ·
 * filters) pinned to the trailing edge. This component IS that row, so the two
 * screens cannot drift apart on the geometry that makes them read as one
 * family — the 44px floor, the `gap-3`, the `gap-1` action cluster, the
 * `min-w-0` + truncate on the title, and the `shrink-0` on everything that
 * must never be what gets cut.
 *
 * It owns the row's INSIDE only. The surface it sits on stays the caller's:
 * ActivityHeader is mounted as PageScaffold's `titleCard` (so the card gives
 * it its liquid-glass background, radius and `px-5`), while the browse toolbar
 * renders it as the first row inside the panel with its own `px-4`. Pass those
 * through `className` / `style`.
 *
 * 44px, not 52: the row's tallest content is a 44px icon button (every
 * `<button>` is floored at 44×44 by the HIG rule in index.css), so anything
 * above 44 is dead space between the screen name and the first row of content.
 *
 * `children` replaces the title + actions for the inline-search state both
 * screens have, WITHOUT giving up the row geometry — and the title still
 * renders `sr-only`, because swapping a visible h1 for a text input used to
 * leave the screen with ZERO headings for as long as search was open. "Exactly
 * one h1 per screen" has to hold in every state, not just at rest.
 */
const SCREEN_HEADER_ROW_MIN_HEIGHT = "44px";

export interface ScreenHeaderRowProps {
  /** The screen's name — rendered as its single `<h1>`. */
  title: string;
  /**
   * Render the h1 for screen readers only. Home does: it shows the brand
   * emblem and nothing else (owner decision, "home will not have a title just
   * the H logo"). The heading is hidden, never dropped.
   */
  titleSrOnly?: boolean;
  /**
   * Small live-state label placed to the right of the title, on its baseline
   * — "· 2 Active" on My Posts, "Filtered · 3 active" on Browse. Fully styled
   * by the caller; this row only positions it (and keeps it `shrink-0`, so a
   * long title yields first and the thing telling you what you are looking at
   * is never what gets cut).
   */
  meta?: ReactNode;
  /** Trailing icon cluster — search, filters. */
  actions?: ReactNode;
  /** Inline-search content, replacing title + actions for that state. */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ScreenHeaderRow({
  title,
  titleSrOnly = false,
  meta,
  actions,
  children,
  className,
  style,
}: ScreenHeaderRowProps) {
  return (
    <div
      className={cn("flex items-center gap-3", className)}
      style={{ minHeight: SCREEN_HEADER_ROW_MIN_HEIGHT, ...style }}
    >
      {children ? (
        <>
          <h1 className="sr-only">{title}</h1>
          {children}
        </>
      ) : (
        <>
          {/* Title and state label on ONE line, label to the right of the name.
              `items-baseline` so the small italic label sits on the wordmark's
              baseline rather than centring against a much larger cap-height. */}
          <div className="flex items-baseline min-w-0 flex-1 gap-2 py-2.5">
            <h1
              className={
                titleSrOnly
                  ? "sr-only"
                  : "font-display font-bold text-foreground text-ds-20 truncate m-0 leading-none min-w-0"
              }
            >
              {title}
            </h1>
            {meta}
          </div>
          <div className="flex items-center gap-1 shrink-0">{actions}</div>
        </>
      )}
    </div>
  );
}
