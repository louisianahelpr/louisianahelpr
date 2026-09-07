import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { ShieldCheck, Camera, FileCheck2, Loader2, AlertTriangle, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorBody, functionErrorMessage } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

type IdvStatus =
  | "not_started"
  | "pending"
  | "processing"
  | "verified"
  | "failed"
  | "manual_review"
  | "skipped"
  | undefined;

interface IDVPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: short message describing why verification is required right now. */
  reason?: string;
  /** Called after the Stripe Identity tab is launched. */
  onLaunched?: () => void;
  /**
   * Current verification status. `manual_review` (and the legacy `failed`,
   * which the 20260829 migration converts) switches the dialog to
   * "a human has this" mode and surfaces the reason the automated check
   * couldn't confirm it. Defaults to first-time-prompt UI when omitted.
   *
   * NOTE: the values here must all be members of the `profiles.idv_status`
   * CHECK constraint (not_started / pending / processing / verified / failed /
   * manual_review / skipped). `requires_input` was listed here and is NOT a
   * legal value — it is a *Stripe* session status, never a column value.
   */
  status?: IdvStatus;
  /** Stripe-supplied or admin-entered reason the prior attempt failed. */
  failureReason?: string;
  /**
   * "job_post" lets the server skip the pre-paid-fee requirement, because the
   * $2 rides on the job payment this same flow is about to collect (see
   * 20260829090211_idv_job_post_skips_fee_gate.sql). Omit for any other
   * caller — the fee-first gate is the safe default.
   */
  context?: "job_post";
  /**
   * True when `profiles.onboarding_fee_paid` is known to be false, so the fee
   * is named BEFORE the member taps Start rather than arriving as a 402 from
   * `stripe-idv-start` once they have already committed.
   *
   * That 402 is still handled below and still has to be: this prop is a cached
   * column and the server's refusal is the authority. But a price the member
   * only discovers by being refused is a bad-faith moment in a flow whose whole
   * job is establishing trust.
   *
   * Do NOT set this alongside `context: "job_post"` — that path deliberately
   * skips the fee gate because the fee rides on the job payment being collected
   * in the same flow (20260829090211).
   */
  feeDue?: boolean;
  /**
   * The fee as the platform actually charges it (e.g. "$2"), from
   * `platform_settings.onboarding_fee_cents`. `null`/omitted when unknown —
   * the copy reads correctly without a number and must never invent one.
   */
  feeLabel?: string | null;
}

