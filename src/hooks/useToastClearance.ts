import { useEffect, useState } from "react";

const LIVE_TOAST = '[data-sonner-toast]:not([data-removed="true"])';

/** Height of the bottom toast stack now on screen (0 when none), in px. Pure, for tests. */
function toastClearancePx(doc: Document): number {
  let tallest = 0;
  doc.querySelectorAll(LIVE_TOAST).forEach((el) => {
    tallest = Math.max(tallest, el.getBoundingClientRect().height);
  });
  return tallest > 0 ? Math.ceil(tallest) + 12 : 0;
}

/**
 * Extra bottom padding a list needs while a toast floats over its end (lead
 * review 2026-10-20, board 14: "Get notified?" is the one prompt on screen,
 * but it must not cover the last card's button). Every toast is
 * bottom-anchored (owner, 2026-09-12; src/components/ui/sonner.tsx).
 */
export function useToastClearance(): number {
  const [px, setPx] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined" || !document.body) return;
    const measure = () => setPx(toastClearancePx(document));
    measure();
    const mo = new MutationObserver(measure);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-removed", "data-mounted"] });
    return () => mo.disconnect();
  }, []);
  return px;
}
