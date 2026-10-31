import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { Zap, Loader2, Clock } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { requireBiometric } from "@/lib/biometricGate";
import { functionErrorBody, functionErrorMessage } from "@/lib/supabaseResult";
import { INSTANT_PAYOUT_FEE_PERCENT } from "@/lib/instantPayoutFee";
import { STANDARD_PAYOUT_WINDOW } from "@/lib/payoutTiming";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface Quote {
  gross_cents: number;
  fee_cents: number;
  net_cents: number;
}

const InstantPayoutDialog = ({ open, onOpenChange, onSuccess }: Props) => {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // NIGHT-JOBSRE4-4: the quote failed to load (no word from the server), so asking again may work.
  const [quoteRetry, setQuoteRetry] = useState(false);
  // Jobs audit 54a: a failed cash-out replaces the offer. The old screen kept
  // "You receive $77.60" and a live Cash Out under a toast that faded.
  const [failure, setFailure] = useState<{ message: string; canRetry: boolean } | null>(null);

  const loadQuote = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQuoteRetry(false);
    setFailure(null);
    setQuote(null);
    const { data, error } = await supabase.functions.invoke("instant-payout", {
      body: { action: "quote" },
    });
    setLoading(false);
    if (error || data?.error) {
      // On a non-2xx the SDK's error.message is generic and `data` is null —
      // recover the edge function's real message (e.g. the below-$25 floor
      // notice) from the response body. See functionErrorMessage.
      const msg = data?.error || (error ? await functionErrorMessage(error, "") : "");
      setError(msg || "We couldn't get your cash-out amount. Check your connection, then tap Try again.");
      setQuoteRetry(!msg);
      return;
    }
    setQuote(data);
  }, []);

  useEffect(() => {
    if (open) void loadQuote();
  }, [open, loadQuote]);

  const handleConfirm = async () => {
    // Face ID / Touch ID gate before moving money. No-op on web. On device it
    // prompts whenever the device can authenticate its owner at all — falling back
    // to the passcode when biometry is unavailable or locked out (see
    // requireBiometric).
    const ok = await requireBiometric("Confirm your instant cash-out");
    if (!ok) return;
    setProcessing(true);
    const { data, error } = await supabase.functions.invoke("instant-payout", {
      body: { action: "execute" },
    });
    setProcessing(false);

    if (error || data?.error) {
      hapticError();
      // The server says what happened to the fee and whether another try is open.
      // No answer at all means nobody here knows: say that. Trying again stays
      // open because it only re-quotes, and the server refuses a second fee.
      const body = data?.error ? data : error ? await functionErrorBody(error) : null;
      setFailure({
        message: typeof body?.error === "string" && body.error.trim()
          ? body.error
          : "We couldn't confirm your instant payout. Check your balance before you try again.",
        canRetry: body?.can_retry !== false && body?.code !== "instant_fee_return_pending",
      });
      return;
    }

    hapticSuccess();
    onOpenChange(false);
    onSuccess?.();
  };

  // NIGHT-JOBSRE4-5: always with cents, like the wallet behind ("$80.00", not "$80").
  const fmt = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (failure) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHero title="Cash out didn't finish" />
          <div
            role="alert"
            className="rounded-ds-md p-4 font-sans text-ds-14"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            {failure.message}
          </div>
          <DialogFooter>
            <DialogSecondaryAction onClick={() => onOpenChange(false)}>Close</DialogSecondaryAction>
            {failure.canRetry && (
              <DialogPrimaryAction onClick={() => void loadQuote()}>Try again</DialogPrimaryAction>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Cash out instantly"
        />

        {/* Relocated OUT of DialogHero's `subtitle` (2026-07-25 "one main
            title": headers show a title and nothing else). Not dropped —
            this is a payout-timing statement, which a sighted
            user has to be able to read. The `subtitle` prop is gone from the
            hero above rather than left sr-only, so screen readers hear it
            once, here, instead of twice. */}
        <DialogBody>
          <p>Goes to your debit card in about 30 minutes.</p>
        </DialogBody>
        {loading ? (
          <div className="py-8 flex justify-center">
            <HelprSpinner size={32} delay={0} />
          </div>
        ) : error ? (
          <div
            className="rounded-ds-md p-4 font-sans text-ds-14"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            {error}
            {quoteRetry && (
              <div className="mt-3">
                <DialogSecondaryAction onClick={() => void loadQuote()}>Try again</DialogSecondaryAction>
              </div>
            )}
          </div>
        ) : quote ? (
          <div className="space-y-3">
            <div
              className="rounded-ds-md p-4 space-y-1.5"
              style={{
                background:
                  "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                  "var(--surface-premium)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255,255,255,0.6), " +
                  "inset 0 0 0 0.5px hsl(var(--burnt-sienna) / 0.22)",
              }}
            >
              <div className="flex justify-between text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span className="font-sans">Available balance</span>
                <span className="font-sans tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{fmt(quote.gross_cents)}</span>
              </div>
              <div className="flex justify-between text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span className="font-sans">− Instant fee ({INSTANT_PAYOUT_FEE_PERCENT}%)</span>
                <span className="font-sans tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>−{fmt(quote.fee_cents)}</span>
              </div>
              <div
                className="flex justify-between items-baseline pt-2 mt-1.5"
                style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
              >
                <span className="font-display font-bold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>You receive</span>
                <span
                  className="font-sans font-bold tabular-nums text-ds-22"
                  style={{ color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
                >
                  {fmt(quote.net_cents)}
                </span>
              </div>
            </div>

            <div
              className="rounded-ds-md flex items-start gap-2.5 px-3 py-2.5"
              style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}
            >
              <Clock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
              <p className="font-sans leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Prefer to wait? Standard payouts are{" "}
                <strong className="not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>free</strong> and land {STANDARD_PAYOUT_WINDOW}.
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <DialogSecondaryAction onClick={() => onOpenChange(false)} disabled={processing}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleConfirm}
            disabled={!quote || processing || !!error}
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Processing…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" /> Cash Out {quote ? fmt(quote.net_cents) : ""}
              </>
            )}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstantPayoutDialog;
