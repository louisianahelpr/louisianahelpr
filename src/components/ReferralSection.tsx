import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Copy, Users, DollarSign, Check, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useReferralData } from "@/hooks/useReferralData";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Single-screen referral dashboard. Backed by React Query (60s staleTime)
 * so revisits within the window are instant — no DB round-trip.
 */
const ReferralSection = ({ userId }: { userId: string }) => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useReferralData(userId);
  const referralCode = data?.referralCode ?? null;
  const credits = data?.credits ?? [];
  const referralCount = data?.referralCount ?? 0;
  const hasStripeAccount = data?.hasStripeAccount ?? false;
  const loading = isLoading;

  const [copied, setCopied] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);

  const copyCode = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    toast.success("Referral code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCashOut = async () => {
    setCashingOut(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("cash-out-credits");
      if (error) throw error;
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`$${result.amount.toFixed(2)} sent to your connected Stripe account!`);
        await queryClient.invalidateQueries({ queryKey: queryKeys.referral(userId) });
      }
    } catch (err: any) {
      toast.error(err.message || "Cash-out failed. Please try again.");
    } finally {
      setCashingOut(false);
    }
  };

  const totalCredits = credits.reduce((sum, c) => sum + Number(c.amount), 0);
  const unredeemedCredits = credits.filter(c => !c.redeemed).reduce((sum, c) => sum + Number(c.amount), 0);

  if (loading) {
    // Skeleton mirrors the live single-screen layout exactly — no jump on load.
    return (
      <div className="h-full flex flex-col justify-between gap-3 overflow-hidden">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <Skeleton className="h-3 w-32 mx-auto" />
          <Skeleton className="h-9 w-48 mx-auto rounded-md" />
          <div className="flex gap-2">
            <Skeleton className="h-10 flex-1 rounded-md" />
            <Skeleton className="h-10 flex-1 rounded-md" />
          </div>
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
        <div className="rounded-xl border border-border bg-card p-3 space-y-2 flex-1 min-h-0">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto overscroll-contain pb-2">
      <p className="text-xs text-muted-foreground leading-relaxed shrink-0">
        Invite friends — they enter your code at sign-up. When they complete their first job, <strong>you both earn $5</strong> (max 5 = $25).
      </p>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3 shrink-0">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Your referral code</p>
          <p className="text-3xl font-bold font-display text-primary tracking-[0.2em] leading-none mt-2">{referralCode}</p>
        </div>
        <Button variant="default" size="sm" className="w-full h-10" onClick={copyCode}>
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? "Copied!" : "Copy code"}
        </Button>
        <p className="text-[10px] text-center text-muted-foreground leading-snug">
          Share your code with friends in any app — they enter it on the sign-up screen.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 shrink-0">
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5 text-primary" />
            <p className="text-lg font-bold text-foreground leading-none">{referralCount}</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Referrals</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-primary" />
            <p className="text-lg font-bold text-foreground leading-none">${totalCredits}</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Earned</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Gift className="w-3.5 h-3.5 text-primary" />
            <p className="text-lg font-bold text-foreground leading-none">${unredeemedCredits}</p>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Available</p>
        </div>
      </div>

      {unredeemedCredits > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Cash out credits</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {hasStripeAccount ? `$${unredeemedCredits.toFixed(2)} → Stripe` : "Connect Stripe to cash out"}
            </p>
          </div>
          <Button onClick={handleCashOut} disabled={cashingOut || !hasStripeAccount} size="sm" className="h-9">
            {cashingOut ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> …</>
            ) : (
              <><Banknote className="w-4 h-4 mr-1" /> ${unredeemedCredits.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3 shrink-0">
        <h3 className="text-xs font-semibold text-foreground mb-2">How it works</h3>
        <div className="space-y-2">
          {[
            "Share your code with friends",
            "They enter it at sign-up",
            "They complete their first job — you both earn $5",
            "Cash out directly to your Stripe account",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center shrink-0 font-bold mt-0.5">
                {i + 1}
              </span>
              <p className="text-xs text-muted-foreground leading-snug">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReferralSection;
