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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Subscription</h1>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {currentTier && !isExpired ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold capitalize text-foreground">{currentTier} plan</span>
            {expiresAt ? ` · renews ${expiresAt.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isExpired ? "Your plan expired — pick one to renew." : "Free plan · upgrade to unlock more jobs."}
          </p>
        )}

        <div className="flex items-center gap-1.5">
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
                className={`px-3 h-7 rounded-full text-xs font-semibold transition-all border ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card text-muted-foreground border-border hover:bg-secondary"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {currentTier && !isExpired && (
        <div className="flex gap-2">
          <Button onClick={handleManageSubscription} disabled={loadingPortal} variant="outline" size="sm" className="flex-1 h-9">
            {loadingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Crown className="w-3.5 h-3.5 mr-1.5 text-primary" />}
            Manage
          </Button>
          <Button onClick={refreshSubscription} disabled={refreshing} variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl border bg-card p-4 flex flex-col ${
                isPro ? "border-primary/30 shadow-lg" : "border-border"
              } ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span className="absolute -top-2 right-4 text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm">
                  Most Popular
                </span>
              )}

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-base leading-tight text-foreground">
                    {tier.badge} {tier.name}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    <p className="text-sm font-bold text-primary leading-none">{getPrice(tier)}</p>
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

              <ul className="mt-3 mb-3 space-y-1 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="text-xs leading-snug flex items-start gap-1.5 text-muted-foreground">
                    <CheckCircle className="w-3 h-3 shrink-0 mt-0.5 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {!isActive && (
                <button
                  onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className={`w-full h-9 rounded-xl font-semibold text-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-60 ${
                    isPro
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-secondary text-foreground hover:bg-secondary/80 border border-border"
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
    </div>
  );
};
