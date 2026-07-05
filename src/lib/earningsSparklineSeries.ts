// Derives a small weekly earnings series for the Profile-landing sparkline
// teaser from the SAME completed-jobs data the Earnings tab already loads —
// no new query, no charting lib. Take-home per job mirrors the Earnings/
// Profile math: budget − platform fee + net urgent fee.

import { netUrgentFeeDollars } from "@/lib/stripeFees";

interface JobLike {
  status: string;
  budget: number;
  platform_fee_amount?: number | null;
  urgent_fee?: number | null;
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
 */
export function buildEarningsSparklineSeries(
  jobs: JobLike[],
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
    const takeHome = j.budget - (j.platform_fee_amount || 0) + netUrgentFeeDollars(j.urgent_fee);
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
