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

/**
 * Humanize a snake_case category slug for display: "yard_work" → "Yard work".
 *
 * Single source of truth so every surface that renders a category reads the
 * same way (sentence case — first letter capitalized, the rest lowercased),
 * instead of the mix of CSS `capitalize`, raw lowercase, and per-word
 * Title Case that drifted across analytics/parish/wrapped/reports views.
 */
export function formatCategory(category: string): string {
  const spaced = category.replace(/_/g, " ").trim();
  if (spaced.length === 0) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
