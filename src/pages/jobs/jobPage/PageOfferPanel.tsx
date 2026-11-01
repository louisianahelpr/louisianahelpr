/**
 * JA-17: THE WORKING CARD'S OFFER, ANSWERED ON THE JOB PAGE (lead 11-01, B111).
 *
 * A Helpr offered this job used to get "See the offer", which left the page for the Working card. Accept and Decline
 * now run HERE, through the very same code the Working card runs; nothing here writes itself:
 *  - the row is the Working list's own read (fetchAppliedActivity, under its own query key, so the two share one
 *    cache), the direct offer's synthetic "direct-<jobId>" row included;
 *  - the handlers are useActivityActions' handleHelperResponse (accept_job_offer / respond_to_direct_offer, the held
 *    card's capture first, the same-frame double-tap ref, the award gate);
 *  - the buttons are the card's OfferedActions (Decline left with its confirm, Accept right, the answer-by clock,
 *    "Finish accepting" while payout setup is owed, nothing once the offer has run out);
 *  - the pop-ups are the Working list's ActivityOfferDialogs (award gate, payment held, payout after hire).
 * Lazy: only a Helpr with an offer loads it (the job page chunk does not grow for everyone else).
 *
 * Guard: src/pages/jobs/jobPage/JobPage.test.tsx "JA-17".
 */
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { fetchAppliedActivity } from "@/hooks/useActivityData";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActivityActions } from "@/components/job-card/useActivityActions";
import { ActivityOfferDialogs } from "@/components/job-card/ActivityOfferDialogs";
import { OfferedActions } from "@/pages/jobs/appliedJobCard/OfferedActions";
import type { AppliedApp } from "@/components/job-card/activityConstants";

const NO_APPS: AppliedApp[] = [];

export function PageOfferPanel({ jobId, onChanged, fallback }: {
  jobId: string;
  /** Re-read the page after an answer. */
  onChanged: () => void;
  /** Drawn while the Working row is read, or when it has no row for this job (never a blank card). */
  fallback: React.ReactNode;
}) {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const q = useQuery({
    queryKey: queryKeys.activity.applied(userId),
    queryFn: () => fetchAppliedActivity(userId),
    enabled: !!userId,
  });
  const app = q.data?.appliedApps.find((a) => a.job_id === jobId && !!a.job) ?? null;
  const actions = useActivityActions({
    user,
    postedJobs: [],
    appliedApps: app ? [app] : NO_APPS,
    refresh: async () => { onChanged(); await q.refetch(); },
    // The Working list's filter jump after an answer; the page has no filter.
    setStatusFilter: () => {},
  });
  if (!app?.job) return <>{fallback}</>;
  return (
    <div data-page-offer="">
      <OfferedActions app={app} job={app.job} onHelperResponse={actions.handleHelperResponse} respondingHelperAppId={actions.respondingHelperAppId} />
      <ActivityOfferDialogs actions={actions} />
    </div>
  );
}
