import { MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { hapticLight } from "@/lib/haptics";

/**
 * The poster's "Message" on one applicant (owner, 2026-10-11: "someone sent a
 * question in their application and I couldn't answer them ... add a message
 * button for the poster to message applicants").
 *
 * POSTER-FIRST, NOT APPLICANT-FIRST (docs/JOB-LIFECYCLE.md rule 4). This
 * control exists only on the poster's applicant lists; the applicant side gets
 * no Message until the poster writes. The server already enforces both halves
 * (measured live 2026-10-11 with pg_get_functiondef): can_send_message_to_in_job
 * admits an applicant as a receiver only when the caller is the job's poster,
 * and can_message_in_job admits an applicant as a sender only after the poster
 * has messaged them AND while their application is pending or accepted.
 *
 * It opens the thread through the same deep link every job-card Message uses
 * (`/messages?jobId=&userId=`): an existing thread opens with its history, and
 * a new one opens as a placeholder the poster's first message creates
 * (useMessagesData's deep-link effect, buildDeepLinkPlaceholder).
 */

/** Application statuses the server still treats as on the job (is_off_job's
 *  live-application clause). Anyone else is refused as a receiver, so a
 *  Message for them would open a thread whose send bounces. Bound to the
 *  migration by src/test/posterMessagesApplicants.test.ts. */
export const MESSAGEABLE_APPLICATION_STATUSES = ["pending", "accepted"] as const;

export function canMessageApplicant(status: string | null | undefined): boolean {
  return (MESSAGEABLE_APPLICATION_STATUSES as readonly string[]).includes(status ?? "");
}

export function applicantThreadPath(jobId: string, helperId: string): string {
  return `/messages?jobId=${encodeURIComponent(jobId)}&userId=${encodeURIComponent(helperId)}`;
}

interface MessageApplicantButtonProps {
  jobId: string;
  helperId: string;
  helperName: string;
  /** "card": the Applicants screen's control column (outline, beside Hire).
   *  "row": SeriesDatesPanel's compact applicant row (its own chip style). */
  appearance?: "card" | "row";
  className?: string;
}

export function MessageApplicantButton({
  jobId,
  helperId,
  helperName,
  appearance = "card",
  className,
}: MessageApplicantButtonProps) {
  const navigate = useNavigate();
  const open = () => {
    hapticLight();
    navigate(applicantThreadPath(jobId, helperId));
  };
  if (appearance === "row") {
    return (
      <button
        type="button"
        aria-label={`Message ${helperName}`}
        onClick={open}
        className={`min-h-[44px] px-3 rounded-ds-md text-ds-11 font-semibold border border-border inline-flex items-center gap-1 ${className ?? ""}`}
      >
        <MessageCircle className="w-3.5 h-3.5" aria-hidden />
        Message
      </button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Message ${helperName}`}
      onClick={open}
      className={`rounded-ds-md px-3 ${className ?? ""}`}
    >
      <MessageCircle aria-hidden />
      Message
    </Button>
  );
}
