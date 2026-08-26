// Derives a small weekly earnings series for the Profile-landing sparkline
// teaser from the SAME completed-jobs data the Earnings tab already loads —
// no new query, no charting lib. Take-home per job is delegated to
// `helperEarnings.ts` so the line and the "total earned" figure printed beside
// it can never disagree.
//
// This used to hand-roll `budget − (platform_fee_amount || 0) + urgent`, which
// had two defects the shared helper fixes: an UNSTAMPED row (legacy/seed, or a
// job whose payout hasn't been released yet) fell back to a $0 fee and drew the
// GROSS budget as take-home, and `|| 0` also swallowed a genuinely-stamped $0
// fee's meaning. Callers now pass the helper's tier-derived fallback rate.

import { helperTakeHomeDollars } from "@/lib/helperEarnings";

interface JobLike {
  status: string;
  /** Needed so an unsettled row is priced at the helper's live tier rather
   *  than create-payment's escrow-time global stamp — see helperEarnings.ts
   *  `isSettledForDisplay`. Callers pass full `jobs` rows, which carry it. */
  payment_status?: string | null;
  budget: number;
  platform_fee_amount?: number | null;
  helper_fee_percent?: number | null;
  urgent_fee?: number | null;
  is_group_job?: boolean | null;
  helpers_needed?: number | null;
  poster_completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const WEEK_MS = 7 * 86_400_000;

/**
 * Bucket completed-job take-home into the last `weeks` 7-day windows,
 * oldest → newest. Returns `null` when there isn't enough signal to draw a
 * meaningful line (fewer than 2 buckets with any earnings), so the caller
 * can hide the teaser instead of rendering an empty/flat chart.
 *
 * `feeFallbackPercent` is the helper's tier-derived rate, applied only to rows
 * that carry neither a stamped fee nor a frozen per-job percent.
 */
export function buildEarningsSparklineSeries(
  jobs: JobLike[],
  feeFallbackPercent: number,
  weeks = 6,
): number[] | null {
  const now = Date.now();
  const buckets = new Array(weeks).fill(0);

  for (const j of jobs) {
    if (j.status !== "completed") continue;
    const when = j.poster_completed_at || j.updated_at || j.created_at;
    if (!when) continue;
    const t = new Date(when).getTime();
    if (Number.isNaN(t)) continue;
    const ageWeeks = Math.floor((now - t) / WEEK_MS);
    if (ageWeeks < 0 || ageWeeks >= weeks) continue;
    const takeHome = helperTakeHomeDollars(j, feeFallbackPercent);
    if (takeHome <= 0) continue;
    // Newest bucket sits at the end of the array (index weeks-1).
    buckets[weeks - 1 - ageWeeks] += takeHome;
  }

  const nonEmpty = buckets.filter((v) => v > 0).length;
  // Need at least two weeks with earnings — a single spike or all-zero
  // series reads as broken, not as a trend.
  if (nonEmpty < 2) return null;
  return buckets;
}
