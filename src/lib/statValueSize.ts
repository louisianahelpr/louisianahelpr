/**
 * Type size for a big stat tile's VALUE.
 *
 * The tiles were sized for numerals (`165`, `$1,255`, `4.9`) and set every
 * value at 28px bold. A WORD value — Wrapped's "top category" — does not fit
 * that: measured on prod 2026-09-23 (Q179), "Cleaning" at 28px ran past its
 * tile's padding at 375 and past the tile's edge at 320. Numerals keep the
 * 28px display size; a value with no numeral in it drops to 16px, which fits
 * the longest one-word category ("Cleaning", "Handyman", "Assembly") inside a
 * 320px phone's tile and wraps between words ("Storm prep"). break-word is
 * only the last resort for a word that still cannot fit.
 */
export function statValueSize(value: string): string {
  return /\d/.test(value)
    ? "text-ds-28 tabular-nums"
    : "text-ds-16 text-balance [overflow-wrap:break-word]";
}
