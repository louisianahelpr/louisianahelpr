/**
 * POST-S9 (posting audit 10-30 #9): DRAG TO REORDER the photos on the one-item sell form.
 *
 * The first photo is the cover (the gallery and Browse card show photos by position), and before the first save the
 * photos wait on the device in order (`held`), so a new order is the order they go up in. Pointer events, so it is
 * one gesture for a mouse and a finger:
 *   - a mouse drags once it moves 6px with the button down;
 *   - a finger holds still on the photo for LONG_PRESS_MS first (a moving finger is scrolling the page, and stays
 *     scrolling); while a finger drags, the page does not scroll under it.
 * The photo under the pointer at release takes the dragged photo's place; the others close up behind it. A press on a
 * control inside the tile (Remove, Make cover) is never a drag. The bunch's photos have their own drag
 * (bunchPhotoDrag.ts, desktop only, with Move earlier / Move later in its sheet).
 * Guard: src/components/declutter/heldPhotoReorder.test.tsx.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

export const LONG_PRESS_MS = 300;
const MOUSE_SLOP_PX = 6;
const TOUCH_SLOP_PX = 8;

/** `list` with the entry at `from` moved to `to`; the same array when nothing moves or an index is out of range. */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list as T[];
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The held-photo index under a screen point: the tile carries `data-held-index`. */
function indexAt(x: number, y: number): number | null {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  const tile = el?.closest<HTMLElement>("[data-held-index]");
  const n = tile ? Number(tile.dataset.heldIndex) : NaN;
  return Number.isInteger(n) ? n : null;
}

type Press = { index: number; x: number; y: number; touch: boolean; active: boolean; timer: number | null };

export function useHeldPhotoReorder(count: number, onMove: ((from: number, to: number) => void) | undefined) {
  const press = useRef<Press | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const stop = () => {
    const p = press.current;
    if (p?.timer != null) window.clearTimeout(p.timer);
    press.current = null;
    setDragging(null);
    setOver(null);
  };

  // While a finger drags, the page must not scroll under it: a touchmove listener that can cancel (React's is passive).
  useEffect(() => {
    const block = (e: TouchEvent) => {
      if (press.current?.active) e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);
  useEffect(() => () => {
    if (press.current?.timer != null) window.clearTimeout(press.current.timer);
  }, []);

  const handlers = (index: number) => {
    if (!onMove || count < 2) return {};
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, label")) return;
        const touch = e.pointerType === "touch" || e.pointerType === "pen";
        const p: Press = { index, x: e.clientX, y: e.clientY, touch, active: false, timer: null };
        press.current = p;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (touch) {
          p.timer = window.setTimeout(() => {
            if (press.current !== p) return;
            p.active = true;
            p.timer = null;
            setDragging(index);
            setOver(index);
          }, LONG_PRESS_MS);
        }
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const p = press.current;
        if (!p) return;
        const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
        if (!p.active) {
          if (p.touch) {
            // Moved before the hold: the finger is scrolling the page.
            if (moved > TOUCH_SLOP_PX) stop();
            return;
          }
          if (moved < MOUSE_SLOP_PX) return;
          p.active = true;
          setDragging(p.index);
        }
        setOver(indexAt(e.clientX, e.clientY) ?? p.index);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        const p = press.current;
        if (p?.active) {
          const to = indexAt(e.clientX, e.clientY);
          if (to !== null && to !== p.index) onMove(p.index, to);
        }
        stop();
      },
      onPointerCancel: stop,
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        // A long press on a phone opens the image menu; the hold is a drag here.
        if (press.current?.touch) e.preventDefault();
      },
    };
  };

  return { handlers, dragging, over };
}
