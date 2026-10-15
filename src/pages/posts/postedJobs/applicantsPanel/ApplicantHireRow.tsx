import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageApplicantButton } from "@/components/jobs/MessageApplicantButton";
import { hapticLight } from "@/lib/haptics";

/**
 * A pending applicant's Message, Hire, decline (x) row on the poster's
 * Applicants card. Message sits immediately left of Hire (owner, 2026-10-14:
 * "message should be to the left of hire"). From `sm` (640px) up the row sits
 * beside the name in the card's right column; below it (owner, 2026-10-15) the
 * row is its own full-width line UNDER the name and note, Message and Hire
 * sharing the width, x keeping its size. The card dissolves its right column
 * below `sm` so this row's `basis-full` wraps it onto that line (ApplicantsPanel).
 * Guard: messageLeftOfHire.test.tsx.
 */
export function ApplicantHireRow({
  jobId,
  helperId,
  helperName,
  payoutReady,
  onAcceptApplication,
  onDecline,
}: {
  jobId: string;
  helperId: string;
  helperName: string;
  payoutReady: boolean;
  onAcceptApplication: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1">
      {/* A pending applicant is always messageable (MESSAGEABLE_APPLICATION_STATUSES); poster-first, see MessageApplicantButton. */}
      <MessageApplicantButton jobId={jobId} helperId={helperId} helperName={helperName} className="flex-1 sm:flex-none" />
      <Button
        variant="primary"
        size="sm"
        className="rounded-ds-md btn-press flex-1 sm:flex-none"
        // Never disabled for the Helpr's Stripe state:
        // a single job's Hire is an offer, and payout
        // setup + Stripe ID are asked at their Accept
        // (20261003193541). A crew hire's roster-gate
        // refusal comes back as a toast naming the reason
        // (useOfferHandlers), which beats a dead control.
        aria-label={payoutReady ? `Select ${helperName}` : `Select ${helperName} — payout setup not finished yet`}
        onClick={() => onAcceptApplication()}
      >
        Hire
      </Button>
      <button
        type="button"
        aria-label={`Decline ${helperName}`}
        onClick={() => {
          hapticLight();
          onDecline();
        }}
        className="w-8 h-8 rounded-ds-sm flex items-center justify-center active:opacity-60 transition-opacity"
        style={{
          background: "hsl(var(--olivewood) / 0.08)",
          border: "0.5px solid hsl(var(--olivewood) / 0.2)",
        }}
      >
        <X className="w-3.5 h-3.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
      </button>
    </div>
  );
}
