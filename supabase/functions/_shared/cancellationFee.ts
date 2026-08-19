// cancellationFee — server-side source of truth for the tiered job-cancellation
// fee, for the Deno edge runtime.
//
// SECURITY (F-MONEY-32): the money paths must NEVER trust the persisted
// `jobs.cancellation_fee` column when moving funds. That column is written by
// the client (CancellationDialog) and, under the helper column-whitelist
// (20260703161000), remains writable by an assigned helper — so a helper could
// inflate it to skim the poster's refund, or a poster could zero it to stiff
// the helper. `void-cancelled-payments` therefore RECOMPUTES the fee here from
// inputs the client cannot forge in its favor (budget, scheduled date, whether a
// helper was assigned, and the timestamp the cancellation was recorded).
//
// This ladder MUST stay in lock-step with the client estimate in
// `src/components/CancellationDialog.tsx` (which is display-only). The tiers:
//
//     no helper assigned          → 0%   (free — nothing committed yet)
//     24+ hours before the job    → 0%   (free cancellation)
//     less than 24 hours before   → 25%  (helper committed time)
//     less than 2 hours before    → 50%  (very late cancellation)

/** Percent of budget owed as a cancellation fee, from the tiered schedule. */
export function cancellationFeePercent(
  hasHelper: boolean,
  hoursUntilJob: number,
): number {
  if (!hasHelper) return 0;
  if (hoursUntilJob < 2) return 50;
  if (hoursUntilJob < 24) return 25;
  return 0;
}

/**
 * The platform's operating timezone. `date_needed` is a plain calendar date
 * (`YYYY-MM-DD`) with no zone, so "midnight on that day" is only meaningful
 * relative to one — and it has to be the SAME one everywhere or the fee tier
 * moves depending on which machine computed it.
 */
const JOB_TIMEZONE = "America/Chicago";

/**
 * Epoch ms for midnight on `dateNeeded` **in JOB_TIMEZONE**, regardless of the
 * runtime's own zone.
 *
 * This replaced `new Date(\`${dateNeeded}T00:00:00\`)`, which parses in the
 * RUNTIME's local zone. The client runs in America/Chicago and this module runs
 * on Deno Deploy in UTC, so the two disagreed by 5-6 hours and the poster could
 * be quoted one cancellation tier and charged another — e.g. shown "free" at 25
 * hours out while the server computed ~20 and charged 25% of the budget.
 *
 * Derived by measuring the zone's offset at that instant rather than hardcoding
 * -5/-6, so DST is handled without a table.
 */
export function jobLocalMidnightMs(dateNeeded: string, timeZone = JOB_TIMEZONE): number {
  const [y, m, d] = dateNeeded.split("-").map(Number);
  const utcMidnight = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMidnight));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // What that same instant reads as in the target zone, expressed as UTC.
  const asZone = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return utcMidnight - (asZone - utcMidnight);
}

/** Hours between when the cancellation was recorded and the job's start. */
export function hoursUntilJob(dateNeeded: string, cancelledAtIso: string | null): number {
  // Midnight on the job's day IN THE PLATFORM'S ZONE — not the runtime's.
  const start = jobLocalMidnightMs(dateNeeded);
  // Use the recorded cancellation time so a slow cron run can't push the job
  // into a cheaper/pricier tier than the moment the poster actually cancelled.
  const at = cancelledAtIso ? new Date(cancelledAtIso).getTime() : Date.now();
  return (start - at) / (1000 * 60 * 60);
}

/** Minimal shape of the job fields required to derive the fee. */
export interface CancellationFeeJob {
  budget: number | null;
  date_needed: string | null;
  cancelled_at: string | null;
  helper_id: string | null;
}

/**
 * Authoritative cancellation fee in DOLLARS, derived entirely from trusted job
 * fields. Never reads `jobs.cancellation_fee`. Returns 0 when no helper was
 * assigned, the budget is missing/non-positive, or the schedule yields 0%.
 */
export function computeCancellationFee(job: CancellationFeeJob): number {
  const budget = job.budget ?? 0;
  if (!(budget > 0) || !job.helper_id || !job.date_needed) return 0;
  const hours = hoursUntilJob(job.date_needed, job.cancelled_at);
  const percent = cancellationFeePercent(!!job.helper_id, hours);
  // round(budget * percent) / 100 mirrors the client's cent-accurate math.
  return Math.round(budget * percent) / 100;
}
