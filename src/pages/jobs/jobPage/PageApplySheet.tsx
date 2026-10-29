import { lazy, Suspense, useMemo } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useApplyFlow } from "@/pages/home/useApplyFlow";
import { ApplicationSentDialog } from "@/components/dashboard/ApplicationSentDialog";
import type { EnrichedJob } from "@/components/dashboard/types";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import { formatName } from "@/lib/utils";
import type { JobPageRow } from "./useJobPage";

const ApplyConfirmDialog = lazy(() => import("@/components/dashboard/ApplyConfirmDialog").then((m) => ({ default: m.ApplyConfirmDialog })));

/**
 * Apply ON the job page (audit 2026-10-28 F9: the page's Apply went to /home?quickApply=<id> and the member left
 * the job they were reading). The same flow Home runs (useApplyFlow: its guards, its optimistic apply, its
 * "Application sent" pop-up, and the cache refresh that turns this page's button into "View application"), in the
 * same standalone sheet (ApplyConfirmDialog), over this page. The sheet names the poster the way this page's
 * poster card does (formatName of get_safe_profiles' name, the same avatar), never "a neighbor" (F8).
 */
export function usePageApply(job: JobPageRow | null | undefined, poster: { name: string | null; avatarUrl: string | null } | null | undefined) {
  const { user, profile } = useCurrentUser();
  const sheetJob = useMemo<EnrichedJob | null>(
    () => (job ? ({ ...job, posterName: formatName(poster?.name, "A neighbor"), posterAvatarUrl: poster?.avatarUrl ?? null } as unknown as EnrichedJob) : null),
    [job, poster?.name, poster?.avatarUrl],
  );
  const flow = useApplyFlow({ user: user ?? null, allJobs: sheetJob ? [sheetJob] : [] });
  // The viewer's own rate, the one the page's take-home and the feed's "You earn" use.
  const platformFee = tierFeePercent(profile?.subscription_tier, profile?.subscription_expires_at);
  return { flow, sheetJob, platformFee };
}

export function PageApplySheet({ apply }: { apply: ReturnType<typeof usePageApply> }) {
  const { flow, sheetJob, platformFee } = apply;
  const open = !!sheetJob && flow.confirmApplyJobId === sheetJob.id;
  return (
    <>
      {open && (
        <Suspense fallback={null}>
          <ApplyConfirmDialog
            open
            onClose={() => flow.setConfirmApplyJobId(null)}
            confirmApplyJob={sheetJob}
            platformFee={platformFee}
            applyMessage={flow.applyMessage}
            setApplyMessage={flow.setApplyMessage}
            applyFiles={flow.applyFiles}
            setApplyFiles={flow.setApplyFiles}
            applyLoading={flow.applyLoading}
            applyTimeSuggestion={flow.applyTimeSuggestion}
            setApplyTimeSuggestion={flow.setApplyTimeSuggestion}
            handleApplyConfirm={() => flow.handleApplyConfirm(sheetJob.id)}
          />
        </Suspense>
      )}
      <ApplicationSentDialog sent={flow.applicationSent} onClose={flow.closeApplicationSent} onView={flow.viewApplication} platformFee={platformFee} />
    </>
  );
}
