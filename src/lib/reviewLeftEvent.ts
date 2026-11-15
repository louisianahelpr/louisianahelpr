/**
 * The `review_left` analytics events (docs/OPEN.md Q2815).
 *
 * Two screens write a job review: ReviewForm (the review sheet) and
 * CompletionPrompts (the review that opens right after Done, Q2484 /
 * 2026-10-29). Only ReviewForm emitted review_left, so once the post-Done
 * prompt became the usual way to review, real reviews stopped being counted:
 * the analytics-freshness monitor read 0 events against 1 real review in the
 * week to 2026-11-15 (reviews 59adb87b, 2026-11-14 03:21Z, written 17 s after
 * that member's job_completed from Activity, with no review_left).
 *
 * So every client review write calls this in its success branch, after the row
 * is proven to exist; it is the one place the three review events are
 * emitted. Guard: src/test/reviewWritesEmitReviewLeft.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";

export function trackReviewLeft(jobId: string, rating: number, reviewerId: string): void {
  track(AhaEvent.ReviewLeft, { job_id: jobId, rating });
  if (rating === 5) {
    // Analytics only: it never decides who is asked to rate the app.
    track(AhaEvent.FirstFiveStarReview, { job_id: jobId, rating: 5 });
  }
  void trackFirstReview(jobId, rating, reviewerId);
}

// True first review (any rating): <= 1 covers the row just written.
async function trackFirstReview(jobId: string, rating: number, reviewerId: string) {
  try {
    const { count, error } = await supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .eq("reviewer_id", reviewerId);
    if (!error && (count ?? 0) <= 1) track(AhaEvent.FirstReviewLeft, { job_id: jobId, rating });
  } catch { /* analytics must never break the flow */ }
}
