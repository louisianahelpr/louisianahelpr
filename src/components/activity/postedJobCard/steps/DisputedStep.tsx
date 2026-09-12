import { AlertTriangle, CheckCircle2, DollarSign, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip, JOB_ACTION_FULL_CLASS, jobActionChipStyle } from "../../JobActionRow";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { PhotoProofGroup } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { posterDisputeControls } from "../posterDisputeControls";
import { disputeSupportSubject } from "@/lib/supportSubject";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 5 — disputed.
 *
 * The mirror of the helper's DisputedSection, in the same shell and the same
 * slot order, so the two ends of one dispute finally read as one screen from
 * both sides: banner in `header`, evidence in `ask`, the money move as the ONE
 * `primary`, and Timeline / Message / Contact Admin in the row.
 *
 * ONE CHANGE OF STRUCTURE, deliberately: Resolve & Pay and Escalate used to be
 * a 2-up row of their own ABOVE a second 3-up row — two action rows in one
 * state, which is the variation this whole pass exists to remove. Resolve & Pay
 * is the money move and is now the step's single full-width primary; Escalate
 * joins the row, beside the other two ways of involving somebody else. Same
 * handlers, same confirms, same gates (`canResolve` / `canEscalate`) — only the
 * arrangement moved.
 */
