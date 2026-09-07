import { useMemo } from "react";

import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { queryKeys } from "@/lib/queryKeys";
import { dedupeById } from "@/lib/utils";
import { CARDS_PER_ROW, PAGE_SIZE } from "./jobsConstants";
import type { JobsPage, PublicJob } from "./types";
import { displayedPayDollars } from "@/lib/jobDisplayPay";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { getCachedUserLocation } from "@/hooks/useUserLocation";

interface UseOpenJobsFeedArgs {
  search: string;
  selectedCategory: string | null;
  /** "" = no floor / no cap, matching the dashboard's string convention. */
  minBudget?: string;
  maxBudget?: string;
  /** "" | "24h" | "3d" | "7d" — same values the authed sheet emits. */
  expiresWithin?: string;
  boostedOnly?: boolean;
  urgentOnly?: boolean;
  /** "smart" | "newest" | "highest_pay" | "lowest_pay" | "ending_soon". */
  sortBy?: string;
}

export const useOpenJobsFeed = ({
  search,
  selectedCategory,
  minBudget = "",
  maxBudget = "",
  expiresWithin = "",
  boostedOnly = false,
  urgentOnly = false,
  sortBy = "smart",
}: UseOpenJobsFeedArgs) => {
  // Paginated open-jobs feed via React Query, consistent with the
  // dashboard's useInfiniteQuery feed. get_ranked_open_jobs ranks by boost
  // (1000) + parish match (500) + urgent (100) + recency (0-50) and coarsens
  // the address to "City, ST" via mask_job_location server-side. Anon callers
  // work (EXECUTE granted) — they just don't get the parish-match boost.
  //
  // EARLY ACCESS IS ENFORCED IN THE RPC, and there is deliberately no gate in
  // this file. Until migration 20260901022522 there was no gate anywhere on
  // this route: `/jobs` is the public, anon-callable board, so a member paying
  // $5–$20/mo for a 5-to-20-minute head start could be undercut by anyone
  // opening a private window — the perk was given away on the one surface that
  // required no account at all. It is now a predicate inside
  // get_ranked_open_jobs, compared against `public.early_access_cutoff()`, the
  // same authority the dashboard view and the map RPC use.
  //
  // For a caller with no session `auth.uid()` is NULL, which resolves to the
  // free 20-minute delay — so this feed shows a guest the free experience, by
  // design, and a filter added here could only ever take MORE away. Do not add
  // one: this is a paid entitlement, and the place to change it is the SQL.
  // (No PGRST202 window either — the function signature is unchanged, so both
  // the 2- and 3-argument call forms below keep resolving throughout the
  // db-deploy lag; they simply gain the gate the moment it lands.)
  // Read-only peek at whatever fix another surface already obtained. This is
  // the non-prompting accessor by design — see the RPC call below.
  const viewerLoc = getCachedUserLocation();

  const {
    data: pagesData,
    isLoading: jobsLoading,
    isError: jobsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    // The position is part of the key: a fix arriving mid-session changes the
    // ORDER the server returns, and a cached page built without one would
    // otherwise be served forever.
    queryKey: [...queryKeys.jobs.open(), viewerLoc?.lat ?? null, viewerLoc?.lng ?? null],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<JobsPage> => {
      const offset = pageParam as number;
      // unwrap surfaces a failed fetch as the query's error state (drives
      // <ErrorState/>) instead of silently degrading to a blank feed.
      const rows = unwrap(
        // FIXTURE (`is_seed`) ROWS ARE THE SERVER'S DECISION, and there is
        // deliberately no argument for them here. `p_include_seed` still
        // exists on the RPC and still NARROWS, but the switch that matters —
        // "are fixtures visible on the public marketplace?" — is
        // `public.seed_jobs_hidden_publicly()`, read inside the function
        // (migration 20260901035245).
        //
        // It used to be a client constant passed from this one call site, and
        // that reached exactly one of the three browse surfaces: the map RPC
        // takes no arguments and `open_jobs_browse` has no `is_seed` column,
        // so flipping it here would have emptied /jobs while leaving every
        // fixture on the map and the dashboard. See src/config/showSeedJobs.ts
        // for the whole story and the one-line flip.
        //
        // Filtering after the fetch is not an option either way: this feed
        // paginates, so dropping rows client-side would return short pages and
        // break the "was that a full page?" check below.
        // Viewer position, for the distance term the ranking gained in
        // 20260907052949. Read from the module cache only — NEVER prompt: a
        // cold permission dialog on a public board nobody asked to be located
        // on is exactly the trade that migration's design set out to avoid,
        // and iOS spends its one system alert per install on it.
        //
        // A SIGNED-IN viewer needs nothing here at all: the RPC falls back to
        // their stored `profiles.latitude/longitude` server-side. This
        // argument is what gives a GUEST — who has no profile row — the same
        // ranking, on the sessions where some other surface already obtained
        // a fix.
        //
        // Undefined for a viewer with no fix, which the RPC reads as "no
        // position" and ranks exactly as it does today.
        await supabase.rpc("get_ranked_open_jobs", {
          p_limit: PAGE_SIZE,
          p_offset: offset,
          ...(viewerLoc ? { p_lat: viewerLoc.lat, p_lng: viewerLoc.lng } : {}),
        }),
      );
      const jobs = (rows ?? []) as unknown as PublicJob[];
      return { jobs, nextOffset: jobs.length === PAGE_SIZE ? offset + PAGE_SIZE : null };
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  // `dedupeById` because the pages are OFFSET/LIMIT windows over `rank_score`,
  // which a boost raises by +1000 mid-scroll — lifting that row above the
  // offset and re-serving the previous page's last card as this page's first.
  // Reproduced live against prod; see the helper's comment.
  const jobs = useMemo<PublicJob[]>(
    () => dedupeById((pagesData?.pages ?? []).flatMap((p) => p.jobs)),
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
      // `location` is null once the poster deletes their account and the job is
      // anonymised (20260901033011) — and `pages/jobs/types.ts` declares it
      // `string`, so the compiler cannot see this. THIS surface is the public,
      // unauthenticated /jobs board fed by `get_ranked_open_jobs`, so an
      // unguarded null here is not a bad card: it throws inside a filter
      // predicate and the entire public job board disappears behind the error
      // boundary, for a guest, after one keystroke in the search box.
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(search.toLowerCase()) ||
        (job.location?.toLowerCase().includes(search.toLowerCase()) ?? false);
      if (!matchesSearch) return false;
      if (selectedCategory && job.category !== selectedCategory) return false;
      // No pricing-style filter any more: bidding was removed after zero
      // production usage, so every job is a set-budget job.
      if (min !== null && Number.isFinite(min) && job.budget < min) return false;
      if (max !== null && Number.isFinite(max) && job.budget > max) return false;
      if (expiryHours !== null) {
        // A job with no expiry can't satisfy "expires within N" — same call
        // the authed filter makes.
        if (!job.expires_at) return false;
        if ((new Date(job.expires_at).getTime() - nowMs) / 3_600_000 > expiryHours) return false;
      }
      if (boostedOnly && !(job.boost_expires_at && new Date(job.boost_expires_at) > now)) return false;
      if (urgentOnly && !job.is_urgent) return false;
      return true;
    });

    // Guests have no membership tier, so every card on this board prices at
    // the free rate — the same constant `Jobs.tsx` hands `JobCard`.
    const payOf = (job: PublicJob) =>
      displayedPayDollars(job, TIER_PERKS.free.platformFeePercent);

    // "Best match" keeps the server's ranking (get_ranked_open_jobs orders by
    // boost → urgent → recency for an anon caller), so there is nothing to
    // re-sort. Every other option mirrors the authed comparator exactly —
    // including "ending soon" keying off date_needed, not expires_at.
    if (sortBy === "smart") return list;
    return list.sort((a, b) => {
      switch (sortBy) {
        // Order by the take-home the card SHOWS, not the gross budget. This
        // board renders every price through `JobPrice` at the free-tier rate,
        // and a group job's budget is split across `helpers_needed` — sorting
        // on `budget` ranked a $200 ÷ 3 = $58 job above a $79 solo one.
        case "highest_pay": return payOf(b) - payOf(a);
        case "lowest_pay": return payOf(a) - payOf(b);
        case "ending_soon":
          return new Date(a.date_needed).getTime() - new Date(b.date_needed).getTime();
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
  }, [jobs, search, selectedCategory, minBudget, maxBudget, expiresWithin, boostedOnly, urgentOnly, sortBy]);

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
