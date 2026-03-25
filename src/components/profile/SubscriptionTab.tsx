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

export const SubscriptionTab = ({ profile, user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "one_time">("one_time");
  const [billingDay, setBillingDay] = useState<number>(1);
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
        body: { tier, billing_cycle, ...(billing_cycle === "monthly" ? { billing_day: billingDay } : {}) },
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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" aria-label="Go back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Subscription</h1>
      </div>

      {currentTier && !isExpired && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 space-y-3">
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
        <p className="text-sm text-muted-foreground">
          {isExpired ? "Your subscription has expired. Renew to continue accessing premium features." : "You're on the free plan. Upgrade to unlock premium features and get more jobs."}
        </p>
      )}

      {/* Billing Interval Toggle */}
      <div className="flex items-center justify-center gap-1 p-1 rounded-xl bg-muted">
        {([
          { key: "one_time" as const, label: "One-Time" },
          { key: "monthly" as const, label: "Monthly" },
          { key: "annual" as const, label: "Annual" },
        ]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setBillingInterval(opt.key)}
            className={`flex-1 text-sm font-medium py-2 px-3 rounded-lg transition-all ${
              billingInterval === opt.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {billingInterval === "monthly" && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <label className="text-sm font-medium text-foreground">Billing day of the month</label>
          <select
            value={billingDay}
            onChange={(e) => setBillingDay(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day === 1 ? "1st" : day === 2 ? "2nd" : day === 3 ? "3rd" : `${day}th`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">You'll be charged on this day each month</p>
        </div>
      )}

      <div className="space-y-3">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          return (
            <div
              key={tier.id}
              className={`rounded-2xl border p-5 space-y-3 ${isActive ? "border-primary bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-foreground">{tier.badge} {tier.name}</h3>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-primary">{getPrice(tier)}</p>
                    {saveBadge && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                        {saveBadge}
                      </span>
                    )}
                  </div>
                </div>
                {isActive && (
                  <span className="flex items-center gap-1 text-xs text-primary font-medium">
                    <CheckCircle className="w-4 h-4" /> Current
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {tier.features.map((f) => (
                  <li key={f} className="text-xs text-muted-foreground flex items-start gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              {!isActive && (
                <Button
                  onClick={() => currentTier && !isExpired ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className="w-full"
                  variant="outline"
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {currentTier && !isExpired ? "Change Plan" : billingInterval === "one_time" ? "Buy Now" : "Subscribe"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
