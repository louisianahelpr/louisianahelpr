import { useState, lazy, Suspense } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
// The consequence this dialog promises is stated ONCE, next to the ladder the
// RPC actually runs (report_helper_no_show → apply_consequence_ladder). This
// bullet used to hard-code "a permanent ban (2nd offense)", which was true of
// the old bespoke ladder and became false the moment migration 20260831183302
// moved the top rung to a reversible 7-day restriction pending admin review.
import { NO_SHOW_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import type { Job, EnrichedApplication } from "./activityConstants";

// Dialogs are conditionally rendered — none are visible on first paint. Each
// is code-split and only the dialogs the user actually opens get fetched,
// keeping the Activity route chunk small.
const JobBoostDialog = lazy(() => import("@/components/JobBoostDialog").then(m => ({ default: m.JobBoostDialog })));
const TipDialog = lazy(() => import("@/components/TipDialog").then(m => ({ default: m.TipDialog })));
const CancellationDialog = lazy(() => import("@/components/CancellationDialog").then(m => ({ default: m.CancellationDialog })));
const CompletionPrompts = lazy(() => import("@/components/CompletionPrompts").then(m => ({ default: m.CompletionPrompts })));
const ReviewForm = lazy(() => import("@/components/ReviewPanel").then(m => ({ default: m.ReviewForm })));
const ResponseDeadlineDialog = lazy(() => import("@/components/ResponseDeadlineDialog").then(m => ({ default: m.ResponseDeadlineDialog })));
const DisputeDialog = lazy(() => import("@/components/DisputeDialog").then(m => ({ default: m.DisputeDialog })));
const DisputeTimelineDialog = lazy(() => import("@/components/DisputeTimelineDialog").then(m => ({ default: m.DisputeTimelineDialog })));
const EditJobDialog = lazy(() => import("./EditJobDialog").then(m => ({ default: m.EditJobDialog })));

/** The response-deadline dialog reads only the helper's display name off the
    enriched applicant row; the full `EnrichedApplication` shape is what the
    Activity page already holds in state, so reuse it rather than inventing a
    narrower parallel type. */
type DeadlineDialogApp = EnrichedApplication;

interface ActivityDialogsProps {
  user: { id: string } | null;
  // Revision
  revisionJobId: string | null;
  setRevisionJobId: (id: string | null) => void;
  onRevisionRequested: () => void;
  // Edit
  editJob: Job | null;
  setEditJob: (job: Job | null) => void;
  // Boost
  boostJobId: string | null;
  setBoostJobId: (id: string | null) => void;
  // Tip
  enhancedTipJobId: string | null;
  enhancedTipHelperName: string;
  setEnhancedTipJobId: (id: string | null) => void;
  setEnhancedTipHelperName: (name: string) => void;
  // No-show
  noShowJobId: string | null;
  setNoShowJobId: (id: string | null) => void;
  onNoShow: (jobId: string) => void;
  reportingNoShow: boolean;
  // Cancel
  cancelDialogJob: Job | null;
  setCancelDialogJob: (job: Job | null) => void;
  // Completion prompts
  completionPromptJob: { job: Job; revieweeId: string; revieweeName: string } | null;
  setCompletionPromptJob: (v: { job: Job; revieweeId: string; revieweeName: string } | null) => void;
  // Deadline
  deadlineDialogApp: DeadlineDialogApp | null;
  setDeadlineDialogApp: (app: DeadlineDialogApp | null) => void;
  onDeadlineConfirm: (hours: number, msg?: string) => Promise<void> | void;
  // Dispute
  disputeJob: Job | null;
  setDisputeJob: (job: Job | null) => void;
  // View dispute timeline (already-disputed jobs — read-only timeline
  // + follow-up evidence upload).
  viewDisputeJob: Job | null;
  setViewDisputeJob: (job: Job | null) => void;
  // Review (poster)
  reviewJob: Job | null;
  reviewTarget: { id: string; name: string } | null;
  setReviewJob: (job: Job | null) => void;
  setReviewTarget: (t: { id: string; name: string } | null) => void;
  // Review (helper)
  helperReviewJob: { jobId: string; posterId: string; posterName: string } | null;
  setHelperReviewJob: (v: { jobId: string; posterId: string; posterName: string } | null) => void;
  // Helper names lookup
  helperNames?: Record<string, string>;
  // Refresh
  onRefresh: () => void;
}

export function ActivityDialogs(props: ActivityDialogsProps) {
  const [revisionNote, setRevisionNote] = useState("");
  const [requestingRevision, setRequestingRevision] = useState(false);

  const requestRevision = async () => {
    if (!props.revisionJobId) return;
    setRequestingRevision(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: { action: "request_revision", jobId: props.revisionJobId, note: revisionNote.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      hapticSuccess();
      props.setRevisionJobId(null);
      setRevisionNote("");
      props.onRevisionRequested();
    } catch (err) {
      hapticError();
      toast.error(err instanceof Error ? err.message : "Couldn't request a revision — try again?");
    } finally {
      setRequestingRevision(false);
    }
  };

  return (
    <>
      {/* Poster reviewing helper */}
      {props.reviewJob && props.reviewTarget && (
        <Suspense fallback={null}>
          {/* `canTip`: only the POSTER may tip, and only this mount is the
              poster. The helper-side mount below leaves it off — see
              ReviewFormProps.canTip. */}
          <ReviewForm canTip open={!!props.reviewJob} onClose={() => { props.setReviewJob(null); props.setReviewTarget(null); props.onRefresh(); }} jobId={props.reviewJob.id} revieweeId={props.reviewTarget.id} revieweeName={props.reviewTarget.name} />
        </Suspense>
      )}

      {/* Helper reviewing poster */}
      {props.helperReviewJob && (
        <Suspense fallback={null}>
          <ReviewForm open={!!props.helperReviewJob} onClose={() => { props.setHelperReviewJob(null); props.onRefresh(); }} jobId={props.helperReviewJob.jobId} revieweeId={props.helperReviewJob.posterId} revieweeName={props.helperReviewJob.posterName} />
        </Suspense>
      )}

      {/* Revision Request Dialog */}
      <Dialog open={!!props.revisionJobId} onOpenChange={() => props.setRevisionJobId(null)}>
        <DialogContent>
          <DialogHero
            title="Request Revision"
          />
          <div className="space-y-4">
            <DialogBody>
              <p>Describe what needs to be fixed or redone. The Helpr will be notified.</p>
            </DialogBody>
            <Textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} rows={3} aria-label="Revision request details" />
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => props.setRevisionJobId(null)}>Cancel</DialogSecondaryAction>
            <DialogPrimaryAction onClick={requestRevision} disabled={requestingRevision || !revisionNote.trim()}>
              {requestingRevision ? "Sending…" : "Request Revision"}
            </DialogPrimaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Job Dialog — only fetch the chunk once a job is being edited;
          EditJobDialog gates its own mounting on the `job` prop. */}
      {props.editJob && (
        <Suspense fallback={null}>
          <EditJobDialog job={props.editJob} onClose={() => props.setEditJob(null)} onSaved={props.onRefresh} />
        </Suspense>
      )}

      {/* Boost Dialog */}
      {props.boostJobId && (
        <Suspense fallback={null}>
          <JobBoostDialog jobId={props.boostJobId} open={!!props.boostJobId} onClose={() => props.setBoostJobId(null)} onBoosted={props.onRefresh} />
        </Suspense>
      )}

      {/* Enhanced Tip Dialog */}
      {props.enhancedTipJobId && (
        <Suspense fallback={null}>
          <TipDialog jobId={props.enhancedTipJobId} helperName={props.enhancedTipHelperName} open={!!props.enhancedTipJobId} onClose={() => { props.setEnhancedTipJobId(null); props.setEnhancedTipHelperName(""); props.onRefresh(); }} />
        </Suspense>
      )}

      {/* No-Show Confirmation Dialog */}
      <Dialog open={!!props.noShowJobId} onOpenChange={() => props.setNoShowJobId(null)}>
        <DialogContent>
          <DialogHero
            title="Report No-Show"
          />
          {/* THE HOUSE VOICE, not shadcn's grey default. Copy is untouched —
              same question, same three consequences, same ladder sentence —
              but it now reads in the serif italic every other popup uses
              instead of `text-ds-11 text-muted-foreground`. This was the
              "upright sans + bullets" dialog in the owner's screenshot set,
              sitting one tap away from four serif-italic siblings.
              A serif-italic bulleted consequence list is not new here:
              BlockUserDialog already renders its effects list exactly this
              way. Same treatment, now from the shared primitive. */}
          <DialogBody>
            <p>Are you sure the Helpr didn't show up? This will:</p>
            <ul className="space-y-1 list-disc pl-5">
              <li>Go on the Helpr's record — {NO_SHOW_LADDER_SENTENCE}</li>
              <li>Reopen your job so you can pick another applicant</li>
              <li>Notify the admin team</li>
            </ul>
          </DialogBody>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => props.setNoShowJobId(null)}>Cancel</DialogSecondaryAction>
            <DialogDestructiveAction onClick={() => props.noShowJobId && props.onNoShow(props.noShowJobId)} disabled={props.reportingNoShow}>
              {props.reportingNoShow ? "Reporting…" : "Confirm No-Show"}
            </DialogDestructiveAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancellation Dialog */}
      {props.cancelDialogJob && props.user && (
        <CancellationDialog
          jobId={props.cancelDialogJob.id} jobTitle={props.cancelDialogJob.title}
          jobDate={props.cancelDialogJob.date_needed} jobBudget={props.cancelDialogJob.budget}
          hasHelper={!!props.cancelDialogJob.helper_id}
          helperId={props.cancelDialogJob.helper_id}
          helperName={props.cancelDialogJob.helper_id ? (props.helperNames?.[props.cancelDialogJob.helper_id] || "the Helpr") : undefined}
          open={!!props.cancelDialogJob} onClose={() => props.setCancelDialogJob(null)} onCancelled={props.onRefresh}
        />
      )}

      {/* Completion Prompts */}
      {props.completionPromptJob && props.user && (
        <CompletionPrompts
          jobId={props.completionPromptJob.job.id} jobTitle={props.completionPromptJob.job.title}
          revieweeId={props.completionPromptJob.revieweeId} revieweeName={props.completionPromptJob.revieweeName}
          userId={props.user.id} onDone={() => props.setCompletionPromptJob(null)}
          isHelper={props.user.id === props.completionPromptJob.job.helper_id}
          jobCategory={props.completionPromptJob.job.category}
        />
      )}

      {/* Response Deadline Dialog */}
      {props.deadlineDialogApp && (
        <ResponseDeadlineDialog
          open={!!props.deadlineDialogApp}
          helperName={formatName(props.deadlineDialogApp.profiles?.full_name, "Helpr")}
          onConfirm={props.onDeadlineConfirm}
          onClose={() => props.setDeadlineDialogApp(null)}
        />
      )}

      {/* Dispute Dialog */}
      {props.disputeJob && props.user && (
        <DisputeDialog
          jobId={props.disputeJob.id}
          userId={props.user.id} open={!!props.disputeJob}
          onClose={() => props.setDisputeJob(null)} onDisputed={props.onRefresh}
        />
      )}

      {/* Dispute Timeline Dialog — viewed once a dispute is already
          open on this job. Surfaces the reason / evidence / decision
          and lets either party upload follow-up evidence. */}
      {props.viewDisputeJob && props.user && (
        <Suspense fallback={null}>
          <DisputeTimelineDialog
            jobId={props.viewDisputeJob.id}
            jobTitle={props.viewDisputeJob.title}
            userId={props.user.id}
            legacy={{
              reason: props.viewDisputeJob.dispute_reason ?? null,
              evidence_urls: props.viewDisputeJob.dispute_evidence_urls ?? [],
              disputed_at: props.viewDisputeJob.disputed_at ?? null,
              disputed_by: props.viewDisputeJob.disputed_by ?? null,
              dispute_resolved_at: props.viewDisputeJob.dispute_resolved_at ?? null,
            }}
            open={!!props.viewDisputeJob}
            onClose={() => props.setViewDisputeJob(null)}
            onUpdated={props.onRefresh}
          />
        </Suspense>
      )}
    </>
  );
}
