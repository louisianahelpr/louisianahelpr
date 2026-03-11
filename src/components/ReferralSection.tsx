import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Gift, Copy, Share2, Users, DollarSign, Check } from "lucide-react";
import { toast } from "sonner";

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

  useEffect(() => {
    loadReferralData();
  }, [userId]);

  const generateCode = () => {
    // Generate a 6-char alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // excluding confusing chars
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  };

  const loadReferralData = async () => {
    // Get or create referral code
    const { data: codeData } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .maybeSingle();

    if (codeData) {
      setReferralCode(codeData.code);
    } else {
      // Create one
      const newCode = generateCode();
      const { data: inserted, error } = await supabase
        .from("referral_codes")
        .insert({ user_id: userId, code: newCode })
        .select("code")
        .single();
      if (!error && inserted) {
        setReferralCode(inserted.code);
      }
    }

    // Load credits
    const { data: creditsData } = await supabase
      .from("referral_credits")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (creditsData) setCredits(creditsData as ReferralCredit[]);

    // Count referrals
    const { count } = await supabase
      .from("referrals")
      .select("*", { count: "exact", head: true })
      .eq("referrer_id", userId);
    setReferralCount(count || 0);

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
        text: `Sign up on Helpr with my referral code ${referralCode} and earn $5 credit when you post or complete your first job!`,
        url,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url);
      toast.success("Referral link copied!");
    }
  };

  const totalCredits = credits.reduce((sum, c) => sum + Number(c.amount), 0);
  const unredeemedCredits = credits.filter(c => !c.redeemed).reduce((sum, c) => sum + Number(c.amount), 0);

  if (loading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading referral info…</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
          <Gift className="w-6 h-6 text-primary" /> Referral Program
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Invite friends — you both earn $5 when they post or complete their first job!
        </p>
      </div>

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

      {/* How it works */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">How it works</h3>
        <div className="space-y-2">
          {[
            "Share your unique referral code with friends",
            "They enter it during signup to link the referral",
            "You both earn $5 when they post or complete their first job",
            "Credits can be applied to your next job payment",
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
                  {c.reason === "referrer_bonus" ? "Referral bonus" : "Signup bonus"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">+${Number(c.amount).toFixed(2)}</p>
                <p className={`text-[10px] ${c.redeemed ? "text-muted-foreground" : "text-primary"}`}>
                  {c.redeemed ? "Redeemed" : "Available"}
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
