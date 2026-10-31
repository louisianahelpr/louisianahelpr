import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { formatPriceExact } from "@/lib/format";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import { currentScreen } from "@/lib/currentScreen";
import { TipCostBreakdown, TipPicker, centsLabel, useTipJob } from "@/components/TipCostBreakdown";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "../../supabase/functions/_shared/tipFees";
import { tipsNotReadyLine, useHelprTakesTips, useTipWaitsOnId } from "@/hooks/useHelprTakesTips";

interface TipDialogProps {
  jobId: string;
  helperName?: string;
  /** On a GROUP job, the crew member being tipped (Q407: a crew has no lead,
   *  so the server needs to be told who). Ignored on a single-helper job. */
  helperId?: string;
  open: boolean;
  onClose: () => void;
}

export function TipDialog({ jobId, helperName, helperId, open, onClose }: TipDialogProps) {
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const tipJob = useTipJob(jobId);
  // F29: a Helpr who can't receive a tip is told so here, not at the last tap.
  const takesTips = useHelprTakesTips(helperId ?? tipJob?.helperId, open);
  const waitsOnId = useTipWaitsOnId(helperId ?? tipJob?.helperId, open);
  // ME-007: one id per opening of the prompt. The server salts the Stripe
  // idempotency key with it, so a retry while open collapses onto one
  // session and a deliberate second tip after reopening gets its own.
  const tipAttemptIdRef = useRef<string>(crypto.randomUUID());
  useEffect(() => {
    if (open) tipAttemptIdRef.current = crypto.randomUUID();
  }, [open]);

  const handleSend = async (rawTip: number) => {
    if (isNaN(rawTip) || rawTip <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    /*
     * ROUND TO WHOLE CENTS HERE, with the server's own rule.
     *
     * `CurrencyInput` deliberately keeps a single decimal point and formats
     * with `toString` rather than `toFixed`, "so the user can keep editing the
     * trailing" digit — so a typed `10.555` reaches this handler intact. The
     * server then does `Math.round(amount * 100)` (create-payment/index.ts:1063)
     * = 1056 and charges $10.56, while the dialog showed $10.555 and nothing
     * anywhere said the number changed.
     *
     * That is the same defect found in the gift-card flow on 2026-09-20
     * (GiftCard.tsx:134), from the same cause: the client sent a fractional
     * cent and let the server silently resolve it. Rounding here means the
     * number on screen, the number the tip bounds are checked against,
     * and the number Stripe charges are one number. Whole-dollar presets are
     * unaffected.
     */
    const tipAmount = Math.round(rawTip * 100) / 100;
    // create-payment's own bound (TIP_MIN_CENTS..TIP_MAX_CENTS), checked here
    // so an out-of-range amount never round-trips to a server error (ME-017 #2).
    if (tipAmount * 100 < TIP_MIN_CENTS || tipAmount * 100 > TIP_MAX_CENTS) {
      toast.error(`Tips must be between $${TIP_MIN_CENTS / 100} and $${(TIP_MAX_CENTS / 100).toLocaleString("en-US")}.`);
      return;
    }
    hapticMedium();
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        // helperId: undefined on a single-helper job, dropped by JSON.
        body: { action: "tip", jobId, amount: tipAmount, tipAttemptId: tipAttemptIdRef.current, native: isNativePlatform, helperId },
      });
      // A non-2xx makes the SDK throw a FunctionsHttpError whose message is the
      // useless "Edge Function returned a non-2xx status code" — while the real
      // reason sits in the response body ("This helper hasn't set up their payout
      // account yet…"). Rethrowing `error` directly buried that, so a tip that
      // could never work reported a generic failure. Read the body first.
      if (error) throw new Error(await functionErrorMessage(error, "Couldn't send your tip — try again?"));
      if (data?.error) throw new Error(data.error);
      if (data?.url) { hapticSuccess(); await openExternalUrl(data.url, () => onClose()); }
      else throw new Error("Couldn't start checkout. Please try again.");
    } catch (err: unknown) {
      hapticError();
      report(err, { tags: { source: "money.tip", action: "tip", screen: currentScreen() }, context: { jobId } });
      toast.error(userFacingError(err, "Couldn't send your tip — try again?"));
    } finally {
      setSending(false);
    }
  };

  const tipValid = amount !== undefined && Math.round(amount * 100) >= TIP_MIN_CENTS && Math.round(amount * 100) <= TIP_MAX_CENTS; // whole cents, as sent
  const first = helperName ? helperName.trim().split(/\s+/)[0] : "";

  // Board 180 ("tip later"): the same step as the Job done screen's tip,
  // reached from the completed card or a notification.
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero moment title={first ? `Add a tip for ${first}?` : "Add a tip?"} />
        {takesTips === false ? (
          <>
            <p className="font-sans text-ds-13 text-foreground" data-testid="tips-not-ready">{tipsNotReadyLine(helperName, waitsOnId)}</p>
            <DialogFooter>
              <DialogPrimaryAction onClick={onClose}>OK</DialogPrimaryAction>
            </DialogFooter>
          </>
        ) : (
        <>
        <div className="space-y-3 min-w-0">
          <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Optional.{tipJob ? ` ${tipJob.title} · $${formatPriceExact(tipJob.shareDollars)}` : ""}
          </p>
          <TipPicker jobPriceDollars={tipJob?.shareDollars ?? null} valueDollars={amount} onChange={setAmount} />
          {tipValid && <TipCostBreakdown tipDollars={amount!} receiverName={helperName} />}
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>No tip</DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => handleSend(amount ?? 0)} disabled={sending || amount === undefined || amount <= 0}>
            {sending ? "Opening checkout…" : amount !== undefined && amount > 0 ? `Tip ${centsLabel(Math.round(amount * 100))}` : "Tip"}
          </DialogPrimaryAction>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
