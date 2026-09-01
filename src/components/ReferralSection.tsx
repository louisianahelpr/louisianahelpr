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
import { getPublicSiteUrl } from "@/lib/authRedirects";
import { requireBiometric } from "@/lib/biometricGate";
import { shareNative, copyToClipboard } from "@/lib/nativeShare";
import { isNativePlatform } from "@/lib/nativeInit";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { formatPriceExact } from "@/lib/format";

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

  /**
   * Does this device have anything registered for the `sms:` scheme?
   *
   * There is no feature test for a URL scheme, so this is the same proxy the
   * rest of the app uses: the native shell always has Messages, and on the web
   * only a phone/tablet does. Read once at mount — it cannot change for the
   * life of the page, and computing it in render would make the button count
   * depend on which render happened to run first.
   */
  const [canSms] = useState(
    () =>
      isNativePlatform ||
      (typeof navigator !== "undefined" &&
        /iphone|ipad|ipod|android|mobile/i.test(navigator.userAgent || "")),
  );

  const copyCode = async () => {
    if (!referralCode) return;
    // copyToClipboard tries navigator.clipboard first, then falls back to a
    // detached-textarea execCommand("copy") — needed inside the Capacitor
    // WKWebView and on insecure origins where navigator.clipboard is either
    // missing or rejects outside a live user gesture.
    if (await copyToClipboard(referralCode)) {
      setCopied(true);
      hapticSuccess();
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(`Couldn't copy — your code is ${referralCode}`);
    }
  };

  // Centralized share-body builder so the SMS shortcut, native share
  // sheet, and clipboard fallback all carry the exact same copy. The
  // code is included verbatim so the recipient can copy/paste it at
  // sign-up even if the link is stripped by a messaging app.
  const buildShareBody = (code: string) => {
    // Canonical origin, NOT `window.location.origin` — inside the shipped
    // iOS/Android build the page origin is `capacitor://localhost`, which
    // resolves to nothing on the recipient's phone.
    const url = `${getPublicSiteUrl()}/signup?ref=${encodeURIComponent(code)}`;
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
        await queryClient.invalidateQueries({ queryKey: queryKeys.referral.byUser(userId) });
      }
    } catch (err: any) {
      toast.error(err.message || "Couldn't cash out — try again?");
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
        <ErrorState variant="inline" onRetry={() => { void refetch(); }} />
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
        <p className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
          Your referral code
        </p>
        <p className="font-display italic font-bold tabular-nums leading-none text-ds-40" style={{ color: "hsl(var(--primary))", letterSpacing: "0.18em" }}>
          {referralCode}
        </p>
        <div className={canSms ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
          <Button
            variant="primary"
            size="sm"
            className="h-11 rounded-ds-md"
            onClick={shareReferral}
          >
            <Share2 className="w-4 h-4 mr-1.5" />
            Share
          </Button>
          {/* SMS shortcut — pre-fills the Messages app body with the
              code + signup URL so the user only picks recipients.

              Rendered ONLY where an `sms:` handler exists. `shareViaSMS`
              clicks a transient <a href="sms:…">, and a platform with nothing
              registered for that scheme drops it on the floor: no navigation,
              no error, no way for the page to detect it. On a desktop browser
              this button was therefore a guaranteed silent no-op — the exact
              "tap does nothing and says nothing" shape this share lane exists
              to remove. Share and Copy both work everywhere and cover the same
              need, so the honest move is not to offer the third option where
              it cannot work. */}
          {canSms && (
          <Button
            variant="outline"
            size="sm"
            className="h-11 rounded-ds-md"
            onClick={shareViaSMS}
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            Text
          </Button>
          )}
          <Button variant="outline" size="sm" className="h-11 rounded-ds-md" onClick={copyCode}>
            {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="font-serif italic leading-snug text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {/* "Up to 5 friends ($25 max)" was wrong for exactly the users this
              program creates. `enforce_referral_cap` counts a user's
              referrer_bonus AND first_job_bonus rows against one cap of 5, so
              anyone who themselves arrived through a referral link has already
              spent a slot and can only ever be paid for FOUR friends. Verified
              by running the live trigger in PGlite: the referrer topped out at
              $25 across 5 credits and the 6th was silently suppressed. The
              enforced ceiling is the dollar figure, so that is what we state. */}
          When a friend completes their first job using your code, <span className="font-semibold not-italic" style={{ color: "hsl(var(--ink-deep))" }}>you both earn $5</span>, up to $25 in referral credits.
        </p>
      </div>

      {/* Stat tiles.
          "Earned" and "Available" are two different reductions over the
          SAME `credits` array (see useReferralData) — not two sources of
          truth. They read identical until a cash-out actually happens:
          Earned = lifetime total (redeemed + unredeemed); Available =
          unredeemed only, i.e. what a cash-out would move to Stripe right
          now. Labeled explicitly below so two equal numbers don't read as
          a duplicate-counting bug before the first cash-out. */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Users, label: "Referrals", value: String(referralCount) },
          // formatPriceExact, NOT raw interpolation. `$${totalCredits}` printed
          // the JS number verbatim, so a $12.50 balance rendered "$12.5" in this
          // tile while the cash-out button beside it (which already used
          // formatPriceExact) rendered "$12.50" and the rank card below it used
          // formatPrice and rendered "$13". Three spellings of one balance on
          // one screen. Credits are money: they use the exact formatter.
          { icon: DollarSign, label: "Total earned", value: `$${formatPriceExact(totalCredits)}` },
          { icon: Gift, label: "To cash out", value: `$${formatPriceExact(unredeemedCredits)}` },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-ds-md liquid-glass p-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-1 min-h-[1.5rem]">
              <Icon className="w-3 h-3 text-primary shrink-0" />
              {/* min-h + items-center keeps the three numbers on ONE baseline.
                  "Total earned" wraps to two lines at 320/375 while its two
                  siblings stay on one, which pushed the middle tile's figure a
                  line lower than the numbers either side of it. */}
              <span className="font-serif italic uppercase text-ds-10" style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}>
                {label}
              </span>
            </div>
            <p className="font-display italic font-bold tabular-nums leading-none text-ds-18" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {unredeemedCredits > 0 && (
        <div className="rounded-2xl liquid-glass p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display italic font-bold leading-tight text-ds-17" style={{ color: "hsl(var(--ink-deep))" }}>
              Cash out credits
            </p>
            <p className="font-serif italic leading-snug truncate text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {hasStripeAccount ? `$${formatPriceExact(unredeemedCredits)} → Stripe payout account` : "Connect Stripe to cash out"}
            </p>
          </div>
          <Button onClick={handleCashOut} disabled={cashingOut || !hasStripeAccount} size="sm" className="h-10 shrink-0">
            {cashingOut ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Cashing Out</>
            ) : (
              <><Banknote className="w-4 h-4 mr-1.5" /> ${formatPriceExact(unredeemedCredits)}</>
            )}
          </Button>
        </div>
      )}

      {/* Tier ladder — a tactile sense of "next milestone, how far to go".
          Self-contained so we don't churn the parent on credit refreshes. */}
      <ReferralExtras
        referralCount={referralCount}
        totalEarned={totalCredits}
      />

      {/* How it works */}
      <div className="rounded-2xl liquid-glass p-5">
        <div className="space-y-3">
          {[
            "Share your code with friends",
            "They enter it at sign-up",
            "Once their first job is fully completed — whether they posted it or worked it — you both earn $5",
            "Cash out directly to your Stripe account",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-display italic font-bold text-ds-12">
                {i + 1}
              </span>
              <p className="font-serif italic leading-snug pt-0.5 text-ds-14" style={{ color: "hsl(var(--ink-deep))" }}>
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
