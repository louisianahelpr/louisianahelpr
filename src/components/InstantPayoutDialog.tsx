import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { Zap, Loader2, Clock } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { requireBiometric } from "@/lib/biometricGate";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { INSTANT_PAYOUT_FEE_PERCENT } from "@/lib/instantPayoutFee";
import { formatPriceExact } from "@/lib/format";

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

  useEffect(() => {
    if (!open) return;
    const getQuote = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase.functions.invoke("instant-payout", {
        body: { action: "quote" },
      });
      setLoading(false);
      if (error || data?.error) {
        // On a non-2xx the SDK's error.message is generic and `data` is null —
        // recover the edge function's real message (e.g. the below-$25 floor
        // notice) from the response body. See functionErrorMessage.
        setError(
          data?.error || (error ? await functionErrorMessage(error, "Couldn't load quote") : "Couldn't load quote")
        );
        return;
      }
      setQuote(data);
    };
    getQuote();
  }, [open]);

  const handleConfirm = async () => {
    // Face ID / Touch ID gate before moving money. No-op on web and on
    // devices without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric("Confirm your instant cash-out");
    if (!ok) return;
    setProcessing(true);
    const { data, error } = await supabase.functions.invoke("instant-payout", {
      body: { action: "execute" },
    });
    setProcessing(false);

    if (error || data?.error) {
      hapticError();
      toast.error(
        data?.error || (error ? await functionErrorMessage(error, "Payout failed") : "Payout failed")
      );
      return;
    }

    hapticSuccess();
    onOpenChange(false);
    onSuccess?.();
  };

  const fmt = (cents: number) => `$${formatPriceExact(cents / 100)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHero
          title="Cash Out Instantly"
        />

        {/* Relocated OUT of DialogHero's `subtitle` (2026-07-25 "one main
            title": headers show a title and nothing else). Not dropped —
            this is a payout-timing statement, which a sighted
            user has to be able to read. The `subtitle` prop is gone from the
            hero above rather than left sr-only, so screen readers hear it
            once, here, instead of twice. */}
        <p className="font-serif italic leading-relaxed text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          In your debit card in ~30 minutes.
        </p>
        {loading ? (
          <div className="py-8 flex justify-center">
            <HelprSpinner size={32} delay={0} />
          </div>
        ) : error ? (
          <div
            className="rounded-ds-md p-4 font-serif italic text-ds-14"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
              color: "hsl(var(--burnt-sienna))",
            }}
          >
            {error}
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
                <span className="font-serif italic">Available balance</span>
                <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{fmt(quote.gross_cents)}</span>
              </div>
              <div className="flex justify-between text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span className="font-serif italic">− Instant fee ({INSTANT_PAYOUT_FEE_PERCENT}%)</span>
                <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>−{fmt(quote.fee_cents)}</span>
              </div>
              <div
                className="flex justify-between items-baseline pt-2 mt-1.5"
                style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
              >
                <span className="font-display italic font-bold text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>You receive</span>
                <span
                  className="font-display italic font-bold tabular-nums text-ds-22"
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
              <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Arrives in ~30 minutes. Prefer to wait? Standard payouts are{" "}
                <strong className="not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>free</strong> and take 1–2 business days.
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={processing} className="rounded-ds-md">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={!quote || processing || !!error}
            className="gap-2 rounded-ds-md"
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
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstantPayoutDialog;
