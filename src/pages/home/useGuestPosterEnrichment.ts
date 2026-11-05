import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { fetchRatingStats } from "@/lib/reviewStats";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import type { EnrichedJob } from "@/components/dashboard/types";
import { guestPosterIds } from "./guestPosterIds";

/**
 * The guest Browse feed's poster enrichment (DashboardGuest): the second of its two queries (see the note there on
 * why the job list and this enrichment are split). Returns the enriched jobs and whether the enrichment has settled
 * (the feed's one-paint gate waits for it).
 */
export function useGuestPosterEnrichment(baseJobs: EnrichedJob[]) {
  // A null `customer_id` is a poster who DELETED their account: deletion
  // anonymises the job rather than removing it (20260901033011), so the job
  // survives with no owner. Null is not an id to look up, and handing one to a
  // uuid[] RPC parameter is a malformed filter rather than a no-match — so it
  // is dropped here, not tolerated downstream.
  const posterIds = useMemo(() => guestPosterIds(baseJobs), [baseJobs]);

  // Social-proof enrichment. Runs only once the job list exists (it needs the
  // poster ids), and the feed never blocks on it.
  const { data: posterInfo, status: posterInfoStatus } = useQuery({
    queryKey: queryKeys.dashboard.guestJobPosters(posterIds),
    enabled: posterIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [profilesRes, reviewStatsMap] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        fetchRatingStats(posterIds),
      ]);

      // Enrichment only — deliberately non-fatal (a name lookup failure must
      // not blank the whole feed), but never silent: without this the poster
      // of every job quietly becomes "User" with nothing in error_logs to say
      // why. (CLAUDE.md: never drop the Supabase error.)
      if (profilesRes.error) {
        report(profilesRes.error, { tags: { source: "DashboardGuest.posterNames" } });
      }
      return {
        nameMap: new Map(
          profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
        ),
        avatarMap: new Map<string, string | null>(
          profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
        ),
        // Poster tier, for the bounded placement term in `smartScore`. This
        // map used to not exist and every guest job was hardcoded to a null
        // tier below, so the logged-out preview ranked jobs differently from
        // the /jobs board (which applies the same lift server-side, in
        // get_ranked_open_jobs) and differently again from the signed-in
        // dashboard. get_safe_profiles already returns this column, with
        // subscription expiry folded in server-side (20260901022522), so a
        // lapsed poster correctly buys nothing.
        tierMap: new Map<string, string | null>(
          profilesRes.data?.map((p) => [p.user_id, p.subscription_tier ?? null]) || [],
        ),
        reviewStatsMap,
      };
    },
  });

  const jobs = useMemo<EnrichedJob[]>(() => {
    if (!posterInfo) return baseJobs;
    return baseJobs.map((j) => {
      // Ownerless job (see posterIds above): it keeps the existing "a neighbor"
      // fallback and scores with no tier, which is what an unknown poster
      // already got. It must not reach a lookup keyed on a string.
      const posterId = j.customer_id;
      const stats = posterId ? posterInfo.reviewStatsMap.get(posterId) : undefined;
      return {
        ...j,
        posterName: (posterId ? posterInfo.nameMap.get(posterId) : null) || "a neighbor",
        posterAvatarUrl: (posterId ? posterInfo.avatarMap.get(posterId) : null) ?? null,
        posterReviewCount: stats?.count ?? 0,
        posterAvgRating: stats?.avg ?? 0,
        posterCompletedJobs: 0,
        posterSubscriptionTier: (posterId ? posterInfo.tierMap.get(posterId) : null) ?? null,
      };
    });
  }, [baseJobs, posterInfo]);

  // ONE PAINT, not two (Q169). The split above stops the feed waiting on the
  // enrichment CHAIN, but painting the list the moment it lands meant it
  // painted twice: the ranking reads each poster's tier, so when posterInfo
  // arrived ~400ms later the cards swapped places (measured at 375 on Fast 3G:
  // "Deep clean" jumped from 4th to 3rd). The skeleton now holds until the
  // enrichment has SETTLED too — at most ARRIVAL_CAP_MS after the list — and
  // then every card lands once, in its final order. No poster ids (empty or
  // all-ownerless list) means there is nothing to wait for.
  const enrichmentSettled = posterIds.length === 0 || posterInfoStatus !== "pending";
  return { jobs, enrichmentSettled };
}
