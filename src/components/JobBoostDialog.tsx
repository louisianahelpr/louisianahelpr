import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket } from "lucide-react";
import { toast } from "sonner";

interface JobBoostDialogProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onBoosted: () => void;
}

export function JobBoostDialog({ jobId, open, onClose }: JobBoostDialogProps) {
  const [boosting, setBoosting] = useState(false);

  const handleBoost = async () => {
    setBoosting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-boost-payment", {
        body: { job_id: jobId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No checkout URL returned");
      // Redirect to Stripe Checkout. The webhook will flip the boost flags
      // on the job once payment captures, so we don't update the DB here.
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err.message || "Failed to start boost checkout");
      setBoosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="!gap-4">
        <DialogHeader className="!text-left space-y-0">
          <span
            className="font-serif italic uppercase inline-flex items-center gap-1.5"
            style={{ fontSize: "0.62rem", color: "hsl(var(--gold-warm))", letterSpacing: "0.18em" }}
          >
            <Rocket className="w-3 h-3" /> Lift it to the top
          </span>
          <DialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{ fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
          >
            Boost your job.
          </DialogTitle>
          <p
            className="font-serif italic mt-1"
            style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Featured placement and a Boosted badge for 24 hours.
          </p>
        </DialogHeader>
        <div className="space-y-3">
          {/* Price card — parchment-gold pill recipe (matches Tip + Payout) */}
          <div
            className="rounded-2xl p-5 text-center"
            style={{
              background:
                "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
              border: "0.5px solid hsl(var(--gold-warm) / 0.30)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
                "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.28), " +
                "0 1px 2px hsl(var(--gold-warm) / 0.12), " +
                "0 8px 22px -6px hsl(var(--gold-warm) / 0.30)",
            }}
          >
            <p
              className="font-display italic font-bold tabular-nums leading-none"
              style={{ fontSize: "2.5rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
            >
              $3
            </p>
            <p
              className="font-serif italic mt-1.5"
              style={{ fontSize: "0.82rem", color: "hsl(var(--olivewood) / 0.78)" }}
            >
              One-time · runs for <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>24 hours</span>
            </p>
          </div>
          <ul className="space-y-1.5">
            {[
              "Featured placement at the top of the browse feed",
              "Gold \"Boosted\" badge on your post",
              "More applications, faster",
            ].map((perk) => (
              <li
                key={perk}
                className="font-serif italic flex items-start gap-2"
                style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}
              >
                <span
                  className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[0.6rem] font-bold mt-0.5"
                  style={{
                    background: "hsl(var(--gold-warm) / 0.18)",
                    color: "hsl(var(--gold-warm))",
                  }}
                >
                  ✓
                </span>
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter className="!gap-2">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md">Cancel</Button>
          <Button
            onClick={handleBoost}
            disabled={boosting}
            className="rounded-ds-md"
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
            <Rocket className="w-4 h-4 mr-1.5" />
            {boosting ? "Boosting…" : "Boost for $3"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
