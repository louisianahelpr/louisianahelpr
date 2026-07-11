import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Gift, Copy, Users, DollarSign, Check, Banknote, Loader2, Share2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useReferralData } from "@/hooks/useReferralData";
import { ErrorState } from "@/components/ui/ErrorState";
import { queryKeys } from "@/lib/queryKeys";
import { ReferralExtras } from "@/components/profile/ReferralExtras";
import { requireBiometric } from "@/lib/biometricGate";
import { shareNative } from "@/lib/nativeShare";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { formatPrice } from "@/lib/format";

/**
 * Single-screen referral dashboard. Backed by React Query (60s staleTime)
 * so revisits within the window are instant — no DB round-trip.
 */
const ReferralSection = ({ userId }: { userId: string }) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useReferralData(userId);
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
    hapticSuccess();
    toast.success("Referral code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  // Centralized share-body builder so the SMS shortcut, native share
  // sheet, and clipboard fallback all carry the exact same copy. The
  // code is included verbatim so the recipient can copy/paste it at
  // sign-up even if the link is stripped by a messaging app.
  const buildShareBody = (code: string) => {
    const url = `${window.location.origin}/signup?ref=${encodeURIComponent(code)}`;
    const text = `Join me on Louisiana Helpr — local job marketplace. Use code ${code} and we both earn $5 on your first job.`;
    return { url, text, combined: `${text}\n${url}` };
  };

  const shareReferral = async () => {
    if (!referralCode) return;
    hapticLight();
    const { url, text, combined } = buildShareBody(referralCode);
    // Native-first share chain (Capacitor Share Sheet → Web Share API →
    // clipboard) so the OS sheet is used on the iOS/Android shell instead
    // of the WKWebView navigator.share shim.
    await shareNative({
      title: "Louisiana Helpr",
      text,
      url,
      dialogTitle: "Share your referral",
      clipboardText: combined,
    });
  };

  // SMS-specific shortcut. `sms:` deep link is supported on iOS (Capacitor)
  // and Android browsers; opens the Messages app with the body and URL
  // pre-populated so the user only picks the recipient. iOS expects
  // `&body=` after a `?` (or `&` if there's a number already); we don't
  // pre-fill the number so `?body=` is correct.
  const shareViaSMS = () => {
    if (!referralCode) return;
    hapticLight();
    const { combined } = buildShareBody(referralCode);
    const href = `sms:?&body=${encodeURIComponent(combined)}`;
    // Use a transient <a> click rather than location.href so we don't
    // navigate-away the SPA on platforms that ignore the `sms:` scheme.
    const a = document.createElement("a");
    a.href = href;
    // Some Android browsers need this to avoid a "blocked" interstitial.
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCashOut = async () => {
    // Face ID / Touch ID gate before moving money. No-op on web and on
    // devices without enrolled biometrics (see requireBiometric).
    const ok = await requireBiometric("Confirm your referral cash-out");
    if (!ok) return;
    setCashingOut(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("cash-out-credits");
      if (error) throw error;
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`$${formatPrice(result.amount)} sent to your connected Stripe account!`);
        await queryClient.invalidateQueries({ queryKey: queryKeys.referral.byUser(userId) });
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
        <Skeleton className="h-10 w-full rounded-ds-sm" />
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
          <Skeleton className="h-16 rounded-ds-md" />
          <Skeleton className="h-16 rounded-ds-md" />
          <Skeleton className="h-16 rounded-ds-md" />
        </div>
        <div className="rounded-ds-md liquid-glass p-3 space-y-2 flex-1 min-h-0">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-4/6" />
        </div>
      </div>
    );
  }

  if (isError) {
    // A failed fetch would otherwise render the page with a blank
    // referral code and zeroed stats — show a recoverable error instead.
    return (
      <div className="h-full flex">
        <ErrorState onRetry={() => { void refetch(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Code card — hero of the page */}
      <div className="rounded-2xl liquid-glass border-2 border-primary/30 p-6 space-y-4 text-center"
        style={{
          background: "radial-gradient(70% 90% at 50% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%), hsl(var(--parchment) / 0.5)",
        }}
      >
        <p className="font-serif italic uppercase" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
          Your referral code
        </p>
        <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "2.5rem", color: "hsl(var(--primary))", letterSpacing: "0.18em" }}>
          {referralCode}
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="bark"
            size="sm"
            className="h-11 rounded-ds-md"
            onClick={shareReferral}
          >
            <Share2 className="w-4 h-4 mr-1.5" />
            Share
          </Button>
          {/* SMS shortcut — pre-fills the Messages app body with the
              code + signup URL so the user only picks recipients. */}
          <Button
            variant="outline"
            size="sm"
            className="h-11 rounded-ds-md"
            onClick={shareViaSMS}
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Text
          </Button>
          <Button variant="outline" size="sm" className="h-11 rounded-ds-md" onClick={copyCode}>
            {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="font-serif italic leading-snug" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
          When a friend completes their first job using your code, <span className="font-semibold not-italic" style={{ color: "hsl(var(--ink-deep))" }}>you both earn $5</span>. Up to 5 friends ($25 max).
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Users, label: "Referrals", value: String(referralCount) },
          { icon: DollarSign, label: "Earned", value: `$${totalCredits}` },
          { icon: Gift, label: "Available", value: `$${unredeemedCredits}` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-ds-md liquid-glass p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Icon className="w-3 h-3 text-primary" />
              <span className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                {label}
              </span>
            </div>
            <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.15rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {unredeemedCredits > 0 && (
        <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif italic uppercase" style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
              Ready to withdraw
            </p>
            <p className="font-display italic font-bold leading-tight" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))" }}>
              Cash out credits
            </p>
            <p className="font-serif italic leading-snug truncate" style={{ fontSize: "0.74rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              {hasStripeAccount ? `$${unredeemedCredits.toFixed(2)} → Stripe payout account` : "Connect Stripe to cash out"}
            </p>
          </div>
          <Button onClick={handleCashOut} disabled={cashingOut || !hasStripeAccount} size="sm" className="h-10 shrink-0">
            {cashingOut ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Cashing out</>
            ) : (
              <><Banknote className="w-4 h-4 mr-1.5" /> ${unredeemedCredits.toFixed(2)}</>
            )}
          </Button>
        </div>
      )}

      {/* QR + tier ladder — scan-in-person flow and a tactile sense of
          "next milestone, how far to go". Self-contained so we don't
          churn the parent on credit refreshes. */}
      <ReferralExtras
        referralCode={referralCode}
        referralCount={referralCount}
        totalEarned={totalCredits}
      />

      {/* How it works */}
      <div className="rounded-2xl liquid-glass p-5">
        <p className="font-serif italic uppercase mb-3" style={{ fontSize: "0.62rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
          How it works
        </p>
        <div className="space-y-3">
          {[
            "Share your code with friends",
            "They enter it at sign-up",
            "They complete their first job — you both earn $5",
            "Cash out directly to your Stripe account",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-display italic font-bold" style={{ fontSize: "0.78rem" }}>
                {i + 1}
              </span>
              <p className="font-serif italic leading-snug pt-0.5" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>
                {step}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReferralSection;
