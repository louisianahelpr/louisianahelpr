import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Ban, ShieldAlert, DollarSign, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";

type CancellationDialogProps = {
  jobId: string;
  jobTitle: string;
  jobDate: string;
  jobBudget: number;
  userId: string;
  hasHelper: boolean;
  helperId?: string | null;
  helperName?: string;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobBudget, userId, hasHelper, helperId, helperName, open, onClose, onCancelled }: CancellationDialogProps) => {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Flat 5% cancellation fee when a helper has been selected, regardless of timing
  const cancellationFeePercent = hasHelper ? 5 : 0;
  const cancellationFee = Math.round((jobBudget * cancellationFeePercent)) / 100;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // Fetch authoritative job data to calculate fee server-side
      const { data: jobData, error: fetchError } = await supabase.from("jobs").select("date_needed, budget, helper_id").eq("id", jobId).single();
      if (fetchError || !jobData) throw new Error("Could not verify job details");

      const serverHasHelper = !!jobData.helper_id;
      const serverFee = serverHasHelper ? Math.round(jobData.budget * 5) / 100 : 0;

      const jobDateTime = new Date(jobData.date_needed + "T00:00:00");
      const serverHoursUntil = (jobDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      const serverIsLate = serverHoursUntil < 24 && serverHoursUntil > 0;

      const updateData: any = {
        status: "cancelled",
        cancelled_by: userId,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason.trim() || null,
        late_cancellation: serverIsLate,
        cancellation_fee: serverFee,
        cancellation_fee_status: serverFee > 0 ? "pending" : null,
      };

      const { error } = await supabase.from("jobs").update(updateData).eq("id", jobId);
      if (error) throw error;

      // Auto-void/refund the held Stripe payment
      try {
        await supabase.functions.invoke("void-cancelled-payments", { body: {} });
      } catch (voidErr) {
        console.warn("Auto-void failed, will be cleaned up by scheduled job:", voidErr);
      }

      // Notify the helper about the cancellation and their compensation
      if (serverHasHelper && jobData.helper_id) {
        const commissionPercent = 10;
        const platformCut = Math.round(serverFee * (commissionPercent / 100) * 100) / 100;
        const helperPayout = Math.max(0, serverFee - platformCut);

        await createNotification({
          user_id: jobData.helper_id,
          title: "Job cancelled — you'll be compensated",
          message: `"${jobTitle}" was cancelled by the poster. You'll receive $${helperPayout.toFixed(2)} as a cancellation fee (5% of the budget minus platform fee).`,
          type: "payment",
          link: "/my-jobs",
        });
      }

      // Track cancellation with helpr assigned — 2 warnings then permanent ban on 3rd
      if (hasHelper) {
        const { data: existing } = await (supabase.from("user_violations" as any) as any)
          .select("id").eq("user_id", userId).eq("violation_type", "cancel_with_helper");
        const priorCount = (existing as any[] | null)?.length || 0;

        let actionTaken = "none";
        if (priorCount >= 2) actionTaken = "permanent_ban";
        else actionTaken = "warning";

        await (supabase.from("user_violations" as any) as any).insert({
          user_id: userId,
          violation_type: "cancel_with_helper",
          description: `Cancelled job with helpr assigned: "${jobTitle}"`,
          job_id: jobId,
          action_taken: actionTaken,
        });

        const warningNum = priorCount + 1;

        if (actionTaken === "warning") {
          await supabase.from("profiles").update({ ban_status: "warned" } as any).eq("user_id", userId);
          await createNotification({
            user_id: userId,
            title: `⚠️ Cancellation Warning (${warningNum}/2)`,
            message: `You've cancelled ${warningNum} job${warningNum > 1 ? "s" : ""} after selecting a helpr. A 3rd cancellation will result in a permanent ban.`,
            type: "warning",
            link: "/profile",
          });
          toast.warning(`Warning ${warningNum}/2: Cancelling after selecting a helpr is tracked. A 3rd time = permanent ban.`);
        } else if (actionTaken === "permanent_ban") {
          await (supabase.from("user_bans" as any) as any).insert({
            user_id: userId, ban_type: "permanent",
            reason: "Cancelled 3 jobs after selecting a helpr", banned_by: userId,
          });
          await supabase.from("profiles").update({ ban_status: "permanently_banned" } as any).eq("user_id", userId);
          toast.error("Your account has been permanently banned due to 3 cancellations after selecting a helpr.");
        }

        // Notify admins
        const { data: adminRoles } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await createNotification({
              user_id: admin.user_id, title: "⚠️ Cancellation with helpr",
              message: `User cancelled "${jobTitle}" after selecting a helpr (${warningNum} total). Action: ${actionTaken}.`,
              type: "warning", link: "/admin",
            });
          }
        }
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Cancel Job
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Are you sure you want to cancel <strong className="text-foreground">"{jobTitle}"</strong>?
          </p>

          {/* Fee breakdown */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">What happens if you cancel</p>

            {hasHelper ? (
              <div className="space-y-2">
                <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-accent/10 border border-accent/20">
                  <DollarSign className="w-4 h-4 mt-0.5 shrink-0 text-accent" />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      5% cancellation fee — <span className="text-accent">${cancellationFee}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      A helpr has been selected for this job. A 5% fee (${cancellationFee} of ${jobBudget}) will be charged and paid to {helperName || "the helpr"} as compensation (minus platform fee).
                    </p>
                  </div>
                </div>

                <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 text-center">
                  <p className="text-lg font-bold text-foreground">${cancellationFee}</p>
                  <p className="text-xs text-muted-foreground">5% of ${jobBudget} budget</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-primary/10 border border-primary/20">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <div>
                  <p className="text-xs font-medium text-foreground">No fee — no helpr has been assigned yet ✓</p>
                  <p className="text-[11px] text-muted-foreground">You can cancel freely before selecting a helpr.</p>
                </div>
              </div>
            )}
          </div>

          {/* Consequences */}
          {hasHelper && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Account consequences
              </p>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">1st cancellation:</strong> Written warning recorded on your account. Admins are notified.</p>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">2nd cancellation:</strong> Final warning. One more = permanent ban.</p>
                </div>
                <div className="flex items-start gap-2">
                  <Ban className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">3rd cancellation:</strong> Permanent ban from Helpr. This cannot be reversed.</p>
                </div>
              </div>
            </div>
          )}

          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancellation (optional)" rows={2} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep Job</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : cancellationFee > 0 ? `Cancel & Pay $${cancellationFee}` : "Cancel Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};