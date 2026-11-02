import { formatPrice } from "@/lib/format";
import { paymentStatusLabel } from "@/lib/statusLabels";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Job } from "./types";
import { HelprFaultFields } from "../helprFault/HelprFaultFields";
import type { HelprFaultKind } from "../helprFault/helprFault";

/** Q2082 (b): the "Helpr at fault" option of the refund (always a full refund). */
export interface RefundHelprFaultState {
  on: boolean;
  helperId: string | null;
  helperName?: string | null;
  loading: boolean;
  kind: HelprFaultKind;
  note: string;
  onToggle: (on: boolean) => void;
  onKindChange: (kind: HelprFaultKind) => void;
  onNoteChange: (note: string) => void;
}

interface RefundJobDialogProps {
  open: boolean;
  detailJob: Job | null;
  refundReason: string;
  refundAmount: string;
  refunding: boolean;
  /** A pending or paid payout_transfers row exists (the server's own test). undefined = unknown. */
  payoutMoved?: boolean;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  helprFault?: RefundHelprFaultState;
}

export const RefundJobDialog = ({
  open,
  detailJob,
  refundReason,
  refundAmount,
  refunding,
  payoutMoved,
  onOpenChange,
  onReasonChange,
  onAmountChange,
  onCancel,
  onConfirm,
  helprFault,
}: RefundJobDialogProps) => {
  // create-payment refuses a FULL refund once a pending or paid
  // payout_transfers row exists; only a partial goodwill refund is allowed.
  // So such a job needs an amount before the refund can be issued. The
  // ledger answer wins; payment_status is only the fallback while unknown.
  const paidOut = payoutMoved ?? detailJob?.payment_status === "released";
  const faultOn = !!helprFault?.on && !paidOut;
  const needsAmount = !faultOn && paidOut && !(refundAmount.trim() && Number(refundAmount) > 0);
  // A Helpr-at-fault refund needs the Helpr and a note before it can be sent.
  const faultIncomplete = faultOn && (!helprFault?.helperId || !helprFault.note.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Refund poster"
        />
        <div className="space-y-3">
          <DialogBody>
            <p>
              Issues a Stripe refund for the captured payment. Leave the
              amount field blank for a full refund (cancels the job +
              notifies both parties); enter a smaller dollar amount to issue
              a partial refund (job state stays intact). Every refund keeps the
              card processing fee Stripe charged (it can&apos;t be returned), and
              a full refund of a first job also keeps its one-time $2 setup fee;
              a partial can be at most what is left after those. Logged to
              admin_audit_log.
            </p>
          </DialogBody>
          {detailJob && (
            <div className="rounded-ds-sm bg-secondary/30 p-3 space-y-1">
              <p className="text-ds-11 text-muted-foreground">Refunding</p>
              <p className="text-ds-13 font-medium text-foreground">{detailJob.title}</p>
              <p className="text-ds-11 text-muted-foreground">
                ${detailJob.budget != null ? formatPrice(detailJob.budget) : "—"} · {paymentStatusLabel(detailJob.payment_status)}
                {detailJob.helper_id && " · Helpr assigned"}
              </p>
            </div>
          )}
          {helprFault && !paidOut && (
            <div className="rounded-ds-sm border border-border p-3 space-y-2">
              <label className="flex min-h-11 items-center gap-2 text-ds-13 font-medium text-foreground">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] min-h-0 min-w-0 shrink-0"
                  style={{ accentColor: "hsl(var(--primary))" }}
                  aria-label="Helpr at fault"
                  checked={helprFault.on}
                  onChange={(e) => helprFault.onToggle(e.target.checked)}
                />
                Helpr at fault (no-show or backout): full refund
              </label>
              {helprFault.on && (
                <HelprFaultFields
                  helperId={helprFault.helperId}
                  helperName={helprFault.helperName}
                  loading={helprFault.loading}
                  kind={helprFault.kind}
                  note={helprFault.note}
                  onKindChange={helprFault.onKindChange}
                  onNoteChange={helprFault.onNoteChange}
                />
              )}
            </div>
          )}
          {!faultOn && (
          <div className="space-y-1.5">
            <label className="text-ds-11 font-medium text-foreground">
              Refund amount <span className="text-muted-foreground font-normal">{paidOut ? "(required: already paid out, partial only)" : "(blank = full refund)"}</span>
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
                job stays open, Helpr not notified.
              </p>
            )}
          </div>
          )}
          <Textarea
            aria-label="Refund reason (optional)"
            placeholder="Reason (optional, included in customer notification and audit log)"
            value={refundReason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
          />
          {paidOut && (
            <div className="rounded-ds-sm bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-ds-11 text-[hsl(var(--destructive-ink))] font-medium mb-1">⚠️ Money already paid out</p>
              <p className="text-ds-11 text-foreground">
                This payment has already been transferred to the Helpr, so
                only a partial refund can be issued. The platform absorbs it
                unless you separately reverse the transfer in Stripe.
              </p>
            </div>
          )}
        </div>
        {/* `ghost` — a secondary sitting beside a primary is bare text in every
            other dialog footer in the app; `outline` is reserved for a footer
            whose only control is the dismiss. `gap-2` restated DialogFooter's
            own gap. */}
        <DialogFooter>
          <DialogSecondaryAction onClick={onCancel}>
            Cancel
          </DialogSecondaryAction>
          <DialogDestructiveAction
            onClick={onConfirm}
            disabled={refunding || needsAmount || faultIncomplete}
          >
            {refunding ? "Refunding…" : faultOn ? "Refund (Helpr at fault)" : "Issue Refund"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
