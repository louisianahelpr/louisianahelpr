import { assertNever } from "@/lib/assertNever";
import type { Job } from "../../activityConstants";

/**
 * What a step of the POSTER's job card is handed.
 *
 * The mirror of the helper card's `HelperStepProps`, and deliberately the same
 * shape of thing: one container (PostedJobActions) owns everything that
 * outlives a step — the dispute RPCs and their confirm state, the completion
 * sheet, the poster's own instant-release flag — and each step is handed the
 * context it needs and nothing else.
 *
 * The two sides share the SHELL (`JobStepCard`), not this. Their content
 * genuinely differs — the poster approves and releases money, the helper does
 * the work and requests it — so what differs is what fills the slots.
 */
export interface PosterStepCtx {
  job: Job;
  userId: string;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  unfunded: boolean;
  completingJobId: string | null;
  confirmingArrivalJobId: string | null;
  confirmingWorkingJobId: string | null;
  /** The poster's own auto-release setting; changes what the wait is called. */
  instantReleaseOn: boolean;
  navigate: (to: string) => void;
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  onReport: (job: Job) => void;
  onViewDispute: (job: Job) => void;
  onConfirmArrival: (jobId: string) => void;
  onConfirmWorking: (jobId: string) => void;
  onActionComplete: () => void;
  /** Completion sheet — owned by the container so a re-render of the step
   *  cannot close it. */
  completionSheetOpen: boolean;
  setCompletionSheetOpen: (open: boolean) => void;
  /** Dispute controls, all container-owned for the same reason. */
  disputeActing: boolean;
  resolveConfirmOpen: boolean;
  setResolveConfirmOpen: (open: boolean) => void;
  escalateConfirmOpen: boolean;
  setEscalateConfirmOpen: (open: boolean) => void;
  escalateDispute: () => void;
  resolveDisputeAndRelease: () => void;
}

/** Which step of the poster's card a job is on. */
export type PosterStepId = "open" | "scheduled" | "in_progress" | "completed" | "disputed";

export function derivePosterStep(status: Job["status"]): PosterStepId | null {
  switch (status) {
    case "open":
      return "open";
    case "accepted":
      return "scheduled";
    case "in_progress":
    case "revision_requested":
      return "in_progress";
    case "completed":
      return "completed";
    case "disputed":
      return "disputed";
    // Both render no actions at all — see STATUS_RENDERS_ACTIONS in
    // PostedJobActions, the gate that keeps an empty bordered band off these
    // cards. Named rather than defaulted so a new enum member is a build error
    // here too (src/test/jobStatusExhaustive.test.ts).
    case "pending_approval":
    case "cancelled":
      return null;
    default:
      return assertNever(status);
  }
}
