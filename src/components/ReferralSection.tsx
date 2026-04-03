import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Gift, Copy, Share2, Users, DollarSign, Check, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import SocialShare from "@/components/SocialShare";

interface ReferralCredit {
  id: string;
  amount: number;
  reason: string;
  redeemed: boolean;
  created_at: string;
}

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

  const shareLink = () => {
    if (!referralCode) return;
    const url = `${window.location.origin}/signup?ref=${referralCode}`;
    if (navigator.share) {
      navigator.share({
        title: "Join Helpr!",
        text: `Sign up on Helpr with my referral code ${referralCode}. Complete your first job (post or work) and we both earn $5!`,
        url,
      }).catch(() => {
        navigator.clipboard.writeText(url);
        toast.success("Referral link copied!");
      });
    } else {
      navigator.clipboard.writeText(url);
      toast.success("Referral link copied!");
    }
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
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading referral info…</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
          Invite friends to Helpr — they must enter your code <strong>during sign-up</strong> (it can't be added later). Once the person you referred completes their first job — whether they posted it or worked it — <strong>you both</strong> earn $5! The bonus is only awarded after a job is fully completed. <strong>You must also have at least one completed job</strong> (as a poster or helpr) to be eligible for the referral bonus.
        </p>

      {/* Referral Code Card */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Your referral code</p>
          <p className="text-3xl font-bold font-display text-primary tracking-widest mt-1">{referralCode}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={copyCode}>
            {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
            {copied ? "Copied!" : "Copy code"}
          </Button>
          <Button className="flex-1" onClick={shareLink}>
            <Share2 className="w-4 h-4 mr-1" /> Share link
          </Button>
        </div>
        <div className="pt-2 border-t border-primary/10">
          <p className="text-xs text-muted-foreground mb-2 text-center">Or share on social media</p>
          <div className="flex justify-center">
            <SocialShare
              url={`${window.location.origin}/signup?ref=${referralCode}`}
              text={`Join me on Helpr! Use my referral code ${referralCode} — once your first job is completed, we both earn $5.`}
              compact
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Users className="w-4 h-4 text-primary" />
            <p className="text-2xl font-bold text-foreground">{referralCount}</p>
          </div>
          <p className="text-xs text-muted-foreground">Referrals</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <DollarSign className="w-4 h-4 text-primary" />
            <p className="text-2xl font-bold text-foreground">${totalCredits}</p>
          </div>
          <p className="text-xs text-muted-foreground">Total Earned</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-center">
          <div className="flex items-center justify-center gap-1">
            <Gift className="w-4 h-4 text-primary" />
            <p className="text-2xl font-bold text-foreground">${unredeemedCredits}</p>
          </div>
          <p className="text-xs text-muted-foreground">Available</p>
        </div>
      </div>

      {/* Cash Out Button */}
      {unredeemedCredits > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Cash out your credits</p>
              <p className="text-xs text-muted-foreground">
                {hasStripeAccount
                  ? `$${unredeemedCredits.toFixed(2)} available — transfers to your connected Stripe account`
                  : "Connect a Stripe account in your Profile to cash out"}
              </p>
            </div>
            <Button
              onClick={handleCashOut}
              disabled={cashingOut || !hasStripeAccount}
              size="sm"
            >
              {cashingOut ? (
                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Processing…</>
              ) : (
                <><Banknote className="w-4 h-4 mr-1" /> Cash out ${unredeemedCredits.toFixed(2)}</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">How it works</h3>
        <div className="space-y-2">
          {[
            "Share your unique referral code with friends",
            "They enter it during sign-up — the code can only be used at registration",
            "Once the person you referred completes their first job — whether they posted it or worked it — you both earn $5",
            "You must also have at least one completed job yourself to qualify for the bonus",
            "Cash out credits directly to your connected Stripe account",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-bold mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-muted-foreground">{step}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Credit History */}
      {credits.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Credit History</h3>
          {credits.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {c.reason === "referrer_bonus" ? "Referral bonus" : "First job bonus"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">+${Number(c.amount).toFixed(2)}</p>
                <p className={`text-[10px] ${c.redeemed ? "text-muted-foreground" : "text-primary"}`}>
                  {c.redeemed ? "Cashed out" : "Available"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReferralSection;
