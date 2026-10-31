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
  onAcceptApplication,
  onDecline,
}: {
  jobId: string;
  helperId: string;
  helperName: string;
  onAcceptApplication: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1 order-2">
      {/* A pending applicant is always messageable (MESSAGEABLE_APPLICATION_STATUSES); poster-first, see MessageApplicantButton. */}
      <MessageApplicantButton jobId={jobId} helperId={helperId} helperName={helperName} className="flex-1 sm:flex-none" />
      <Button
        variant="primary"
        size="sm"
        className="btn-press flex-1 sm:flex-none"
        // Never disabled for the Helpr's Stripe state:
        // a single job's Hire is an offer, and payout
        // setup + Stripe ID are asked at their Accept
        // (20261003193541). A crew hire's roster-gate
        // refusal comes back as a toast naming the reason
        // (useOfferHandlers), which beats a dead control.
        aria-label={`Hire ${helperName}`}
        onClick={() => onAcceptApplication()}
      >
        Hire
      </Button>
      {/* Round like every button (owner 2026-10-29: the grey square x next to Hire): the shared outline Button,
          Hire's own height (sm, 44px), a circle because it is as wide as it is tall. */}
      <Button
        type="button"
        variant="outline" size="sm"
        className="w-11 shrink-0 px-0"
        aria-label={`Decline ${helperName}`}
        onClick={() => {
          hapticLight();
          onDecline();
        }}
      >
        <X style={{ color: "hsl(var(--olivewood) / 0.8)" }} aria-hidden="true" />
      </Button>
    </div>
  );
}
