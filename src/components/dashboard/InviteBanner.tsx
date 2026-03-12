import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Gift, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import SocialShare from "@/components/SocialShare";

const InviteBanner = ({ userId }: { userId: string }) => {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if dismissed this session
    if (sessionStorage.getItem("invite-banner-dismissed")) {
      setDismissed(true);
      return;
    }

    const load = async () => {
      const { data } = await supabase
        .from("referral_codes")
        .select("code")
        .eq("user_id", userId)
        .maybeSingle();

      if (data) {
        setReferralCode(data.code);
      } else {
        // Generate and create code
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        const { data: inserted } = await supabase
          .from("referral_codes")
          .insert({ user_id: userId, code })
          .select("code")
          .single();
        if (inserted) setReferralCode(inserted.code);
      }
    };
    load();
  }, [userId]);

  const copyCode = () => {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode);
    setCopied(true);
    toast.success("Referral code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("invite-banner-dismissed", "true");
  };

  if (dismissed || !referralCode) return null;

  return (
    <div className="relative rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 p-4">
      <button
        onClick={dismiss}
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Gift className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Invite friends, earn $5 each</p>
          <p className="text-xs text-muted-foreground">Share your code — you both earn $5 after their first job</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={copyCode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-mono text-sm font-bold tracking-widest hover:bg-primary/20 transition-colors"
          >
            {referralCode}
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <SocialShare
            url={`${window.location.origin}/signup?ref=${referralCode}`}
            text={`Join me on Helpr! Use code ${referralCode} and we both earn $5.`}
            compact
          />
        </div>
      </div>
    </div>
  );
};

export default InviteBanner;
