import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { ArrowRight, Search, Lock, Briefcase } from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useCurrentUser } from "@/hooks/useCurrentUser";
// Card-matching skeleton — mirrors the actual JobCard avatar/title/price
// layout so the loading→loaded transition doesn't shift. See task #121.
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { VirtualList } from "@/components/VirtualList";
import { categoryLabels } from "@/components/activity/activityConstants";
import { queryKeys } from "@/lib/queryKeys";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useJobRef } from "@/hooks/useJobRef";

// Read-only job detail for logged-out visitors. Lazy so the guest browse
// grid paints without pulling the heavy dialog chunk until a card is tapped.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));

const DEBUG_AUTH = import.meta.env.DEV;

// Shape of a row from get_ranked_open_jobs. The RPC returns the full job
// detail set; we type the subset the guest browse card actually reads.
interface PublicJob {
  id: string;
  title: string;
  description: string | null;
  category: string;
  location: string;
  budget: number;
  date_needed: string;
  start_time: string | null;
  is_urgent: boolean | null;
  urgent_fee: number | null;
  is_recurring: boolean | null;
  recurrence_interval: string | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  created_at: string;
  expires_at: string | null;
  boost_expires_at: string | null;
}

const ALL_CATEGORIES = Object.keys(categoryLabels);

const PAGE_SIZE = 30;

// Cards per virtualized row — matches the lg:grid-cols-3 grid so each
// VirtualList row holds a full grid line.
const CARDS_PER_ROW = 3;

// Cap the staggered entrance animation to roughly the first screenful of
// cards. Beyond this the per-card animationDelay would compound layout
// work on long lists for an effect nobody scrolls fast enough to see.
const MAX_STAGGER_CARDS = 9;

interface JobsPage {
  jobs: PublicJob[];
  nextOffset: number | null;
}

// Adapt a PublicJob (anon RPC row) to the EnrichedJob shape JobCard
// expects. Guests have no poster-profile enrichment, so the poster-*
// fields are intentionally omitted — JobCard renders a neutral avatar
// fallback. `customer_id`/`status`/`description` satisfy the type;
// `isBoosted` is derived from the boost-expiry timestamp.
const toEnrichedJob = (job: PublicJob): EnrichedJob => ({
  id: job.id,
  title: job.title,
  description: job.description ?? "",
  // The RPC returns the job_category enum; PublicJob types it loosely as
  // string. JobCard only uses it for categoryLabels/Colors lookups
  // (both keyed by string), so the cast is display-safe.
  category: job.category as EnrichedJob["category"],
  budget: job.budget,
  date_needed: job.date_needed,
  start_time: job.start_time,
  location: job.location,
  customer_id: "",
  status: "open",
  created_at: job.created_at,
  expires_at: job.expires_at,
  is_urgent: job.is_urgent ?? false,
  urgent_fee: job.urgent_fee ?? 0,
  is_recurring: job.is_recurring ?? false,
  recurrence_interval: job.recurrence_interval,
  is_group_job: job.is_group_job ?? false,
  helpers_needed: job.helpers_needed,
  isBoosted: !!job.boost_expires_at && new Date(job.boost_expires_at) > new Date(),
});

// JobCard requires apply/report/select/save handlers. On the public
// browse page every interaction routes to /signup via the wrapping
// <Link>, so these are inert no-ops.
const noop = () => {};