export function IDVPromptDialog({
  open,
  onOpenChange,
  reason,
  onLaunched,
  status,
  failureReason,
  context,
  feeDue: feeDueUpFront = false,
  feeLabel = null,
}: IDVPromptDialogProps) {
  const [loading, setLoading] = useState(false);

  // Owner policy (Lexi 2026-08-28): "1 try for $2 and then send to admin for
  // manual verification." The $2 onboarding fee funds exactly one billable
  // Stripe Identity session, so there is no self-service retry — but there is
  // never a dead end either. A spent attempt lands the account in
  // `manual_review`, which the admin identity review queue lists and an admin
  // clears with one tap.
  //
  // What this state used to say (and why it was wrong): it told the user "We
  // don't re-run this check" and pointed them at Stripe Connect payout setup.
  // That was a dead end dressed as a next step — payout setup writes
  // `profiles.stripe_identity_verified`, a DIFFERENT column that the jobs
  // INSERT policy does not read, so finishing it cleared nothing and the
  // person still could not post. `failed` is kept in the test below only
  // because rows written before the fix may still carry it.
  const isAdminReview = status === "failed" || status === "manual_review";
  const isPending = status === "processing";

  // Set when the SERVER refuses because the one-time account setup fee is
  // outstanding. That is the ONE refusal the user can act on, so it swaps the
  // button for a pay-now button rather than leaving them reading a toast about
  // a fee with no way to settle it.
  const [feeRefusal, setFeeRefusal] = useState<string | null>(null);

  // The fee is owed, by either account: the server said so (authoritative), or
  // the caller read `onboarding_fee_paid` and told us in advance so the price
  // is on screen before the member commits. Same UI either way — one step,
  // named, with the button that completes it.
  // Set when `pay-onboarding-fee` answers `alreadyPaid` — the fee was settled
  // by another path (a job post, a payout) since the caller read the column.
  // Without this, clearing `feeRefusal` alone left `feeDueUpFront` asserting a
  // debt Stripe had just told us does not exist, and the dialog kept offering
  // to charge for it.
  const [feeSettled, setFeeSettled] = useState(false);

  const feeOwed = !feeSettled && (feeRefusal !== null || feeDueUpFront);
  const feeMessage =
    feeRefusal ??
    `Your one-time${feeLabel ? ` ${feeLabel}` : ""} account setup fee covers this check — charged once per account, never again. You'll settle it with Stripe and come right back to verify.`;

  const handlePayFee = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pay-onboarding-fee", {
        body: { native: isNativePlatform },
      });
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't open checkout"));
      if (data?.alreadyPaid) {
        // Settled by another path (a job post, a payout) since we last looked.
        setFeeRefusal(null);
        setFeeSettled(true);
        toast.success("Your setup fee is already paid — you can verify now.");
        return;
      }
      if (!data?.url) throw new Error("Couldn't open checkout — try again in a moment.");
      onOpenChange(false);
      await openExternalUrl(data.url);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't open checkout");
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-idv-start", {
        body: { native: isNativePlatform, context },
      });
      // A non-2xx makes the SDK return a FunctionsHttpError whose `.message` is
      // the useless "Edge Function returned a non-2xx status code" — which is
      // literally all the user saw for as long as this flow was broken. The
      // real reason is in the JSON body; `functionErrorMessage` reads it.
      if (error) {
        const body = await functionErrorBody(error);
        const msg = await functionErrorMessage(error, "Couldn't start verification");
        if (body?.needsOnboardingFee === true) {
          // Not a failure to report and forget — it's a step with a next step.
          setFeeRefusal(msg);
          return;
        }
        throw new Error(msg);
      }
      if (data?.alreadyVerified) {
        onOpenChange(false);
        onLaunched?.();
        return;
      }
      if (!data?.url) throw new Error("Couldn't start verification");
      // Per the one-attempt policy above, this dialog's Start button only
      // renders for first-time verification — there is no self-service
      // retry path. Navigate in-place (matches every other Stripe flow) so
      // the verification return_url lands the user back in the app.
      onOpenChange(false);
      onLaunched?.();
      await openExternalUrl(data.url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't start verification";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const headline = isAdminReview
    ? "We're Checking This by Hand"
    : isPending
      ? "Verification in Progress"
      : "Verify Your Identity";

  const Icon = isAdminReview ? Hourglass : isPending ? Hourglass : ShieldCheck;

  // WHY this dialog is being shown, rendered at the top of the body.
  //
  // This used to be a three-way const that DialogHero no longer rendered, so
  // it was computed and thrown away — including the caller's own `reason`
  // ("…before you can post a job", from PostJob), which meant a poster was
  // shown the generic first-job copy instead of the reason they were actually
  // stopped. The admin-review and pending arms are dropped rather than
  // restored: their bodies below already say the same thing ("An admin will
  // review your ID upload manually…", "You'll get a notification as soon as
  // the review finishes"), and re-adding them would duplicate that copy.
  const intro = isAdminReview || isPending
    ? null
    : (reason ?? "Helpr requires a quick ID + selfie check before you accept your first job. This protects posters and keeps the platform safe.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
       
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
          title={headline}
        />

        {intro && (
          <DialogBody>
            <p>{intro}</p>
          </DialogBody>
        )}

        {/* Automated check spent — show the reason for transparency, no retry
            CTA (the one paid attempt is gone), and a real next step: a person
            is reviewing it and will email. See the note above for why this no
            longer points at Stripe Connect payout setup. */}
        {isAdminReview && (
          <div
            className="flex items-start gap-3 p-3 rounded-ds-md border mt-2"
            style={{
              backgroundColor: "hsl(var(--amber-tint) / 0.10)",
              borderColor: "hsl(var(--amber-tint) / 0.30)",
            }}
          >
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "hsl(var(--amber-ink))" }} />
            <div className="text-ds-13 text-foreground">
              <p className="font-medium">What happened</p>
              <p className="text-ds-11 text-muted-foreground mt-1">
                {failureReason || "The automated check couldn't confirm your identity from the photos provided."}
              </p>
              <p className="font-medium mt-2">What happens next</p>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Someone on our team is reviewing your ID by hand. You'll get an email and a notification as soon as it's done — usually within 24 hours. There's nothing else for you to do.
              </p>
            </div>
          </div>
        )}

        {!isAdminReview && !isPending && (
          <div className="space-y-2 py-1">
            <div
              className="flex items-start gap-3 p-3 rounded-ds-md"
              style={{
                background: "hsl(var(--ivory-sand) / 0.5)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
              >
                <FileCheck2 className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p
                  className="font-display italic font-bold leading-tight text-ds-15"
                  style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                >
                  Photo of your government ID
                </p>
                <p className="font-serif italic mt-0.5 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  Driver's license, passport, or state ID
                </p>
              </div>
            </div>
            <div
              className="flex items-start gap-3 p-3 rounded-ds-md"
              style={{
                background: "hsl(var(--ivory-sand) / 0.5)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--bark) / 0.12)", color: "hsl(var(--bark))" }}
              >
                <Camera className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p
                  className="font-display italic font-bold leading-tight text-ds-15"
                  style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
                >
                  A quick selfie
                </p>
                <p className="font-serif italic mt-0.5 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  We compare it to your ID to make sure it's really you
                </p>
              </div>
            </div>
            <p
              className="font-serif italic px-1 pt-1 text-ds-12"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Verification is handled securely by Stripe Identity. Most checks finish in under 2 minutes.
            </p>
          </div>
        )}

        {/* Setup fee outstanding — the refusal that has an answer. */}
        {feeOwed && (
          <div
            className="flex items-start gap-3 p-3 rounded-ds-md border mt-2"
            style={{
              backgroundColor: "hsl(var(--amber-tint) / 0.10)",
              borderColor: "hsl(var(--amber-tint) / 0.30)",
            }}
          >
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: "hsl(var(--amber-ink))" }} />
            <div className="text-ds-13 text-foreground">
              <p className="font-medium">One thing first</p>
              <p className="text-ds-11 text-muted-foreground mt-1">{feeMessage}</p>
            </div>
          </div>
        )}

        {isPending && (
          <p
            className="font-serif italic px-1 py-2 text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            You'll get a notification as soon as the review finishes. No need to do anything else right now.
          </p>
        )}

        <DialogFooter>
          <DialogSecondaryAction onClick={() => onOpenChange(false)} disabled={loading}>
            {isPending || isAdminReview ? "OK" : "Not Now"}
          </DialogSecondaryAction>
          {!isPending && !isAdminReview && feeOwed && (
            <DialogPrimaryAction
              onClick={handlePayFee}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Pay Setup Fee
            </DialogPrimaryAction>
          )}
          {!isPending && !isAdminReview && !feeOwed && (
            <DialogPrimaryAction
              onClick={handleStart}
              disabled={loading}
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />}
              Start Verification
            </DialogPrimaryAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
