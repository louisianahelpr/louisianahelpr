import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/format";
import { paymentStatusLabel } from "@/lib/statusLabels";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign } from "lucide-react";
import type { Job } from "./types";

interface RefundJobDialogProps {
  open: boolean;
  detailJob: Job | null;
  refundReason: string;
  refundAmount: string;
  refunding: boolean;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RefundJobDialog = ({
  open,
  detailJob,
  refundReason,
  refundAmount,
  refunding,
  onOpenChange,
  onReasonChange,
  onAmountChange,
  onCancel,
  onConfirm,
}: RefundJobDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          eyebrow={
            <>
              <DollarSign className="w-3.5 h-3.5" /> Refund
            </>
          }
          title="Refund Poster"
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            Issues a Stripe refund for the captured payment. Leave the
            amount field blank for a full refund (cancels the job +
            notifies both parties); enter a smaller dollar amount to issue
            a partial refund (job state stays intact). Logged to admin_audit_log.
          </p>
          {detailJob && (
            <div className="rounded-ds-sm bg-secondary/30 p-3 space-y-1">
              <p className="text-ds-11 text-muted-foreground">Refunding</p>
              <p className="text-ds-13 font-medium text-foreground">{detailJob.title}</p>
              <p className="text-ds-11 text-muted-foreground">
                ${detailJob.budget != null ? formatPrice(detailJob.budget) : "—"} · {paymentStatusLabel(detailJob.payment_status)}
                {detailJob.helper_id && " · helper assigned"}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-ds-11 font-medium text-foreground">
              Refund amount <span className="text-muted-foreground font-normal">(blank = full refund)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ds-13 text-muted-foreground pointer-events-none">$</span>
              <input
                type="number"
                aria-label="Refund amount"
                inputMode="decimal"
                step="0.01"
                min="0"
                max={detailJob?.budget || undefined}
                placeholder={detailJob ? `${Number(detailJob.budget).toFixed(2)}` : "0.00"}
                value={refundAmount}
                onChange={(e) => onAmountChange(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-ds-13 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {refundAmount.trim() && Number(refundAmount) > 0 && detailJob && Number(refundAmount) < Number(detailJob.budget) && (
              <p className="text-ds-11 text-muted-foreground">
                Partial refund of ${Number(refundAmount).toFixed(2)} of ${Number(detailJob.budget).toFixed(2)} —
                job stays open, helper not notified.
              </p>
            )}
          </div>
          <Textarea
            aria-label="Refund reason (optional)"
            placeholder="Reason (optional, included in customer notification and audit log)"
            value={refundReason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
          />
          {detailJob?.payment_status === "released" && (
            <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-ds-11 text-destructive font-medium mb-1">⚠️ Money already paid out</p>
              <p className="text-ds-11 text-foreground">
                This payment has already been transferred to the helper.
                Refunding the customer means the platform absorbs the loss
                unless you separately reverse the transfer in Stripe.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={refunding}
          >
            {refunding ? "Refunding…" : "Issue Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
