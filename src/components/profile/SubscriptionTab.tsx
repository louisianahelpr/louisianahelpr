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
    <div className="h-[calc(100dvh-8.5rem)] flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Subscription</h1>
      </div>

      <div className="flex flex-col gap-2 shrink-0">
        {currentTier && !isExpired ? (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-semibold capitalize text-foreground">{currentTier} plan</span>
            {expiresAt ? ` · renews ${expiresAt.toLocaleDateString([], { month: "short", day: "numeric" })}` : ""}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {isExpired ? "Plan expired — pick one to renew." : "Free plan · upgrade for more."}
          </p>
        )}

        <div className="flex items-center gap-1">
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
                className={`flex-1 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all border ${
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
        <div className="flex gap-2 shrink-0">
          <Button onClick={handleManageSubscription} disabled={loadingPortal} variant="outline" size="sm" className="flex-1 h-8">
            {loadingPortal ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Crown className="w-3.5 h-3.5 mr-1.5 text-primary" />}
            Manage
          </Button>
          <Button onClick={refreshSubscription} disabled={refreshing} variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 flex-1 min-h-0">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl border bg-card p-2.5 flex flex-col min-h-0 ${
                isPro ? "border-primary/30 shadow-lg" : "border-border"
              } ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm whitespace-nowrap">
                  Popular
                </span>
              )}

              <div className="flex flex-col items-center text-center">
                <h3 className="font-display font-bold text-sm leading-tight text-foreground">
                  {tier.badge} {tier.name}
                </h3>
                <p className="text-xs font-bold text-primary leading-none mt-1">{getPrice(tier)}</p>
                {saveBadge && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold bg-primary/10 text-primary leading-none mt-1">
                    {saveBadge}
                  </span>
                )}
                {isActive && (
                  <span className="flex items-center gap-0.5 text-[9px] font-semibold text-primary mt-1">
                    <CheckCircle className="w-2.5 h-2.5" /> Current
                  </span>
                )}
              </div>

              <ul className="mt-2 mb-2 space-y-1 flex-1 min-h-0 overflow-hidden">
                {tier.features.map((f) => (
                  <li key={f} className="text-[10px] leading-snug flex items-start gap-1 text-muted-foreground">
                    <CheckCircle className="w-2.5 h-2.5 shrink-0 mt-0.5 text-primary" />
                    <span className="break-words">{f}</span>
                  </li>
                ))}
              </ul>

              {!isActive && (
                <button
                  onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className={`w-full h-8 rounded-lg font-semibold text-[11px] transition-all flex items-center justify-center gap-1 disabled:opacity-60 ${
                    isPro
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-secondary text-foreground hover:bg-secondary/80 border border-border"
                  }`}
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-3 h-3 animate-spin" />}
                  {currentTier && !isExpired ? "Change" : billingInterval === "one_time" ? "Buy" : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
