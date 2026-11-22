import { useLayoutEffect, useRef } from "react";

/** The class index.css sets smaller on a phone, beside `.page-title-long` (JA-14). */
const TITLE_WRAPS_CLASS = "page-title-wraps";

/**
 * Jobs audit 11-21 (L23): a short title still wrapped at the large size on a phone when the row's icons left it
 * little room ("Saved Helprs" and "Host automation" on two lines at 375, beside search and Help). The length rule
 * (LONG_TITLE_CHARS) guessed from the character count; this measures: a wrapping title that takes more than one
 * line at the large size gets TITLE_WRAPS_CLASS, which sets it at the long-title size (index.css, phones only).
 * Re-measured when the row's width changes. Guard: src/test/titleShrinksWhenItWraps1121.test.tsx.
 */
export function useTitleShrinksWhenItWraps<T extends HTMLElement>(enabled: boolean, title: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const check = () => {
      el.classList.remove(TITLE_WRAPS_CLASS);
      const line = parseFloat(getComputedStyle(el).lineHeight);
      const wraps = Number.isFinite(line) && line > 0 && el.getBoundingClientRect().height > line * 1.5;
      el.classList.toggle(TITLE_WRAPS_CLASS, wraps);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    let width = el.parentElement?.clientWidth ?? 0;
    const ro = new ResizeObserver(() => {
      const next = el.parentElement?.clientWidth ?? 0;
      if (next === width) return; // only the row's width changes what fits (our own class changes the height)
      width = next;
      check();
    });
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, [enabled, title]);
  return ref;
}
