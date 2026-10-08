import { CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCallout,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";

/** What the pop-up reports: the job, and whether the server held the note back. */
export type ApplicationSent = { jobId: string; title: string | null; noteWithheld: boolean };

/**
 * AFTER AN APPLY, A POP-UP, NOT A TOAST (owner, 2026-10-08, Q1550: "once they
 * apply a screen like this should pop up not a toast at the bottom"). Says it
 * went, what happens next, and where to find it; the withheld-note warning the
 * toast carried lives here too.
 */
export function ApplicationSentDialog({
  sent,
  onClose,
  onView,
}: {
  sent: ApplicationSent | null;
  onClose: () => void;
  onView: (jobId: string) => void;
}) {
  return (
    <Dialog open={!!sent} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHero title="Application Sent" />
        <DialogBody>
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-10 w-10" style={{ color: "hsl(var(--success-ink))" }} aria-hidden />
            <DialogDescription className="text-ds-14">
              {sent?.title ? <>You applied to <strong>{sent.title}</strong>. </> : null}
              The person who posted it will look at your application and can send you an offer. We'll let
              you know when they do.
            </DialogDescription>
          </div>
          {sent?.noteWithheld ? (
            <DialogCallout>
              Your note wasn't included: it looked like contact or payment details, which can't be shared
              before a job is confirmed. They see your application without it.
            </DialogCallout>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Keep Browsing</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => { if (sent) onView(sent.jobId); onClose(); }}>View in My Jobs</DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
