import { supabase } from "@/integrations/supabase/client";

/**
 * Did the review just posted go live at once? Audit A2-C34 (2026-10-29): the second reviewer was told "It goes
 * live once they review you too" when both reviews had just gone live. The AFTER INSERT trigger
 * set_review_visibility() (live def read 2026-10-29) stamps feedback_visible_at = now() on BOTH rows when the
 * other side's review exists, else now() + 14 days, so the insert's own RETURNING cannot see it. One follow-up
 * read of the reviewer's own row answers it: the reviews SELECT policy lets a reviewer read their own row
 * (`reviewer_id = auth.uid()`, pg_policies 2026-10-29), and authenticated holds SELECT on the column.
 *
 * Live = stamped and not held: the hold is 14 days, so anything under a day ahead of this device's clock is the
 * reveal (a device clock a little behind the server's must not turn a reveal into "held"). Any failure answers
 * false, which keeps the old, held wording: never claims a review is public when we do not know.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function isLiveNow(visibleAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!visibleAt) return false;
  const at = Date.parse(visibleAt);
  return !Number.isNaN(at) && at < nowMs + DAY_MS;
}

export async function reviewIsLiveNow(reviewId: string): Promise<boolean> {
  const { data, error } = await supabase.from("reviews").select("feedback_visible_at").eq("id", reviewId).maybeSingle();
  // A failed read keeps the held wording (see above); the review itself is already saved.
  if (error || !data) return false;
  return isLiveNow((data as { feedback_visible_at: string | null }).feedback_visible_at);
}
