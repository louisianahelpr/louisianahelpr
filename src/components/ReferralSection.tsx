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
    <div className="h-full flex flex-col gap-2 overflow-hidden justify-start">
      <p className="text-[11px] text-muted-foreground leading-snug shrink-0">
        Invite friends — they enter your code at sign-up. When they complete their first job, <strong>you both earn $5</strong> (max 5 = $25).
      </p>

      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 space-y-2 shrink-0">
        <div className="text-center">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide font-medium">Your referral code</p>
          <p className="text-xl font-bold font-display text-primary tracking-widest leading-none mt-1">{referralCode}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 h-8" onClick={copyCode}>
            {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button size="sm" className="flex-1 h-8" onClick={shareLink}>
            <Share2 className="w-3.5 h-3.5 mr-1" /> Share
          </Button>
        </div>
        <div className="pt-1.5 border-t border-primary/10 flex justify-center">
          <SocialShare
            url={`https://www.louisianahelpr.com/signup?ref=${referralCode}`}
            text={`Join me on Helpr! Use my referral code ${referralCode} — once your first job is completed, we both earn $5.`}
            compact
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 shrink-0">
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <Users className="w-3 h-3 text-primary" />
            <p className="text-base font-bold text-foreground leading-none">{referralCount}</p>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5">Referrals</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <DollarSign className="w-3 h-3 text-primary" />
            <p className="text-base font-bold text-foreground leading-none">${totalCredits}</p>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5">Earned</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <Gift className="w-3 h-3 text-primary" />
            <p className="text-base font-bold text-foreground leading-none">${unredeemedCredits}</p>
          </div>
          <p className="text-[9px] text-muted-foreground mt-0.5">Available</p>
        </div>
      </div>

      {unredeemedCredits > 0 && (
        <div className="rounded-xl border border-border bg-card p-2.5 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">Cash out credits</p>
            <p className="text-[10px] text-muted-foreground truncate">
              {hasStripeAccount ? `$${unredeemedCredits.toFixed(2)} → Stripe` : "Connect Stripe to cash out"}
            </p>
          </div>
          <Button onClick={handleCashOut} disabled={cashingOut || !hasStripeAccount} size="sm" className="h-8">
            {cashingOut ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> …</>
            ) : (
              <><Banknote className="w-3.5 h-3.5 mr-1" /> ${unredeemedCredits.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-2.5 shrink-0">
        <h3 className="text-[11px] font-semibold text-foreground mb-1.5">How it works</h3>
        <div className="space-y-1">
          {[
            "Share your code with friends",
            "They enter it at sign-up",
            "They complete their first job — you both earn $5",
            "Cash out directly to your Stripe account",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-3.5 h-3.5 rounded-full bg-primary/10 text-primary text-[9px] flex items-center justify-center shrink-0 font-bold mt-0.5">
                {i + 1}
              </span>
              <p className="text-[11px] text-muted-foreground leading-snug">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReferralSection;
