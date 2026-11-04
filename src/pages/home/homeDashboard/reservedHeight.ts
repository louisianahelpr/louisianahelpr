import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Q2706 (B98, 11-04): the height a Home block had when it last finished loading on this device, at this width,
 * so the next load can hold that much room while its reads are out and nothing below it moves when it lands.
 * Lab (/home, Fast 4G, prod data): the money strip arriving (0.106) and Next up growing from its loading state
 * (0.103) were the two layout shifts. A first visit has no number and reserves only the placeholder's own size.
 *
 * Per viewer and per device (localStorage), never shared; storage blocked or empty just means no reserve.
 */
const keyFor = (name: string) => `lh:home-reserve:${name}:${typeof window === "undefined" ? 0 : window.innerWidth}`;

export function readReservedHeight(name: string): number {
  try {
    const n = Number(localStorage.getItem(keyFor(name)));
    return Number.isFinite(n) && n > 0 && n < 2000 ? n : 0;
  } catch {
    return 0; // storage blocked (private window): no reserve, the block draws as it always did
  }
}

export function saveReservedHeight(name: string, px: number): void {
  try {
    if (px > 0) localStorage.setItem(keyFor(name), String(Math.round(px)));
    else localStorage.removeItem(keyFor(name));
  } catch {
    // storage blocked: the next load reserves nothing, as before this hint existed
  }
}

/**
 * The reserve for `name` (read once per mount), and, once `loading` is false, the block's settled height saved for
 * next time (0 = the block is not drawn, so nothing is reserved). `measure` reads the settled block.
 */
export function useReservedHeight(name: string | null, loading: boolean, measure: RefObject<HTMLElement | null> | (() => HTMLElement | null)): number {
  const [reserve] = useState(() => (name ? readReservedHeight(name) : 0));
  useLayoutEffect(() => {
    if (!name || loading) return;
    const el = typeof measure === "function" ? measure() : measure.current;
    saveReservedHeight(name, el ? el.offsetHeight : 0);
  });
  return reserve;
}
