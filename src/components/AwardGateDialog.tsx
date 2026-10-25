import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
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
import { ID_VERIFIED_LABEL } from "@/components/profile/IdVerifiedPill";
import { isNativePlatform } from "@/lib/nativeInit";
import { getPublicReturnUrl } from "@/lib/authRedirects";
import { track, AhaEvent } from "@/lib/analytics";
import { acceptPendingCopy, awardBlockCopy, type AcceptMissing, type AwardBlockReason } from "@/lib/awardGate";
import { userFacingError } from "@/lib/userFacingError";
import { openIdentityCheck } from "@/lib/identityCheck";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";

/**
 * What a Helpr sees when their accept needs Stripe setup first.
 *
 * Two modes. PENDING (`pendingMissing` set): they tapped Accept, the server
 * recorded it (accept_job_offer, 20261003193541), and this thanks them and
 * lists only the steps still missing, payout setup and/or Stripe ID; the accept
 * completes by itself when Stripe reports both done, and the poster is told
 * then (owner, 2026-10-03, docs/OPEN.md Q1180). BLOCKED (`reason` only): a
 * gate refusal from another path. Either way the primary button goes straight
 * into Stripe's setup, never a disabled control with no explanation, which
 * this codebase has shipped before (see 41ff2120e and audit item R30).
 */
export function AwardGateDialog({
  open,
  onOpenChange,
  reason,
  pendingMissing = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: AwardBlockReason;
  /** The accept is recorded and waits on these steps (accept_job_offer's `missing`). */
  pendingMissing?: readonly AcceptMissing[] | null;
}) {
  const [loading, setLoading] = useState(false);
  // ID check off (switch `identity_check`, owner 2026-10-23): no ID row at all.
  // A "✓ ID verified" row for a member who never verified would be false.
  const idOn = useIdentityCheckOnStore();
  const copy = pendingMissing ? acceptPendingCopy(pendingMissing) : awardBlockCopy(reason);
  const payoutMissing = pendingMissing ? pendingMissing.includes("payout_setup") : reason === "helper_payout_setup_incomplete";
  const idMissing = pendingMissing ? pendingMissing.includes("stripe_id") : reason === "helper_identity_unverified";
  // Owner ruling 2026-10-23: payout setup is paused while Stripe reviews our
  // account. With the payout step missing, the dialog says what happens next (no
  // 'paused' notice, owner 2026-10-25) and never calls stripe-connect; the ID check (its own sheet) still works.
  const setupPaused = usePayoutSetupPaused();
  const payoutPaused = setupPaused && payoutMissing;
  // While paused the "set up payouts, about two minutes" copy would contradict
  // the notice: say what happens to the accept instead (lh-silent-failure #1-2).
  const title = payoutPaused && !pendingMissing ? "Not booked yet" : copy.title;
  const body = !payoutPaused
    ? copy.body
    : pendingMissing
      ? `You're not booked yet. Your accept is saved and goes through once you can add a payout account${idMissing ? " and your ID is verified with Stripe" : ""}. Then we let the person who posted the job know.`
      : "This job can be booked for you once you can add a payout account.";
  // Stripe Identity (photo ID + selfie) is its own sheet, not part of payout
  // setup (owner 2026-10-21): with payouts done, the one CTA opens it.
  const openIdCheck = () => {
    onOpenChange(false);
    openIdentityCheck("accept");
  };
  const handleFix = async () => {
    if ((!payoutMissing || payoutPaused) && idMissing) {
      openIdCheck();
      return;
    }
    if (payoutPaused) return;
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
      // GO FIRST, CLOSE AFTER (owner, 2026-10-08: "I have to click Finish
      // Stripe Setup twice, the first time it just closed"). Closing first
      // ran the page's close handlers while the browser was starting the
      // move to Stripe, and a same-page URL update then can cancel that move:
      // the dialog closed and nothing else happened. On the web the page
      // leaves, so the dialog stays up with its spinner until it does; in the
      // app Stripe opens over it, and it closes once that sheet is up.
      await openExternalUrl(data.url);
      if (isNativePlatform) {
        onOpenChange(false);
        setLoading(false);
      }
    } catch (e: unknown) {
      hapticError();
      toast.error(userFacingError(e, "Couldn't open Stripe — try again in a moment."));
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHero
          title={title}
        />

        <DialogBody>
          <p>{body}</p>
        </DialogBody>

        {/* Both requirements, each called out as done or still needed. */}
        <div className="space-y-2 py-1">
          <RequirementRow label="Payout account connected" met={!payoutMissing} unmetLabel={payoutPaused ? "Later" : undefined} />
          {idOn && (
            <RequirementRow
              label={ID_VERIFIED_LABEL}
              met={!idMissing}
              action={payoutMissing && idMissing && !payoutPaused ? { label: "Verify", onClick: openIdCheck } : undefined}
            />
          )}
        </div>

        <DialogFooter>
          <DialogSecondaryAction
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {payoutPaused && !idMissing ? "OK" : pendingMissing ? "Later" : "Not Now"}
          </DialogSecondaryAction>
          {!(payoutPaused && !idMissing) && (
            <DialogPrimaryAction
              onClick={handleFix}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                payoutMissing && !payoutPaused ? <BadgeDollarSign className="w-4 h-4 mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />
              )}
              {payoutPaused ? "Verify my ID" : copy.ctaLabel}
            </DialogPrimaryAction>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequirementRow({ label, met, action, unmetLabel }: { label: string; met: boolean; action?: { label: string; onClick: () => void }; unmetLabel?: string }) {
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
      {action ? (
        <button type="button" onClick={action.onClick} className="ml-auto min-h-11 -my-2 px-2 text-ds-13 font-bold font-sans text-primary">
          {action.label}
        </button>
      ) : (
        <span
          className="ml-auto text-ds-11 font-sans"
          style={{ color: met ? "hsl(var(--sage))" : "hsl(var(--amber-ink))" }}
        >
          {met ? "Done" : (unmetLabel ?? "Needed")}
        </span>
      )}
    </div>
  );
}
