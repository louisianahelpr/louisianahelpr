import { Crown, Sparkles, Star } from "lucide-react";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

export type TierIconName = "star" | "sparkles" | "crown";

interface TierDisplay {
  id: string;
  name: string;
  iconName: TierIconName;
  forWhom: string;
  monthly: string;
  annual: string;
  oneTime: string;
  annualSave: string;
  features: string[];
}

/**
 * Format the display prices for a consumer tier from the canonical
 * `TIER_PERKS` config. This is the single source of truth — if `pro` moves
 * to $12/mo we edit `subscriptionTiers.ts` and every price surface (this
 * tab, /subscription, /for-business, checkout, Legal) follows. Previously
 * each string was hardcoded here and drifted on any change.
 */
function formatTierPrices(tierId: "pro" | "elite") {
  const perk = TIER_PERKS[tierId];
  // TIER_PERKS.pro/elite always have prices — TS narrows via non-null assertion
  // rather than falling back to a hardcoded default, so a config change to
  // a null price triggers a compile-time failure instead of shipping "$NaN/mo".
  const monthlyPrice = perk.price!;
  const annualMonthly = perk.annualPrice!;
  const yearlyTotal = Math.round(annualMonthly * 12);
  const monthlyTotalIfPaidMonthly = monthlyPrice * 12;
  const savePct = Math.round(
    ((monthlyTotalIfPaidMonthly - yearlyTotal) / monthlyTotalIfPaidMonthly) * 100,
  );
  return {
    monthly: `$${monthlyPrice}/mo`,
    annual: `$${yearlyTotal}/yr`,
    oneTime: `$${monthlyPrice} one-time`,
    annualSave: `Save ${savePct}%`,
  };
}

// Consumer tiers only. The Business tier lives on /for-business (seat plans
// + membership) and is deliberately NOT surfaced here as a fourth consumer
// choice — showing it here previously caused the "Your plan" hero card to
// blank for a Business subscriber, which SubscriptionTab now handles with an
// explicit redirect note instead.
export const tierConfig: TierDisplay[] = [
  {
    id: "pro",
    name: "Pro",
    iconName: "sparkles",
    forWhom: "For Helprs picking up regular work",
    ...formatTierPrices("pro"),
    features: ["Helpr Badge", "Instant Payouts", "Portfolio Showcase", "10-min Early Access"],
  },
  {
    id: "elite",
    name: "Elite",
    iconName: "crown",
    forWhom: "For Helprs running this as their main income.",
    ...formatTierPrices("elite"),
    features: ["Everything in Pro", "Free Job Boosts", "Landing Spotlight", "Auto-Match", "20-min Early Access"],
  },
];

export const TierIcon = ({ name, className, style }: { name: TierIconName; className?: string; style?: React.CSSProperties }) => {
  if (name === "star") return <Star className={className} style={style} strokeWidth={2} />;
  if (name === "sparkles") return <Sparkles className={className} style={style} strokeWidth={2} />;
  return <Crown className={className} style={style} strokeWidth={2} />;
};
