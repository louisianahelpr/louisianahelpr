import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Zap, Loader2, Clock } from "lucide-react";

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
        setError(data?.error || error?.message || "Could not load quote");
        return;
      }
      setQuote(data);
    };
    getQuote();
  }, [open]);

  const handleConfirm = async () => {
    setProcessing(true);
    const { data, error } = await supabase.functions.invoke("instant-payout", {
      body: { action: "execute" },
    });
    setProcessing(false);

    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Payout failed");
      return;
    }

    toast.success(`$${(data.net_cents / 100).toFixed(2)} is on the way to your debit card!`);
    onOpenChange(false);
    onSuccess?.();
  };

  const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!gap-3">
        <DialogHeader className="!text-left space-y-0">
          <span
            className="font-serif italic uppercase inline-flex items-center gap-1.5"
            style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            <Zap className="w-3 h-3" /> Skip the wait
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Cash out instantly.
          </DialogTitle>
          <DialogDescription className="font-serif italic mt-1" style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.7)" }}>
            In your debit card in ~30 minutes.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
          </div>
        ) : error ? (
          <div
            className="rounded-ds-md p-4 font-serif italic"
            style={{
              fontSize: "0.85rem",
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
                  "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
                border: "0.5px solid hsl(var(--bark) / 0.22)",
                boxShadow:
                  "inset 0 1px 1px 0 rgba(255,255,255,0.6), " +
                  "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22)",
              }}
            >
              <p
                className="font-serif italic uppercase mb-1"
                style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Breakdown
              </p>
              <div className="flex justify-between text-[0.8rem]" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                <span className="font-serif italic">Available balance</span>
                <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{fmt(quote.gross_cents)}</span>
              </div>
              <div className="flex justify-between text-[0.8rem]" style={{ color: "hsl(var(--olivewood) / 0.78)" }}>
                <span className="font-serif italic">− Instant fee (3% + $1, min $2)</span>
                <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>−{fmt(quote.fee_cents)}</span>
              </div>
              <div
                className="flex justify-between items-baseline pt-2 mt-1.5"
                style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
              >
                <span className="font-display italic font-bold" style={{ fontSize: "0.9rem", color: "hsl(var(--ink-deep))" }}>You receive</span>
                <span
                  className="font-display italic font-bold tabular-nums"
                  style={{ fontSize: "1.4rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
                >
                  {fmt(quote.net_cents)}
                </span>
              </div>
            </div>

            <div
              className="rounded-ds-md flex items-start gap-2.5 px-3 py-2.5"
              style={{ background: "hsl(var(--ivory-sand) / 0.4)" }}
            >
              <Clock className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.6)" }} />
              <p className="font-serif italic leading-snug" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.78)" }}>
                Arrives in ~30 minutes. Prefer to wait? Standard payouts are{" "}
                <strong className="not-italic font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>free</strong> and take 1–2 business days.
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={processing} className="rounded-ds-md">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!quote || processing || !!error}
            className="gap-2 rounded-ds-md"
            style={{
              background: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px hsl(var(--bark) / 0.18), 0 8px 20px -6px hsl(var(--bark) / 0.34)",
            }}
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Processing…
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" /> Cash out {quote ? fmt(quote.net_cents) : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InstantPayoutDialog;
