import { type TrackingData } from "@/components/JobTracking";
import type { GroupHelperLite } from "@/hooks/useActivityData";
import { type Job, type EnrichedApplication } from "../activityConstants";

/** Bid column added by a later migration not yet regenerated into the
    Supabase types (PGRST202 migration-lag pattern — see CLAUDE.md).
    Optional: absent on a production DB where the migration hasn't run. */
export type WithBidPrice = { proposed_price?: number | null };

export interface PostedJobCardProps {
  /** The job + its embedded data — one row of the posted feed. */
  job: Job;
  applicantCounts: Record<string, number>;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperNames: Record<string, string>;
  completedJobMeta: Record<string, { tipped: boolean; reviewed: boolean }>;
  startRequestedJobIds: Set<string>;
  userId: string;
  /** Job-lifecycle handlers, owned by the parent ActivityTab. */
  onBoost: (jobId: string) => void;
  onEdit: (job: Job) => void;
  onCancel: (job: Job) => void;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onRevision: (jobId: string) => void;
  onNoShow: (jobId: string) => void;
  onTip: (jobId: string, helperName: string) => void;
  onReview: (job: Job) => void;
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  onConfirmStart: (jobId: string) => void;
  /** Non-null (=== job.id) while the confirmStart DB write is in-flight. */
  confirmingStartJobId: string | null;
  onConfirmArrival: (jobId: string) => void;
  /** Non-null (=== job.id) while the confirmArrival DB write is in-flight. */
  confirmingArrivalJobId: string | null;
  onConfirmWorking: (jobId: string) => void;
  /** Non-null (=== job.id) while the confirmWorking DB write is in-flight. */
  confirmingWorkingJobId: string | null;
  onLoadApplications: (job: Job) => void;
  /** Inline applicant data for the expanded open-job card. */
  onLoadInlineApplicants: (jobId: string) => void;
  inlineApplicants: Record<string, EnrichedApplication[]>;
  loadingApplicants: Record<string, boolean>;
  /** Per-job applicant fetch error, for inline retry. */
  applicantErrors: Record<string, boolean>;
  /** Pre-fetched latest tracking row for this job, threaded down to
      <JobTracking> so the card doesn't fire its own SELECT on mount.
      `null` = pre-fetched and no row exists yet; `undefined` = not
      pre-fetched (the child falls back to its own per-mount query). */
  initialTracking?: TrackingData | null;
  /** Pre-fetched group-helper rows for this job (only relevant for active
      group jobs), threaded into <GroupJobHelpers> to skip its own 2-query
      waterfall on mount. */
  initialGroupHelpers?: GroupHelperLite[];
  /** Refetch the posted-jobs feed after an inline mutation (dispute
      resolve/escalate) instead of a full-page reload. */
  onActionComplete: () => void;
  /** Number of unique helprs who have viewed this job. Only shown when > 0. */
  viewCount?: number;
  /** Pre-computed analytics for this job — views, applicant count,
   *  conversion rate, and bid range (bid fields only for accept_bids jobs). */
  jobAnalytics?: {
    viewCount: number;
    applicantCount: number;
    conversionRate: number | null;
    bidMin: number | null;
    bidMax: number | null;
    bidAvg: number | null;
  };
}
