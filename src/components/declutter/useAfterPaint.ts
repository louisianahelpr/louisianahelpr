import { useEffect, useState } from "react";

/**
 * True from the frame after `ready` first turns true (the screen has painted with it), and stays true. The item page
 * starts its below-the-fold reads ("More from this seller", "Similar items", the seller's badges, owner 11-07) only
 * then, so they never share the line with the item and its photos (owner rule: pages under 2 s).
 */
export function useAfterPaint(ready: boolean): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (!ready || painted) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => { t = setTimeout(() => setPainted(true), 0); });
    return () => {
      cancelAnimationFrame(raf);
      if (t) clearTimeout(t);
    };
  }, [ready, painted]);
  return painted;
}
