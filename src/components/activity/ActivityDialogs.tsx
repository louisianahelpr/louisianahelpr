import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { JobBoostDialog } from "@/components/JobBoostDialog";
import { TipDialog } from "@/components/TipDialog";
import { CancellationDialog } from "@/components/CancellationDialog";
import { CompletionPrompts } from "@/components/CompletionPrompts";
import { ReviewForm } from "@/components/ReviewPanel";
import { ResponseDeadlineDialog } from "@/components/ResponseDeadlineDialog";
import { DisputeDialog } from "@/components/DisputeDialog";
import { EditJobDialog } from "./EditJobDialog";
import type { Job, Application, EnrichedApplication } from "./activityConstants";

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
  setCompletionPromptJob: (v: any) => void;
  // Deadline
  deadlineDialogApp: (Application & { profiles?: any }) | null;
  setDeadlineDialogApp: (app: any) => void;
  onDeadlineConfirm: (hours: number, msg?: string) => void;
  // Dispute
  disputeJob: Job | null;
  setDisputeJob: (job: Job | null) => void;
  // Review (poster)
  reviewJob: Job | null;
  reviewTarget: { id: string; name: string } | null;
  setReviewJob: (job: Job | null) => void;
  setReviewTarget: (t: { id: string; name: string } | null) => void;
  // Review (helper)
  helperReviewJob: { jobId: string; posterId: string; posterName: string } | null;
  setHelperReviewJob: (v: any) => void;
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
      toast.success("Revision requested!");
      props.setRevisionJobId(null);
      setRevisionNote("");
      props.onRevisionRequested();
    } catch (err: any) {
      toast.error(err.message || "Failed to request revision");
    } finally {
      setRequestingRevision(false);
    }
  };

  return (
    <>
      {/* Poster reviewing helper */}
      {props.reviewJob && props.reviewTarget && (
        <ReviewForm open={!!props.reviewJob} onClose={() => { props.setReviewJob(null); props.setReviewTarget(null); props.onRefresh(); }} jobId={props.reviewJob.id} revieweeId={props.reviewTarget.id} revieweeName={props.reviewTarget.name} />
      )}

      {/* Helper reviewing poster */}
      {props.helperReviewJob && (
        <ReviewForm open={!!props.helperReviewJob} onClose={() => props.setHelperReviewJob(null)} jobId={props.helperReviewJob.jobId} revieweeId={props.helperReviewJob.posterId} revieweeName={props.helperReviewJob.posterName} />
      )}

      {/* Revision Request Dialog */}
      <Dialog open={!!props.revisionJobId} onOpenChange={() => props.setRevisionJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Request Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Describe what needs to be fixed or redone. The helpr will be notified.</p>
            <Textarea value={revisionNote} onChange={(e) => setRevisionNote(e.target.value)} placeholder="Please fix…" rows={3} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => props.setRevisionJobId(null)}>Cancel</Button>
            <Button onClick={requestRevision} disabled={requestingRevision || !revisionNote.trim()}>
              {requestingRevision ? "Sending…" : "Request Revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Job Dialog */}
      <EditJobDialog job={props.editJob} onClose={() => props.setEditJob(null)} onSaved={props.onRefresh} />

      {/* Boost Dialog */}
      {props.boostJobId && (
        <JobBoostDialog jobId={props.boostJobId} open={!!props.boostJobId} onClose={() => props.setBoostJobId(null)} onBoosted={props.onRefresh} />
      )}

      {/* Enhanced Tip Dialog */}
      {props.enhancedTipJobId && (
        <TipDialog jobId={props.enhancedTipJobId} helperName={props.enhancedTipHelperName} open={!!props.enhancedTipJobId} onClose={() => { props.setEnhancedTipJobId(null); props.setEnhancedTipHelperName(""); props.onRefresh(); }} />
      )}

      {/* No-Show Confirmation Dialog */}
      <Dialog open={!!props.noShowJobId} onOpenChange={() => props.setNoShowJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" /> Report No-Show
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Are you sure the helpr didn't show up? This will:</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
              <li>Issue a <span className="font-medium text-foreground">warning</span> to the helpr (1st offense) or a <span className="font-medium text-destructive">permanent ban</span> (2nd offense)</li>
              <li>Reopen your job so you can pick another applicant</li>
              <li>Notify the admin team</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => props.setNoShowJobId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => props.noShowJobId && props.onNoShow(props.noShowJobId)} disabled={props.reportingNoShow}>
              {props.reportingNoShow ? "Reporting…" : "Confirm No-Show"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancellation Dialog */}
      {props.cancelDialogJob && props.user && (
        <CancellationDialog
          jobId={props.cancelDialogJob.id} jobTitle={props.cancelDialogJob.title}
          jobDate={props.cancelDialogJob.date_needed} jobBudget={props.cancelDialogJob.budget}
          userId={props.user.id} hasHelper={!!props.cancelDialogJob.helper_id}
          helperId={props.cancelDialogJob.helper_id}
          helperName={props.cancelDialogJob.helper_id ? (props.helperNames?.[props.cancelDialogJob.helper_id] || "the helpr") : undefined}
          open={!!props.cancelDialogJob} onClose={() => props.setCancelDialogJob(null)} onCancelled={props.onRefresh}
        />
      )}

      {/* Completion Prompts */}
      {props.completionPromptJob && props.user && (
        <CompletionPrompts
          jobId={props.completionPromptJob.job.id} jobTitle={props.completionPromptJob.job.title}
          revieweeId={props.completionPromptJob.revieweeId} revieweeName={props.completionPromptJob.revieweeName}
          userId={props.user.id} onDone={() => props.setCompletionPromptJob(null)}
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
          jobId={props.disputeJob.id} jobTitle={props.disputeJob.title}
          userId={props.user.id} open={!!props.disputeJob}
          onClose={() => props.setDisputeJob(null)} onDisputed={props.onRefresh}
        />
      )}
    </>
  );
}
