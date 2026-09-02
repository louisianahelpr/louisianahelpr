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
import { BadgeDollarSign, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { getPublicReturnUrl } from "@/lib/authRedirects";
import { track, AhaEvent } from "@/lib/analytics";
import { awardBlockCopy, type AwardBlockReason } from "@/lib/awardGate";

/**
 * The blocked state for a helper who cannot yet be awarded a job.
 *
 * This screen carries a lot of weight. On today's live data NO account passes
 * the identity check — the column defaults false with no backfill — so for now
 * this dialog is what every helper sees the first time they try to take work.
 * The bar is deliberate (owner's call; the app is pre-launch), which makes it
 * all the more important that this is not a dead end.
 *
 * So: it names WHICH of the two requirements is missing, says WHAT Stripe is
 * waiting on, and its primary button goes straight into the right Stripe flow —
 * never a disabled control with no explanation, which this codebase has shipped
 * before (see 41ff2120e and audit item R30).
 *
 * The identity path asks Stripe for `eventually_due`, not the default
 * `currently_due`. Without that the button is a loop: the helper completes
 * Stripe's flow, returns, and is blocked by the very field the link declined to
 * collect. See supabase/functions/stripe-connect/index.ts.
 */
export function AwardGateDialog({
  open,
  onOpenChange,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: AwardBlockReason;
}) {
  const [loading, setLoading] = useState(false);
  const copy = awardBlockCopy(reason);
  const Icon = reason === "helper_identity_unverified" ? ShieldCheck : BadgeDollarSign;

  const handleFix = async () => {
    setLoading(true);
    try {
      track(AhaEvent.PayoutSetupStarted, { action: "award_gate", reason });
      // `update_onboarding` needs an account to already exist; `onboard`
      // creates one. An identity block always implies an account (payouts are
      // enabled), so it takes the update path.
      const action = reason === "helper_identity_unverified" ? "update_onboarding" : "onboard";
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action, return_url: getPublicReturnUrl(), collect: copy.collect },
      });
      // A non-2xx makes the SDK return a FunctionsHttpError whose `.message` is
      // the useless "Edge Function returned a non-2xx status code"; the real
      // reason is in the JSON body.
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't open Stripe"));
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("Stripe didn't return a setup link — try again in a moment.");
      onOpenChange(false);
      await openExternalUrl(data.url);
    } catch (e: unknown) {
      hapticError();
      toast.error(e instanceof Error ? e.message : "Couldn't open Stripe — try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title={copy.title}
        />

        <DialogBody>
          <p>{copy.body}</p>
        </DialogBody>

        {/* The two requirements, with the failing one called out. Showing both
            answers the question the single-line version left open — "is this
            the only thing?" — which is the difference between one trip through
            Stripe and two. */}
        <div className="space-y-2 py-1">
          <RequirementRow
            label="Payout account connected"
            met={reason !== "helper_payout_setup_incomplete"}
          />
          <RequirementRow
            label="Identity verified by Stripe"
            met={false}
          />
        </div>

        <DialogFooter>
          <DialogSecondaryAction
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Not Now
          </DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleFix}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Icon className="w-4 h-4 mr-2" />
            )}
            {copy.ctaLabel}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequirementRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-ds-md"
      style={{
        background: "hsl(var(--ivory-sand) / 0.5)",
        border: "0.5px solid hsl(var(--olivewood) / 0.14)",
      }}
    >
      <span
        className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-ds-11 font-bold"
        style={
          met
            ? { background: "hsl(var(--sage) / 0.16)", color: "hsl(var(--sage))" }
            : { background: "hsl(var(--amber-tint) / 0.18)", color: "hsl(var(--amber-ink))" }
        }
        aria-hidden="true"
      >
        {met ? "✓" : "•"}
      </span>
      <span className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
        {label}
      </span>
      <span
        className="ml-auto text-ds-11 font-sans"
        style={{ color: met ? "hsl(var(--sage))" : "hsl(var(--amber-ink))" }}
      >
        {met ? "Done" : "Needed"}
      </span>
    </div>
  );
}
