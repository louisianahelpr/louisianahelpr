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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            Cash Out Instantly
          </DialogTitle>
          <DialogDescription>
            Get your money in ~30 minutes to your debit card.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : quote ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Available balance</span>
                <span className="font-medium text-foreground">{fmt(quote.gross_cents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Instant payout fee (3% + $1, min $2)</span>
                <span className="font-medium text-destructive">−{fmt(quote.fee_cents)}</span>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="flex justify-between">
                <span className="font-semibold text-foreground">You'll receive</span>
                <span className="font-bold text-primary text-lg">{fmt(quote.net_cents)}</span>
              </div>
            </div>

            <div className="rounded-lg bg-muted/50 p-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                Arrives in ~30 minutes to your eligible debit card. Prefer to wait? Standard payouts
                are <strong>free</strong> and take 1–2 business days.
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!quote || processing || !!error}
            className="gap-2"
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
