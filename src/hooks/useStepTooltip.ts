import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Which rail step's time tooltip is open, and the pointer handlers that open it.
 *
 * A CLICK NEVER HIDES WHAT THE HOVER JUST SHOWED. A mouse reaches the dot before
 * it clicks it, so the hover had already opened the tooltip and a plain toggle
 * closed it again: clicking "Done — <date>" showed nothing (press-every-control
 * 38536821617, shard 11, /jobs/d3034be8 "no observable change", nightly-red
 * #2353). A click on a hover-opened tooltip keeps it open (leaving the dot still
 * closes it); a click on a tap- or click-opened one closes it, as before.
 * Guard: src/components/JobTracking.stepTooltip.test.tsx.
 */
export function useStepTooltip() {
  const [open, setOpen] = useState<string | null>(null);
  /** The step whose tooltip the pointer opened (not yet pinned by a click). */
  const hoverOpened = useRef<string | null>(null);
  const handlers = (key: string) => ({
    onClick: (e: ReactMouseEvent) => {
      e.stopPropagation();
      if (hoverOpened.current === key) {
        hoverOpened.current = null;
        setOpen(key);
        return;
      }
      setOpen((k) => (k === key ? null : key));
    },
    onMouseEnter: () => {
      hoverOpened.current = key;
      setOpen(key);
    },
    onMouseLeave: () => {
      hoverOpened.current = null;
      setOpen((k) => (k === key ? null : k));
    },
  });
  return { open, handlers };
}
