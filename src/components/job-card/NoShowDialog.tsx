import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
// The consequence this dialog promises is stated ONCE, next to the ladder the
// RPC actually runs (report_helper_no_show → apply_consequence_ladder). This
// bullet used to hard-code "a permanent ban (2nd offense)", which was true of
// the old bespoke ladder and became false the moment migration 20260831183302
// moved the top rung to a reversible 7-day restriction pending admin review.
import { NO_SHOW_LADDER_SENTENCE } from "@/lib/reliabilityLadder";
import { noShowOpensAt, noShowOpensLine } from "@/lib/noShowOpens";

/** The job the sheet is about: its date and start decide when a report opens (F284). */
export interface NoShowJob {
  id: string;
  date_needed?: string | null;
  start_time?: string | null;
}

export interface NoShowDialogProps {
  jobId: string | null;
  /** The job behind `jobId`, when the page has it. Missing: Confirm stays as before (the server still decides). */
  job?: NoShowJob | null;
  onClose: () => void;
  onConfirm: (jobId: string) => void;
  reporting: boolean;
}

/** Re-renders when the report opens, so Confirm turns on without reopening the sheet. */
function useOpensAt(opensAtMs: number | null, active: boolean): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || opensAtMs === null || now >= opensAtMs) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(opensAtMs - now + 50, 60_000));
    return () => clearTimeout(t);
  }, [active, opensAtMs, now]);
  return opensAtMs === null || now >= opensAtMs;
}

export function NoShowDialog({ jobId, job, onClose, onConfirm, reporting }: NoShowDialogProps) {
  const known = !!job && job.id === jobId;
  const opensAt = known ? noShowOpensAt(job.date_needed, job.start_time) : null;
  // F284: report_helper_no_show refuses until 30 minutes after the start (20261111202421); the sheet says when
  // it opens and keeps Confirm off until then.
  const open = useOpensAt(opensAt ? opensAt.getTime() : null, !!jobId);
  const waitLine = known && !open ? noShowOpensLine(job.date_needed, job.start_time) : null;

  return (
    <Dialog open={!!jobId} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero title="Report no-show" />
        {/* THE HOUSE VOICE, not shadcn's grey default: the serif italic every
            other popup uses. A serif-italic bulleted consequence list is not
            new here: BlockUserDialog renders its effects list the same way. */}
        <DialogBody>
          {waitLine && <p data-testid="no-show-opens-line"><strong>{waitLine}</strong></p>}
          <p>Are you sure the Helpr didn't show up? This will:</p>
          <ul className="space-y-1 list-disc pl-5">
            <li>Go on the Helpr's record — {NO_SHOW_LADDER_SENTENCE}</li>
            <li>Take them off your job. Its start time has passed, so to hire someone else, change the date right away. Otherwise it's cancelled and refunded</li>
            <li>Notify the admin team</li>
          </ul>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>Cancel</DialogSecondaryAction>
          <DialogDestructiveAction onClick={() => jobId && onConfirm(jobId)} disabled={reporting || !open}>
            {reporting ? "Reporting…" : "Confirm No-Show"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
