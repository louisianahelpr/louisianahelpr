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
/**
 * Canonical date formatter for job timestamps (created_at, completed_at, etc.).
 * Produces "Jun 18, 2026" — short month + day + year, locale-stable.
 * Use this instead of bare `toLocaleDateString()` so every surface matches.
 */
export function formatJobDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Compact relative date — "Jun 13" within the current year, "Jun 13, 2025"
 * for prior years. Year is appended only when the date falls outside the
 * current year, so recent activity stays terse while older entries still
 * disambiguate. Use for dense activity/review lists; use `formatJobDate`
 * when the year must always show.
 */
export function formatShortDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", opts);
}

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
