/**
 * Shared price/currency formatting helpers.
 *
 * `formatPrice` is the single source of truth for rendering a dollar
 * amount the way the job cards do: whole numbers print with no decimals
 * ("$85", not "$85.00"), while fractional amounts keep two decimal places
 * ("$85.50"). This mirrors the canonical logic in
 * `src/components/dashboard/JobCard.tsx` so every surface that shows a
 * price reads identically.
 *
 * The returned string does NOT include a leading "$" — callers prepend it
 * (often inside JSX like `${formatPrice(n)}`) so they keep control over
 * styling around the glyph.
 */
export function formatPrice(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  // Work in integer cents to avoid binary float artifacts (e.g. 85.1 →
  // "85.10" rather than "85.099999…").
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
