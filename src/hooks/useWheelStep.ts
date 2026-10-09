import { useEffect, useRef, type RefObject } from "react";

/** A wheel event at least this large (px) is a mouse-wheel notch: one step. */
const WHEEL_NOTCH_PX = 50;
/** Smaller trackpad deltas add up; this much travel is one step. */
const WHEEL_STEP_PX = 30;

/**
 * Mouse wheel and trackpad on a scroll-snap picker column, one row at a time.
 *
 * MEASURED (owner's Post a Job, desktop Chrome with smooth scrolling,
 * 2026-10-09): `snap-mandatory` columns left the browser to decide. One
 * 100px mouse notch jumped TWO hours (9 -> 7), and six 4px trackpad nudges
 * moved nothing at all, snapping back to the same row every time, so the
 * owner could only change the hour by clicking each number.
 *
 * This takes the wheel over: a notch-sized event is exactly one step, small
 * deltas accumulate until they add up to one, and `onStep(±n)` moves the
 * selection. At either end of the list the event is left alone, so the page
 * scrolls on as normal. Touch never fires `wheel`, so phone swiping keeps the
 * native snap scroll.
 *
 * `canStep(dir)` says whether the column can move in that direction.
 */
export function useWheelStep(
  ref: RefObject<HTMLElement>,
  onStep: (steps: number) => void,
  canStep: (dir: 1 | -1) => boolean,
  disabled = false,
) {
  const latest = useRef({ onStep, canStep, disabled });
  latest.current = { onStep, canStep, disabled };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const { onStep: step, canStep: can, disabled: off } = latest.current;
      if (off || e.deltaY === 0) return;
      const px =
        e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      const dir = px > 0 ? 1 : -1;
      if (!can(dir)) { acc = 0; return; }
      e.preventDefault();
      // A reversal starts a fresh count rather than cancelling travel.
      if (Math.sign(acc) !== dir) acc = 0;
      if (Math.abs(px) >= WHEEL_NOTCH_PX) { acc = 0; step(dir); return; }
      acc += px;
      const steps = Math.trunc(acc / WHEEL_STEP_PX);
      if (!steps) return;
      acc -= steps * WHEEL_STEP_PX;
      step(steps);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
