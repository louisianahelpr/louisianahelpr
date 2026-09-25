/**
 * When a cancelled recurring-series visit is refunded IN FULL, service fee
 * included, and carries no cancellation fee (money audit 2026-09-25 MEDIUM-9;
 * owner decisions Q407 (5) and (9)).
 *
 *   - An UNFILLED visit: a series visit (parent_job_id set) cancelled with no
 *     Helpr on it. It was funded for a Helpr who then gave it up, and nobody
 *     took it before it arrived (owner: a date still unfilled when it arrives
 *     is not charged).
 *   - A visit a PERMANENT BAN cancelled: jobs.series_ban_cancelled_at, a
 *     SERVER-OWNED marker that only end_series_for_banned_account
 *     (20260925170555) sets and no client role can write
 *     (trg_series_ban_marker_server_owned). Never the free-text
 *     cancellation_reason: poster_cancel_job copies the caller's p_reason
 *     verbatim, so any poster could type it (money review HIGH-1). The marker
 *     counts only on a series job (a visit, or visit one = the parent).
 *
 * The platform absorbs the Stripe processing cost on these refunds; the owner
 * has not said who should (docs/OPEN.md). Zero imports on purpose (the edge
 * harness points at the real module).
 */

export interface SeriesRefundJob {
  parent_job_id?: string | null;
  recurrence_days?: unknown[] | null;
  helper_id?: string | null;
  /** Server-owned; read separately from the job (deploy order). */
  series_ban_cancelled_at?: string | null;
}

export function refundsSeriesVisitInFull(job: SeriesRefundJob): boolean {
  const inSeries = !!job.parent_job_id || (Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0);
  if (inSeries && !!job.series_ban_cancelled_at) return true;
  return !!job.parent_job_id && !job.helper_id;
}
