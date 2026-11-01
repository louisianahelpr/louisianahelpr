import { lazy, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { readJobsAheadOfDb } from "@/lib/jobColumns";
import type { Database } from "@/integrations/supabase/types";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePendingSaveConsumer } from "@/hooks/usePendingSaveConsumer";
import { useJobRef } from "@/hooks/useJobRef";
import { usePageMeta } from "@/hooks/usePageMeta";
import { queryKeys } from "@/lib/queryKeys";
import { signupUrlFor } from "@/lib/jobIntent";
import PublicLayout from "@/components/marketing/PublicLayout";
import { EmptyState } from "@/components/ui/EmptyState";
import { OfflineEmptyState } from "@/components/ui/OfflineEmptyState";
import { useFeedPhase, useProfileWaitPhase } from "@/hooks/useFeedPhase";
import { ErrorState } from "@/components/ui/ErrorState";
import { Button } from "@/components/ui/button";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { GuestJobPreview, guestJobFacts, type GuestJob } from "@/components/dashboard/GuestJobPreview";

// Signed in: the job page itself (boards 15, 42, 168, 169).
const JobPage = lazy(() => import("./jobPage/JobPage"));

/**
 * JobDetail — public, deep-linkable job preview at `/jobs/:id`.
 *
 * Shared job links (ShareJobButton → `/jobs/{id}?ref=share`) used to fall
 * through to the `*` NotFound catch-all because no `/jobs/:id` route
 * existed — a dead end that forced recipients to a 404 instead of letting
 * them preview the job. This route closes that gap:
 *   - Signed-in members get the job page (jobPage/JobPage.tsx): poster
 *     view on their own job, take-home + Apply (the quick-apply sheet)
 *     otherwise.
 *   - Guests get a read-only preview, with apply/report routed to /signup
 *     carrying this job. Closing returns them to the public Browse list
 *     rather than a blank backdrop.
 */
const JobDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading, profileQuery, refresh: refreshCurrentUser } = useCurrentUser();
  // Q571: a signed-in visitor waits on their profile before the redirect below.
  // Offline that query is paused, `authLoading` never clears, and the page held
  // its skeleton for as long as the connection was down.
  const authPhase = useProfileWaitPhase(profileQuery);
  // The job-intent bounce lands HERE — consume a guest's pending save too.
  usePendingSaveConsumer(user?.id);
  // Capture ?ref= attribution (share / email / notif) on mount.
  useJobRef();

  // Guests fetch the single job from the RLS-public masked view. We skip
  // the fetch entirely for authed users: they get the job page below.
  // This column list is the guest's whole view of a job (JOBS-29, lead
  // 2026-10-31, under the owner's 9-2 rule): title, category, parish (from the
  // view's town) and the take-home (budget, rush fee, crew split, fee stamp: the
  // guest card's own figure), plus status and expiry to know it is still open.
  // No poster, no address, no coordinates, no description (free text can carry
  // an address or a phone number). Guards: src/test/guestOpensSharedJobLink.test.tsx,
  // src/test/guestSeesFourFacts.test.tsx.
  const { data: job, isLoading, isError, refetch, status, fetchStatus } = useQuery({
    queryKey: queryKeys.jobs.publicDetail(id ?? ""),
    queryFn: async (): Promise<GuestJob | null> => {
      const data = unwrap<unknown>(
        await readJobsAheadOfDb(
          "id, title, category, budget, location, urgent_fee, is_group_job, helpers_needed, helper_fee_flat_cents, helper_fee_percent, status, expires_at",
          (columns) => supabase.from("open_jobs_browse").select(columns).eq("id", id!).maybeSingle(),
          { browseView: true },
        ),
      );
      if (!data) return null;
      // A runtime column list types the row as GenericStringError; it is a browse row.
      const row = data as Database["public"]["Views"]["open_jobs_browse"]["Row"];
      // A job that expired between share and open is no longer browsable.
      if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;
      return {
        id: row.id ?? id!, title: row.title, category: row.category, budget: row.budget, location: row.location,
        urgent_fee: row.urgent_fee, is_group_job: row.is_group_job, helpers_needed: row.helpers_needed,
        helper_fee_flat_cents: row.helper_fee_flat_cents, helper_fee_percent: row.helper_fee_percent,
      };
    },
    enabled: !!id && !authLoading && !user,
    staleTime: 60 * 1000,
  });
  // Q571: offline with nothing loaded is not "this job isn't available".
  const phase = useFeedPhase({ status, fetchStatus });

  // Hoisted above the redirect below so the title hook can never sit after an
  // early return. See the h1 note further down for why every branch needs a
  // heading; the document title is simply that heading.
  const headingText =
    !authLoading && !isLoading && !isError && job?.title ? job.title : "Job details";

  // This is the share-link landing page — the thing pasted into a text or a
  // Facebook group. A tab reading "Job Details — Helpr" for every shared link
  // told the recipient nothing; the job's own title does. Every other public
  // page uses usePageMeta (title + description + canonical + OG), but this
  // one only set the tab title — every social/search preview of a shared job
  // link fell back to the generic homepage description and canonical instead
  // of the job's own. usePageMeta covers both.
  // The preview's own facts, never the description (JOBS-29: a guest sees title, category, parish and take-home only).
  const jobFacts = job ? guestJobFacts(job).map((f) => f.value).join(" · ") : "";
  const jobDescription = jobFacts
    ? `${jobFacts}. Payment is held safely until the work is confirmed done. Sign up to apply.`
    : "Every job on Louisiana Helpr holds payment safely until the work is confirmed done — see the details and apply.";
  usePageMeta({
    title: `${headingText} — Helpr`,
    description: jobDescription,
    canonical: id ? `https://www.louisianahelpr.com/jobs/${id}` : "https://www.louisianahelpr.com/browse",
    ogTitle: headingText,
    ogDescription: jobDescription,
  });

  // Signed in: the job's own page (it used to redirect to /home?quickApply=<id>;
  // that quick-apply sheet is now what the page's Apply button opens).
  if (!authLoading && user && id) {
    return (
      <Suspense fallback={<div role="status" aria-busy="true" aria-label="Loading job"><JobCardSkeleton /></div>}>
        <JobPage id={id} userId={user.id} />
      </Suspense>
    );
  }

  const requireSignup = () => navigate(signupUrlFor(id ? `/jobs/${id}` : null));

  // Every branch of this page (loading / error / not-found / job) needs its
  // own <h1>: this is the share-link landing page, and it previously rendered
  // NONE, so a screen-reader user arriving from a shared link got a document
  // with no heading at all. The heading is `sr-only` rather than visible
  // because each branch already paints its own title-styled copy — the
  // EmptyState/ErrorState titles are <p>, and the populated branch's title
  // lives in the JobDetailDialog's DialogTitle (an <h2> that Radix portals to
  // <body>, outside #root). A visible h1 here would duplicate that copy, and
  // in the populated branch would sit behind the dialog's own backdrop.
  // (`headingText` itself is computed above the redirect, so `usePageTitle`
  // can reuse it without a hook landing after an early return.)

  return (
    <PublicLayout noNavSpacer>
      <div className="pt-20 pb-safe-nav px-5">
        <div className="container mx-auto max-w-md">
          <h1 className="sr-only">{headingText}</h1>
          {(authLoading ? authPhase : phase) === "offline-empty" ? (
            <OfflineEmptyState
              body="This job will load here as soon as you're back online."
              onRetry={() => { void (authLoading ? refreshCurrentUser() : refetch()); }}
            />
          ) : authLoading || isLoading ? (
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
                  onClick={() => navigate("/browse")}
                  className="squircle"
                >
                  Browse open Jobs
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
                  onClick={() => navigate("/browse")}
                  className="squircle"
                >
                  Browse open Jobs
                </Button>
              }
            />
          ) : (
            <GuestJobPreview job={job} onClose={() => navigate("/browse")} onSignUp={requireSignup} />
          )}
        </div>
      </div>
    </PublicLayout>
  );
};

export default JobDetail;
