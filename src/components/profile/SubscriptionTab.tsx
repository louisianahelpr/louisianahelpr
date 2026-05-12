import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle, Loader2, RefreshCw, Sparkles, Star } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type TierIconName = "star" | "sparkles" | "crown";

const tierConfig: Array<{
  id: string;
  name: string;
  iconName: TierIconName;
  forWhom: string;
  monthly: string;
  annual: string;
  oneTime: string;
  annualSave: string;
  features: string[];
}> = [
  {
    id: "basic",
    name: "Basic",
    iconName: "star",
    forWhom: "For casual side-hustlers",
    monthly: "$5/mo",
    annual: "$50/yr",
    oneTime: "$5 one-time",
    annualSave: "Save 17%",
    features: ["Helpr Badge", "Search Priority", "5-min Early Access"],
  },
  {
    id: "pro",
    name: "Pro",
    iconName: "sparkles",
    forWhom: "For active helpers landing 2+ jobs/week",
    monthly: "$10/mo",
    annual: "$100/yr",
    oneTime: "$10 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Basic", "Boosted Visibility", "Portfolio Showcase", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    iconName: "crown",
    forWhom: "For pro contractors who want max reach",
    monthly: "$15/mo",
    annual: "$150/yr",
    oneTime: "$15 one-time",
    annualSave: "Save 17%",
    features: ["Everything in Pro", "Landing Spotlight", "Auto-Match", "20-min Early Access"],
  },
];

const TierIcon = ({ name, className, style }: { name: TierIconName; className?: string; style?: React.CSSProperties }) => {
  if (name === "star") return <Star className={className} style={style} strokeWidth={2} />;
  if (name === "sparkles") return <Sparkles className={className} style={style} strokeWidth={2} />;
  return <Crown className={className} style={style} strokeWidth={2} />;
};

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

      {/* Billing cycle pills — Annual carries the save badge inline so the
          cheapest option is the most visually inviting one. */}
      <div className="flex items-center gap-1 rounded-2xl liquid-glass p-1.5">
        {([
          { key: "one_time" as const, label: "Once" },
          { key: "monthly" as const, label: "Monthly" },
          { key: "annual" as const, label: "Annual", save: "−17%" },
        ]).map((opt) => {
          const active = billingInterval === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setBillingInterval(opt.key)}
              className={`flex-1 px-3 h-9 rounded-ds-md text-ds-13 font-semibold transition-all inline-flex items-center justify-center gap-1.5 ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
              {opt.save && (
                <span
                  className={`text-[9px] font-bold tracking-wider px-1 py-0.5 rounded ${
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-burnt-sienna-soft"
                  }`}
                  style={
                    !active
                      ? {
                          background: "hsl(var(--burnt-sienna) / 0.14)",
                          color: "hsl(var(--burnt-sienna))",
                          letterSpacing: "0.06em",
                        }
                      : { letterSpacing: "0.06em" }
                  }
                >
                  {opt.save}
                </span>
              )}
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

      {/* Tier cards — single-row compact layout so all 3 tiers fit in
          one iPhone viewport without scrolling, for every billing cycle.
          Row layout: [icon] [name + forWhom + feature dots] [price + CTA]. */}
      <div className="space-y-2">
        {tierConfig.map((tier) => {
          const isActive = currentTier?.toLowerCase() === tier.id && !isExpired;
          const saveBadge = getSaveBadge(tier);
          const isPro = tier.id === "pro";
          const accent =
            tier.id === "elite"
              ? "hsl(var(--gold-warm))"
              : tier.id === "pro"
                ? "hsl(var(--burnt-sienna))"
                : "hsl(var(--bark))";
          const accentSoft =
            tier.id === "elite"
              ? "hsl(var(--gold-warm) / 0.14)"
              : tier.id === "pro"
                ? "hsl(var(--burnt-sienna) / 0.12)"
                : "hsl(var(--bark) / 0.10)";
          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl px-3 py-2.5 ${
                isPro
                  ? "liquid-glass border-2 border-primary/40 shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.25)]"
                  : "liquid-glass"
              } ${isActive ? "ring-2 ring-primary" : ""}`}
            >
              {isPro && (
                <span
                  className="absolute -top-2 left-3 text-[9px] uppercase px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-bold shadow-sm whitespace-nowrap"
                  style={{ letterSpacing: "0.18em" }}
                >
                  Most popular
                </span>
              )}

              <div className="flex items-center gap-3">
                {/* Icon — smaller (w-8) to free vertical space */}
                <span
                  className="shrink-0 w-8 h-8 rounded-ds-md flex items-center justify-center"
                  style={{ background: accentSoft, color: accent }}
                >
                  <TierIcon name={tier.iconName} className="w-4 h-4" />
                </span>

                {/* Name + forWhom on one line + features dot row underneath.
                    Keeps the card to ~2 lines of text instead of the
                    previous 5-line bulleted block. */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h3
                      className="font-display italic font-bold leading-none"
                      style={{ fontSize: "1rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.018em" }}
                    >
                      {tier.name}
                    </h3>
                    {isActive && (
                      <span className="text-[9px] not-italic font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                        <CheckCircle className="w-2.5 h-2.5" /> Current
                      </span>
                    )}
                    <span
                      className="font-serif italic truncate"
                      style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.7)" }}
                    >
                      {tier.forWhom}
                    </span>
                  </div>
                  {/* Features as inline dots — one line, truncated if
                      necessary. Drops "Everything in X" prefixes since
                      the visual stacking already conveys ascending tier. */}
                  <p
                    className="font-serif italic mt-0.5 truncate"
                    style={{ fontSize: "0.7rem", color: "hsl(var(--olivewood) / 0.78)" }}
                  >
                    {tier.features
                      .filter((f) => !/^Everything in/i.test(f))
                      .join(" · ")}
                  </p>
                </div>

                {/* Price + CTA on the right edge */}
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <p
                    className="font-display italic font-bold tabular-nums leading-none"
                    style={{ fontSize: "1rem", color: accent, letterSpacing: "-0.02em" }}
                  >
                    {getPrice(tier)}
                  </p>
                  {saveBadge && (
                    <span
                      className="text-[8.5px] px-1 py-px rounded-full font-bold"
                      style={{ background: accentSoft, color: accent, letterSpacing: "0.06em" }}
                    >
                      {saveBadge}
                    </span>
                  )}
                  {!isActive && (
                    <button
                      onClick={() =>
                        currentTier && !isExpired
                          ? handleManageSubscription()
                          : handleSubscribe(tier.id)
                      }
                      disabled={loadingCheckout === tier.id || loadingPortal}
                      className="inline-flex items-center justify-center gap-1 px-2.5 h-7 rounded-full font-sans font-bold text-[0.7rem] transition active:scale-[0.96] disabled:opacity-60"
                      style={
                        isPro
                          ? {
                              background: "hsl(var(--bark))",
                              color: "hsl(var(--parchment))",
                              border: "1px solid hsl(70 22% 24%)",
                              boxShadow:
                                "inset 0 1px 0 0 rgba(255,255,255,0.12), 0 4px 10px -3px hsl(var(--bark) / 0.45)",
                            }
                          : {
                              background: "hsla(0, 0%, 100%, 0.55)",
                              color: "hsl(var(--ink-deep))",
                              border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                            }
                      }
                    >
                      {(loadingCheckout === tier.id || loadingPortal) && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                      {currentTier && !isExpired
                        ? "Change"
                        : billingInterval === "one_time"
                          ? "Buy"
                          : "Subscribe"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
