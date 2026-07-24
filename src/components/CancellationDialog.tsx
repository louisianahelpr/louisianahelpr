import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Ban, ShieldAlert, DollarSign, CheckCircle, Clock, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import { formatPrice } from "@/lib/format";

type CancellationDialogProps = {
  jobId: string;
  jobTitle: string;
  jobDate: string;
  jobBudget: number;
  userId: string;
  hasHelper: boolean;
  helperId?: string | null;
  helperName?: string;
  /** Commission % frozen on the job row (`jobs.helper_fee_percent`). The
   * actual transfer resolves the helper's live tier server-side
   * (void-cancelled-payments); this drives the client estimate so the
   * breakdown matches the canonical `job.helper_fee_percent ?? 10` pattern
   * instead of a hardcoded 10%. */
  helperFeePercent?: number | null;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobBudget, userId, hasHelper, helperId: _helperId, helperName, helperFeePercent, open, onClose, onCancelled }: CancellationDialogProps) => {
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
  const commissionPercent = helperFeePercent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
  const platformCut = Math.round(cancellationFee * commissionPercent) / 100;
  const helperPayout = Math.max(0, Math.round((cancellationFee - platformCut) * 100) / 100);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // Fetch authoritative job data to calculate fee server-side
      const { data: jobData, error: fetchError } = await supabase.from("jobs").select("date_needed, budget, helper_id, helper_fee_percent").eq("id", jobId).single();
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

      // The held Stripe payment is NOT voided here: void-cancelled-payments
      // only accepts cron/service-role auth (a client JWT gets a 401 — a
      // previous invoke from here failed on every call and was removed). The
      // hourly cron sweeps jobs with cancellation_fee_status='pending' and
      // processes the refund, so it lands within ~an hour of cancelling.

      // Notify the helper about the cancellation and their compensation.
      // The amount is an ESTIMATE from the job-frozen fee percent — the
      // actual transfer (void-cancelled-payments) resolves the helper's live
      // tier, which can differ (e.g. Elite 8% vs frozen 10%).
      if (serverHasHelper && jobData.helper_id && serverFee > 0) {
        const commissionPercent = jobData.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
        const platformCut = Math.round(serverFee * (commissionPercent / 100) * 100) / 100;
        const helperPayout = Math.max(0, serverFee - platformCut);

        await createNotification({
          user_id: jobData.helper_id,
          title: "Job cancelled — you'll be compensated",
          message: `"${jobTitle}" was cancelled by the poster. You'll receive approximately $${helperPayout.toFixed(2)} as a cancellation fee (${serverFeePercent}% of the budget minus platform fee), processed within the hour.`,
          type: "payment",
          link: "/my-jobs",
        });
      }

      // Track cancellation with helpr assigned — 2 warnings then permanent ban on 3rd
      if (hasHelper) {
        const { data: existing, error: existingErr } = await supabase
          .from("user_violations")
          .select("id")
          .eq("user_id", userId)
          .eq("violation_type", "cancel_with_helper");
        if (existingErr) report(existingErr, { tags: { source: "CancellationDialog.priorViolations" } });
        const priorCount = existing?.length ?? 0;

        let actionTaken = "none";
        if (priorCount >= 2) actionTaken = "permanent_ban";
        else actionTaken = "warning";

        const { error: violationErr } = await supabase.from("user_violations").insert({
          user_id: userId,
          violation_type: "cancel_with_helper",
          description: `Cancelled job with Helpr assigned: "${jobTitle}"`,
          job_id: jobId,
          action_taken: actionTaken,
        });
        if (violationErr) report(violationErr, { tags: { source: "CancellationDialog.recordViolation" } });

        const warningNum = priorCount + 1;

        if (actionTaken === "warning") {
          const { error: warnErr } = await supabase.from("profiles").update({ ban_status: "final_warning" }).eq("user_id", userId);
          if (warnErr) report(warnErr, { tags: { source: "CancellationDialog.finalWarning" } });
          await createNotification({
            user_id: userId,
            title: `⚠️ Cancellation Warning (${warningNum}/2)`,
            message: `You've cancelled ${warningNum} job${warningNum > 1 ? "s" : ""} after selecting a Helpr. A 3rd cancellation will result in a permanent ban.`,
            type: "warning",
            link: "/profile",
          });
          toast.warning(`Late cancel ${warningNum} of 2 — one more after a Helpr accepts will result in a permanent ban.`);
        } else if (actionTaken === "permanent_ban") {
          const { error: banInsertErr } = await supabase.from("user_bans").insert({
            user_id: userId,
            ban_type: "permanent",
            reason: "Cancelled 3 jobs after selecting a Helpr",
            banned_by: userId,
          });
          if (banInsertErr) report(banInsertErr, { tags: { source: "CancellationDialog.recordBan" } });
          const { error: banStatusErr } = await supabase.from("profiles").update({ ban_status: "permanently_banned" }).eq("user_id", userId);
          if (banStatusErr) report(banStatusErr, { tags: { source: "CancellationDialog.applyBanStatus" } });
          toast.error("Your account has been permanently banned due to 3 cancellations after selecting a Helpr.");
        }

        // Bulk-fan to admins in one INSERT instead of awaiting per row.
        const { data: adminRoles, error: adminRolesErr } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRolesErr) report(adminRolesErr, { tags: { source: "CancellationDialog.fetchAdmins" } });
        if (adminRoles?.length) {
          const { error: notifyErr } = await supabase.from("notifications").insert(
            adminRoles.map((a: { user_id: string }) => ({
              user_id: a.user_id,
              title: "⚠️ Cancellation with Helpr",
              message: `User cancelled "${jobTitle}" after selecting a Helpr (${warningNum} total). Action: ${actionTaken}.`,
              type: "warning",
              link: "/admin?view=people",
              read: false,
            })),
          );
          if (notifyErr) report(notifyErr, { tags: { source: "CancellationDialog.notifyAdmins" } });
        }
      } else {
        toast.success("Job cancelled. Any held payment will be refunded within the hour.");
      }

      hapticSuccess();
      onCancelled();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't cancel — please try again";
      hapticError();
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={
            <>
              <Clock className="w-3 h-3" /> Heads up
            </>
          }
          title={`Cancel "${jobTitle}"?`}
        />
        <div className="space-y-4">

          {/* Full Cancellation Policy */}
          <div className="rounded-ds-md border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-ds-11 font-semibold text-foreground uppercase tracking-wide">Full Cancellation Policy</p>

            {/* Step 1: Before helpr selected */}
            <div className={`flex items-start gap-2.5 p-3 rounded-ds-sm border transition-all ${!hasHelper ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20" : "bg-muted/20 border-border opacity-50"}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-ds-10 font-bold ${!hasHelper ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>1</div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-ds-11 font-semibold text-foreground">Before a Helpr is selected</p>
                  {!hasHelper && <span className="text-ds-10 font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                </div>
                <p className="text-ds-11 text-muted-foreground mt-0.5">Cancel anytime with no fee. You&apos;ll receive a full refund.</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-ds-11 text-primary font-medium">$0 fee · Full refund · No consequences</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center"><ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 rotate-90" /></div>

            {/* Step 2: After helpr selected */}
            <div className={`p-3 rounded-ds-sm border space-y-2 transition-all ${hasHelper ? "bg-accent/10 border-accent/30 ring-1 ring-accent/20" : "bg-muted/20 border-border opacity-50"}`}>
              <div className="flex items-start gap-2.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-ds-10 font-bold ${hasHelper ? "bg-accent text-accent-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>2</div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-ds-11 font-semibold text-foreground">After a Helpr is selected</p>
                    {hasHelper && <span className="text-ds-10 font-bold bg-accent text-accent-foreground px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                  </div>
                  <p className="text-ds-11 text-muted-foreground mt-0.5">
                    Cancellation fees are <strong className="text-foreground">tiered by timing</strong> to compensate the Helpr for their committed time:
                  </p>
                  <ul className="text-ds-11 text-muted-foreground mt-1 space-y-0.5 list-disc list-inside">
                    <li><strong className="text-foreground">24+ hours before:</strong> 0% (free)</li>
                    <li><strong className="text-foreground">Less than 24 hours:</strong> 25% fee</li>
                    <li><strong className="text-foreground">Less than 2 hours:</strong> 50% fee</li>
                  </ul>
                  {hasHelper && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <DollarSign className="w-3 h-3 text-accent shrink-0" />
                      <span className="text-ds-11 text-accent font-medium">
                        {feeTier} → {cancellationFeePercent}% fee · Strike recorded
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {hasHelper && cancellationFee > 0 && (
                <div className="rounded-ds-sm bg-muted/50 border border-border p-3 space-y-1.5 ml-7">
                  <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-wide mb-1">Your fee breakdown</p>
                  <div className="flex justify-between text-ds-11">
                    <span className="text-muted-foreground">Cancellation fee ({cancellationFeePercent}% of ${formatPrice(jobBudget)})</span>
                    <span className="font-semibold text-foreground">${formatPrice(cancellationFee)}</span>
                  </div>
                  <div className="flex justify-between text-ds-11">
                    <span className="text-muted-foreground">Platform fee ({commissionPercent}%)</span>
                    <span className="text-muted-foreground">−${formatPrice(platformCut)}</span>
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between text-ds-11">
                    <span className="text-muted-foreground">{helperName || "Helpr"} receives</span>
                    <span className="font-semibold text-primary">${formatPrice(helperPayout)}</span>
                  </div>
                </div>
              )}

              {hasHelper && cancellationFee === 0 && (
                <div className="rounded-ds-sm bg-primary/10 border border-primary/20 p-3 ml-7 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-ds-11 text-primary font-medium">
                    Free cancellation — more than 24 hours until the job starts.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Strike system — always visible */}
          <div className={`rounded-ds-md border p-4 space-y-3 ${hasHelper ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/20 opacity-60"}`}>
            <p className={`text-ds-11 font-semibold uppercase tracking-wide flex items-center gap-1.5 ${hasHelper ? "text-destructive" : "text-muted-foreground"}`}>
              <ShieldAlert className="w-3.5 h-3.5" /> Strike System (applies when Helpr is selected)
            </p>
            <div className="space-y-2 text-ds-11 text-muted-foreground">
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
              <p className="text-ds-11 text-muted-foreground italic">✓ These consequences don&apos;t apply to you — no Helpr has been selected.</p>
            )}
          </div>

          {/* Fee summary callout — surfaces the exact dollar amount before
              the user taps confirm so there's no ambiguity. Only shown when
              a non-zero fee applies (hasHelper + late). */}
          {hasHelper && cancellationFee > 0 && (
            <div
              className="flex items-start gap-2.5 rounded-ds-md p-3.5"
              style={{
                background: "hsl(var(--destructive) / 0.07)",
                border: "1px solid hsl(var(--destructive) / 0.28)",
              }}
            >
              <DollarSign
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{ color: "hsl(var(--destructive))" }}
              />
              <div>
                <p
                  className="font-sans font-bold"
                  style={{ fontSize: "0.82rem", color: "hsl(var(--destructive))", letterSpacing: "-0.01em" }}
                >
                  A cancellation fee of{" "}
                  {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cancellationFee)}{" "}
                  applies
                </p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">
                  {cancellationFeePercent}% of the ${jobBudget.toFixed(2)} budget · {feeTier.toLowerCase()}
                </p>
              </div>
            </div>
          )}

          {/* Worker protection notice — shown when the poster cancels within
              24h of the scheduled time and a helper is assigned. Lets the poster
              know the helper is covered, and the helper will see their credit. */}
          {hasHelper && hoursUntilJob < 24 && hoursUntilJob >= 0 && (
            <div
              className="rounded-ds-md p-3"
              style={{
                background: "hsl(155 50% 35% / 0.08)",
                border: "0.5px solid hsl(155 50% 35% / 0.20)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(155 50% 30%)" }} strokeWidth={2.25} />
                <p
                  className="font-display italic font-semibold text-ds-13"
                  style={{ color: "hsl(155 50% 30%)" }}
                >
                  Your Helpr is protected
                </p>
              </div>
              <p
                className="font-serif italic text-ds-12"
                style={{ color: "hsl(155 40% 40%)" }}
              >
                Since this is a last-minute cancellation, {helperName || "your Helpr"} will receive a $10 Helpr credit within 24 hours — separate from any cancellation fee above.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              className="font-serif italic uppercase block"
              style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              Reason — optional
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What changed? Helps us improve."
              rows={2}
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-[0.85rem]"
            />
          </div>
        </div>
        <DialogFooter className="!gap-2">
          <Button
            variant="ghost"
            disabled={cancelling}
            onClick={onClose}
            className="rounded-ds-md font-sans font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            Keep the job
          </Button>
          <Button
            onClick={handleCancel}
            disabled={cancelling}
            className="rounded-ds-md"
            style={{
              background: "hsl(var(--burnt-sienna))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--burnt-sienna))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px hsl(var(--burnt-sienna) / 0.2), 0 8px 20px -6px hsl(var(--burnt-sienna) / 0.32)",
            }}
          >
            {cancelling ? "Cancelling…" : cancellationFee > 0 ? `Cancel · pay $${cancellationFee}` : "Cancel job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};