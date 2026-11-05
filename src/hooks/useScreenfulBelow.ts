import { useLayoutEffect, useRef, useState } from "react";

/**
 * One screenful from where the element starts, for a placeholder that must
 * "FILL THE SCREEN, GROW BELOW" (owner ruling 2026-09-19; the Profile tab
 * placeholder's rule, ProfileTabFallback's useScreenfulBelow). Read once: the
 * placeholder's whole life is a few hundred ms, and a resize observer here
 * would fight the content that is about to replace it.
 */
export function useScreenfulBelow<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [reserve, setReserve] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setReserve(Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top)));
  }, []);
  return { ref, reserve };
}
