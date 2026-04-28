import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Copy, Share2, Users, DollarSign, Check, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import SocialShare from "@/components/SocialShare";
import { nativeShare } from "@/lib/nativeShare";
import { hapticLight } from "@/lib/haptics";

interface ReferralCredit {
  id: string;
  amount: number;
  reason: string;
  redeemed: boolean;
  created_at: string;
}

/**
 * Single-screen, non-scrollable referral dashboard.
 * Designed to fit between the top + bottom nav frame on standard mobile
 * viewports (~640-820px tall content area). Uses flex-col + justify-between
 * so cards expand/compress to fill available space — no inner scroll.
 */
const ReferralSection = ({ userId }: { userId: string }) => {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [credits, setCredits] = useState<ReferralCredit[]>([]);
  const [referralCount, setReferralCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [hasStripeAccount, setHasStripeAccount] = useState(false);

  useEffect(() => {
    loadReferralData();
  }, [userId]);

  const generateCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  };

  const loadReferralData = async () => {
    const [codeRes, creditsRes, referralsRes, profileRes] = await Promise.all([
      supabase.from("referral_codes").select("code").eq("user_id", userId).maybeSingle(),
      supabase.from("referral_credits").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("referrals").select("*", { count: "exact", head: true }).eq("referrer_id", userId),
      supabase.from("profiles").select("stripe_account_id").eq("user_id", userId).single(),
    ]);

    if (codeRes.data) {
      setReferralCode(codeRes.data.code);
    } else {
      const newCode = generateCode();
      const { data: inserted, error } = await supabase
        .from("referral_codes")
        .insert({ user_id: userId, code: newCode })
        .select("code")
        .single();
      if (!error && inserted) setReferralCode(inserted.code);
    }

    if (creditsRes.data) setCredits(creditsRes.data as ReferralCredit[]);
    setReferralCount(referralsRes.count || 0);
    setHasStripeAccount(!!profileRes.data?.stripe_account_id);
    setLoading(false);
  };

  const copyCode = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    toast.success("Referral code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = async () => {
    if (!referralCode) return;
    hapticLight();
    const url = `https://www.louisianahelpr.com/signup?ref=${referralCode}`;
    await nativeShare({
      title: "Join Helpr!",
      text: `Sign up on Helpr with my referral code ${referralCode}. Complete your first job (post or work) and we both earn $5!`,
      url,
      dialogTitle: "Share your Helpr referral",
    });
  };

  const handleCashOut = async () => {
    setCashingOut(true);
    try {
      const { data, error } = await supabase.functions.invoke("cash-out-credits");
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
      } else {
        toast.success(`$${data.amount.toFixed(2)} sent to your connected Stripe account!`);
        await loadReferralData();
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
    <div className="h-full flex flex-col justify-between gap-3 overflow-hidden">
      {/* Intro — compact one-liner */}
      <p className="text-xs text-muted-foreground leading-snug shrink-0">
        Invite friends — they enter your code at sign-up. When they complete
        their first job, <strong>you both earn $5</strong> (max 5 = $25).
      </p>

      {/* Referral Code Card */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3 shrink-0">
        <div className="text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Your referral code</p>
          <p className="text-2xl font-bold font-display text-primary tracking-widest mt-0.5">{referralCode}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={copyCode}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button size="sm" className="flex-1" onClick={shareLink}>
            <Share2 className="w-4 h-4 mr-1" /> Share
          </Button>
        </div>
        <div className="pt-2 border-t border-primary/10 flex justify-center">
          <SocialShare
            url={`https://www.louisianahelpr.com/signup?ref=${referralCode}`}
            text={`Join me on Helpr! Use my referral code ${referralCode} — once your first job is completed, we both earn $5.`}
            compact
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5 text-primary" />
            <p className="text-xl font-bold text-foreground leading-tight">{referralCount}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">Referrals</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-primary" />
            <p className="text-xl font-bold text-foreground leading-tight">${totalCredits}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">Earned</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <Gift className="w-3.5 h-3.5 text-primary" />
            <p className="text-xl font-bold text-foreground leading-tight">${unredeemedCredits}</p>
          </div>
          <p className="text-[10px] text-muted-foreground">Available</p>
        </div>
      </div>

      {/* Cash Out (only when there's something to cash out) */}
      {unredeemedCredits > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">Cash out credits</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {hasStripeAccount
                ? `$${unredeemedCredits.toFixed(2)} → Stripe`
                : "Connect Stripe in Profile to cash out"}
            </p>
          </div>
          <Button onClick={handleCashOut} disabled={cashingOut || !hasStripeAccount} size="sm">
            {cashingOut ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> …</>
            ) : (
              <><Banknote className="w-4 h-4 mr-1" /> ${unredeemedCredits.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}

      {/* How it works — flex-1 fills remaining space */}
      <div className="rounded-xl border border-border bg-card p-3 flex-1 min-h-0 overflow-hidden">
        <h3 className="text-xs font-semibold text-foreground mb-2">How it works</h3>
        <div className="space-y-1.5">
          {[
            "Share your code with friends",
            "They enter it at sign-up (only at registration)",
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
