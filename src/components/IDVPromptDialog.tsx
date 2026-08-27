import { useState } from "react";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Camera, FileCheck2, Loader2, AlertTriangle, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";

type IdvStatus =
  | "not_started"
  | "pending"
  | "processing"
  | "verified"
  | "failed"
  | "requires_input"
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
   * Current verification status. When 'failed' or 'requires_input' the dialog
   * switches to "try again" mode and surfaces the failure reason. Defaults to
   * first-time-prompt UI when omitted.
   */
  status?: IdvStatus;
  /** Stripe-supplied or admin-entered reason the prior attempt failed. */
  failureReason?: string;
}

export function IDVPromptDialog({
  open,
  onOpenChange,
  reason,
  onLaunched,
  status,
  failureReason,
}: IDVPromptDialogProps) {
  const [loading, setLoading] = useState(false);

  // Owner policy (Lexi 2026-05-06): one Stripe Identity attempt per user. If
  // it fails, no self-service retry — that saves Stripe Identity cost on dead
  // accounts and on users repeatedly failing automated checks.
  //
  // What this state no longer means (2026-08-27): it used to say an admin
  // would review the ID upload manually, via AdminIDVQueue. That queue has
  // been retired — nobody worked it, and the owner confirmed the uploads were
  // never reviewed — so the promise was false. The copy below now says what is
  // actually true: this attempt is finished, and the identity signal that
  // matters comes from Stripe Connect (profiles.stripe_identity_verified),
  // which is a separate flow reachable from payout settings.
  const isAdminReview =
    status === "failed" || status === "requires_input" || status === "manual_review";
  const isPending = status === "processing";

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-idv-start", { body: { native: isNativePlatform } });
      // A non-2xx makes the SDK return a FunctionsHttpError whose `.message` is
      // the useless "Edge Function returned a non-2xx status code" — which is
      // literally all the user saw for as long as this flow was broken. The
      // real reason is in the JSON body; `functionErrorMessage` reads it.
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't start verification"));
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
    ? "That check didn't go through"
    : isPending
      ? "Verification in progress"
      : "Verify your identity";

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
          eyebrow={
            <>
              <Icon className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
              Identity check
            </>
          }
          title={headline}
        />

        {intro && (
          <p
            className="font-serif italic px-1 pt-1 text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {intro}
          </p>
        )}

        {/* Failed state — show Stripe's reason for transparency, but no
            self-service retry CTA. Per owner policy, Stripe Identity is
            charged once. It no longer promises an admin review, because there
            is no longer a queue for one (see the note above). */}
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
                {failureReason || "Stripe couldn't confirm your identity automatically from the photos provided."}
              </p>
              <p className="text-ds-11 text-muted-foreground mt-2">
                We don't re-run this check. Your identity for accepting jobs is confirmed through your Stripe payout account instead — finish that in Profile → Payment Settings and the verified badge follows automatically.
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

        {isPending && (
          <p
            className="font-serif italic px-1 py-2 text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            You'll get a notification as soon as the review finishes. No need to do anything else right now.
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-ds-md h-11">
            {isPending || isAdminReview ? "OK" : "Not Now"}
          </Button>
          {!isPending && !isAdminReview && (
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={loading}
              className="rounded-ds-md h-11"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />}
              Start Verification
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
