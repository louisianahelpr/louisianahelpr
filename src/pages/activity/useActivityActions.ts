import { useState } from "react";
import { usePushPermissionNudge } from "@/lib/pushPermissionNudge";
import { useStripeConnectCheck } from "@/hooks/useStripeConnectCheck";
import type {
  Job,
  Application,
  EnrichedApplication,
} from "@/components/activity/activityConstants";
import type { UseActivityActionsArgs } from "./activityActions/types";
import { useOptimisticJobCache } from "./activityActions/useOptimisticJobCache";
import { useApplicantsState } from "./activityActions/useApplicantsState";
import { createOfferHandlers } from "./activityActions/useOfferHandlers";
import { createLifecycleHandlers } from "./activityActions/useLifecycleHandlers";

export type { UseActivityActionsArgs } from "./activityActions/types";

/**
 * useActivityActions — data-loading + all action handlers for the Activity
 * page (accept / decline / complete / no-show / start / arrival / etc.),
 * plus the dialog and per-action UI state those handlers own.
 *
 * Handlers call `setStatusFilter` to jump the filter after a state
 * transition, and `refresh` (from useActivityData) to reconcile the cache.
 *
 * The implementation is split across `./activityActions/*` for readability;
 * this file keeps the public return shape byte-identical and owns the dialog
 * state that the sub-modules operate on.
 */
export function useActivityActions({
  user,
  postedJobs,
  appliedApps,
  refresh,
  setStatusFilter,
  helperNames = {},
  completedJobMeta = {},
}: UseActivityActionsArgs) {
  const { checkHelperStripeConnect } = useStripeConnectCheck();
  const triggerPushNudge = usePushPermissionNudge();

  // UI state
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [completingJobId, setCompletingJobId] = useState<string | null>(null);
  const [reportingNoShow, setReportingNoShow] = useState(false);

  // Applicant loading + enrichment state (dialog list + inline per-job map).
  const {
    selectedJob, setSelectedJob,
    applications, setApplications,
    applicationsLoading,
    applicationsError,
    inlineApplicants, setInlineApplicants,
    loadingApplicants,
    applicantErrors,
    loadApplications,
    loadInlineApplicants,
  } = useApplicantsState(user);

  // Dialog state
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [boostJobId, setBoostJobId] = useState<string | null>(null);
  const [enhancedTipJobId, setEnhancedTipJobId] = useState<string | null>(null);
  const [enhancedTipHelperName, setEnhancedTipHelperName] = useState("");
  const [noShowJobId, setNoShowJobId] = useState<string | null>(null);
  const [cancelDialogJob, setCancelDialogJob] = useState<Job | null>(null);
  const [revisionJobId, setRevisionJobId] = useState<string | null>(null);
  const [deadlineDialogApp, setDeadlineDialogApp] = useState<EnrichedApplication | null>(null);
  const [completionPromptJob, setCompletionPromptJob] = useState<{ job: Job; revieweeId: string; revieweeName: string } | null>(null);
  const [disputeJob, setDisputeJob] = useState<Job | null>(null);
  // Read-only timeline + follow-up evidence for an already-disputed
  // job. Separate from disputeJob so the file-a-new-dispute and
  // view-the-existing-one dialogs don't collide on the same state.
  const [viewDisputeJob, setViewDisputeJob] = useState<Job | null>(null);
  const [reviewJob, setReviewJob] = useState<Job | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [helperReviewJob, setHelperReviewJob] = useState<{ jobId: string; posterId: string; posterName: string } | null>(null);

  const [idvDialogOpen, setIdvDialogOpen] = useState(false);
  const [idvStatus, setIdvStatus] = useState<string | undefined>(undefined);
  const [idvFailureReason, setIdvFailureReason] = useState<string | undefined>(undefined);
  const [pendingAcceptApp, setPendingAcceptApp] = useState<Application | null>(null);

  // W-9 e-sign — surfaces when the accepted job has `requires_w9 = true`
  // (set by business posters at post time). We open the dialog after the
  // optimistic acceptance lands.
  const [w9DialogOpen, setW9DialogOpen] = useState(false);
  const [w9Context, setW9Context] = useState<{ jobId: string; businessId: string | null } | null>(null);

  // Optimistic cache helpers shared by every money-path handler.
  const { optimisticallyPatchJob, rollbackActivity } = useOptimisticJobCache(user);

  // --- Action handlers ---

  const {
    acceptApplication,
    declineApplication,
    confirmAcceptWithDeadline,
    handleHelperResponse,
  } = createOfferHandlers({
    user,
    refresh,
    setStatusFilter,
    checkHelperStripeConnect,
    triggerPushNudge,
    optimisticallyPatchJob,
    rollbackActivity,
    selectedJob,
    setSelectedJob,
    setApplications,
    setInlineApplicants,
    deadlineDialogApp,
    setDeadlineDialogApp,
    setPendingAcceptApp,
    setIdvStatus,
    setIdvFailureReason,
    setIdvDialogOpen,
    setW9Context,
    setW9DialogOpen,
  });

  const {
    tryCancelJob,
    completeJob,
    resolveRevision,
    confirmStartJob,
    confirmArrival,
    confirmWorking,
    handleNoShow,
    openReviewForPosted,
  } = createLifecycleHandlers({
    user,
    postedJobs,
    appliedApps,
    refresh,
    setStatusFilter,
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
  });

  return {
    // UI state
    expandedJobId, setExpandedJobId,
    completingJobId,
    reportingNoShow,
    // Dialog state
    selectedJob, setSelectedJob,
    applications,
    applicationsLoading,
    applicationsError,
    inlineApplicants,
    loadingApplicants,
    applicantErrors,
    editJob, setEditJob,
    boostJobId, setBoostJobId,
    enhancedTipJobId, setEnhancedTipJobId,
    enhancedTipHelperName, setEnhancedTipHelperName,
    noShowJobId, setNoShowJobId,
    cancelDialogJob, setCancelDialogJob,
    revisionJobId, setRevisionJobId,
    deadlineDialogApp, setDeadlineDialogApp,
    completionPromptJob, setCompletionPromptJob,
    disputeJob, setDisputeJob,
    viewDisputeJob, setViewDisputeJob,
    reviewJob, setReviewJob,
    reviewTarget, setReviewTarget,
    helperReviewJob, setHelperReviewJob,
    idvDialogOpen, setIdvDialogOpen,
    idvStatus,
    idvFailureReason,
    pendingAcceptApp, setPendingAcceptApp,
    w9DialogOpen, setW9DialogOpen,
    w9Context,
    // Handlers
    loadApplications,
    loadInlineApplicants,
    acceptApplication,
    declineApplication,
    confirmAcceptWithDeadline,
    handleHelperResponse,
    tryCancelJob,
    completeJob,
    resolveRevision,
    confirmStartJob,
    confirmArrival,
    confirmWorking,
    handleNoShow,
    openReviewForPosted,
  };
}
