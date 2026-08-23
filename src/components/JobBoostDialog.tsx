import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Rocket, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticError } from "@/lib/haptics";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { BOOST_FEE_CENTS, formatFeeUsd } from "@/lib/productPrices";

const BOOST_PRICE = formatFeeUsd(BOOST_FEE_CENTS);

interface JobBoostDialogProps {
  jobId: string;
  open: boolean;
  onClose: () => void;
  onBoosted?: () => void;
}

export function JobBoostDialog({ jobId, open, onClose, onBoosted }: JobBoostDialogProps) {
  const [boosting, setBoosting] = useState(false);
  const { profile } = useCurrentUser();
  // Elite-only perk: Boost is a top-tier subscriber benefit so the
  // upsell ladder reads Basic → Pro → Elite (each tier unlocks
  // something specific). Pro / Basic posters see the $3 paywall with
  // an upgrade nudge; Elite sees "Free boost." instead.
  const subTier = (profile?.subscription_tier ?? "free") as string;
  const subExp = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const subActive = subExp ? subExp > new Date() : false;
  const isSubscriber = subActive && subTier === "elite";

  const handleBoost = async () => {
    setBoosting(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-boost-payment", {
        body: { job_id: jobId },
      });
      // A non-2xx makes the SDK return a FunctionsHttpError whose message is
      // the unhelpful "Edge Function returned a non-2xx status code". The real,
      // user-facing reason lives in the response body — pull it out so we never
      // surface the raw SDK string.
      if (error) throw new Error(await functionErrorMessage(error, "We couldn't start your boost. Please try again."));
      if (data?.error) throw new Error(data.error);
      // Elite perk path — server flipped the boost flags directly and
      // returned `free: true`. No Stripe redirect needed.
      if (data?.free) {
        hapticSuccess();
        toast.success(data.message || "Job boosted — your post will lead the feed.");
        onBoosted?.();
        onClose();
        return;
      }
      if (!data?.url) throw new Error("No checkout URL returned");
      // Redirect to Stripe Checkout. The webhook will flip the boost flags
      // on the job once payment captures, so we don't update the DB here.
      hapticSuccess();
      window.location.href = data.url;
    } catch (err: any) {
      hapticError();
      toast.error(err.message || "Couldn't start your boost — try again?");
      setBoosting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="!gap-4">
        <DialogHero
          eyebrowClassName="inline-flex items-center gap-1.5"
          eyebrow={
            <>
              <Rocket className="w-3 h-3" /> Lift it to the top
            </>
          }
          title="Boost Your Job."
        />
        <div className="space-y-3">
          {/* Price card — parchment-gold pill recipe (matches Tip + Payout).
              Subscribers see "Included" instead of $3 since Boosted
              Visibility is bundled with their plan. */}
          <div
            className="rounded-2xl p-5 text-center"
            style={{
              background:
                "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
                "var(--surface-premium)",
              border: "0.5px solid hsl(var(--amber-tint) / 0.30)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
                "inset 0 0 0 0.5px hsl(var(--amber-tint) / 0.28), " +
                "0 1px 2px hsl(var(--amber-tint) / 0.12), " +
                "0 8px 22px -6px hsl(var(--amber-tint) / 0.30)",
            }}
          >
            {isSubscriber ? (
              <>
                <p
                  className="font-display italic font-bold leading-none text-ds-28"
                  style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
                >
                  Free boost.
                </p>
                <p
                  className="font-serif italic mt-1.5 text-ds-13"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  Runs for <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>24 hours</span>
                </p>
              </>
            ) : (
              <>
                <p
                  className="font-display italic font-bold tabular-nums leading-none text-ds-40"
                  style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
                >
                  {BOOST_PRICE}
                </p>
                <p
                  className="font-serif italic mt-1.5 text-ds-13"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  One-time · runs for <span className="not-italic font-display font-bold" style={{ color: "hsl(var(--ink-deep))" }}>24 hours</span>
                </p>
                <Link
                  to="/profile?tab=subscription"
                  onClick={onClose}
                  className="inline-flex items-center gap-1 mt-2 text-ds-12 font-sans font-semibold active:opacity-70 tap-44"
                  style={{ color: "hsl(var(--amber-tint))" }}
                >
                  <Sparkles className="w-3 h-3" /> Free with Elite · See plans
                </Link>
              </>
            )}
          </div>
          <ul className="space-y-1.5">
            {[
              "Featured placement at the top of the browse feed",
              "Gold \"Boosted\" badge on your post",
              "More applicants to choose from",
            ].map((perk) => (
              <li
                key={perk}
                className="font-serif italic flex items-start gap-2 text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                <span
                  className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-ds-10 font-bold mt-0.5"
                  style={{
                    background: "hsl(var(--amber-tint) / 0.18)",
                    color: "hsl(var(--amber-tint))",
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
            variant="primary"
            onClick={handleBoost}
            disabled={boosting}
            className="rounded-ds-md"
          >
            <Rocket className="w-4 h-4 mr-1.5" />
            {boosting ? "Boosting…" : isSubscriber ? "Boost — Included" : `Boost for ${BOOST_PRICE}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
