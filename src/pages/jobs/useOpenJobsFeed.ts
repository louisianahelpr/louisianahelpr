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
}

export const useOpenJobsFeed = ({
  search,
  selectedCategory,
  pricingMode,
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

  const filtered = useMemo(() => {
    const now = new Date();
    return jobs.filter((job) => {
      // Hide jobs that have expired in real-time (between fetches)
      if (job.expires_at && new Date(job.expires_at) <= now) return false;
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(search.toLowerCase()) ||
        job.location.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = !selectedCategory || job.category === selectedCategory;
      // "accept_bids" = open to bids; any other value (fixed / null) = set budget.
      const isBids = job.pricing_mode === "accept_bids";
      const matchesPricing =
        pricingMode === "all" || (pricingMode === "bids" ? isBids : !isBids);
      return matchesSearch && matchesCategory && matchesPricing;
    });
  }, [jobs, search, selectedCategory, pricingMode]);

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
