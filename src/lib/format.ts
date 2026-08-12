/**
 * Shared price/currency formatting helpers.
 *
 * `formatPrice` is the single source of truth for rendering a dollar
 * amount the way the job cards do: always whole dollars, no decimals
 * ("$85", and 114.40 -> "$114"). This mirrors the canonical logic in
 * `src/components/dashboard/JobCard.tsx` so every surface that shows a
 * price reads identically.
 *
 * The returned string does NOT include a leading "$" — callers prepend it
 * (often inside JSX like `${formatPrice(n)}`) so they keep control over
 * styling around the glyph.
 */
/**
 * Cents-exact sibling of `formatPrice`, for lines that SHOW THE ARITHMETIC —
 * fee breakdowns, payout splits, receipts.
 *
 * `formatPrice` rounds to whole dollars, which is right for a headline figure
 * and wrong here: a 10% cut of $25 rendered as "-$3" instead of "-$2.50",
 * overstating the platform's take by 50c in the one place a user is checking
 * our maths. A breakdown that doesn't add up is worse than one with cents in
 * it. Whole amounts still print clean ("$25", not "$25.00").
 */
export function formatPriceExact(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  const cents = Math.round(amount * 100);
  const hasFraction = cents % 100 !== 0;
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Canonical date formatter for job timestamps (created_at, completed_at, etc.).
 * Produces "Jun 18, 2026" — short month + day + year, locale-stable.
 * Use this instead of bare `toLocaleDateString()` so every surface matches.
 *
 * Named `formatTimestamp` to distinguish it from `formatJobDate` in
 * `@/lib/dateUtils`, which formats the date_needed DATE column
 * (YYYY-MM-DD) with a weekday prefix ("Mon, Jun 22").
 */
export function formatTimestamp(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Compact relative date — "Jun 13" within the current year, "Jun 13, 2025"
 * for prior years. Year is appended only when the date falls outside the
 * current year, so recent activity stays terse while older entries still
 * disambiguate. Use for dense activity/review lists; use `formatTimestamp`
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
  // "85.10" rather than "85.099999…"), then group thousands so amounts
  // ≥ $1,000 read as "1,524" not "1524".
  // WHOLE DOLLARS. Prices round to the nearest dollar rather than carrying
  // cents: a fee-derived net like 114.40 read as false precision next to a
  // budget the poster typed as a round "$130", and every card ended up with a
  // ragged mix of "$95" and "$114.40".
  //
  // Rounding is DISPLAY ONLY — nothing here touches what Stripe moves. The
  // exact arithmetic still appears beside the figure ("$130 budget - 12% fee"),
  // so the precise number is always one line away. Worst-case drift is 49c
  // against a payout, and the breakdown reconciles it.
  return Math.round(amount).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
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

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

/**
 * Human-readable label for a job's `recurrence_interval` enum value.
 * Raw values like "weekly" read as "Every weekly" when concatenated with
 * "Every "; this maps them to grammatically correct phrases.
 */
export function formatRecurrenceInterval(interval: string | null | undefined): string {
  if (!interval) return "Recurring";
  return RECURRENCE_LABELS[interval] ?? "Recurring";
}

/**
 * Season-aware label for the year-in-review feature.
 *
 * "Wrapped" frames the feature as a completed year-in-review, but it's shown
 * year-round — calling a half-finished year "Wrapped" in June reads as a bug.
 * Only call it "Wrapped" once the year is actually wrapping up (December);
 * the rest of the year it's "so far" — an in-progress tally.
 *
 * @param now - injectable clock for tests; defaults to the current date.
 * @returns `{ year, isYearEnd, noun, title }` where `noun` is "Wrapped" in
 *   December else "so far", and `title` is `"${year} ${noun}"`.
 */
export function wrappedSeasonLabel(now: Date = new Date()): {
  year: number;
  isYearEnd: boolean;
  noun: string;
  title: string;
} {
  const year = now.getFullYear();
  const isYearEnd = now.getMonth() === 11; // December
  const noun = isYearEnd ? "Wrapped" : "so far";
  return { year, isYearEnd, noun, title: `${year} ${noun}` };
}
