import { useMemo } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import { CARDS_PER_ROW, PAGE_SIZE } from "./jobsConstants";
import type { JobsPage, PublicJob } from "./types";

interface UseOpenJobsFeedArgs {
  search: string;
  selectedCategory: string | null;
  pricingMode: "all" | "bids" | "budget";
  /** "" = no floor / no cap, matching the dashboard's string convention. */
  minBudget?: string;
  maxBudget?: string;
  /** "" | "24h" | "3d" | "7d" — same values the authed sheet emits. */
  expiresWithin?: string;
  boostedOnly?: boolean;
  /** "smart" | "newest" | "highest_pay" | "lowest_pay" | "ending_soon". */
  sortBy?: string;
}

export const useOpenJobsFeed = ({
  search,
  selectedCategory,
  pricingMode,
  minBudget = "",
  maxBudget = "",
  expiresWithin = "",
  boostedOnly = false,
  sortBy = "smart",
}: UseOpenJobsFeedArgs) => {
  // Paginated open-jobs feed via React Query, consistent with the
  // dashboard's useInfiniteQuery feed. get_ranked_open_jobs ranks by boost
  // (1000) + parish match (500) + urgent (100) + recency (0-50) and coarsens
  // the address to "City, ST" via mask_job_location server-side. Anon callers
  // work (EXECUTE granted) — they just don't get the parish-match boost.
  const {
    data: pagesData,
    isLoading: jobsLoading,
    isError: jobsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: queryKeys.jobs.open(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<JobsPage> => {
      const offset = pageParam as number;
      // unwrap surfaces a failed fetch as the query's error state (drives
      // <ErrorState/>) instead of silently degrading to a blank feed.
      const rows = unwrap(
        await supabase.rpc("get_ranked_open_jobs", { p_limit: PAGE_SIZE, p_offset: offset }),
      );
      const jobs = (rows ?? []) as unknown as PublicJob[];
      return { jobs, nextOffset: jobs.length === PAGE_SIZE ? offset + PAGE_SIZE : null };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const jobs = useMemo<PublicJob[]>(
    () => (pagesData?.pages ?? []).flatMap((p) => p.jobs),
    [pagesData],
  );

  // Guest filtering + sorting runs client-side over the pages fetched so far —
  // the same model the signed-in feed uses (useDashboardFilters filters and
  // sorts `allJobs` in a useMemo), so a filter behaves identically on both
  // surfaces. Budget / expiry / boost all read fields get_ranked_open_jobs
  // already returns; nothing here needs an account.
  const filtered = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const min = minBudget ? parseFloat(minBudget) : null;
    const max = maxBudget ? parseFloat(maxBudget) : null;
    // Same windows the authed sheet applies for "Expires within".
    const expiryHours =
      expiresWithin === "24h" ? 24 : expiresWithin === "3d" ? 72 : expiresWithin === "7d" ? 168 : null;

    const list = jobs.filter((job) => {
      // Hide jobs that have expired in real-time (between fetches)
      if (job.expires_at && new Date(job.expires_at) <= now) return false;
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(search.toLowerCase()) ||
        job.location.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;
      if (selectedCategory && job.category !== selectedCategory) return false;
      // "accept_bids" = open to bids; any other value (fixed / null) = set budget.
      const isBids = job.pricing_mode === "accept_bids";
      if (pricingMode !== "all" && (pricingMode === "bids" ? !isBids : isBids)) return false;
      if (min !== null && Number.isFinite(min) && job.budget < min) return false;
      if (max !== null && Number.isFinite(max) && job.budget > max) return false;
      if (expiryHours !== null) {
        // A job with no expiry can't satisfy "expires within N" — same call
        // the authed filter makes.
        if (!job.expires_at) return false;
        if ((new Date(job.expires_at).getTime() - nowMs) / 3_600_000 > expiryHours) return false;
      }
      if (boostedOnly && !(job.boost_expires_at && new Date(job.boost_expires_at) > now)) return false;
      return true;
    });

    // "Best match" keeps the server's ranking (get_ranked_open_jobs orders by
    // boost → urgent → recency for an anon caller), so there is nothing to
    // re-sort. Every other option mirrors the authed comparator exactly —
    // including "ending soon" keying off date_needed, not expires_at.
    if (sortBy === "smart") return list;
    return list.sort((a, b) => {
      switch (sortBy) {
        case "highest_pay": return b.budget - a.budget;
        case "lowest_pay": return a.budget - b.budget;
        case "ending_soon":
          return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
  }, [jobs, search, selectedCategory, pricingMode, minBudget, maxBudget, expiresWithin, boostedOnly, sortBy]);

  // Wrap each job in its own single-item row so the window-scroll
  // VirtualList (single-column row primitive) renders one card per row.
  const rows = useMemo<PublicJob[][]>(() => {
    const out: PublicJob[][] = [];
    for (let i = 0; i < filtered.length; i += CARDS_PER_ROW) {
      out.push(filtered.slice(i, i + CARDS_PER_ROW));
    }
    return out;
  }, [filtered]);

  return {
    jobs,
    filtered,
    rows,
    jobsLoading,
    jobsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  };
};
