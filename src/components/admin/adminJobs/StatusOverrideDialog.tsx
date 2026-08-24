import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { History as HistoryIcon } from "lucide-react";
import { jobStatusLabel } from "@/lib/statusLabels";
import type { Job } from "./types";

type OverrideStatus = "open" | "completed" | "cancelled";

interface StatusOverrideDialogProps {
  open: boolean;
  detailJob: Job | null;
  overrideStatus: OverrideStatus;
  overrideReason: string;
  overriding: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange: (status: OverrideStatus) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const StatusOverrideDialog = ({
  open,
  detailJob,
  overrideStatus,
  overrideReason,
  overriding,
  onOpenChange,
  onStatusChange,
  onReasonChange,
  onCancel,
  onConfirm,
}: StatusOverrideDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          eyebrow={
            <>
              <HistoryIcon className="w-3.5 h-3.5" /> Status override
            </>
          }
          title="Manual Status Override"
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            Force the job into a different status. Logged to admin_audit_log and
            both parties are notified.
            {detailJob && <> Current: <strong className="text-foreground">{jobStatusLabel(detailJob.status)}</strong>.</>}
          </p>
          <div className="space-y-1.5">
            <p className="text-ds-11 font-semibold uppercase tracking-wide text-muted-foreground">Set status to</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "open", label: "Re-open", tone: "border-primary/40 bg-primary/10 text-primary" },
                { id: "completed", label: "Mark complete", tone: "border-primary/40 bg-primary/10 text-primary" },
                { id: "cancelled", label: "Cancel", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
              ] as const).map((opt) => {
                const active = overrideStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onStatusChange(opt.id)}
                    className={`p-2 rounded-ds-md border text-ds-11 font-medium transition-colors ${
                      active ? opt.tone : "border-border bg-card hover:bg-secondary/30"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-ds-10 text-muted-foreground italic">
              Refunds aren't issued automatically — use the Refund Customer
              button if money also needs to move.
            </p>
          </div>
          <Textarea
            aria-label="Reason for status override"
            placeholder="Required — explain why this status is being forced."
            value={overrideReason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={overriding || !overrideReason.trim()}
          >
            {overriding ? "Updating…" : `Set to ${overrideStatus}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
