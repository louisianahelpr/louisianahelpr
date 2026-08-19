import type { TrackingData } from "@/components/JobTracking";
import type { Application, AppliedApp, Job } from "../activityConstants";

/** Negotiation/bid columns added by a later migration that hasn't been
    regenerated into the Supabase types yet (the PGRST202 migration-lag
    pattern — see CLAUDE.md). Optional because on a production DB where the
    migration is not yet applied these keys are genuinely absent. */
/**
 * Columns on `applications` that aren't in the generated Supabase types yet
 * (migration lag), read through this narrow view rather than `as any`.
 *
 * Was `NegotiationFields` and also carried `negotiation_status`, `counter_price`
 * and `proposed_price`. Bidding was removed (PRICING_MODE_REMOVED in
 * BudgetSection) and those three went with it; `poster_viewed_at` has nothing
 * to do with bidding — it drives the "poster viewed your application" stamp —
 * so the type stays, under a name that describes what is actually left.
 */
export type ApplicationViewFields = {
  poster_viewed_at?: string | null;
};

export interface AppliedJobCardProps {
  /** The application + its embedded job — one row of the applied feed. */
  app: AppliedApp;
  /** When true, scroll this card into view on mount and apply a brief
   *  pulse ring so the helper knows which application the notification
   *  was about (/my-jobs?highlight=<appId> deep-link). Respects
   *  prefers-reduced-motion — animation skipped but scroll still fires. */
  highlight?: boolean;
  expandedJobId: string | null;
  setExpandedJobId: (id: string | null) => void;
  helperReviewedJobIds: Set<string>;
  /** Pre-fetched latest tracking row for this job. `null` = pre-fetched
      and no row exists yet; `undefined` = not pre-fetched (the child
      <JobTracking> falls back to its own per-mount query). Hoisting this
      up to useActivityData eliminates an N+1 across confirmed/in-progress
      cards on the helper's Activity tab. */
  initialTracking?: TrackingData | null;
  userId: string;
  /** Job-lifecycle handlers, owned by the parent ActivityTab. */
  onHelperResponse: (app: Application, accept: boolean) => void;
  /** When set to this card's app.id, the Accept/Decline buttons are
   *  disabled so the helper can't double-tap while the async offer
   *  response is in-flight. */
  respondingHelperAppId: string | null;
  onComplete: (jobId: string) => void;
  completingJobId: string | null;
  onResolveRevision: (jobId: string) => void;
  onHelperReview: (jobId: string, posterId: string, posterName: string) => void;
  /** Open the dispute dialog for this job — helper-initiated dispute (issue #113). */
  onDispute: (job: Job) => void;
  /** Open the read-only timeline + follow-up evidence uploader for a
   *  job that's already in dispute. */
  onViewDispute: (job: Job) => void;
  /** Re-fetch the activity feed after a card-local mutation (dispute response). */
  onRefresh: () => void;
  /** Dispute-response state (parent-owned; keyed by job id). */
  disputeResponse: string;
  setDisputeResponse: (value: string) => void;
  respondingJobId: string | null;
  setRespondingJobId: (id: string | null) => void;
  submittingResponse: boolean;
  setSubmittingResponse: (value: boolean) => void;
  /** Withdraw flow — the confirm sheet lives on the parent. */
  withdrawingAppId: string | null;
  setWithdrawTarget: (target: { appId: string; jobTitle: string; jobId?: string | null } | null) => void;
  /** Application-message edit + attachment state (parent-owned). */
  uploadingAttachment: string | null;
  editingMessageAppId: string | null;
  setEditingMessageAppId: (id: string | null) => void;
  editMessageText: string;
  setEditMessageText: (value: string) => void;
  savingMessage: boolean;
  handleSaveMessage: (appId: string) => void;
  handleAddAttachment: (appId: string, jobId: string, currentUrls: string[], file: File) => void;
  handleRemoveAttachment: (appId: string, currentUrls: string[], urlToRemove: string) => void;
}
