import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Camera, FileCheck2, Loader2, RefreshCw, AlertTriangle, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

  // Owner policy (Lexi 2026-05-06): one Stripe Identity attempt per user.
  // If it fails, no self-service retry — admin reviews manually via
  // AdminIDVQueue. Saves Stripe Identity costs on dead accounts and on
  // users repeatedly failing automated checks. The 'failed' /
  // 'requires_input' states therefore route into the "admin review" UI,
  // not a "try again" CTA.
  const isAdminReview =
    status === "failed" || status === "requires_input" || status === "manual_review";
  const isPending = status === "processing";

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-idv-start", { body: {} });
      if (error) throw error;
      if (data?.alreadyVerified) {
        toast.success("You're already verified!");
        onOpenChange(false);
        onLaunched?.();
        return;
      }
      if (!data?.url) throw new Error("Could not start verification");
      window.open(data.url, "_blank", "noopener,noreferrer");
      toast.info(
        isRetry
          ? "New verification opened in a new tab."
          : "Verification opened in a new tab. Come back when it's done.",
      );
      onOpenChange(false);
      onLaunched?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not start verification";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const headline = isAdminReview
    ? "Verification under admin review"
    : isPending
      ? "Verification in progress"
      : "Verify your identity";

  const Icon = isAdminReview ? Hourglass : isPending ? Hourglass : ShieldCheck;

  const description = isAdminReview
    ? "Your verification didn't auto-pass. An admin will review your submission manually within 24 hours. You'll get a notification when it's resolved."
    : isPending
      ? "We've received your documents and are reviewing them. This usually finishes in a few minutes."
      : (reason ?? "Helpr requires a quick ID + selfie check before you accept your first job. This protects posters and keeps the platform safe.");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-[12px] p-5">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <DialogTitle>{headline}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Admin-review state — show Stripe's reason for transparency, but
            no self-service retry CTA. Per owner policy, Stripe Identity is
            charged once; failures route to manual admin review. */}
        {isAdminReview && (
          <div className="flex items-start gap-3 p-3 rounded-[12px] bg-amber-500/10 border border-amber-500/30 mt-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-foreground">
              <p className="font-medium">What happened</p>
              <p className="text-xs text-muted-foreground mt-1">
                {failureReason || "Stripe couldn't confirm your identity automatically from the photos provided."}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                An admin will review your ID upload manually. You'll receive a notification when it's resolved — typically within 24 hours.
              </p>
            </div>
          </div>
        )}

        {!isAdminReview && !isPending && (
          <div className="space-y-3 py-2">
            <div className="flex items-start gap-3 p-3 rounded-[12px] bg-muted/40 border border-border">
              <FileCheck2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">Photo of your government ID</p>
                <p className="text-muted-foreground text-xs">Driver's license, passport, or state ID</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-[12px] bg-muted/40 border border-border">
              <Camera className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-foreground">A quick selfie</p>
                <p className="text-muted-foreground text-xs">We compare it to your ID to make sure it's really you</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Verification is handled securely by Stripe Identity. Most checks finish in under 2 minutes.
            </p>
          </div>
        )}

        {isPending && (
          <p className="text-xs text-muted-foreground px-1 py-2">
            You'll get a notification as soon as the review finishes. No need to do anything else right now.
          </p>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading} className="rounded-[12px]">
            {isPending || isAdminReview ? "OK" : "Not now"}
          </Button>
          {!isPending && !isAdminReview && (
            <Button onClick={handleStart} disabled={loading} className="rounded-[12px]">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />}
              Start verification
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
