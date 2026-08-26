import {
  jobLocalMidnightMs,
  cancellationFeePercent as sharedCancellationFeePercent,
} from "../../supabase/functions/_shared/cancellationFee";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createNotification } from "@/lib/notifications";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, isWriteRejected } from "@/lib/mutationResult";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Ban, ShieldAlert, DollarSign, CheckCircle, Clock, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
// The ladder this dialog quotes IS the ladder Community Rules publishes —
// read the same two constants CommunitySection does rather than restating
// "25"/"50" as prose.
import { LATE_CANCEL_PERCENT, VERY_LATE_CANCEL_PERCENT } from "@/lib/moneyLimits";
// formatPriceExact, not formatPrice: this block shows the fee arithmetic,
// and whole-dollar rounding made the lines stop adding up.
import { formatPriceExact as formatPrice } from "@/lib/format";

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
  // Is this a recurring PARENT? Fetched on open so the dialog can say the
  // one thing the card no longer says (owner: card = less hectic; the
  // cancel-scope warning belongs at the moment of cancelling).
  const [isSeriesParent, setIsSeriesParent] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabase
      .from("jobs")
      .select("recurrence_days, parent_job_id")
      .eq("id", jobId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setIsSeriesParent(!!data && !data.parent_job_id && (data.recurrence_days?.length ?? 0) > 0);
      });
    return () => { alive = false; };
  }, [open, jobId]);

  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Tiered cancellation fee (only applies once a helpr has been selected):
  //   • 24+ hours before job  → 0%   (free cancellation)
  //   • Less than 24 hours    → 25%  (helpr has committed time)
  //   • Less than 2 hours     → 50%  (very late cancellation)
  // Both values come from the SAME module the edge function charges from.
  //
  // This used to be `new Date(jobDate + "T00:00:00")` plus a hand-copied
  // ladder. That string parses in the RUNTIME's zone, so the browser
  // (America/Chicago) and the edge function (Deno Deploy, UTC) disagreed by
  // 5-6 hours: a poster cancelling ~24.5h out was shown "free cancellation"
  // here and charged 25% of the budget by void-cancelled-payments.
  const hoursUntilJob = (jobLocalMidnightMs(jobDate) - Date.now()) / (1000 * 60 * 60);
  const cancellationFeePercent = sharedCancellationFeePercent(hasHelper, hoursUntilJob);
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
      const { data: jobData, error: fetchError } = await supabase.from("jobs").select("date_needed, budget, helper_id, helper_fee_percent, recurrence_days, parent_job_id").eq("id", jobId).single();
      if (fetchError || !jobData) throw new Error("Couldn't verify job details");

      // SAME two functions the quote above uses, and the same ones
      // void-cancelled-payments charges from. This block used to re-inline
      // `new Date(date_needed + "T00:00:00")` and a hand-copied ladder — the
      // exact local-zone parse the comment 20 lines above says was removed —
      // so the fee we PERSIST was computed in the browser's timezone while the
      // fee we SHOWED was computed in the platform's.
      //
      // Chicago agreed with itself, which is why it survived. Anywhere else it
      // did not: a $200 job cancelled 24.5h out was quoted 0% and written to
      // the row as 25% ($50) with late_cancellation = true from America/
      // New_York. The money that actually MOVES was always right — the edge
      // function recomputes from _shared/cancellationFee — but every number
      // derived from the persisted row was not: the fee pill both parties see,
      // admin late-cancel revenue, and the helper's penalty record.
      const serverHasHelper = !!jobData.helper_id;
      const serverHoursUntil =
        (jobLocalMidnightMs(jobData.date_needed) - Date.now()) / (1000 * 60 * 60);
      const serverFeePercent = sharedCancellationFeePercent(serverHasHelper, serverHoursUntil);
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

      // .select("id") + unwrapMutation: a cancellation that matches zero rows
      // (already cancelled, RLS, stale id) returns error === null, and this
      // used to go on to promise a refund for a job that never moved.
      unwrapMutation(
        await supabase.from("jobs").update(updateData).eq("id", jobId).select("id"),
        {
          action: "cancel this job",
          rejectedMessage: "This job couldn't be cancelled — it may have already been cancelled or completed. Refresh and check.",
          context: { jobId },
        },
      );

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
          message: `"${jobTitle}" was cancelled by the poster. You'll receive approximately $${formatPrice(helperPayout)} as a cancellation fee (${serverFeePercent}% of the budget minus platform fee), processed within the hour.`,
          type: "payment",
          link: "/my-jobs",
        });
      }

      // The consequence ladder is SERVER-owned (apply_cancellation_violation_consequence,
      // migration 20260826040000). This block used to run it here: it counted
      // prior violations in the browser and, on the third cancel, inserted a
      // `permanent` user_bans row with banned_by pointing at the offender
      // themselves, set profiles.ban_status, and redirected to /account-banned.
      //
      // RLS rejects both of those writes for a non-admin, so the ban never
      // actually landed — the user was sent to a ban screen while the database
      // still said `active`, and no admin ever saw a case. Same bug the message
      // scanner had (20260825183000), same fix: report the event, let the server
      // decide, act only on the verdict it returns.
      if (hasHelper) {
        // `as any`: the RPC ships with this change's migration, so the
        // generated types.ts doesn't know it yet — same escape hatch
        // logViolation.ts uses for the message ladder.
        const { data: verdict, error: ladderErr } = await supabase.rpc(
          "apply_cancellation_violation_consequence" as any,
          { p_job_id: jobId } as any,
        );

        if (ladderErr) {
          // PGRST202 = merged but not yet deployed (db-deploy.yml runs on the
          // merge commit). The cancellation itself already succeeded, so say
          // nothing and let the strike go unrecorded for those few minutes.
          // There is deliberately NO client-side fallback: a ban this client
          // cannot legitimately write is not a fallback, it is theatre.
          if (String(ladderErr.code ?? "") !== "PGRST202") {
            report(ladderErr, { tags: { source: "CancellationDialog.applyConsequence" } });
          }
        } else {
          const action = (verdict as { action?: string } | null)?.action;
          if (action === "warning") {
            toast.warning("Cancellation warning (1 of 2) — cancelling again after a Helpr commits is a final warning.");
          } else if (action === "final_warning") {
            toast.warning("Final warning — one more cancellation after a Helpr commits and your account is restricted for 7 days pending review.");
          } else if (action === "pending_ban_review") {
            // A restriction is the most consequential message this product can
            // send, and a toast auto-dismisses. Route to the page that reads
            // the real ban_status off the profile, so it persists and says why.
            // window.location, not useNavigate: a full document load tears down
            // every cached authed query rather than leaving a restricted
            // session live in memory behind the screen, and it keeps this
            // component renderable without a Router (its unit tests rely on that).
            window.location.assign("/account-banned");
            return;
          }
        }
      }

      hapticSuccess();
      // Cancelling used to end in silence — the dialog closed, the card
      // vanished, and nothing said what happened to the money. That refund is
      // the one outcome a poster needs stated, so this confirmation names it.
      // It carries an action, which is also what lets it past the
      // suppress-plain-success toast policy (see lib/toastPolicy.ts).
      toast.success(
        hasHelper && cancellationFee > 0
          ? `Job cancelled. The $${formatPrice(cancellationFee)} cancellation fee applies — the rest returns to your card.`
          : "Job cancelled — the full amount returns to your card.",
        { action: { label: "Dismiss", onClick: () => { /* toast closes itself */ } } },
      );
      onCancelled();
      onClose();
    } catch (err) {
      const message = isWriteRejected(err)
        ? err.userMessage
        : err instanceof Error
          ? err.message
          : "Couldn't cancel — please try again";
      hapticError();
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
       
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
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
                    <li><strong className="text-foreground">Less than 24 hours:</strong> {LATE_CANCEL_PERCENT}% fee</li>
                    <li><strong className="text-foreground">Less than 2 hours:</strong> {VERY_LATE_CANCEL_PERCENT}% fee</li>
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
                <p><strong className="text-foreground">1st strike:</strong> Written warning on your account.</p>
              </div>
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                <p><strong className="text-foreground">2nd strike:</strong> Final warning.</p>
              </div>
              {/* This used to promise an automatic, irreversible permanent ban
                  on the 3rd strike. It now says what actually happens: a
                  reversible 7-day restriction while a person reviews the case
                  (apply_cancellation_violation_consequence, 20260826040000). */}
              <div className="flex items-start gap-2">
                <Ban className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                <p><strong className="text-foreground">3rd strike:</strong> Your account is restricted for 7 days while an admin reviews it. They decide what happens next — a permanent ban is never automatic.</p>
              </div>
            </div>
            {!hasHelper && (
              <p className="text-ds-11 text-muted-foreground italic">✓ These consequences don&apos;t apply to you — no Helpr has been selected.</p>
            )}
          </div>

          {/* Series scope — stated HERE, at the decision, instead of living
              permanently on the card (owner, 2026-08-24). */}
          {isSeriesParent && (
            <div
              className="rounded-ds-md p-3"
              style={{
                background: "hsl(var(--bark) / 0.06)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
              }}
            >
              <p className="text-ds-12 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
                <strong>This cancels the whole series.</strong> Every future visit stops; visits already funded are unaffected.
              </p>
            </div>
          )}

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
                  className="font-sans font-bold text-ds-13"
                  style={{ color: "hsl(var(--destructive))", letterSpacing: "-0.01em" }}
                >
                  A cancellation fee of ${formatPrice(cancellationFee)} applies
                </p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">
                  {cancellationFeePercent}% of the ${formatPrice(jobBudget)} budget · {feeTier.toLowerCase()}
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
                background: "hsl(var(--success-ink) / 0.08)",
                border: "0.5px solid hsl(var(--success-ink) / 0.20)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={2.25} />
                <p
                  className="font-sans font-semibold text-ds-13"
                  style={{ color: "hsl(var(--success-ink))" }}
                >
                  Your Helpr is protected
                </p>
              </div>
              <p
                className="font-serif italic text-ds-12"
                style={{ color: "hsl(var(--success-ink))" }}
              >
                Since this is a last-minute cancellation, {helperName || "your Helpr"} will receive a $10 Helpr credit within 24 hours — separate from any cancellation fee above.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="cancel-reason"
              className="font-serif italic uppercase block text-ds-10"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              Reason — optional
            </label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-serif italic text-ds-14"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={cancelling}
            onClick={onClose}
            className="rounded-ds-md font-sans font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            Keep the Job
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
              boxShadow: "var(--elev-sienna-raised)",
            }}
          >
            {cancelling ? "Cancelling…" : cancellationFee > 0 ? `Cancel · pay $${cancellationFee}` : "Cancel Job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};