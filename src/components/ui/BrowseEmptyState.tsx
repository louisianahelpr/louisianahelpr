import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * The one place a Browse tab's empty state sits (owner 2026-10-30: Jobs and Declutter "in the same place"): its content
 * is centred on the screen above the bottom nav, whatever sits over it (search rows, filter bars, a Save search button),
 * and never rises over those: it stops at the top of the room it has. No page passes an offset.
 *
 * The caller's column must let this fill it (flex-1 down from the scroller). Guard: src/test/browseEmptySameSpot.test.tsx.
 *
 * Audit SS-9: moved up, this layer's empty top still covers what sits above the room ("Save this search" could not be
 * pressed on no results). So the layer and the card take no press; only the card's content does.
 */
export function browseEmptyShift(room: { top: number; height: number }, contentHeight: number, screenMid: number): number {
  if (room.height <= 0) return 0;
  const natural = room.top + room.height / 2;
  const highest = -Math.max(0, (room.height - contentHeight) / 2);
  return Math.max(highest, Math.round(screenMid - natural));
}

/**
 * The middle of the screen above the bottom nav. Measured from the nav itself: `--bottom-nav-h` is only ever set to 0
 * (the 96px is a fallback inside the CSS that reads it), so reading that variable centred on the full screen. A nav that
 * is hidden (desktop, display:none) has no height and the whole screen counts.
 */
export function browseEmptyScreenMid(innerHeight: number, nav: { top: number; height: number } | null | undefined): number {
  return (nav && nav.height > 0 ? nav.top : innerHeight) / 2;
}

/** The moved layer: presses pass through its empty parts to whatever it has moved over (the card's content keeps them). */
export const SHIFTED_LAYER = "pointer-events-none flex min-h-0 min-w-0 flex-1 [&_[data-empty-state]>*]:pointer-events-auto";

export function BrowseEmptyState({ icon, illustration, title, body, action, footnote, surfaceStyle, bodyLines }: Omit<ComponentProps<typeof EmptyState>, "variant" | "align">) {
  const room = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const place = () => {
      const card = el.querySelector("[data-empty-state]");
      const first = card?.firstElementChild?.getBoundingClientRect();
      const last = card?.lastElementChild?.getBoundingClientRect();
      if (!first || !last) return;
      const nav = document.querySelector(".mobile-nav-frame")?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setShift(browseEmptyShift({ top: r.top, height: r.height }, last.bottom - first.top, browseEmptyScreenMid(window.innerHeight, nav)));
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    ro?.observe(el);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  return (
    <div ref={room} data-browse-empty="" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={SHIFTED_LAYER} style={shift ? { transform: `translateY(${shift}px)` } : undefined}>
        <EmptyState icon={icon} illustration={illustration} title={title} body={body} action={action} footnote={footnote} surfaceStyle={surfaceStyle} bodyLines={bodyLines} variant="bare" />
      </div>
    </div>
  );
}
