import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Crown, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const tierConfig = [
  {
    id: "basic",
    name: "Basic",
    badge: "⭐",
    monthly: "$5/mo",
    annual: "$50/yr",
    oneTime: "$5 one-time",
    annualSave: "Save 17%",
    features: ["Helpr Badge", "Search Priority", "5-min Early Access"],
  },
  {
    id: "pro",
    name: "Pro",
    badge: "🔥",
    monthly: "$10/mo",
    annual: "$100/yr",
    oneTime: "$10 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Basic", "Boosted Visibility", "Portfolio Showcase", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    badge: "💎",
    monthly: "$15/mo",
    annual: "$150/yr",
    oneTime: "$15 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Landing Spotlight", "Auto-Match", "20-min Early Access"],
  },
];

export const SubscriptionTab = ({ profile, user: _user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "one_time">("annual");
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentTier = profile?.subscription_tier || null;
  const expiresAt = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  useEffect(() => {
    if (searchParams.get("pro") === "success") refreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const refreshSubscription = async () => {
    setRefreshing(true);
    try {
      await supabase.functions.invoke("check-pro-subscription");
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      toast.success("Subscription updated!");
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const handleManageSubscription = async () => {
    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("pro-customer-portal");
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to open portal");
    } finally {
      setLoadingPortal(false);
    }
  };

  const handleSubscribe = async (tier: string) => {
    setLoadingCheckout(tier);
    try {
      const billing_cycle = billingInterval === "one_time" ? "one_time" : billingInterval;
      const { data, error } = await supabase.functions.invoke("create-pro-checkout", {
        body: { tier, billing_cycle },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Checkout failed");
    } finally {
      setLoadingCheckout(null);
    }
  };

  const getPrice = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annual;
    if (billingInterval === "one_time") return tier.oneTime;
    return tier.monthly;
  };

  const getSaveBadge = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annualSave;
    return null;
  };

  const header = (
    <div
      className="flex items-center gap-2 px-4 bg-background/95 backdrop-blur-md border-b border-foreground/5"
      style={{
        paddingTop: "8px",
        paddingBottom: "8px",
        maxHeight: "60px",
      }}
    >
      <button
        onClick={onBack}
        className="h-9 w-9 -ml-1.5 rounded-xl flex items-center justify-center hover:bg-foreground/5 transition-colors text-foreground"
        aria-label="Go back"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="font-display text-[19px] font-bold leading-none tracking-tight text-foreground">
        Subscription
      </h1>
    </div>
  );

  return (
    // fixed inset-0 z-40 overlay sits above the Profile page content but below
    // MobileNav (z-50). AppShell handles the 100dvh lock + internal scroll box.
    <div className="fixed inset-0 z-40 bg-background">
      <AppShell header={header}>
        {/* Free plan / status text — compact */}
        <div className="px-5 pt-1.5 flex items-center">
          {currentTier && !isExpired ? (
            <p className="text-[12px] text-foreground/70 truncate">
              <span className="font-semibold capitalize text-foreground">{currentTier} plan</span>
              {expiresAt ? ` · renews ${expiresAt.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
            </p>
          ) : (
            <p className="text-[12px] text-foreground/70 truncate">
              {isExpired ? "Your plan expired — pick one to renew." : "Free plan · upgrade to unlock more jobs."}
            </p>
          )}
        </div>

        {/* Billing chip bar */}
        <div className="px-5 mt-2">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {([
              { key: "annual" as const, label: "Annual" },
              { key: "monthly" as const, label: "Monthly" },
              { key: "one_time" as const, label: "One-Time" },
            ]).map((opt) => {
              const active = billingInterval === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setBillingInterval(opt.key)}
                  className={`shrink-0 px-3.5 h-8 rounded-full text-[13px] font-semibold transition-all border ${
                    active
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-white/60 text-foreground/70 border-foreground/10 hover:bg-white"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active subscription manage button */}
        {currentTier && !isExpired && (
          <div className="px-5 mt-2 flex gap-2">
            <Button
              onClick={handleManageSubscription}
              disabled={loadingPortal}
              variant="outline"
              size="sm"
              className="flex-1 h-9"
            >
              {loadingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Crown className="w-3.5 h-3.5 mr-1.5 text-primary" />}
              Manage
            </Button>
            <Button
              onClick={refreshSubscription}
              disabled={refreshing}
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        )}

        {/* Cards stack — tightened spacing */}
        <div className="px-3 pt-2.5 flex flex-col gap-2">
          {tierConfig.map((tier) => {
            const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
            const saveBadge = getSaveBadge(tier);
            const isPro = tier.id === "pro";
            return (
              <div
                key={tier.id}
                className={`relative rounded-[24px] px-4 py-3 flex flex-col bg-white border transition-all ${
                  isPro
                    ? "border-primary/25 shadow-[0_0_0_4px_hsl(var(--primary)/0.08),0_22px_44px_-16px_hsl(var(--primary)/0.4),0_8px_18px_-6px_hsl(var(--primary)/0.22)]"
                    : "border-foreground/8 shadow-[0_8px_22px_-12px_rgba(15,23,42,0.18),0_2px_8px_-3px_rgba(15,23,42,0.08)]"
                } ${isActive ? "ring-2 ring-primary" : ""}`}
              >
                {isPro && (
                  <span className="absolute -top-2 right-4 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm">
                    Most Popular
                  </span>
                )}

                {/* Header row — title + price */}
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="font-display font-bold text-[15px] leading-tight text-foreground truncate">
                      {tier.badge} {tier.name}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-[13px] font-bold text-primary leading-none">{getPrice(tier)}</p>
                      {saveBadge && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-primary/10 text-primary leading-none">
                          {saveBadge}
                        </span>
                      )}
                    </div>
                  </div>
                  {isActive && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                      <CheckCircle className="w-3 h-3" /> Current
                    </span>
                  )}
                </div>

                {/* Features */}
                <ul className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 mb-2.5 content-start">
                  {tier.features.map((f) => (
                    <li key={f} className="text-[11px] leading-snug flex items-start gap-1 text-foreground/75">
                      <CheckCircle className="w-2.5 h-2.5 shrink-0 mt-0.5 text-primary" />
                      <span className="truncate">{f}</span>
                    </li>
                  ))}
                </ul>

                {!isActive && (
                  <button
                    onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                    disabled={loadingCheckout === tier.id || loadingPortal}
                    className={`w-full h-9 rounded-[12px] font-semibold text-[13px] transition-all flex items-center justify-center gap-1.5 disabled:opacity-60 ${
                      isPro
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.55)]"
                        : "bg-foreground/5 text-foreground hover:bg-foreground/10 border border-foreground/10"
                    }`}
                  >
                    {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {currentTier && !isExpired ? "Change Plan" : billingInterval === "one_time" ? "Buy Now" : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </AppShell>
    </div>
  );
};
