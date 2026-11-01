/**
 * THE POSTED CARD'S OWN FLOWS, MOUNTED ON THE JOB PAGE (owner 2026-10-31, LEAD-JOBPAGE-LAYOUT, money half).
 *
 * "Approve and release", the cancel, the edit and "More options" (report a no-show, the dispute, a fix asked for,
 * tip and review) used to send the poster to /posts and ask the Posted card to act. They now run HERE, through the
 * very same code the Posted list runs; nothing here writes money itself:
 *  - the handlers are createLifecycleHandlers (the release is its completeJob: create-payment `release`, with its
 *    same-frame double-tap ref; the cancel is its tryCancelJob: the on-the-way check, then CancellationDialog);
 *  - every dialog is ActivityDialogs (CancellationDialog with the fee quote and refund, the completion prompts,
 *    no-show, dispute, review, tip, edit), the Posted list's own mount;
 *  - the approve sheet and "More options" are the card's PostedJobActions itself (CompletionChoiceSheet, every
 *    step's own gate), drawn in a panel on this page;
 *  - the row is the Posted list's own read of this one job (the same columns, series state and offeree, the same detail read for the
 *    Helpr's name, the tip and review badges and a crew's roster), so the cancel quote sees onboarding_fee_amount
 *    and the poster's fee.
 *
 * Guard: src/pages/jobs/jobPage/posterPageFlows.test.tsx.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { JOB_READABLE_COLUMNS, readJobsAheadOfDb, readableJobRows } from "@/lib/jobColumns";
import { fetchPostedActivityDetail, postedDetailInputs, type PostedActivityDetail } from "@/hooks/useActivityData";
import { fetchJobSeriesState } from "@/lib/jobSeriesState";
import { fetchJobOfferTargets } from "@/lib/jobOfferTargets";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Job, CompletionPromptTarget } from "@/components/job-card/activityConstants";
import { createLifecycleHandlers } from "@/components/job-card/activityActions/useLifecycleHandlers";
import { useOptimisticJobCache } from "@/components/job-card/activityActions/useOptimisticJobCache";
import { ActivityDialogs, type TipDialogState, type TipTarget } from "@/components/job-card/ActivityDialogs";
import { PostedJobActions } from "@/pages/posts/postedJobCard/PostedJobActions";
import { crewNobodyLeft } from "@/lib/crewLifecycle";
import { GroupJobHelpers } from "@/components/GroupJobHelpers";

export interface PosterPageFlows {
  /** The Posted list's row for this job is read: the flows below can run. */
  ready: boolean;
  completing: boolean;
  approve: () => void;
  cancel: () => void;
  edit: () => void;
  moreOpen: boolean;
  toggleMore: () => void;
  /** JOBS-3: an under-way crew whose every member was reported a no-show (crewNobodyLeft, read from the loaded detail). */
  crewNobodyLeft: boolean;
  /** The card's own controls (shown under "More options"; always mounted so Approve opens its sheet). */
  panel: React.ReactNode;
  dialogs: React.ReactNode;
}

