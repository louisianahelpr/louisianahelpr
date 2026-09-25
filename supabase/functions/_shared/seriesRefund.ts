/**
 * When a cancelled recurring-series visit is refunded IN FULL, service fee
 * included, and carries no cancellation fee (money audit 2026-09-25 MEDIUM-9;
 * owner decisions Q407 (5) and (9)).
 *
 *   - An UNFILLED visit: a series visit (parent_job_id set) cancelled with no
 *     Helpr on it. It was funded for a Helpr who then gave it up, and nobody
 *     took it before it arrived (owner: a date still unfilled when it arrives
 *     is not charged).
 *   - A visit cancelled because the series was ENDED BY A PERMANENT BAN
 *     (20260925170555 writes SERIES_BAN_CANCEL_REASON): "future visits are
 *     cancelled and not charged".
 *
 * The platform absorbs the Stripe processing cost on these refunds; the owner
 * has not said who should (docs/OPEN.md). Zero imports on purpose (the edge
 * harness points at the real module).
 */

/** cancellation_reason 20260925170555 writes on every visit a permanent ban cancels. */
export const SERIES_BAN_CANCEL_REASON = "series_ended_account_banned";

export interface SeriesRefundJob {
  parent_job_id?: string | null;
  helper_id?: string | null;
  cancellation_reason?: string | null;
}

export function refundsSeriesVisitInFull(job: SeriesRefundJob): boolean {
  if (job.cancellation_reason === SERIES_BAN_CANCEL_REASON) return true;
  return !!job.parent_job_id && !job.helper_id;
}
