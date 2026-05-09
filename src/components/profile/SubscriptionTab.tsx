import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
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
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "one_time">("one_time");
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const currentTier = profile?.subscription_tier || null;
  const expiresAt = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  useEffect(() => {
    if (searchParams.get("pro") === "success") refreshSubscription();
     
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

  return (
    <div className="space-y-5 pb-24">
      <ProfileTabHeader
        eyebrow="Membership"
        title="Subscription"
        meta={currentTier && !isExpired ? `${currentTier[0].toUpperCase()}${currentTier.slice(1)} plan${expiresAt ? ` · renews ${expiresAt.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}` : isExpired ? "Plan expired — pick one to renew" : "Free plan · upgrade to unlock more"}
        onBack={onBack}
      />

      {/* Billing cycle pills */}
      <div className="flex items-center gap-1 rounded-2xl liquid-glass p-1.5">
        {([
          { key: "one_time" as const, label: "Once" },
          { key: "monthly" as const, label: "Monthly" },
          { key: "annual" as const, label: "Annual" },
        ]).map((opt) => {
          const active = billingInterval === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setBillingInterval(opt.key)}
              className={`flex-1 px-3 h-9 rounded-xl text-sm font-semibold transition-all ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {currentTier && !isExpired && (
        <div className="flex gap-2">
          <Button onClick={handleManageSubscription} disabled={loadingPortal} variant="outline" className="flex-1 h-10">
            {loadingPortal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-2 text-primary" />}
            Manage subscription
          </Button>
          <Button onClick={refreshSubscription} disabled={refreshing} variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      )}

      {/* Tier cards — compact so all 3 fit in a single viewport on iPhone
          (no scroll). Editorial sizing kept; just trimmed padding +
          font-sizes + gaps from the breathable original. */}
      <div className="space-y-2">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl p-3.5 ${
                isPro
                  ? "liquid-glass border-2 border-primary/40 shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.25)]"
                  : "liquid-glass"
              } ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span
                  className="absolute -top-2 left-4 text-[9px] uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm whitespace-nowrap"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Most popular
                </span>
              )}

              <div className="flex items-start justify-between gap-2.5 mb-2">
                <div className="min-w-0 flex-1">
                  <p className="font-serif italic uppercase" style={{ fontSize: "0.55rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
                    {tier.id === "basic" ? "Entry" : tier.id === "pro" ? "Recommended" : "Top tier"}
                  </p>
                  <h3 className="font-display italic font-bold leading-tight flex items-center gap-2 flex-wrap" style={{ fontSize: "1.1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}>
                    <span className="not-italic">{tier.badge}</span> {tier.name}
                    {isActive && (
                      <span className="text-[9px] not-italic font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> Current
                      </span>
                    )}
                  </h3>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display italic font-bold tabular-nums leading-none" style={{ fontSize: "1.2rem", color: "hsl(var(--primary))", letterSpacing: "-0.02em" }}>
                    {getPrice(tier)}
                  </p>
                  {saveBadge && (
                    <span className="inline-block mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-primary/10 text-primary">
                      {saveBadge}
                    </span>
                  )}
                </div>
              </div>

              <ul className="space-y-0.5 mb-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="font-serif italic flex items-start gap-1.5" style={{ fontSize: "0.75rem", color: "hsl(var(--ink-deep))" }}>
                    <CheckCircle className="w-3 h-3 shrink-0 mt-0.5 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {!isActive && (
                <button
                  onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className={`w-full px-3 h-9 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.97] ${
                    isPro
                      ? "bg-gradient-to-b from-primary to-primary/85 text-primary-foreground shadow-[0_4px_14px_-2px_hsl(var(--primary)/0.4),inset_0_1px_0_hsl(var(--primary-foreground)/0.25)] hover:shadow-[0_6px_18px_-2px_hsl(var(--primary)/0.5),inset_0_1px_0_hsl(var(--primary-foreground)/0.25)] border border-primary/40"
                      : "liquid-glass text-foreground hover:bg-secondary/40 border border-border"
                  }`}
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {currentTier && !isExpired ? "Change to this plan" : billingInterval === "one_time" ? `Buy ${tier.name}` : `Subscribe to ${tier.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
