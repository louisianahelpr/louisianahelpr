import { Button } from "@/components/ui/button";
import { messageButtonStyle } from "@/components/activity/JobActionRow";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import type { AppliedApp, Job } from "../activityConstants";

interface DisputedSectionProps {
  app: AppliedApp;
  job: Job;
  navigate: (to: string) => void;
  onViewDispute: (job: Job) => void;
  onRefresh: () => void;
  disputeResponse: string;
  setDisputeResponse: (value: string) => void;
  respondingJobId: string | null;
  setRespondingJobId: (id: string | null) => void;
  submittingResponse: boolean;
  setSubmittingResponse: (value: boolean) => void;
}

/** Disputed */
export function DisputedSection({
  app,
  job,
  navigate,
  onViewDispute,
  onRefresh,
  disputeResponse,
  setDisputeResponse,
  respondingJobId,
  setRespondingJobId,
  submittingResponse,
  setSubmittingResponse,
}: DisputedSectionProps) {
  const disputeStatus = job.dispute_status || "open";
  const hasResponded = !!job.dispute_helper_response;
  return (
    <div
      className="px-4 py-3 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
      style={{
        borderTop: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
        background: "hsl(var(--burnt-sienna) / 0.06)",
      }}
    >
      {/* Dispute info */}
      <div
        className="rounded-ds-md p-3"
        style={{
          background: "hsl(var(--burnt-sienna) / 0.10)",
          border: "0.5px solid hsl(var(--burnt-sienna) / 0.24)",
        }}
      >
        <span
          className="font-serif italic uppercase inline-flex items-center gap-1.5 text-ds-10"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          <AlertTriangle className="w-3 h-3" />
          {disputeStatus === "escalated" ? "Admin reviewing" : "Dispute open"}
        </span>
        <p
          className="font-display italic font-bold leading-tight mt-2 text-ds-16"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          {disputeStatus === "escalated"
            ? "An admin is on it."
            : "Both sides are talking it out."}
        </p>
        {job.dispute_reason && (
          <p
            className="font-serif italic mt-1.5 text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            Reason: {job.dispute_reason}
          </p>
        )}
        {job.disputed_at && (
          <p
            className="font-serif italic mt-1 text-ds-11"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Filed {formatDistanceToNow(new Date(job.disputed_at), { addSuffix: true })}
          </p>
        )}
      </div>

      {job.dispute_deadline && (
        <DeadlineCountdown
          deadline={job.dispute_deadline}
          expiredText="Deadline passed — payment auto-releasing to you"
          consequenceText="If the poster doesn't resolve or escalate, payment auto-releases to you after the deadline."
          variant="destructive"
        />
      )}

      {/* Photo proof */}
      {job.poster_confirmed_working_at && (
        <PhotoProofGroup
          jobId={app.job_id}
          beforeUrls={job.proof_before_urls || []}
          afterUrls={job.proof_after_urls || []}
          canUploadBefore={true}
          canUploadAfter={true}
          requireAfter={true}
          budget={job.budget || 0}
        />
      )}

      {/* Helper's response */}
      {hasResponded && (
        <div className="p-2 rounded-ds-sm bg-primary/5 border border-primary/20">
          <p className="text-ds-10 text-muted-foreground font-medium">Your response:</p>
          <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
        </div>
      )}

      {/* Respond form */}
      {!hasResponded && disputeStatus === "open" && (
        <div className="space-y-2">
          {respondingJobId === app.job_id ? (
            <div className="space-y-2">
              <Textarea
                aria-label="Your response to the dispute"
                placeholder="Explain your side — what work was done, any issues, etc."
                value={disputeResponse}
                onChange={(e) => setDisputeResponse(e.target.value)}
                rows={3}
                maxLength={500}
                className="text-ds-11"
              />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={!disputeResponse.trim() || submittingResponse} onClick={async () => {
                  setSubmittingResponse(true);
                  // `.select("id")`: a bare `.update().eq(...)` resolves
                  // `{data: null, error: null}` whether it changed one row or
                  // NONE, so an RLS-filtered write (dispute resolved out from
                  // under this card) read as success and showed a response
                  // the poster never received.
                  const { data: saved, error } = await supabase.from("jobs").update({ dispute_helper_response: disputeResponse.trim(), dispute_status: "helper_responded" }).eq("id", app.job_id).select("id");
                  if (error || !saved || saved.length === 0) { hapticError(); toast.error("We couldn't submit your response — please try again."); setSubmittingResponse(false); return; }
                  if (job.customer_id) await createNotification({ user_id: job.customer_id, title: "Helpr responded to dispute", message: `The Helpr has responded to the dispute on "${job.title}". Please review and mark resolved or escalate.`, type: "info", link: "/my-posts?filter=disputed" });
                  hapticSuccess();
                  setSubmittingResponse(false);
                  setRespondingJobId(null);
                  setDisputeResponse("");
                  onRefresh();
                }}>
                  <Send className="w-3.5 h-3.5 mr-1" /> {submittingResponse ? "Sending…" : "Submit"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setRespondingJobId(null); setDisputeResponse(""); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="w-full" onClick={() => setRespondingJobId(app.job_id)}>
              <MessageSquare className="w-4 h-4 mr-1" /> Respond to Dispute
            </Button>
          )}
        </div>
      )}

      {/* No hardcoded "within 72 hours" policy line — the DeadlineCountdown
          above renders the job's ACTUAL dispute_deadline and its caption
          already says what happens when it lapses; a fixed 72h sentence
          contradicted it whenever the live deadline differed. */}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => onViewDispute(job)}
      >
        <AlertTriangle className="w-4 h-4 mr-1" /> View Timeline & Add Evidence
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" style={messageButtonStyle} className="w-full" onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}><MessageSquare className="w-4 h-4 mr-1" /> Message</Button>
        <Button size="sm" variant="outline" className="w-full" onClick={() => navigate("/support")}><AlertTriangle className="w-4 h-4 mr-1" /> Contact Admin</Button>
      </div>
    </div>
  );
}
