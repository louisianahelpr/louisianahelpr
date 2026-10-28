/**
 * The Declutter reviews on a member's profile (deep audit 2026-10-28 #61): the reviews others left them after a
 * Declutter sale, read through declutter_visible_reviews (the blind rule and the seed switch are applied
 * server-side; no order id and no reviewer). Their listings already show on the profile (SellingNowRow, board 40).
 * There is no member-readable "sold" count yet; that line waits for a server read.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

export interface ProfileReview {
  id: string;
  /** Who wrote it: "buyer" = a buyer about this member as a seller; "seller" = a seller about them as a buyer. */
  reviewer_side: "buyer" | "seller";
  stars: number;
  comment: string | null;
  created_at: string;
  tags: string[] | null;
}

/** The Declutter reviews about this member that the viewer may see now, newest first. */
export async function fetchProfileReviews(userId: string): Promise<ProfileReview[]> {
  return ((unwrap(await supabase.rpc("declutter_visible_reviews", { p_user_id: userId })) ?? []) as unknown) as ProfileReview[];
}

/** Average stars (one decimal) and count, or null with none. */
export function reviewSummary(reviews: readonly ProfileReview[]): { avg: number; count: number } | null {
  if (reviews.length === 0) return null;
  const sum = reviews.reduce((a, r) => a + r.stars, 0);
  return { avg: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}
