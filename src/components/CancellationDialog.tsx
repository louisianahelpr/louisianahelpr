import {
  jobLocalMidnightMs,
  cancellationFeePercent as sharedCancellationFeePercent,
} from "../../supabase/functions/_shared/cancellationFee";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
// unwrapMutation is gone with the client-side UPDATE it guarded; isWriteRejected
// stays so this dialog keeps rendering a rejected write's own message if any
// future write lands here.
import { isWriteRejected } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Ban, ShieldAlert, DollarSign, CheckCircle, ArrowRight, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { tierFeePercent } from "@/lib/subscriptionTiers";

/** Highest commission on the tier ladder (free = 12%). Quoting it makes any
 *  helper-share estimate a guaranteed floor rather than an optimistic guess. */
const MAX_HELPER_FEE_PERCENT = tierFeePercent("free");
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
  /* No `userId`: the cancelling identity is auth.uid() inside
     poster_cancel_job now, so the client no longer asserts who it is. */
  hasHelper: boolean;
  helperId?: string | null;
  helperName?: string;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobBudget, hasHelper, helperId: _helperId, helperName, open, onClose, onCancelled }: CancellationDialogProps) => {
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
      .then(({ data, error }) => {
        // A dropped error here is user-visible, not cosmetic: on failure this
        // falls back to isSeriesParent=false and silently hides the
        // whole-series cancellation warning, so someone cancelling a
        // recurring parent is shown single-occurrence copy. Keep the safe
        // fallback, but make the failure observable instead of invisible.
        if (error) {
          report(error, {
            severity: "warning",
            tags: { source: "CancellationDialog.seriesParentLookup" },
            context: { job_id: jobId },
          });
        }
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
  // The helper's share of the cancellation fee, from the POSTER's side.
  //
  // This used to read `jobs.helper_fee_percent`, on the belief that the column
  // freezes the assigned helper's commission rate. It does not: `create-payment`
  // stamps it from the GLOBAL `platform_settings.helper_fee_percent` at escrow
  // time, before any helper exists on the job, while `void-cancelled-payments`
  // re-resolves the helper's LIVE tier when it actually transfers. On a real
  // test job this dialog quoted the helper $54.00 and Stripe sent $55.20.
  //
  // The poster cannot resolve the helper's tier: `profiles` RLS lets a user
  // read only their OWN row (verified against pg_policies), and no public view
  // exposes `subscription_tier`. So quote the FLOOR instead of a false exact:
  // the free tier's 12% is the highest commission on the ladder, so the figure
  // shown is the least the helper can receive and is labelled "at least". A
  // number shown to a helper may never exceed what they are paid; the same
  // discipline applies to a number shown ABOUT a helper.
  const commissionPercent = MAX_HELPER_FEE_PERCENT;
  const platformCut = Math.round(cancellationFee * commissionPercent) / 100;
  const helperPayout = Math.max(0, Math.round((cancellationFee - platformCut) * 100) / 100);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // ONE call, ONE transaction, ONE outcome.
      //
      // This used to be three independent client round-trips: an UPDATE that
      // wrote status/cancelled_by/cancellation_fee/cancellation_fee_status
      // straight onto `jobs`, then a createNotification(), then a SEPARATE
      // apply_cancellation_violation_consequence() RPC. Nothing bound them.
      // A client that simply never made the third call cancelled a job with a
      // Helpr committed and recorded no strike — the ladder was opt-in, and
      // the opt-out was free. The fee was client-computed too, so the number
      // persisted on the row was whatever the caller sent.
      //
      // poster_cancel_job (migration 20260828020000) does all three server-
      // side in one transaction and DERIVES the fee from the same
      // cancellation_fee_percent/job_hours_until_start ladder
      // void-cancelled-payments recomputes from. The cancellation columns are
      // no longer writable by a client at all (trg_cancellation_requires_rpc),
      // so there is no path to the state change that skips the strike.
      const { data: verdict, error } = await supabase.rpc(
        "poster_cancel_job" as any,
        { p_job_id: jobId, p_reason: reason.trim() || null } as any,
      );
      if (error) {
        // PGRST202 = merged but not yet deployed (db-deploy.yml runs on the
        // merge commit), so for a few minutes this RPC does not exist yet.
        // There is deliberately NO fallback to the old client-side UPDATE:
        // during that same window the guarding trigger is also absent, so the
        // fallback would succeed AND skip the ladder — it would re-open the
        // exact hole this change closes, on a timer. Say so and stop.
        if (String(error.code ?? "") === "PGRST202") {
          throw new Error(
            "Cancelling is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.",
          );
        }
        // The RPC raises terse identifiers, and a PostgrestError is a plain
        // object — not an Error — so rethrowing it raw would fall past both
        // arms of the catch below and surface the generic "please try again"
        // for cases we can explain precisely. Translate the ones it defines.
        // `not_cancellable` is the state this dialog is most likely to hit: it
        // is the already-cancelled / already-finished race the previous
        // zero-row unwrapMutation guard existed to catch, now answered by the
        // server instead of inferred from a row count.
        const human: Record<string, string> = {
          not_cancellable:
            "This job couldn't be cancelled — it may have already been cancelled, finished, or opened as a dispute. Refresh and check.",
          not_authorized: "Only the person who posted this job can cancel it.",
          job_not_found: "This job no longer exists. Refresh and check.",
          not_authenticated: "Please sign in again to cancel this job.",
        };
        throw new Error(
          human[String(error.message ?? "").trim()] ??
            error.message ??
            "Couldn't cancel — please try again",
        );
      }

      const result = (verdict ?? {}) as {
        action?: string;
        cancellation_fee?: number;
        had_helper?: boolean;
      };
      const appliedFee = Number(result.cancellation_fee ?? 0);

      // The held Stripe payment is NOT voided here: void-cancelled-payments
      // only accepts cron/service-role auth (a client JWT gets a 401 — a
      // previous invoke from here failed on every call and was removed). The
      // hourly cron sweeps jobs with cancellation_fee_status='pending' and
      // processes the refund, so it lands within ~an hour of cancelling.
      //
      // The Helpr's "you'll be compensated" notification is now written by the
      // RPC in the same transaction, so a client that closes the tab mid-flow
      // can no longer cancel someone's job without telling them.

      if (result.action === "warning") {
        toast.warning("Cancellation warning (1 of 2) — cancelling again after a Helpr commits is a final warning.");
      } else if (result.action === "final_warning") {
        toast.warning("Final warning — one more cancellation after a Helpr commits and your account is restricted for 7 days pending review.");
      } else if (result.action === "pending_ban_review") {
        // A restriction is the most consequential message this product can
        // send, and a toast auto-dismisses. Route to the page that reads the
        // real ban_status off the profile, so it persists and says why.
        // window.location, not useNavigate: a full document load tears down
        // every cached authed query rather than leaving a restricted session
        // live in memory behind the screen, and it keeps this component
        // renderable without a Router (its unit tests rely on that).
        window.location.assign("/account-banned");
        return;
      }

      hapticSuccess();
      // Cancelling used to end in silence — the dialog closed, the card
      // vanished, and nothing said what happened to the money. That refund is
      // the one outcome a poster needs stated, so this confirmation names it.
      // It carries an action, which is also what lets it past the
      // suppress-plain-success toast policy (see lib/toastPolicy.ts).
      // The amount the SERVER applied, not the estimate this dialog rendered.
      // They agree (same ladder, same Chicago-midnight clock), but the row is
      // the authority now that the client no longer writes it.
      toast.success(
        appliedFee > 0
          ? `Job cancelled. The $${formatPrice(appliedFee)} cancellation fee applies — the rest returns to your card.`
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
                {/* Says "budget refunded", not "full refund". The platform
                    service fee is deliberately withheld — Stripe keeps its cut
                    on a refund, so returning it would put the platform
                    out-of-pocket on every cancellation
                    (void-cancelled-payments/index.ts:320-331). A live run
                    charged $67.20 and refunded $60.00, exactly as designed —
                    while this text promised a "full refund", which is the part
                    that was wrong. */}
                <p className="text-ds-11 text-muted-foreground mt-0.5">Cancel anytime with no cancellation fee. Your job budget is refunded in full; the service fee isn&apos;t refundable once payment has been processed.</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-ds-11 text-primary font-medium">$0 cancellation fee · Budget refunded · No consequences</span>
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
                    <span className="text-muted-foreground">Platform fee (up to {commissionPercent}%)</span>
                    <span className="text-muted-foreground">−${formatPrice(platformCut)}</span>
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between text-ds-11">
                    <span className="text-muted-foreground">{helperName || "Helpr"} receives</span>
                    <span className="font-semibold text-primary">at least ${formatPrice(helperPayout)}</span>
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