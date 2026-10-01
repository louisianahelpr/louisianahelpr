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
import { BadgeDollarSign, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { toast } from "sonner";
import { hapticError } from "@/lib/haptics";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { getPublicReturnUrl } from "@/lib/authRedirects";
import { track, AhaEvent } from "@/lib/analytics";
import { awardBlockCopy, type AwardBlockReason } from "@/lib/awardGate";
import { userFacingError } from "@/lib/userFacingError";

/**
 * The blocked state for a helper who cannot yet be awarded a job.
 *
 * This screen carries a lot of weight: it is what a helper sees the first time
 * they try to take work and cannot. The one requirement is a payout account
 * (identity verification stopped being one on 2026-10-01, migration
 * 20261001222911), so it says what is missing and its primary button goes
 * straight into Stripe's payout setup, never a disabled control with no
 * explanation, which this codebase has shipped before (see 41ff2120e and audit
 * item R30).
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
  const handleFix = async () => {
    setLoading(true);
    try {
      track(AhaEvent.PayoutSetupStarted, { action: "award_gate", reason });
      const { data, error } = await supabase.functions.invoke("stripe-connect", {
        body: { action: "onboard", return_url: getPublicReturnUrl(), collect: copy.collect },
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
      toast.error(userFacingError(e, "Couldn't open Stripe — try again in a moment."));
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

        {/* The requirement, called out as met or needed. */}
        <div className="space-y-2 py-1">
          <RequirementRow
            label="Payout account connected"
            met={reason !== "helper_payout_setup_incomplete"}
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
              <BadgeDollarSign className="w-4 h-4 mr-2" />
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
