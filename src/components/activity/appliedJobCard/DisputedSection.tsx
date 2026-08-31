import { Button } from "@/components/ui/button";
import { JobActionRow, JobActionChip } from "@/components/activity/JobActionRow";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, MessageSquare, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { createNotification } from "@/lib/notifications";
import { formatDistanceToNow } from "date-fns";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { SectionEyebrow } from "./SectionEyebrow";
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
  // The helper keeps their voice after escalation.
  //
  // This used to be `disputeStatus === "open"`, so the response control simply
  // vanished the moment the poster escalated (PostedJobActions writes
  // dispute_status='escalated' in one tap) — and `helper_abort_job`
  // (20260825191500) opens its dispute ESCALATED from the start, so a helper
  // who took the sanctioned exit never saw the control at all. Nothing said
  // why; the button was just gone.
  //
  // The server does not forbid it: the "Helpers can update their assigned
  // jobs" policy (20260312010219) is USING/WITH CHECK auth.uid() = helper_id
  // with no status clause, and `dispute_helper_response` is on
  // enforce_helper_jobs_column_whitelist's ALLOW-list (20260828020000) in every
  // dispute state. So the control stays; only the STATUS write is withheld
  // (see the submit handler).
  const canRespond = ["open", "escalated", "under_review"].includes(disputeStatus);
  const awaitingAdmin = disputeStatus === "escalated" || disputeStatus === "under_review";
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
        <section aria-labelledby={`dispute-response-${app.job_id}`} className="p-2 rounded-ds-sm bg-primary/5 border border-primary/20">
          {/* Was a bare grey "Your response:" — the ONE block on this card
              carrying the helper's own words, labelled in a style no other
              section header on these cards uses. Same eyebrow as everywhere
              else now (owner, 2026-08-30). */}
          <SectionEyebrow id={`dispute-response-${app.job_id}`}>Your response</SectionEyebrow>
          <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
        </section>
      )}

      {/* Respond form */}
      {!hasResponded && canRespond && (
        <div className="space-y-2">
          {/* Say who reads it once it is out of the poster's hands, so the
              control does not read as a dead end. */}
          {awaitingAdmin && (
            <p
              className="font-serif italic text-ds-11"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              An admin is deciding this one. You can still add your side — it goes
              into the record they read before they decide.
            </p>
          )}
          {respondingJobId === app.job_id ? (
            <div className="space-y-2">
              {/* A REAL <label htmlFor>, not an aria-label alone: this editor
                  had no visible label at all, so a sighted user saw an
                  unexplained box while only a screen reader was told what it
                  was. The eyebrow is the label. */}
              <SectionEyebrow htmlFor={`dispute-reply-${app.job_id}`}>Your side of it</SectionEyebrow>
              <Textarea
                id={`dispute-reply-${app.job_id}`}
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
                  // The STATUS only moves out of 'open'. Stamping
                  // 'helper_responded' on an escalated dispute would silently
                  // DE-escalate it, and `auto-resolve-disputes` treats that as
                  // a money decision: it skips escalated disputes
                  // (index.ts:56) and auto-releases the FULL escrow to the
                  // helper on any other status past the 72h deadline
                  // (index.ts:113). `helper_abort_job` sets 'escalated'
                  // precisely to stop that (20260825191500), so writing the
                  // response must not undo it — the helper gets heard, the
                  // escrow stays frozen for the admin.
                  const patch: { dispute_helper_response: string; dispute_status?: string } =
                    disputeStatus === "open"
                      ? { dispute_helper_response: disputeResponse.trim(), dispute_status: "helper_responded" }
                      : { dispute_helper_response: disputeResponse.trim() };
                  const { data: saved, error } = await supabase.from("jobs").update(patch).eq("id", app.job_id).select("id");
                  if (error || !saved || saved.length === 0) { hapticError(); toast.error("We couldn't submit your response — please try again."); setSubmittingResponse(false); return; }
                  if (job.customer_id) await createNotification({ user_id: job.customer_id, title: "Helpr responded to dispute", message: awaitingAdmin ? `The Helpr added their side of the dispute on "${job.title}". An admin is reviewing it.` : `The Helpr has responded to the dispute on "${job.title}". Please review and mark resolved or escalate.`, type: "info", link: "/my-posts?filter=disputed" });
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
              {/* "Respond to Dispute" implies the poster is still the one
                  listening. Once it is escalated they are not. */}
              <MessageSquare className="w-4 h-4 mr-1" /> {awaitingAdmin ? "Add Your Side" : "Respond to Dispute"}
            </Button>
          )}
        </div>
      )}

      {/* No hardcoded "within 72 hours" policy line — the DeadlineCountdown
          above renders the job's ACTUAL dispute_deadline and its caption
          already says what happens when it lapses; a fixed 72h sentence
          contradicted it whenever the live deadline differed. */}
      {/* View Timeline / Message / Contact Admin — one 3-up row (mirrors the
          same fix on the poster's side, PostedJobActions), instead of a
          full-width View Timeline button followed by a separate 2-up row. */}
      <JobActionRow columns={3}>
        <JobActionChip
          icon={AlertTriangle}
          // "View Timeline & Add Evidence" wanted 169px in a 110px chip at
          // 375px and still overflowed by 45px at 1440. The chip wraps now,
          // but a four-word label in a three-up row is three lines of 11px
          // type — the label carries the same meaning at a third the width,
          // and the full phrasing survives in the spoken name below.
          label="Timeline & Evidence"
          ariaLabel="View dispute timeline and add evidence"
          tone="neutral"
          onClick={() => onViewDispute(job)}
        />
        <JobActionChip
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message poster"
          tone="info"
          onClick={() => navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)}
        />
        <JobActionChip
          icon={AlertTriangle}
          label="Contact Admin"
          ariaLabel="Contact an admin about this dispute"
          tone="neutral"
          onClick={() => navigate("/support")}
        />
      </JobActionRow>
    </div>
  );
}
