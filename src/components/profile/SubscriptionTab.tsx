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
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Helpr Badge", "Search Priority", "5-min Early Job Access"],
  },
  {
    id: "pro",
    name: "Pro",
    badge: "🔥",
    monthly: "$10/mo",
    annual: "$100/yr",
    oneTime: "$10 one-time",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Everything in Basic", "Boosted Visibility", "Portfolio Showcase", "Weekly Reports", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    badge: "💎",
    monthly: "$15/mo",
    annual: "$150/yr",
    oneTime: "$15 one-time",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Landing Page Spotlight", "Auto-Match Jobs", "Priority Dispute Resolution", "20-min Early Access"],
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

  // Auto-refresh subscription status after returning from Stripe checkout
  useEffect(() => {
    if (searchParams.get("pro") === "success") {
      refreshSubscription();
    }
  }, [searchParams]);

  const refreshSubscription = async () => {
    setRefreshing(true);
    try {
      await supabase.functions.invoke("check-pro-subscription");
      // Invalidate profile cache to pick up updated tier
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      toast.success("Subscription status updated!");
    } catch {
      toast.error("Failed to refresh subscription status");
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
      toast.error(err.message || "Failed to open subscription portal");
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
      toast.error(err.message || "Failed to start checkout");
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
    if (billingInterval === "one_time") return "One month, no recurring";
    return null;
  };

  const formatExpiry = (date: Date) => {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "Expired";
    if (diffDays === 0) return "Expires today";
    if (diffDays === 1) return "Expires tomorrow";
    if (diffDays <= 7) return `Expires in ${diffDays} days`;
    return `Expires ${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  };

  return (
    <div className="relative -mx-4 sm:-mx-6 px-5 pb-32 min-h-[calc(100vh-4rem)] bg-gradient-to-b from-primary/15 via-primary/5 to-background">
      {/* Top nav bar: back arrow + title vertically centered */}
      <div className="flex items-center gap-2 pt-2 pb-5">
        <button
          onClick={onBack}
          className="h-10 w-10 -ml-2 rounded-xl flex items-center justify-center hover:bg-foreground/5 transition-colors text-foreground"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display text-[22px] font-bold leading-none tracking-tight text-foreground">
          Subscription
        </h1>
      </div>

      {currentTier && !isExpired && (
        <div className="rounded-[24px] border border-primary/30 bg-white/80 backdrop-blur-xl p-5 space-y-3 mb-5 shadow-[0_10px_30px_-12px_hsl(var(--primary)/0.25),0_4px_12px_-4px_hsl(var(--primary)/0.15)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              <span className="font-bold text-foreground capitalize">{currentTier} Plan</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">Active</span>
          </div>
          {expiresAt && (
            <p className="text-sm text-muted-foreground">
              {formatExpiry(expiresAt)}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={handleManageSubscription}
              disabled={loadingPortal}
              variant="outline"
              className="flex-1"
            >
              {loadingPortal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Manage Subscription
            </Button>
            <Button
              onClick={refreshSubscription}
              disabled={refreshing}
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Refresh subscription status"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      )}

      {(!currentTier || isExpired) && (
        <p className="text-[15px] leading-relaxed text-muted-foreground max-w-prose mb-5">
          {isExpired
            ? "Your subscription has expired. Renew to continue accessing premium features."
            : "You're on the free plan. Upgrade to unlock premium features and get more jobs."}
        </p>
      )}

      {/* Billing Interval Chip Bar */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto no-scrollbar">
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
              className={`shrink-0 px-4 h-9 rounded-full text-sm font-semibold transition-all border ${
                active
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-transparent text-foreground/70 border-foreground/15 hover:bg-foreground/5"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          const isElite = tier.id === "elite";
          return (
            <div
              key={tier.id}
              className={`relative rounded-[24px] p-5 transition-all ${
                isPro
                  ? "bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-[0_20px_40px_-15px_hsl(var(--primary)/0.5),0_8px_20px_-8px_hsl(var(--primary)/0.35)]"
                  : isElite
                  ? "bg-white/90 backdrop-blur-xl shadow-[0_16px_36px_-14px_rgba(15,23,42,0.18),0_6px_16px_-6px_rgba(15,23,42,0.12)] border border-foreground/5"
                  : "bg-white/90 backdrop-blur-xl shadow-[0_12px_30px_-12px_rgba(15,23,42,0.15),0_4px_12px_-4px_rgba(15,23,42,0.08)] border border-foreground/5"
              } ${isActive && !isPro ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span className="absolute -top-2.5 right-5 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full bg-white text-primary font-bold shadow-md">
                  Most Popular
                </span>
              )}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className={`font-display font-bold text-lg ${isPro ? "text-primary-foreground" : "text-foreground"}`}>
                    {tier.badge} {tier.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className={`text-[15px] font-bold ${isPro ? "text-primary-foreground" : "text-primary"}`}>
                      {getPrice(tier)}
                    </p>
                    {saveBadge && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        isPro ? "bg-white/20 text-primary-foreground" : "bg-primary/10 text-primary"
                      }`}>
                        {saveBadge}
                      </span>
                    )}
                  </div>
                </div>
                {isActive && (
                  <span className={`flex items-center gap-1 text-xs font-semibold ${isPro ? "text-primary-foreground" : "text-primary"}`}>
                    <CheckCircle className="w-4 h-4" /> Current
                  </span>
                )}
              </div>
              {/* Features in tight 2-col square grid to minimize height */}
              <ul className="grid grid-cols-2 gap-x-3 gap-y-2 mb-4">
                {tier.features.map((f) => (
                  <li key={f} className={`text-[12px] leading-snug flex items-start gap-1.5 ${
                    isPro ? "text-primary-foreground/95" : "text-foreground/75"
                  }`}>
                    <CheckCircle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isPro ? "text-primary-foreground" : "text-primary"}`} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {!isActive && (
                <button
                  onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className={`w-full h-11 rounded-[12px] font-semibold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 ${
                    isPro
                      ? "bg-white text-primary hover:bg-white/95 shadow-md"
                      : "bg-foreground/5 text-foreground hover:bg-foreground/10 border border-foreground/10"
                  }`}
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-4 h-4 animate-spin" />}
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
