import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type CancellationDialogProps = {
  jobId: string;
  jobTitle: string;
  jobDate: string;
  userId: string;
  hasHelper: boolean;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, userId, hasHelper, open, onClose, onCancelled }: CancellationDialogProps) => {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Check if cancellation is within 24 hours of the job date
  const jobDateTime = new Date(jobDate + "T00:00:00");
  const hoursUntilJob = (jobDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const isLateCancellation = hoursUntilJob < 24 && hoursUntilJob > 0;

  // Cancellation fee logic
  const cancellationFee = hasHelper
    ? (hoursUntilJob < 4 ? 15 : isLateCancellation ? 5 : 0)
    : 0;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const updateData: any = {
        status: "cancelled",
        cancelled_by: userId,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason.trim() || null,
        late_cancellation: isLateCancellation,
        cancellation_fee: cancellationFee,
        cancellation_fee_status: cancellationFee > 0 ? "pending" : null,
      };

      const { error } = await supabase.from("jobs").update(updateData).eq("id", jobId);
      if (error) throw error;

      // Log late cancellation as violation
      if (isLateCancellation) {
        // Check prior late cancellations
        const { data: existing } = await (supabase.from("user_violations" as any) as any)
          .select("id").eq("user_id", userId).eq("violation_type", "late_cancellation");
        const priorCount = (existing as any[] | null)?.length || 0;

        await (supabase.from("user_violations" as any) as any).insert({
          user_id: userId, violation_type: "late_cancellation",
          description: `Late cancellation (within 24h) for job: ${jobTitle}`,
          job_id: jobId, action_taken: priorCount >= 1 ? "permanent_ban" : "warning",
        });

        if (priorCount >= 1) {
          await (supabase.from("user_bans" as any) as any).insert({
            user_id: userId, ban_type: "permanent",
            reason: "Repeated late cancellations", banned_by: userId,
          });
          await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", userId);
        }

        // Notify admins
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabase.from("notifications").insert({
              user_id: admin.user_id, title: "⚠️ Late cancellation",
              message: `User cancelled "${jobTitle}" within 24 hours of the job date.${priorCount >= 1 ? " Auto-banned." : " Warning issued."}`,
              type: "warning", link: "/admin",
            });
          }
        }

        toast.warning("Job cancelled. Note: Cancelling within 24 hours of the job date has been recorded.");
      } else {
        toast.success("Job cancelled successfully.");
      }

      onCancelled();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel job");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            {isLateCancellation && <AlertTriangle className="w-5 h-5 text-destructive" />}
            Cancel Job
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isLateCancellation && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-3">
              <p className="text-sm text-destructive font-medium">⚠️ Late Cancellation Warning</p>
              <p className="text-xs text-muted-foreground mt-1">
                This job is within 24 hours. Late cancellations are tracked. A second late cancellation will result in a permanent ban.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel "{jobTitle}"?
          </p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancellation (optional)" rows={2} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep Job</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : isLateCancellation ? "Cancel Anyway" : "Cancel Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
