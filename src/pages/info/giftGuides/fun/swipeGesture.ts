/**
 * The swipe deck's drag (owner 2026-11-22 on her iPhone: "These don't swipe well"). Pure helpers, so the page can move
 * the card straight from pointer events (no React render per finger move) and the rules are testable:
 *   - the card follows the finger and tilts with it (no tilt under prefers-reduced-motion);
 *   - let go past 30% of the card's width, or flick it (fast over the last ~100 ms, a little way), and it goes: right
 *     saves, left skips; anything less springs back.
 * The page's stage keeps touch-action:pan-y, so an up/down drag still scrolls the page (the browser then cancels the
 * pointer and the card springs back). Guard: src/test/swipeDrag1122.test.tsx.
 */

/** Share of the card's width a drag must pass, on release, to count as a swipe. */
export const SWIPE_SHARE = 0.3;
/** A flick: at least this fast (px per ms, over the last FLING_WINDOW ms) ... */
export const FLING_SPEED = 0.5;
/** ... and at least this far (px), in the same direction it is moving. */
export const FLING_MIN = 24;
/** How much recent movement the flick speed reads (ms). */
export const FLING_WINDOW = 100;
/** Degrees of tilt at a drag of one card width. */
export const TILT_PER_WIDTH = 14;
/** A press that moves less than this (px) is a tap (it opens the card's details). */
export const TAP_SLOP = 6;
/** A card narrower than this (or not laid out yet) is measured as this wide. */
const MIN_WIDTH = 240;

export interface DragSample { x: number; t: number }

export const cardWidth = (w: number | undefined) => (w && w > MIN_WIDTH ? w : MIN_WIDTH);

/** Keeps only the samples of the last FLING_WINDOW ms (the newest is always kept). */
export function recentSamples(samples: DragSample[], now: number): DragSample[] {
  const keep = samples.filter((s) => now - s.t <= FLING_WINDOW);
  return keep.length ? keep : samples.slice(-1);
}

/** Speed (px/ms) over the samples given, 0 when they span no time. */
export function dragSpeed(samples: DragSample[]): number {
  if (samples.length < 2) return 0;
  const a = samples[0];
  const b = samples[samples.length - 1];
  return b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
}

/** On release: "save" (right), "skip" (left) or "back" (springs back). */
export function swipeDecision(dx: number, width: number, speed: number): "save" | "skip" | "back" {
  const far = Math.abs(dx) > cardWidth(width) * SWIPE_SHARE;
  const flick = Math.abs(speed) >= FLING_SPEED && Math.abs(dx) >= FLING_MIN && Math.sign(speed) === Math.sign(dx);
  if (!far && !flick) return "back";
  return dx > 0 ? "save" : "skip";
}

/** The card's transform at a drag of dx (tilted unless reduced motion), and how far toward a swipe it is (-1..1). */
export function dragStyle(dx: number, width: number, reduce: boolean): { transform: string; progress: number } {
  const w = cardWidth(width);
  const progress = Math.max(-1, Math.min(1, dx / (w * SWIPE_SHARE)));
  if (!dx) return { transform: "", progress: 0 };
  const tilt = reduce ? "" : ` rotate(${((dx / w) * TILT_PER_WIDTH).toFixed(2)}deg)`;
  return { transform: `translate3d(${Math.round(dx)}px,0,0)${tilt}`, progress };
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
