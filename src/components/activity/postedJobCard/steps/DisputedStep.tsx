import { useState } from "react";
import { AlertTriangle, CheckCircle2, DollarSign, History, Image, LifeBuoy, MessageSquare } from "lucide-react";
import { JobStepCard } from "@/components/activity/JobStepCard";
import { JobActionChip, JobStepPrimaryButton } from "../../JobActionRow";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { PhotoProofDialog, PhotoProofRequirementNote } from "@/components/PhotoProof";
import DeadlineCountdown from "@/components/activity/DeadlineCountdown";
import { posterDisputeControls } from "../posterDisputeControls";
import { disputeSupportSubject } from "@/lib/supportSubject";
import type { PosterStepCtx } from "./posterStepContract";

/**
 * POSTER STEP 5 — disputed.
 *
 * The mirror of the helper's DisputedSection, in the same shell and the same
 * slot order, so the two ends of one dispute finally read as one screen from
 * both sides: banner in `header`, the money move as the ONE `primary`, and
 * Photos / Timeline / Message / Contact Admin in the row. (The evidence used
 * to fill `ask` as a panel above the row — owner item 10, 2026-09-19 made
 * "before & after pictures" a button on the row like the rest.)
 *
 * ONE CHANGE OF STRUCTURE, deliberately: Resolve & Pay and Escalate used to be
 * a 2-up row of their own ABOVE a second 3-up row — two action rows in one
 * state, which is the variation this whole pass exists to remove. Resolve & Pay
 * is the money move and is now the step's single primary, leading the one row
 * (owner, 2026-09-14, VN-21); Escalate joins the row, beside the other two ways of involving somebody else. Same
 * handlers, same confirms, same gates (`canResolve` / `canEscalate`) — only the
 * arrangement moved.
 */
export function DisputedStep(ctx: PosterStepCtx) {
  const [photosOpen, setPhotosOpen] = useState(false);
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
  const hasProof = (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;

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
      primary={
        /* "Mark Resolved" was a lie of omission: one tap released the ENTIRE
           escrow, and neither the label nor the spoken name mentioned money. It
           is named for its consequence and confirms before it moves anything. */
        /* It leads the card's ONE action row in the row's dark green (owner,
           2026-09-14, VN-21), Escalate / Timeline / Message / Contact Admin
           beside it. Still confirms before anything moves. */
        canEscalate && canResolve ? (
          <JobStepPrimaryButton
            icon={CheckCircle2}
            label="Resolve & Pay"
            ariaLabel="Resolve & Pay — close this dispute and release the payment to your Helpr"
            disabled={disputeActing}
            onClick={(e) => {
              e.stopPropagation();
              setResolveConfirmOpen(true);
            }}
          />
        ) : null
      }
      notice={
        /* The red requirement line survives the move to a chip. Item 10 sent
           the photo PANEL away, and the dialog that replaced it shows photos
           and nothing else — so this card, of all cards, lost the sentence
           saying the proof is short. A poster deciding a dispute is deciding on
           exactly that. It renders itself only when the proof is actually
           missing, so it is mounted unconditionally. */
        /* AUDIENCE: the poster (owner, 2026-09-19). This printed the HELPER's
           sentence — "Before & after photos are required — they're the proof
           that releases YOUR payment" — on the screen of the person the money
           leaves, next to a row with no way to file a photo, because the
           poster is not who uploads work proof. The rule and the missing-proof
           test are untouched (one definition, src/lib/photoProofPolicy.ts);
           only the sentence is aimed at the reader. The control that satisfies
           it is on the Helpr's card, which carries this chip on its disputed
           AND revision steps as of today. */
        <PhotoProofRequirementNote
          audience="poster"
          budget={job.budget}
          beforeUrls={job.proof_before_urls || []}
          afterUrls={job.proof_after_urls || []}
        />
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
        /* THE PROOF PHOTOS, on the row (owner item 10, 2026-09-19). They used
           to be a two-column panel above it, gated on
           `poster_confirmed_working_at`; the chip is gated on there being
           photos instead, because a chip is a tap and an empty gallery is a
           dead end. NOTE what that drops with the panel: its red "before &
           after photos are required" line, which appeared when a disputed job
           was missing required proof. Reported, not re-invented — the dialog
           this opens shows the photos and nothing else (PhotoProofDialog). */
        hasProof ? (
          <JobActionChip
            key="photos"
            icon={Image}
            label="Photos"
            ariaLabel="Photos — the before and after proof photos filed on this job"
            tone="neutral"
            onClick={() => setPhotosOpen(true)}
          />
        ) : null,
        /* Distinct ICONS for the three non-message chips (was one
           AlertTriangle each). On the one row at 375 these chips are
           icon-only (VN-21), and three identical triangles were three
           buttons nobody could tell apart. */
        <JobActionChip
          key="timeline"
          icon={History}
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
          icon={LifeBuoy}
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
        <>
          <PhotoProofDialog
            open={photosOpen}
            onOpenChange={setPhotosOpen}
            beforeUrls={job.proof_before_urls || []}
            afterUrls={job.proof_after_urls || []}
          />
          {canEscalate ? (
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
          ) : null}
        </>
      }
    />
  );
}
