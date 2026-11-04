import { useNavigate } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PosterCancelFeeLine } from "./PosterCancelFeeLine";
import type { PostedJobCardProps } from "./types";

/** A cancelled posted job, expanded: the fee line (when a fee was recorded) and Re-Post. Moved out of PostedJobCard (Q806). */
export function PostedCancelledBlock({ job, userId }: { job: PostedJobCardProps["job"]; userId: string }) {
  const navigate = useNavigate();
  return (
    <div className="space-y-1.5">
      {/* The "Cancelled" pill that used to lead this row is gone —
          the full-width status stripe at the top of the card now
          says it, in the same destructive tint. Only the fee badge
          (which the stripe does NOT carry) remains. */}
      {/* NO PILL. Owner, 2026-09-12: "no pills" — and when asked
          whether this one should survive because it states money
          rather than job state, "remove it too, no pills means
          none". The FACT does not vanish with the pill: a charged
          cancellation fee with nothing on the card saying so would
          be a worse defect than the pill ever was. It is a plain
          money line now, in the card's own type, which is where a
          currency amount belongs anyway.

          Keeping `tabular-nums`: the digits still have to align
          with the other money on the card. And still no glyph —
          `feeAmt` already carries the symbol, which is what
          produced the doubled "$ Fee $12.50" the owner reported. A
          currency symbol is typography; it belongs in the same text
          node as the digits, never beside them as an icon. */}
      {/* Q1916: "charged" only when a card paid it; a gift-funded fee says so (PosterCancelFeeLine). */}
      {job.cancellation_fee != null && job.cancellation_fee > 0 && job.cancellation_fee_status && (
        <PosterCancelFeeLine jobId={job.id} fee={job.cancellation_fee} status={job.cancellation_fee_status} posterId={userId} />
      )}
      {/* Re-post CTA — all cancelled / expired jobs.
          Navigates to /post-job?rebook=<id> which pre-fills
          every field except the date (date must be in the
          future; old date is intentionally skipped). */}
      <Button
        size="sm"
        variant="primary"
        className="w-full mt-2"
        onClick={(e) => { e.stopPropagation(); navigate(`/post-job?rebook=${job.id}`); }}
      >
        <RotateCcw className="w-4 h-4 mr-1.5" />
        Re-Post this job
      </Button>
    </div>
  );
}
