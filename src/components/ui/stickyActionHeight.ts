/**
 * Deep audit 11-22 #13: the fixed phone StickyActionBar publishes its painted height on <html> so a toast clears it
 * (ui/sonner.tsx reads the variable). A signed-out visitor has no dock (--bottom-nav-h is 0), so without this a toast
 * ("Link copied") sat on the Make offer / Buy now bar. More than one bar may be mounted for a moment (a route change),
 * so the variable is the tallest live bar, and it is removed when the last one goes.
 */
export const STICKY_ACTION_H_VAR = "--sticky-action-h";

const heights = new Map<object, number>();

function publish(): void {
  if (typeof document === "undefined") return;
  const tallest = Math.max(0, ...heights.values());
  const style = document.documentElement.style;
  if (tallest > 0) style.setProperty(STICKY_ACTION_H_VAR, `${Math.ceil(tallest)}px`);
  else style.removeProperty(STICKY_ACTION_H_VAR);
}

/** Track one bar's height until the returned cleanup runs. */
export function trackStickyActionHeight(bar: HTMLElement): () => void {
  const key = {};
  const measure = () => {
    heights.set(key, bar.getBoundingClientRect().height);
    publish();
  };
  measure();
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  observer?.observe(bar);
  return () => {
    observer?.disconnect();
    heights.delete(key);
    publish();
  };
}