export function DisputedStep(ctx: PosterStepCtx) {
  const {
    job,
    userId,
    helperNames,
    navigate,
    onViewDispute,
    disputeActing,
    resolveConfirmOpen,
    setResolveConfirmOpen,
    escalateConfirmOpen,
    setEscalateConfirmOpen,
    escalateDispute,
    resolveDisputeAndRelease,
  } = ctx;

  // Controls AND the sentences that describe them come from ONE call — they
  // used to be computed in two places and drifted, promising posters controls
  // they did not have. See posterDisputeControls.ts.
  const { disputeStatus, awaitingAdmin, showDeadline, canResolve, canEscalate, consequenceText, policyText } =
    posterDisputeControls(job, userId);

  const header = (
    <>
      <div className="p-3 rounded-ds-sm bg-destructive/5 border border-destructive/20">
        <p className="text-ds-11 text-[hsl(var(--destructive-ink))] font-medium flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {disputeStatus === "escalated"
            ? "Escalated to Admin"
            : disputeStatus === "resolved"
              ? "Dispute Resolved"
              : "Dispute Under Review"}
        </p>
        <p className="text-ds-11 text-muted-foreground mt-1">
          {awaitingAdmin
            ? "Admin is reviewing this dispute. You'll be notified of the outcome, and nothing is charged or released until then."
            : "Payment is on hold pending resolution."}
        </p>
        {job.dispute_reason && <p className="text-ds-11 text-muted-foreground mt-1">"{job.dispute_reason}"</p>}
        {job.dispute_helper_response && (
          <div className="mt-2 p-2 rounded bg-muted/50">
            <p className="text-ds-10 text-muted-foreground font-medium">Helpr's response:</p>
            <p className="text-ds-11 text-foreground mt-0.5">"{job.dispute_helper_response}"</p>
          </div>
        )}
        {showDeadline && job.dispute_deadline && (
          <DeadlineCountdown
            deadline={job.dispute_deadline}
            expiredText="Deadline passed — payment auto-releasing to Helpr"
            /* Derived from the controls actually on this card, not from the
               happy path — each wording names only moves THIS poster can make,
               and every one still answers "what happens if I do nothing". */
            consequenceText={consequenceText}
            variant="destructive"
          />
        )}
      </div>
      {/* Static fallback ONLY when there is no live deadline to count: with
          `dispute_deadline` present the countdown above says all of this with a
          live number, and the box was the same sentence twice. */}
      {!showDeadline && !awaitingAdmin && (
        <div className="p-2 rounded-ds-sm bg-card">
          {/* ONE hour literal in this file — the window is stated once as a
              shared prefix and the branches say only what THIS poster can do
              inside it. Three copies of "72 hours" in one paragraph would also
              trip escrowTiming.copyParity.test.ts. */}
          <p className="text-ds-10 text-muted-foreground leading-relaxed">
            <strong>Policy:</strong> {policyText} You have 72 hours; if you do nothing, payment auto-releases to the Helpr.
          </p>
        </div>
      )}
    </>
  );

  return (
    <JobStepCard
      side="poster"
      step="disputed"
      header={header}
      ask={
        job.poster_confirmed_working_at ? (
          <PhotoProofGroup
            jobId={job.id}
            beforeUrls={job.proof_before_urls || []}
            afterUrls={job.proof_after_urls || []}
            canUploadBefore={false}
            canUploadAfter={false}
            requireAfter={true}
            budget={job.budget}
          />
        ) : null
      }
      primary={
        /* "Mark Resolved" was a lie of omission: one tap released the ENTIRE
           escrow, and neither the label nor the spoken name mentioned money. It
           is named for its consequence and confirms before it moves anything. */
        canEscalate && canResolve ? (
          <Button
            size="sm"
            variant="outline"
            className={JOB_ACTION_FULL_CLASS}
            style={jobActionChipStyle("approve")}
            disabled={disputeActing}
            aria-label="Resolve & Pay — close this dispute and release the payment to your Helpr"
            onClick={(e) => {
              e.stopPropagation();
              setResolveConfirmOpen(true);
            }}
          >
            <CheckCircle2 className="w-4 h-4" /> Resolve &amp; Pay
          </Button>
        ) : null
      }
      actions={[
        canEscalate ? (
          <JobActionChip
            key="escalate"
            icon={AlertTriangle}
            label="Escalate"
            ariaLabel="Escalate — send this dispute to a Helpr admin to decide"
            tone="danger"
            disabled={disputeActing}
            onClick={(e) => {
              e.stopPropagation();
              setEscalateConfirmOpen(true);
            }}
          />
        ) : null,
        <JobActionChip
          key="timeline"
          icon={AlertTriangle}
          label="Timeline & Evidence"
          ariaLabel="Timeline & Evidence — this dispute's full history, and a place to attach proof"
          tone="neutral"
          onClick={() => onViewDispute(job)}
        />,
        <JobActionChip
          key="message"
          icon={MessageSquare}
          label="Message"
          ariaLabel="Message Helpr"
          tone="message"
          onClick={() => navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)}
        />,
        <JobActionChip
          key="admin"
          icon={AlertTriangle}
          label="Contact Admin"
          ariaLabel="Contact Admin — get help from a Helpr admin about this dispute"
          tone="neutral"
          /* CARRIES THE JOB — `?topic=` and `?subject=` are the two params
             Support.tsx reads, and it carries the job TITLE plus a short id
             rather than a bare UUID nobody recognises. */
          onClick={() => navigate(`/support?topic=report&subject=${encodeURIComponent(disputeSupportSubject(job))}`)}
        />,
      ]}
      dialogs={
        canEscalate ? (
          <>
            {/* Gated alongside its control: a confirm whose primary action the
                server would refuse must not be reachable at all. */}
            {canResolve && (
              <BrandConfirmDialog
                open={resolveConfirmOpen}
                onOpenChange={setResolveConfirmOpen}
                title="Release the payment?"
                description={(() => {
                  // helperNames values are abbreviated ("Hallie H.") and end in
                  // a period whenever the surname is an initial, so a
                  // hard-coded ". You can't" rendered "Hallie H.. You can't".
                  const who = job.helper_id ? helperNames[job.helper_id] || "your Helpr" : "your Helpr";
                  const sentence = `Resolving this dispute closes it and releases the full amount held for this job to ${who}`;
                  return `${sentence.endsWith(".") ? sentence : sentence + "."} You can't reopen this dispute afterwards.`;
                })()}
                callout={{ icon: DollarSign, text: "This moves real money. Only resolve if the issue is actually fixed." }}
                primaryLabel="Release Payment"
                primaryTone="sienna"
                primaryDisabled={disputeActing}
                onPrimary={() => { void resolveDisputeAndRelease(); }}
                secondaryLabel="Cancel"
              />
            )}
            <BrandConfirmDialog
              open={escalateConfirmOpen}
              onOpenChange={setEscalateConfirmOpen}
              title="Send this to an admin?"
              description="A Helpr admin will review the dispute and decide the outcome. Nothing is charged or released until they do, and you won't be able to resolve it yourself afterwards."
              callout={{ icon: AlertTriangle, text: "Use this when you and your Helpr can't settle it between you." }}
              primaryLabel="Escalate to Admin"
              primaryTone="sienna"
              primaryDisabled={disputeActing}
              onPrimary={() => { setEscalateConfirmOpen(false); void escalateDispute(); }}
              secondaryLabel="Cancel"
            />
          </>
        ) : null
      }
    />
  );
}
