import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "sonner";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { isNativePlatform } from "@/lib/nativeInit";
import { userFacingError } from "@/lib/userFacingError";
import { report } from "@/lib/errorLogger";
import { currentScreen } from "@/lib/currentScreen";
import { TipCostBreakdown, TipTotalHint } from "@/components/TipCostBreakdown";
import { TIP_MAX_CENTS, TIP_MIN_CENTS } from "../../supabase/functions/_shared/tipFees";

interface TipDialogProps {
  jobId: string;
  helperName?: string;
  /** On a GROUP job, the crew member being tipped (Q407: a crew has no lead,
   *  so the server needs to be told who). Ignored on a single-helper job. */
  helperId?: string;
  open: boolean;
  onClose: () => void;
}

const SUGGESTED_AMOUNTS = [5, 10, 20];

export function TipDialog({ jobId, helperName, helperId, open, onClose }: TipDialogProps) {
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [sending, setSending] = useState(false);
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHero
          /* Helper names arrive abbreviated ("Camille R."), so the template's
             own period doubled it up — "Send a tip to Camille R..". */
          title={`Send a tip${helperName ? ` to ${helperName.replace(/\.$/, "")}` : ""}.`}
        />
        {/* Relocated OUT of DialogHero's `subtitle` (2026-07-25 "one main
            title": headers show a title and nothing else). Not dropped —
            this is a fee disclosure, which a sighted
            user has to be able to read. The `subtitle` prop is gone from the
            hero above rather than left sr-only, so screen readers hear it
            once, here, instead of twice. */}
        <DialogBody>
          <p>Your Helpr receives 100% of your tip. The card-processing fee is added on top, so each amount shows what you pay.</p>
        </DialogBody>
        <div className="space-y-4">
          {/* Suggested amounts — celebratory tier-styled pills first
              since most people pick from quick-picks rather than typing. */}
          <div>
            <div className="grid grid-cols-3 gap-2">
              {SUGGESTED_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className="h-14 rounded-2xl font-sans font-bold tabular-nums transition-all active:scale-[0.97] disabled:opacity-60 text-ds-18"
                  style={{
                    background:
                      "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                      "var(--surface-premium)",
                    border: "0.5px solid hsl(var(--burnt-sienna) / 0.30)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.02em",
                    boxShadow:
                      "inset 0 1px 1px 0 rgba(255,255,255,0.55), " +
                      "inset 0 0 0 0.5px hsl(var(--burnt-sienna) / 0.22), " +
                      "0 1px 2px hsl(var(--burnt-sienna) / 0.12), " +
                      "0 6px 14px -4px hsl(var(--burnt-sienna) / 0.28)",
                  }}
                  onClick={() => handleSend(amt)}
                  disabled={sending}
                >
                  ${amt}
                  <TipTotalHint tipDollars={amt} />
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
            <span className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Or custom
            </span>
            <div className="h-px flex-1" style={{ background: "hsl(var(--olivewood) / 0.12)" }} />
          </div>

          {/* Custom amount */}
          <div className="flex gap-2">
            <CurrencyInput
              id="tip-dialog-amount"
              className="flex-1"
              value={amount}
              onChange={setAmount}
              min={TIP_MIN_CENTS / 100}
              aria-label="Tip amount in dollars"
            />
            <Button
              variant="primary"
              className="h-12 px-5 rounded-ds-md"
              onClick={() => handleSend(amount ?? 0)}
              disabled={sending || amount === undefined || amount <= 0}
            >
              {sending ? "Sending…" : "Send Tip"}
            </Button>
          </div>
          {amount !== undefined && amount >= 1 && amount <= 1000 && <TipCostBreakdown tipDollars={amount} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
