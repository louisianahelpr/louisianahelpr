import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Ban, ShieldAlert, DollarSign, CheckCircle, Clock, ArrowRight } from "lucide-react";
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

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobBudget, userId, hasHelper, helperId: _helperId, helperName, open, onClose, onCancelled }: CancellationDialogProps) => {
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Tiered cancellation fee (only applies once a helpr has been selected):
  //   • 24+ hours before job  → 0%   (free cancellation)
  //   • Less than 24 hours    → 25%  (helpr has committed time)
  //   • Less than 2 hours     → 50%  (very late cancellation)
  const jobDateTime = new Date(jobDate + "T00:00:00");
  const hoursUntilJob = (jobDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
  const cancellationFeePercent = !hasHelper
    ? 0
    : hoursUntilJob < 2
    ? 50
    : hoursUntilJob < 24
    ? 25
    : 0;
  const feeTier = cancellationFeePercent === 50
    ? "Less than 2 hours before job"
    : cancellationFeePercent === 25
    ? "Less than 24 hours before job"
    : "24+ hours before job";
  const cancellationFee = Math.round(jobBudget * cancellationFeePercent) / 100;
  const platformCut = Math.round(cancellationFee * 10) / 100;
  const helperPayout = Math.max(0, Math.round((cancellationFee - platformCut) * 100) / 100);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // Fetch authoritative job data to calculate fee server-side
      const { data: jobData, error: fetchError } = await supabase.from("jobs").select("date_needed, budget, helper_id").eq("id", jobId).single();
      if (fetchError || !jobData) throw new Error("Could not verify job details");

      const serverHasHelper = !!jobData.helper_id;
      const serverJobDateTime = new Date(jobData.date_needed + "T00:00:00");
      const serverHoursUntil = (serverJobDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      const serverFeePercent = !serverHasHelper
        ? 0
        : serverHoursUntil < 2
        ? 50
        : serverHoursUntil < 24
        ? 25
        : 0;
      const serverFee = Math.round(jobData.budget * serverFeePercent) / 100;
      const serverIsLate = serverHoursUntil < 24 && serverHoursUntil > 0;

      const updateData = {
        status: "cancelled" as const,
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
        report(voidErr, { severity: "warning", tags: { source: "CancellationDialog.autoVoid" } });
      }

      // Notify the helper about the cancellation and their compensation
      if (serverHasHelper && jobData.helper_id && serverFee > 0) {
        const commissionPercent = 10;
        const platformCut = Math.round(serverFee * (commissionPercent / 100) * 100) / 100;
        const helperPayout = Math.max(0, serverFee - platformCut);

        await createNotification({
          user_id: jobData.helper_id,
          title: "Job cancelled — you'll be compensated",
          message: `"${jobTitle}" was cancelled by the poster. You'll receive $${helperPayout.toFixed(2)} as a cancellation fee (${serverFeePercent}% of the budget minus platform fee).`,
          type: "payment",
          link: "/my-jobs",
        });
      }

      // Track cancellation with helpr assigned — 2 warnings then permanent ban on 3rd
      if (hasHelper) {
        // Tables `user_violations` and `user_bans` aren't in the generated
        // Supabase types yet, so we use `unknown` casts to bypass typing
        // without resorting to `any`.
        const supabaseUntyped = supabase as unknown as {
          from: (table: string) => {
            select: (cols: string) => {
              eq: (col: string, val: string) => {
                eq: (col: string, val: string) => Promise<{ data: { id: string }[] | null }>;
              };
            };
            insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
          };
        };
        const { data: existing } = await supabaseUntyped
          .from("user_violations")
          .select("id")
          .eq("user_id", userId)
          .eq("violation_type", "cancel_with_helper");
        const priorCount = existing?.length ?? 0;

        let actionTaken = "none";
        if (priorCount >= 2) actionTaken = "permanent_ban";
        else actionTaken = "warning";

        await supabaseUntyped.from("user_violations").insert({
          user_id: userId,
          violation_type: "cancel_with_helper",
          description: `Cancelled job with helpr assigned: "${jobTitle}"`,
          job_id: jobId,
          action_taken: actionTaken,
        });

        const warningNum = priorCount + 1;

        if (actionTaken === "warning") {
          await supabase.from("profiles").update({ ban_status: "warned" }).eq("user_id", userId);
          await createNotification({
            user_id: userId,
            title: `⚠️ Cancellation Warning (${warningNum}/2)`,
            message: `You've cancelled ${warningNum} job${warningNum > 1 ? "s" : ""} after selecting a helpr. A 3rd cancellation will result in a permanent ban.`,
            type: "warning",
            link: "/profile",
          });
          toast.warning(`Warning ${warningNum}/2: Cancelling after selecting a helpr is tracked. A 3rd time = permanent ban.`);
        } else if (actionTaken === "permanent_ban") {
          await supabaseUntyped.from("user_bans").insert({
            user_id: userId, ban_type: "permanent",
            reason: "Cancelled 3 jobs after selecting a helpr", banned_by: userId,
          });
          await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", userId);
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to cancel job";
      toast.error(message);
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

          {/* Full Cancellation Policy */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Full Cancellation Policy</p>

            {/* Step 1: Before helpr selected */}
            <div className={`flex items-start gap-2.5 p-3 rounded-lg border transition-all ${!hasHelper ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20" : "bg-muted/20 border-border opacity-50"}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${!hasHelper ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>1</div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-semibold text-foreground">Before a helpr is selected</p>
                  {!hasHelper && <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">Cancel anytime with no fee. You&apos;ll receive a full refund.</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-[11px] text-primary font-medium">$0 fee · Full refund · No consequences</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center"><ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 rotate-90" /></div>

            {/* Step 2: After helpr selected */}
            <div className={`p-3 rounded-lg border space-y-2 transition-all ${hasHelper ? "bg-accent/10 border-accent/30 ring-1 ring-accent/20" : "bg-muted/20 border-border opacity-50"}`}>
              <div className="flex items-start gap-2.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${hasHelper ? "bg-accent text-accent-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>2</div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-semibold text-foreground">After a helpr is selected</p>
                    {hasHelper && <span className="text-[10px] font-bold bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Cancellation fees are <strong className="text-foreground">tiered by timing</strong> to compensate the helpr for their committed time:
                  </p>
                  <ul className="text-[11px] text-muted-foreground mt-1 space-y-0.5 list-disc list-inside">
                    <li><strong className="text-foreground">24+ hours before:</strong> 0% (free)</li>
                    <li><strong className="text-foreground">Less than 24 hours:</strong> 25% fee</li>
                    <li><strong className="text-foreground">Less than 2 hours:</strong> 50% fee</li>
                  </ul>
                  {hasHelper && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <DollarSign className="w-3 h-3 text-accent shrink-0" />
                      <span className="text-[11px] text-accent font-medium">
                        {feeTier} → {cancellationFeePercent}% fee · Strike recorded
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {hasHelper && cancellationFee > 0 && (
                <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5 ml-7">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Your fee breakdown</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Cancellation fee ({cancellationFeePercent}% of ${jobBudget.toFixed(2)})</span>
                    <span className="font-semibold text-foreground">${cancellationFee.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Platform fee (10%)</span>
                    <span className="text-muted-foreground">−${platformCut.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between text-xs">
                    <span className="text-muted-foreground">{helperName || "Helpr"} receives</span>
                    <span className="font-semibold text-primary">${helperPayout.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {hasHelper && cancellationFee === 0 && (
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 ml-7 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-[11px] text-primary font-medium">
                    Free cancellation — more than 24 hours until the job starts.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Strike system — always visible */}
          <div className={`rounded-xl border p-4 space-y-3 ${hasHelper ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/20 opacity-60"}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 ${hasHelper ? "text-destructive" : "text-muted-foreground"}`}>
              <ShieldAlert className="w-3.5 h-3.5" /> Strike System (applies when helpr is selected)
            </p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                <p><strong className="text-foreground">1st strike:</strong> Written warning on your account. Admins notified.</p>
              </div>
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                <p><strong className="text-foreground">2nd strike:</strong> Final warning. One more cancellation = permanent ban.</p>
              </div>
              <div className="flex items-start gap-2">
                <Ban className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                <p><strong className="text-foreground">3rd strike:</strong> Permanent ban from Helpr. This cannot be undone.</p>
              </div>
            </div>
            {!hasHelper && (
              <p className="text-[11px] text-muted-foreground italic">✓ These consequences don&apos;t apply to you — no helpr has been selected.</p>
            )}
          </div>

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