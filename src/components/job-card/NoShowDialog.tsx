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
import { fetchPosterCancelQuote } from "@/lib/posterCancelQuote";
import { formatPriceExact } from "@/lib/format";

/** The job the sheet is about: its date and start decide when a report opens (F284). */
export interface NoShowJob {
  id: string;
  date_needed?: string | null;
  start_time?: string | null;
  helper_id?: string | null;
}

export interface NoShowDialogProps {
  jobId: string | null;
  /** The job behind `jobId`, when the page has it. Missing: Confirm stays as before (the server still decides). */
  job?: NoShowJob | null;
  /** The Helpr's display name ("Bea T."), for "<name> gets a strike". */
  helperName?: string | null;
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

/**
 * F272 (owner 11-11): the sheet states the money plainly, and only what the server sends.
 * report_helper_no_show refunds nothing itself: it reopens the job. If the poster picks no new date and nobody new is
 * hired, the job is cancelled (auto-expire-jobs, once its day is past) and void-cancelled-payments refunds it IN FULL,
 * card fee and setup fee included (owner 11-11 ~2:50 PM; noShowFullRefund there). The amount is the server's own
 * quote of that refund (create-payment cancel_quote, asNoShow); with no quote, no number is shown.
 */
export function noShowRefundLine(backCents: number | null): string {
  return backCents !== null && backCents > 0
    ? `If you don't pick a new date, you get a full refund of $${formatPriceExact(backCents / 100)}.`
    : "If you don't pick a new date, you get a full refund.";
}

function useNoShowRefundCents(jobId: string | null): number | null {
  const [cents, setCents] = useState<number | null>(null);
  useEffect(() => {
    setCents(null);
    if (!jobId) return;
    let alive = true;
    void fetchPosterCancelQuote(jobId, { asNoShow: true }).then((q) => {
      if (alive) setCents(typeof q?.back_to_you_cents === "number" ? q.back_to_you_cents : null);
    });
    return () => { alive = false; };
  }, [jobId]);
  return cents;
}

export function NoShowDialog({ jobId, job, helperName, onClose, onConfirm, reporting }: NoShowDialogProps) {
  const known = !!job && job.id === jobId;
  const opensAt = known ? noShowOpensAt(job.date_needed, job.start_time) : null;
  // F284: report_helper_no_show refuses until 30 minutes after the start (20261111202421); the sheet says when
  // it opens and keeps Confirm off until then.
  const open = useOpensAt(opensAt ? opensAt.getTime() : null, !!jobId);
  const waitLine = known && !open ? noShowOpensLine(job.date_needed, job.start_time) : null;
  const refundCents = useNoShowRefundCents(jobId);
  const who = helperName?.trim() || "The Helpr";

  return (
    <Dialog open={!!jobId} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero title="Report no-show" />
        {/* THE HOUSE VOICE, not shadcn's grey default: the serif italic every
            other popup uses. A serif-italic bulleted consequence list is not
            new here: BlockUserDialog renders its effects list the same way. */}
        <DialogBody>
          {waitLine && <p data-testid="no-show-opens-line"><strong>{waitLine}</strong></p>}
          <p data-testid="no-show-outcome">{noShowRefundLine(refundCents)} {who} gets a strike.</p>
          <p>Are you sure the Helpr didn't show up? This will:</p>
          <ul className="space-y-1 list-disc pl-5">
            <li>Go on the Helpr's record — {NO_SHOW_LADDER_SENTENCE}</li>
            <li>Take them off your job. Its start time has passed, so to hire someone else, change the date right away</li>
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
