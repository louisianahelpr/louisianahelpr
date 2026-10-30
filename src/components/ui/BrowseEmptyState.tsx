import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { EmptyState } from "@/components/ui/EmptyState";

/**
 * The one place a Browse tab's empty state sits (owner 2026-10-30: Jobs and Declutter "in the same place"): its content
 * is centred on the screen above the bottom nav, whatever sits over it (search rows, filter bars, a Save search button),
 * and never rises over those: it stops at the top of the room it has. No page passes an offset.
 *
 * The caller's column must let this fill it (flex-1 down from the scroller). Guard: src/test/browseEmptySameSpot.test.tsx.
 */
export function browseEmptyShift(room: { top: number; height: number }, contentHeight: number, screenMid: number): number {
  if (room.height <= 0) return 0;
  const natural = room.top + room.height / 2;
  const highest = -Math.max(0, (room.height - contentHeight) / 2);
  return Math.max(highest, Math.round(screenMid - natural));
}

export function BrowseEmptyState(props: Omit<ComponentProps<typeof EmptyState>, "variant" | "align">) {
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
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-nav-h")) || 0;
      const r = el.getBoundingClientRect();
      setShift(browseEmptyShift({ top: r.top, height: r.height }, last.bottom - first.top, (window.innerHeight - nav) / 2));
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
      <div className="flex min-h-0 min-w-0 flex-1" style={shift ? { transform: `translateY(${shift}px)` } : undefined}>
        <EmptyState {...props} variant="bare" />
      </div>
    </div>
  );
}
