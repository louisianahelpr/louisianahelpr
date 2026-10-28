import { useQuery } from "@tanstack/react-query";
import { useFeature } from "@/hooks/useFeature";
import { fetchProfileReviews } from "@/lib/declutter/profile";

/**
 * #28 (Declutter deep audit, 2026-10-28): how many Declutter reviews this
 * member has, for the profile hero's rating tile. The SAME query (key and
 * read) DeclutterProfileSection makes, so the page reads them once. 0 while
 * loading, on an error, and for a viewer without Declutter: the tile then
 * keeps its plain "No reviews yet", which is what it said before.
 */
export function useDeclutterReviewCount(userId: string | undefined): number {
  const on = useFeature("declutter");
  const reviews = useQuery({
    queryKey: ["declutter", "profile-reviews", userId],
    queryFn: () => fetchProfileReviews(userId!),
    enabled: on && !!userId,
  });
  return on ? reviews.data?.length ?? 0 : 0;
}
