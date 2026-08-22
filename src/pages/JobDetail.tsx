import { lazy, Suspense } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useJobRef } from "@/hooks/useJobRef";
import { usePageTitle } from "@/hooks/usePageTitle";
import { queryKeys } from "@/lib/queryKeys";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import PublicLayout from "@/components/marketing/PublicLayout";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import type { EnrichedJob } from "@/components/dashboard/types";

// Read-only job detail for logged-out visitors who open a shared link.
// Lazy so the heavy dialog chunk only loads once the job resolves.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));

/**
 * JobDetail — public, deep-linkable job preview at `/jobs/:id`.
 *
 * Shared job links (ShareJobButton → `/jobs/{id}?ref=share`) used to fall
 * through to the `*` NotFound catch-all because no `/jobs/:id` route
 * existed — a dead end that forced recipients to a 404 instead of letting
 * them preview the job. This route closes that gap:
 *   - Signed-in recipients are handed to the real dashboard apply flow
 *     (`/dashboard?quickApply={id}`), which already surfaces a "Apply now"
 *     prompt for the job.
 *   - Guests get the same read-only preview the Browse grid opens, with
 *     apply/report routed to /signup. Closing returns them to the public
 *     Browse list rather than a blank backdrop.
 */
const JobDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useCurrentUser();
  // Capture ?ref= attribution (share / email / notif) on mount.
  useJobRef();
  usePageTitle("Job details — Helpr");

  // Guests fetch the single job from the RLS-public masked view. We skip
  // the fetch entirely for authed users — they're redirected below.
  const { data: job, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.jobs.publicDetail(id ?? ""),
    queryFn: async (): Promise<EnrichedJob | null> => {
      const { data, error } = await supabase
        .from("open_jobs_browse")
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boost_expires_at, expires_at, start_time, recurrence_interval, pricing_mode",
        )
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const now = new Date();
      // A job that expired between share and open is no longer browsable.
      if (data.expires_at && new Date(data.expires_at) <= now) return null;
      return {
        ...(data as Record<string, unknown>),
        // Guest preview disables poster-profile lookups (JobDetailDialog
        // gates the poster card behind !guest), so neutral poster fields
        // are enough — mirrors Jobs.tsx's toEnrichedJob mapping.
        posterName: "User",
        posterReviewCount: 0,
        posterAvgRating: 0,
        isBoosted: !!data.boost_expires_at && new Date(data.boost_expires_at) > now,
      } as EnrichedJob;
    },
    enabled: !!id && !authLoading && !user,
    staleTime: 60 * 1000,
  });

  // Signed-in recipients land in their real dashboard apply flow.
  if (!authLoading && user) {
    return <Navigate to={`/dashboard?quickApply=${id}`} replace />;
  }

  const requireSignup = () => navigate("/signup");

  // Every branch of this page (loading / error / not-found / job) needs its
  // own <h1>: this is the share-link landing page, and it previously rendered
  // NONE, so a screen-reader user arriving from a shared link got a document
  // with no heading at all. The heading is `sr-only` rather than visible
  // because each branch already paints its own title-styled copy — the
  // EmptyState/ErrorState titles are <p>, and the populated branch's title
  // lives in the JobDetailDialog's DialogTitle (an <h2> that Radix portals to
  // <body>, outside #root). A visible h1 here would duplicate that copy, and
  // in the populated branch would sit behind the dialog's own backdrop.
  const headingText =
    !authLoading && !isLoading && !isError && job ? job.title : "Job details";

  return (
    <PublicLayout showCtaBand={false} noNavSpacer>
      <div className="pt-20 pb-[calc(var(--safe-area-bottom,0px)_+_96px_+_1rem)] md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-md">
          <h1 className="sr-only">{headingText}</h1>
          {authLoading || isLoading ? (
            <div role="status" aria-busy="true" aria-label="Loading job">
              <JobCardSkeleton />
            </div>
          ) : isError ? (
            /* Retry really re-runs the fetch — the old handler navigated to
               /jobs under a "Try again" label, so the one button that
               promised a retry was the one that left the page. Browsing all
               open jobs is still offered, as the honest second option. */
            <ErrorState
              variant="inline"
              title="We couldn't load this job."
              body="It may have been taken down, or our end is having a hiccup. Try again, or browse everything that's open."
              onRetry={() => { void refetch(); }}
              secondaryAction={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/jobs")}
                  className="squircle"
                >
                  Browse open jobs
                </Button>
              }
            />
          ) : !job ? (
            <EmptyState
              variant="inline"
              icon={Briefcase}
              title="This job isn't available."
              body="It may have been filled, expired, or removed. New jobs are posted across Louisiana every day."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/jobs")}
                  className="squircle"
                >
                  Browse open jobs
                </Button>
              }
            />
          ) : (
            /* The dialog chunk is lazy, so hold the same skeleton that was
               already on screen until it lands. `fallback={null}` painted a
               blank page for the length of the chunk fetch on a cold cache.
               DialogContent portals to <body>, so living inside this column
               costs the dialog nothing. */
            <Suspense
              fallback={
                <div role="status" aria-busy="true" aria-label="Loading job">
                  <JobCardSkeleton />
                </div>
              }
            >
              <JobDetailDialog
                guest
                job={job}
                effectiveFee={TIER_PERKS.free.platformFeePercent}
                onClose={() => navigate("/jobs")}
                onApply={requireSignup}
                onReport={requireSignup}
              />
            </Suspense>
          )}
        </div>
      </div>
    </PublicLayout>
  );
};

export default JobDetail;