/** The Posted list's own read (useActivityData: named columns, the newer ones through readJobsAheadOfDb). */
async function fetchPosterRow(jobId: string, userId: string): Promise<{ job: Job; detail: PostedActivityDetail } | null> {
  const res = await readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, materials_note, onboarding_fee_amount, poster_marked_done_at`, (columns) =>
    supabase.from("jobs").select(columns).eq("id", jobId).eq("customer_id", userId).limit(1));
  const row = readableJobRows<Job>(unwrap(res))[0];
  if (!row) return null;
  // As the Posted list builds its row: the series state (its own read) and the poster's offeree (get_job_offer_targets).
  const [seriesState, offerTargets] = await Promise.all([
    fetchJobSeriesState(!row.parent_job_id && (row.recurrence_days?.length ?? 0) > 0 ? [row.id] : []),
    fetchJobOfferTargets([row.id], { throwOnNetwork: true }),
  ]);
  const job: Job = {
    ...row,
    series_ended_on: null,
    series_split_ok: false,
    ...seriesState.get(row.id),
    offered_to_helper_id: offerTargets.get(row.id) ?? null,
  };
  return { job, detail: await fetchPostedActivityDetail(userId, postedDetailInputs([job])) };
}

export function usePosterPageFlows({ jobId, enabled, trackingStatus, onChanged }: {
  jobId: string;
  /** The poster only. */
  enabled: boolean;
  trackingStatus: string | null;
  /** Re-read the page after a write. */
  onChanged: () => void;
}): PosterPageFlows {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "";
  const q = useQuery({
    queryKey: ["job-page", "poster-flows", jobId, userId],
    queryFn: () => fetchPosterRow(jobId, userId),
    enabled: enabled && !!userId,
  });
  const job = q.data?.job ?? null;
  const detail = q.data?.detail;
  const helperNames = detail?.helperNames ?? {};
  const completedJobMeta = detail?.completedJobMeta ?? {};
  const refresh = async () => { onChanged(); await q.refetch(); };

  const { optimisticallyPatchJob, rollbackActivity } = useOptimisticJobCache(user);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [reportingNoShow, setReportingNoShow] = useState(false);
  const [noShowJobId, setNoShowJobId] = useState<string | null>(null);
  const [cancelDialogJob, setCancelDialogJob] = useState<Job | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<CompletionPromptTarget | null>(null);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmingArrivalJobId, setConfirmingArrivalJobId] = useState<string | null>(null);
  const [confirmingWorkingJobId, setConfirmingWorkingJobId] = useState<string | null>(null);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [boostJobId, setBoostJobId] = useState<string | null>(null);
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);
  const [viewDisputeJob, setViewDisputeJob] = useState<Job | null>(null);
  const [tipTarget, setTipTarget] = useState<TipTarget | null>(null);
  const tip: TipDialogState = {
    target: tipTarget,
    open: (id, helperName, helperId) => setTipTarget({ jobId: id, helperName, helperId }),
    close: () => setTipTarget(null),
  };
  const completeInFlight = useRef(new Set<string>());
  // Bumped by "Approve and release": the card's PostedJobActions opens its CompletionChoiceSheet (the confirm).
  const [completionRequest, setCompletionRequest] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  // At 375 the panel opens below the fold, behind the bottom nav (headless check 10-31): bring it into view.
  useEffect(() => {
    if (moreOpen) moreRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [moreOpen]);

  const handlers = createLifecycleHandlers({
    user,
    postedJobs: job ? [job] : [],
    appliedApps: [],
    refresh,
    // The Posted list's filter jump after a completion; the page has no filter.
    setStatusFilter: () => {},
    helperNames,
    completedJobMeta,
    optimisticallyPatchJob,
    rollbackActivity,
    setCompletingJobId,
    setReportingNoShow,
    setNoShowJobId,
    setCancelDialogJob,
    setCompletionPromptJob,
    setReviewTarget,
    setReviewJob,
    setConfirmingArrivalJobId,
    setConfirmingWorkingJobId,
    completeInFlight,
  });

  if (!enabled || !job) {
    return { ready: false, completing: false, approve: () => {}, cancel: () => {}, edit: () => {}, moreOpen: false, toggleMore: () => {}, crewNobodyLeft: false, panel: null, dialogs: null };
  }

  // Its own Suspense: the card's steps lazy-load dialogs (the refund ask), and a suspend with no boundary of its own
  // would swap the whole job page for its loading fallback (the Posted list has one around its tab).
  const panel = (
    <Suspense fallback={null}>
    <div data-poster-more="" hidden={!moreOpen} ref={moreRef} className="scroll-mb-28">
      {/* JOBS-3: an under-way crew's roster, as the Posted card draws it (per-member "Didn't show" and arrival). No
          onCancelJob here: the page's own Cancel job row covers a crew with nobody left (crewNobodyLeft below). */}
      {job.is_group_job && job.status === "in_progress" && (
        <div data-poster-crew="" className="pb-3">
          <GroupJobHelpers jobId={job.id} helpersNeeded={job.helpers_needed || 2} isOwner jobStatus={job.status}
            initialHelpers={detail?.groupHelpersByJob?.[job.id]} dateNeeded={job.date_needed} startTime={job.start_time} />
        </div>
      )}
      <PostedJobActions
        job={job}
        userId={userId}
        helperNames={helperNames}
        completedJobMeta={completedJobMeta}
        onBoost={setBoostJobId}
        onEdit={setEditJob}
        crewRoster={detail?.groupHelpersByJob?.[job.id]}
        onCancel={(j) => void handlers.tryCancelJob(j)}
        onComplete={(id) => void handlers.completeJob(id)}
        completingJobId={completingJobId}
        onNoShow={setNoShowJobId}
        onTip={tip.open}
        onReview={handlers.openReviewForPosted}
        onDispute={setDisputeJob}
        onReport={() => {}}
        onViewDispute={setViewDisputeJob}
        onConfirmArrival={(id) => void handlers.confirmArrival(id)}
        confirmingArrivalJobId={confirmingArrivalJobId}
        onConfirmWorking={(id) => void handlers.confirmWorking(id)}
        confirmingWorkingJobId={confirmingWorkingJobId}
        helperWorking={trackingStatus === "working" || trackingStatus === "done"}
        onActionComplete={() => void refresh()}
        completionRequest={completionRequest}
      />
    </div>
    </Suspense>
  );

  const dialogs = (
    <Suspense fallback={null}>
    <ActivityDialogs
      user={{ id: userId }}
      editJob={editJob}
      setEditJob={setEditJob}
      boostJobId={boostJobId}
      setBoostJobId={setBoostJobId}
      tip={tip}
      noShowJobId={noShowJobId}
      setNoShowJobId={setNoShowJobId}
      onNoShow={(id) => void handlers.handleNoShow(id)}
      reportingNoShow={reportingNoShow}
      cancelDialogJob={cancelDialogJob}
      setCancelDialogJob={setCancelDialogJob}
      completionPromptJob={completionPromptJob}
      setCompletionPromptJob={setCompletionPromptJob}
      deadlineDialogApp={null}
      setDeadlineDialogApp={() => {}}
      onDeadlineConfirm={() => {}}
      disputeJob={disputeJob}
      setDisputeJob={setDisputeJob}
      viewDisputeJob={viewDisputeJob}
      setViewDisputeJob={setViewDisputeJob}
      reviewJob={reviewJob}
      reviewTarget={reviewTarget}
      setReviewJob={setReviewJob}
      setReviewTarget={setReviewTarget}
      helperReviewJob={null}
      setHelperReviewJob={() => {}}
      groupHelpersByJob={detail?.groupHelpersByJob}
      helperNames={helperNames}
      onRefresh={() => void refresh()}
    />
    </Suspense>
  );

  return {
    ready: true,
    completing: completingJobId === job.id,
    approve: () => setCompletionRequest((n) => n + 1),
    cancel: () => void handlers.tryCancelJob(job),
    edit: () => setEditJob(job),
    moreOpen,
    toggleMore: () => setMoreOpen((o) => !o),
    // The detail read is done (q.data), so a crew with no roster entry has nobody left on it.
    crewNobodyLeft: !!detail && job.is_group_job === true && crewNobodyLeft(job.status, detail.groupHelpersByJob?.[job.id] ?? [], true),
    panel,
    dialogs,
  };
}
