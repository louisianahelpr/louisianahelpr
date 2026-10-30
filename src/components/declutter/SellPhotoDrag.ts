/**
 * Dragging a held photo to another place in the sell form (audit posting 1030 #9). The grip is what drags, so a finger
 * on the photo still scrolls the page; the same grip takes the left and right arrow keys. Nothing moves until it is let
 * go: the tile follows the finger and the one under it is marked, so the list never reshuffles under a live drag.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

/** The list with the photo at `from` moved to `to`; the same list when that changes nothing. */
export function movedPhoto<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list as T[];
  const next = list.filter((_, i) => i !== from);
  next.splice(to, 0, list[from]);
  return next;
}

/** Which tile a point is on, or `fallback` when it is between tiles or off the grid. */
export function tileAt(tiles: readonly Pick<DOMRect, "left" | "right" | "top" | "bottom">[], x: number, y: number, fallback: number): number {
  const i = tiles.findIndex((t) => x >= t.left && x <= t.right && y >= t.top && y <= t.bottom);
  return i < 0 ? fallback : i;
}

type Drag = { from: number; over: number; dx: number; dy: number };

export function usePhotoDrag(count: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const tiles = useRef<(HTMLElement | null)[]>([]);
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const startDrag = useCallback((e: ReactPointerEvent, from: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rects = tiles.current.slice(0, count).map((t) => t?.getBoundingClientRect() ?? { left: 0, right: 0, top: 0, bottom: 0 });
    const { clientX: startX, clientY: startY } = e;
    let over = from;
    const onPointerMove = (m: PointerEvent) => {
      over = tileAt(rects, m.clientX, m.clientY, over);
      setDrag({ from, over, dx: m.clientX - startX, dy: m.clientY - startY });
    };
    const finish = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", finish);
      endDrag.current = null;
      setDrag(null);
    };
    const onPointerUp = () => {
      finish();
      if (over !== from) onMove(from, over);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", finish);
    endDrag.current = finish;
    setDrag({ from, over, dx: 0, dy: 0 });
  }, [count, onMove]);

  const gripKeys = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : i;
    if (to === i) return;
    e.preventDefault();
    if (to < 0 || to >= count) return;
    onMove(i, to);
  };

  const tileRef = (i: number) => (el: HTMLElement | null) => {
    tiles.current[i] = el;
  };
  /** The tile's look during a drag: the dragged one follows the finger. */
  const tileStyle = (i: number): CSSProperties | undefined =>
    drag?.from === i ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 20, opacity: 0.9 } : undefined;
  const isTarget = (i: number) => !!drag && drag.over === i && drag.from !== i;

  return { startDrag, gripKeys, tileRef, tileStyle, isTarget };
}