const Jobs = () => {
  usePageTitle("Browse Jobs — Helpr");
  // Capture ?ref= attribution from share/external links (e.g. ?ref=share
  // from the Share Sheet) so we can attribute traffic source for job views.
  useJobRef();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // The job a guest tapped to preview — opens the read-only JobDetailDialog.
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useCurrentUser();

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

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] Jobs page", {
      authLoading,
      hasUser: !!user,
      userId: user?.id ?? null,
      jobsLoading,
      route: window.location.pathname,
    });
  }, [authLoading, jobsLoading, user?.id]);

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
      return matchesSearch && matchesCategory;
    });
  }, [jobs, search, selectedCategory]);

  // Chunk the filtered jobs into grid rows so the window-scroll VirtualList
  // (single-column row primitive) still renders the original 3-up grid.
  const rows = useMemo<PublicJob[][]>(() => {
    const out: PublicJob[][] = [];
    for (let i = 0; i < filtered.length; i += CARDS_PER_ROW) {
      out.push(filtered.slice(i, i + CARDS_PER_ROW));
    }
    return out;
  }, [filtered]);

  return (
    <PublicLayout showCtaBand={false} noNavSpacer>
      {/* pt-20 sits flush under the fixed Navbar (h-14 + safe-area).
          The bottom padding clears the floating MobileNav (96px) plus
          the iOS home-indicator safe area, with a 16px gap so the
          last action isn't kissing the dock. pb-32 was barely 2px
          short on notched phones. */}
      <div className="pt-20 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)] md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-5xl">
          {/* Header — title + live count vertically centered with a "Live" pill on the right. */}
          <div className="flex items-center justify-between gap-4 mb-6 md:mb-8 mt-2 md:mt-6 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="flex flex-col leading-none min-w-0">
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Open across Louisiana
              </span>
              <h1 className="text-page-title leading-tight truncate mt-1">
                Browse tasks
              </h1>
              <span className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{filtered.length}</span>{" "}
                {filtered.length === 1 ? "task" : "tasks"}{" "}
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                Live now
              </span>
            </div>
            <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-primary/10 text-primary text-ds-11 font-bold tracking-wider uppercase border border-primary/15 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Live
            </div>
          </div>

          {/* Search & Filters */}
          <div className="mb-5 md:mb-8 space-y-3 md:space-y-4">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70" />
              <Input
                type="search"
                aria-label="Search jobs"
                placeholder="Search by title or location…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-11 rounded-2xl squircle border-border bg-white/80 dark:bg-card/80 placeholder:text-muted-foreground/80 focus:bg-background focus:border-primary/60 focus:ring-2 focus:ring-primary/15 transition-all"
              />
            </div>

            <div className="-mx-5 px-5 overflow-x-auto scrollbar-hide overscroll-x-contain">
              <div className="flex gap-2 w-max mx-auto">
                {[{ key: null as string | null, label: "All" }, ...ALL_CATEGORIES.map((c) => ({ key: c, label: categoryLabels[c] }))].map(({ key, label }) => {
                  const isActive = selectedCategory === key;
                  return (
                    <button
                      key={label ?? "all"}
                      onClick={() => setSelectedCategory(isActive ? null : key)}
                      className={`inline-flex items-center min-h-[36px] px-3.5 py-2 rounded-ds-md text-ds-11 font-semibold whitespace-nowrap shrink-0 transition-all duration-200 btn-press squircle border ${
                        isActive
                          ? "bg-primary text-primary-foreground border-primary shadow-[0_4px_14px_-4px_hsl(var(--primary)/0.45)]"
                          : "bg-white/60 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Jobs Grid */}
          {jobsLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-label="Loading jobs">
              {Array.from({ length: 6 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : jobsError && jobs.length === 0 ? (
            <div className="max-w-md mx-auto">
              <ErrorState onRetry={() => refetch()} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="max-w-md mx-auto">
              <EmptyState
                variant="inline"
                icon={(search || selectedCategory) ? Search : Briefcase}
                title={(search || selectedCategory) ? "No tasks found" : "No open tasks right now"}
                body="New tasks are posted across Louisiana every day."
                action={
                  (search || selectedCategory) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSearch(""); setSelectedCategory(null); }}
                      className="squircle rounded-full"
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="squircle rounded-full"
                    >
                      <Link to="/signup">Sign up to get notified</Link>
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            // Virtualized grid: each VirtualList row is one grid line of up
            // to CARDS_PER_ROW cards. The window virtualizer keeps the DOM
            // small on long lists while preserving the 1/2/3-up layout.
            <VirtualList
              items={rows}
              getKey={(row, i) => `row-${i}-${row[0]?.id ?? "empty"}`}
              estimateSize={250}
              overscan={3}
              renderItem={(row, rowIndex) => (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
                  {row.map((job, colIndex) => {
                    const flatIndex = rowIndex * CARDS_PER_ROW + colIndex;
                    const enriched = toEnrichedJob(job);
                    return (
                      // Tapping a card opens a read-only detail preview (guest
                      // mode). Phones have no hover state, so the whole card is
                      // a plain tappable button. Apply/message/save are gated
                      // inside the dialog behind a single sign-up CTA.
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setDetailJob(enriched)}
                        aria-label={`View details for ${job.title}`}
                        className="block w-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary animate-in fade-in slide-in-from-bottom-2 duration-300"
                        style={
                          flatIndex < MAX_STAGGER_CARDS
                            ? { animationDelay: `${flatIndex * 40}ms`, animationFillMode: "both" }
                            : undefined
                        }
                      >
                        <JobCard
                          job={enriched}
                          variant="guest"
                          effectiveFee={TIER_PERKS.free.platformFeePercent}
                          onApply={noop}
                          onReport={noop}
                          onSelect={noop}
                          index={flatIndex}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            />
          )}

          {/* Load More */}
          {hasNextPage && !jobsLoading && filtered.length > 0 && (
            <div className="text-center mt-6">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more jobs"}
              </Button>
            </div>
          )}

          {/* CTA */}
          <div className="text-center mt-12 space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 max-w-lg mx-auto space-y-4">
              <Lock className="w-8 h-8 text-primary mx-auto" />
              <h3 className="text-ds-17 font-bold text-foreground">Join the Helpr community</h3>
              <p className="text-ds-11 text-muted-foreground">
                Sign up to apply for jobs, message posters, and start earning — or post your own task and find help today.
              </p>
              <Button
                variant="hero"
                size="lg"
                onClick={() => navigate("/signup")}
                className="group"
              >
                Get started
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Read-only guest preview. `guest` skips every authed look-up and
          replaces apply/message/save/report with a single sign-up CTA. */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            guest
            job={detailJob}
            effectiveFee={TIER_PERKS.free.platformFeePercent}
            onClose={() => setDetailJob(null)}
            onApply={noop}
            onReport={noop}
          />
        </Suspense>
      )}
    </PublicLayout>
  );
};

export default Jobs;
