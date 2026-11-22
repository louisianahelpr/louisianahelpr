import { useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverDismissLayer, PopoverPortal } from "@/components/ui/popover";

/**
 * The desktop website's filter panel: a SMALL drop-down under the Filters
 * button, like the bell's Notifications panel (owner 2026-10-28: "make
 * filters open like notification like it's just over the page it's on", then,
 * pointing at the search mockup's recent-searches drop-down: "filters should
 * be a small drop down like this").
 *
 *   - the page stays as it is: no dim, no blur (PopoverDismissLayer paints
 *     nothing; it only takes the click that closes the panel, so that click
 *     never lands on a card underneath);
 *   - a light card (the popover tone, 14px corners, a soft shadow), ~380px
 *     wide, right-aligned to the Filters button just under it; nothing in the
 *     row moves;
 *   - its body scrolls inside the panel, the footer ("Clear all" + "Show N")
 *     stays at the bottom;
 *   - click outside or Escape closes it and focus goes back to the button.
 *
 * Phone and the native app keep the slide-up sheet (FilterSheet decides).
 * `modal` keeps the page from scrolling under it and keeps Tab inside it, as
 * Notifications does (anchoredPanel.tsx).
 */
const FILTER_DROPDOWN_WIDTH = 380;

/**
 * Deep audit 11-22 #30: at 1440 the pop-up stopped at 36rem (576px) with ~780px free under the Filters button, so only
 * Home and Yard of the category chips showed. It may now use up to 45rem (720px) of the room Radix measures.
 */
const FILTER_DROPDOWN_MAX_HEIGHT = "min(45rem, calc(var(--radix-popover-content-available-height, 80vh) - 16px))";
/** The "more below" cue: the scrolling body's last 40px fade out. */
const MORE_BELOW_FADE = "[mask-image:linear-gradient(to_bottom,#000_calc(100%-40px),transparent)]";

export function FilterDropdown({
  open,
  onOpenChange,
  anchorRef,
  label,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef?: RefObject<HTMLElement | null>;
  /** Accessible name, e.g. "Filter jobs". */
  label: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  // A live rect: every reposition reads the button where it is now.
  const virtualRef = useMemo(
    () => ({ current: { getBoundingClientRect: () => anchorRef?.current?.getBoundingClientRect() ?? new DOMRect() } }),
    [anchorRef],
  );
  // Deep audit 11-22 #30: the body's cut fell neatly between category chips, so it looked finished while "Show only"
  // and Saved searches sat out of sight. While more is below, the body's last 40px fade out (the cue to scroll).
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const measure = useCallback(() => {
    if (body) setMoreBelow(body.scrollHeight - body.scrollTop - body.clientHeight > 2);
  }, [body]);
  useEffect(() => {
    if (!body) return;
    measure();
    body.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(body);
    if (body.firstElementChild) ro?.observe(body.firstElementChild);
    return () => {
      body.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [body, measure]);
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverPortal>
        <PopoverDismissLayer />
      </PopoverPortal>
      <PopoverContent
        aria-label={label}
        data-filter-dropdown=""
        side="bottom"
        align="end"
        sideOffset={8}
        onOpenAutoFocus={(event) => {
          // Focus the panel itself, not its first chip (pressing Enter would flip a filter).
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          const button = anchorRef?.current;
          if (!button) return;
          event.preventDefault();
          button.focus({ preventScroll: true });
        }}
        className="flex flex-col p-0 gap-0 overflow-hidden border-0 outline-none"
        style={{
          width: FILTER_DROPDOWN_WIDTH,
          maxHeight: FILTER_DROPDOWN_MAX_HEIGHT,
          background: "hsl(var(--popover))",
          borderRadius: 14,
          boxShadow: "0 10px 30px rgba(0,0,0,.12), 0 1px 3px rgba(0,0,0,.08)",
        }}
      >
        <div
          ref={setBody}
          data-filter-sheet-body=""
          data-more-below={moreBelow ? "" : undefined}
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3.5${moreBelow ? ` ${MORE_BELOW_FADE}` : ""}`}
        >
          {children}
        </div>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
