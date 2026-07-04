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

/** Hours between when the cancellation was recorded and the job's start. */
export function hoursUntilJob(dateNeeded: string, cancelledAtIso: string | null): number {
  // Match the client: the job's day at local-midnight is the reference start.
  // `date_needed` is a plain `YYYY-MM-DD`; appending T00:00:00 keeps parity with
  // CancellationDialog's `new Date(jobDate + "T00:00:00")`.
  const start = new Date(`${dateNeeded}T00:00:00`).getTime();
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
