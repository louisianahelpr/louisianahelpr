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
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobBudget, userId, hasHelper, open, onClose, onCancelled }: CancellationDialogProps) => {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const jobDateTime = new Date(jobDate + "T00:00:00");
  const hoursUntilJob = (jobDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const isLateCancellation = hoursUntilJob < 24 && hoursUntilJob > 0;
  const isVeryLateCancellation = hoursUntilJob < 2 && hoursUntilJob > 0;

  // Tiered cancellation fee: free 24h+, 25% <24h, 50% <2h
  const cancellationFeePercent = hasHelper
    ? (isVeryLateCancellation ? 50 : isLateCancellation ? 25 : 0)
    : 0;
  const cancellationFee = Math.round((jobBudget * cancellationFeePercent) / 100);

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
          description: `Cancelled job with helpr assigned: "${jobTitle}"${isLateCancellation ? " (late)" : ""}`,
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
            {helperEnRoute ? <ShieldAlert className="w-5 h-5 text-destructive" /> : isLateCancellation ? <AlertTriangle className="w-5 h-5 text-destructive" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
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

            {/* Fee tier explanation */}
            <div className="space-y-2">
              <div className={`flex items-start gap-2.5 p-2.5 rounded-lg ${!isLateCancellation ? "bg-primary/10 border border-primary/20" : "bg-card border border-border"}`}>
                <CheckCircle className={`w-4 h-4 mt-0.5 shrink-0 ${!isLateCancellation ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-xs font-medium text-foreground">24+ hours before job — <span className="text-primary">Free</span></p>
                  <p className="text-[11px] text-muted-foreground">No fee, no penalties.</p>
                </div>
                {!isLateCancellation && <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">YOU</span>}
              </div>

              <div className={`flex items-start gap-2.5 p-2.5 rounded-lg ${isLateCancellation && !isVeryLateCancellation ? "bg-accent/10 border border-accent/20" : "bg-card border border-border"}`}>
                <DollarSign className={`w-4 h-4 mt-0.5 shrink-0 ${isLateCancellation && !isVeryLateCancellation ? "text-accent" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-xs font-medium text-foreground">2–24 hours before — <span className="text-accent">25% fee</span></p>
                  <p className="text-[11px] text-muted-foreground">25% of the job budget goes to the helpr as compensation.</p>
                </div>
                {isLateCancellation && !isVeryLateCancellation && <span className="ml-auto text-[10px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded">YOU</span>}
              </div>

              <div className={`flex items-start gap-2.5 p-2.5 rounded-lg ${isVeryLateCancellation && !helperEnRoute ? "bg-destructive/10 border border-destructive/20" : "bg-card border border-border"}`}>
                <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${isVeryLateCancellation && !helperEnRoute ? "text-destructive" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-xs font-medium text-foreground">Less than 2 hours — <span className="text-destructive">50% fee</span></p>
                  <p className="text-[11px] text-muted-foreground">50% of the job budget. The helpr has already prepared for this job.</p>
                </div>
                {isVeryLateCancellation && !helperEnRoute && <span className="ml-auto text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">YOU</span>}
              </div>

              <div className={`flex items-start gap-2.5 p-2.5 rounded-lg ${helperEnRoute ? "bg-destructive/10 border border-destructive/20" : "bg-card border border-border"}`}>
                <Ban className={`w-4 h-4 mt-0.5 shrink-0 ${helperEnRoute ? "text-destructive" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-xs font-medium text-foreground">Helpr en route / working — <span className="text-destructive">100% fee</span></p>
                  <p className="text-[11px] text-muted-foreground">Full budget goes to the helpr. They're already on their way or working.</p>
                </div>
                {helperEnRoute && <span className="ml-auto text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">YOU</span>}
              </div>
            </div>

            {/* Actual fee for this cancellation */}
            {cancellationFee > 0 && (
              <div className="rounded-lg bg-accent/10 border border-accent/20 p-3 text-center">
                <p className="text-lg font-bold text-foreground">${cancellationFee}</p>
                <p className="text-xs text-muted-foreground">{cancellationFeePercent}% of ${jobBudget} budget</p>
              </div>
            )}
            {cancellationFee === 0 && hasHelper && (
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-center">
                <p className="text-sm font-semibold text-primary">No fee — you're cancelling with plenty of notice ✓</p>
              </div>
            )}
            {!hasHelper && (
              <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-center">
                <p className="text-sm font-semibold text-primary">No fee — no helpr has been assigned yet ✓</p>
              </div>
            )}
          </div>

          {/* Consequences for late cancellations */}
          {isLateCancellation && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Account consequences
              </p>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">1st late cancellation:</strong> Written warning recorded on your account. Admins are notified.</p>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">2nd late cancellation:</strong> 7-day account suspension. You cannot post or accept jobs.</p>
                </div>
                <div className="flex items-start gap-2">
                  <Ban className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                  <p><strong className="text-foreground">3rd late cancellation:</strong> Permanent ban from Helpr. This cannot be reversed.</p>
                </div>
              </div>
              <p className="text-[11px] text-destructive/70 italic">
                This cancellation will be recorded as a late cancellation on your account.
              </p>
            </div>
          )}

          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for cancellation (optional)" rows={2} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Keep Job</Button>
          <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : cancellationFee > 0 ? `Cancel & Pay $${cancellationFee}` : isLateCancellation ? "Cancel Anyway" : "Cancel Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
