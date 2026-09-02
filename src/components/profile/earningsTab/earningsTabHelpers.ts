import { formatTimestamp } from "@/lib/format";
import type { StripePayout } from "./types";

// Payout-status pills are a separate concern from job-status chips: this
// table is the Stripe payout pipeline (`paid` / `in_transit` / `pending`
// / `failed` / `canceled`), not the `job_status` enum. Job-status chips
// in the earnings list below route through the canonical
// `jobStatusColorClasses` from `@/lib/statusColors` so they paint the
// same as every other status chip in the app.
export const payoutStatusColors: Record<string, string> = {
  paid: "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))]",
  in_transit: "bg-[hsl(var(--burnt-sienna)/0.10)] text-[hsl(var(--burnt-sienna))]",
  pending: "bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood))]",
  failed: "bg-destructive/10 text-destructive",
  canceled: "bg-destructive/10 text-destructive",
};

export const formatCents = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export const formatDate = (unixSec: number) => formatTimestamp(new Date(unixSec * 1000));

// Builds the tax-prep CSV for a given year from the Stripe payout list.
// Returns the filtered rows (so the caller can toast the count / handle
// the empty case) and the assembled CSV string. Pure — no DOM/toast.
export const buildPayoutsCsv = (
  payouts: StripePayout[],
  year: number,
): { rows: StripePayout[]; csv: string } => {
  const rows = payouts.filter(
    (p) => new Date(p.arrival_date * 1000).getFullYear() === year
  );

  const escape = (val: string | number | null | undefined) => {
    const s = val == null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["Arrival Date", "Description", "Status", "Method", "Currency", "Net Payout (USD)"];
  const csvLines = [header.join(",")];
  let total = 0;

  rows.forEach((p) => {
    const dollars = p.amount / 100;
    total += dollars;
    csvLines.push(
      [
        new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
        escape(p.description ?? `Stripe Payout ${p.id}`),
        escape(p.status),
        escape(p.method),
        escape(p.currency.toUpperCase()),
        dollars.toFixed(2),
      ].join(",")
    );
  });

  csvLines.push("");
  csvLines.push(`Total Net Payouts,${total.toFixed(2)}`);
  csvLines.push(`Tax Year,${year}`);
  csvLines.push("Note,Net amounts paid to your bank. Excludes platform fees & sales tax (Helpr's responsibility).");

  return { rows, csv: csvLines.join("\n") };
};

// ─── DATE-RANGE SCOPING (the Money view's range toggle) ─────────────────
//
// The range toggle above the Money view used to gate two cards (the Sunday
// projection and the monthly goal) and NOTHING else — the headline total, the
// tips figure and the job count were always lifetime, so picking "This Year"
// changed literally nothing on screen and picking "This Week" still showed a
// lifetime total under a control labelled "This Week". A range control that
// does not range anything is worse than no control: it states a scope the
// numbers beneath it do not honour.
//
// These two helpers are what make the toggle honest. The bucketing rule is
// copied deliberately from PaymentTab's poster-spend toggle (completion
// timestamp, poster's confirmation first, helper's next, `created_at` for
// legacy rows that predate both) so the earned side and the spent side slice
// time the same way — otherwise "This Week" would mean two different weeks on
// one screen.

/** Inclusive lower bound (ms) for a range, or null for "everything". */
export const rangeStartMs = (
  range: "lifetime" | "week" | "month" | "year",
  now: Date = new Date(),
): number | null => {
  if (range === "lifetime") return null;
  if (range === "week") {
    // Week starts MONDAY, matching PaymentTab's spend toggle. Sunday
    // (getDay() === 0) belongs to the week that began six days earlier.
    const day = now.getDay();
    const start = new Date(now);
    start.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return new Date(now.getFullYear(), 0, 1).getTime();
};

/** When a completed job actually completed. Poster confirmation is the
 *  terminal step, so it wins; the helper's mark is the fallback; `created_at`
 *  covers rows written before either column existed. */
const completedAtMs = (job: {
  poster_completed_at?: string | null;
  helper_completed_at?: string | null;
  created_at: string;
}): number =>
  new Date(job.poster_completed_at ?? job.helper_completed_at ?? job.created_at).getTime();

/** Filter completed jobs down to a range. `null` (lifetime) passes everything
 *  through untouched rather than re-deriving a timestamp per row. */
export const completedWithin = <
  T extends { poster_completed_at?: string | null; helper_completed_at?: string | null; created_at: string },
>(
  rows: T[],
  sinceMs: number | null,
): T[] => (sinceMs === null ? rows : rows.filter((j) => completedAtMs(j) >= sinceMs));

/** The caption printed under the headline figure. Named for the range so the
 *  number can never sit under a scope it doesn't have. */
export const earnedRangeLabel = (range: "lifetime" | "week" | "month" | "year"): string =>
  range === "lifetime"
    ? "total earned"
    : range === "week"
    ? "earned this week"
    : range === "month"
    ? "earned this month"
    : "earned this year";
