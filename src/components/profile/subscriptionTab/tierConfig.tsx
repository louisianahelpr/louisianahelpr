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
  // Platform-fee % for this tier — surfaced on the card so the in-app upgrade
  // path shows the same "lower commission" value prop the public page leads
  // with. Sourced from TIER_PERKS so it can never disagree with the fee the
  // payout actually charges.
  feePercent: number;
  // First entry may be an "Everything in <lower tier>" inclusive cue that
  // SubscriptionTab renders as a small eyebrow; the rest are the canonical
  // per-tier perk bullets from TIER_PERKS.featureBullets (single source of
  // truth shared with the public /subscription page).
  features: string[];
}

/**
 * Format the display prices for a consumer tier from the canonical
 * `TIER_PERKS` config. This is the single source of truth — if `pro` moves
 * to $12/mo we edit `subscriptionTiers.ts` and every price surface (this
 * tab, /subscription, /for-business, checkout, Legal) follows. Previously
 * each string was hardcoded here and drifted on any change.
 */
function formatTierPrices(tierId: "basic" | "pro" | "elite") {
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

// Consumer tiers only. Business lives on /for-business (per-seat plans) and
// is deliberately NOT surfaced here as a consumer choice — showing it here
// previously caused the "Your plan" hero card to blank for a Business
// subscriber, which SubscriptionTab now handles with an explicit redirect
// note instead.
export const tierConfig: TierDisplay[] = [
  {
    id: "basic",
    name: "Basic",
    iconName: "star",
    forWhom: "For Helprs testing the marketplace.",
    ...formatTierPrices("basic"),
    feePercent: TIER_PERKS.basic.platformFeePercent,
    features: [...TIER_PERKS.basic.featureBullets],
  },
  {
    id: "pro",
    name: "Pro",
    iconName: "sparkles",
    forWhom: "For Helprs picking up regular work",
    ...formatTierPrices("pro"),
    feePercent: TIER_PERKS.pro.platformFeePercent,
    features: ["Everything in Basic", ...TIER_PERKS.pro.featureBullets],
  },
  {
    id: "elite",
    name: "Elite",
    iconName: "crown",
    forWhom: "For Helprs running this as their main income.",
    ...formatTierPrices("elite"),
    feePercent: TIER_PERKS.elite.platformFeePercent,
    features: ["Everything in Pro", ...TIER_PERKS.elite.featureBullets],
  },
];

export const TierIcon = ({ name, className, style }: { name: TierIconName; className?: string; style?: React.CSSProperties }) => {
  if (name === "star") return <Star className={className} style={style} strokeWidth={2} />;
  if (name === "sparkles") return <Sparkles className={className} style={style} strokeWidth={2} />;
  return <Crown className={className} style={style} strokeWidth={2} />;
};
