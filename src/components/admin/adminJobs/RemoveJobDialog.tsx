import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import type { Job } from "./types";

interface RemoveJobDialogProps {
  open: boolean;
  detailJob: Job | null;
  deleteReason: string;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RemoveJobDialog = ({
  open,
  detailJob,
  deleteReason,
  deleting,
  onOpenChange,
  onReasonChange,
  onCancel,
  onConfirm,
}: RemoveJobDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          eyebrow={
            <>
              <Trash2 className="w-3.5 h-3.5" /> Remove job
            </>
          }
          eyebrowClassName="inline-flex items-center gap-1.5"
          title="Remove Job"
        />
        <div className="space-y-3">
          <p className="text-ds-11 text-muted-foreground">
            This will cancel the job and notify the poster{detailJob?.helper_id ? " and assigned helper" : ""}. Please provide a reason:
          </p>
          <Textarea
            aria-label="Reason for cancelling job"
            placeholder="e.g. This listing violates our community guidelines…"
            value={deleteReason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={3}
          />
          {detailJob && (
            <div className="rounded-ds-sm bg-secondary/30 p-3">
              <p className="text-ds-11 text-muted-foreground">Job being removed</p>
              <p className="text-ds-13 font-medium text-foreground">{detailJob.title}</p>
              <p className="text-ds-11 text-muted-foreground">${detailJob.budget} · {detailJob.location}</p>
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
            disabled={!deleteReason.trim() || deleting}
          >
            {deleting ? "Removing…" : "Remove & Notify"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
