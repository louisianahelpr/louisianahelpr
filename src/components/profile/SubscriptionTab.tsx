import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Crown, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const tierConfig = [
  {
    id: "basic",
    name: "Basic",
    badge: "⭐",
    monthly: "$5/mo",
    annual: "$50/yr",
    lifetime: "$5 one-time",
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
    lifetime: "$10 one-time",
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
    lifetime: "$15 one-time",
    monthlySave: null,
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Landing Page Spotlight", "Auto-Match Jobs", "Priority Dispute Resolution", "20-min Early Access"],
  },
];

export const SubscriptionTab = ({ profile, user, onBack }: { profile: Profile | null; user: User | null; onBack: () => void }) => {
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "annual" | "lifetime">("lifetime");
  const [billingDay, setBillingDay] = useState<number>(1);
  const currentTier = profile?.subscription_tier || null;

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
      const billing_cycle = billingInterval === "lifetime" ? "one_time" : billingInterval;
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
    if (billingInterval === "lifetime") return tier.lifetime;
    return tier.monthly;
  };

  const getSaveBadge = (tier: typeof tierConfig[0]) => {
    if (billingInterval === "annual") return tier.annualSave;
    if (billingInterval === "lifetime") return "Best value";
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-display font-bold text-foreground">Subscription</h1>
      </div>

      {currentTier && (
        <div className="rounded-2xl border-2 border-primary bg-primary/5 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              <span className="font-bold text-foreground capitalize">{currentTier} Plan</span>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">Active</span>
          </div>
          <Button
            onClick={handleManageSubscription}
            disabled={loadingPortal}
            variant="outline"
            className="w-full"
          >
            {loadingPortal ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Manage Subscription
          </Button>
        </div>
      )}

      {!currentTier && (
        <p className="text-sm text-muted-foreground">You're on the free plan. Upgrade to unlock premium features and get more jobs.</p>
      )}

      {/* Billing Interval Toggle */}
      <div className="flex items-center justify-center gap-1 p-1 rounded-xl bg-muted">
        {([
          { key: "lifetime", label: "One-Time" },
          { key: "monthly", label: "Monthly" },
          { key: "annual", label: "Annual" },
        ] as const).map((opt) => (
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
          const isActive = currentTier?.toLowerCase() === tier.id;
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
                  onClick={() => currentTier ? handleManageSubscription() : handleSubscribe(tier.id)}
                  disabled={loadingCheckout === tier.id || loadingPortal}
                  className="w-full"
                  variant="outline"
                >
                  {(loadingCheckout === tier.id || loadingPortal) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {currentTier ? "Change Plan" : billingInterval === "lifetime" ? "Buy Now" : "Subscribe"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
