import { Crown, Leaf, Sparkles, Star } from "lucide-react";
import { ONE_TIME_PASS_DAYS, TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";

export type TierIconName = "leaf" | "star" | "sparkles" | "crown";

interface TierDisplay {
  id: string;
  name: string;
  iconName: TierIconName;
  forWhom: string;
  monthly: string;
  annual: string;
  oneTime: string;
  /** Separate expiry caption for the one-time pass — see formatTierPrices(). */
  oneTimeNote: string | null;
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
 * tab, /subscription, checkout, Legal) follows. Previously
 * each string was hardcoded here and drifted on any change.
 */
// DERIVED from SubscriptionTier rather than a hand-written union. This read
// `"basic" | "pro" | "elite"` and became a compile error the moment Plus was
// restored — which is the good outcome, but only because the call site was
// added in the same commit. Excluding "free" is the real rule (free has null
// prices, hence the non-null assertions below), and stating it that way means
// the next paid tier needs no edit here at all.
function formatTierPrices(tierId: Exclude<SubscriptionTier, "free">) {
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
    // The one-time pass lapses after ONE_TIME_PASS_DAYS — it is not a
    // perpetual licence. That expiry used to be disclosed only by a banner
    // above the cards; the banner is gone (owner, 2026-08-27) so the duration
    // rides alongside the price. It USED to be crammed onto the price string
    // itself ("$5 · 30 days"), which read as a strange unit price rather
    // than a plain number for a one-time purchase (owner, 2026-08-30: show
    // just the price). Split into two fields instead of dropping the
    // disclosure outright — it is still the only pre-purchase statement of
    // the expiry (consumer-disclosure / App Store 3.1.1), just rendered as
    // its own caption near the price rather than inline with it.
    oneTime: `$${monthlyPrice}`,
    oneTimeNote: `${ONE_TIME_PASS_DAYS}-day pass`,
    annualSave: `Save ${savePct}%`,
  };
}

// Consumer tiers only.
export const tierConfig: TierDisplay[] = [
  {
    // The plan almost every Helpr is actually ON, and it was the one plan the
    // membership tab never drew — the owner opened it and saw only the three
    // things they could buy ("show the free plan also"). Leaving it out made
    // the page read as a shop rather than as "here is where you are, here is
    // what upgrading changes", and gave the 12% fee nothing to be compared to.
    //
    // Its prices are literals rather than formatTierPrices(): that helper
    // divides by a monthly price to derive an annual saving, which for a
    // free plan is a division by zero. There is nothing to bill and nothing
    // to save, so all three billing intervals read the same.
    id: "free",
    name: "Free",
    iconName: "leaf",
    forWhom: TIER_PERKS.free.tagline,
    monthly: "Free",
    annual: "Free",
    oneTime: "Free",
    oneTimeNote: null,
    annualSave: "",
    feePercent: TIER_PERKS.free.platformFeePercent,
    features: [...TIER_PERKS.free.featureBullets],
  },
  {
    id: "basic",
    name: TIER_PERKS.basic.name,
    iconName: "star",
    forWhom: "For Helprs testing the marketplace.",
    ...formatTierPrices("basic"),
    feePercent: TIER_PERKS.basic.platformFeePercent,
    features: [...TIER_PERKS.basic.featureBullets],
  },
  {
    id: "pro",
    name: TIER_PERKS.pro.name,
    iconName: "sparkles",
    forWhom: "For Helprs picking up regular work.",
    ...formatTierPrices("pro"),
    feePercent: TIER_PERKS.pro.platformFeePercent,
    features: [`Everything in ${TIER_PERKS.basic.name}`, ...TIER_PERKS.pro.featureBullets],
  },
  {
    id: "plus",
    name: TIER_PERKS.plus.name,
    // Sparkles, same as Pro — the crown is Elite's Featured Crown Badge and
    // must not appear on a tier that doesn't grant it.
    iconName: "sparkles",
    forWhom: "For Helprs who want a smaller cut.",
    ...formatTierPrices("plus"),
    feePercent: TIER_PERKS.plus.platformFeePercent,
    features: [`Everything in ${TIER_PERKS.pro.name}`, ...TIER_PERKS.plus.featureBullets],
  },
  {
    id: "elite",
    name: TIER_PERKS.elite.name,
    iconName: "crown",
    forWhom: "For full-time Helprs.",
    ...formatTierPrices("elite"),
    feePercent: TIER_PERKS.elite.platformFeePercent,
    // "Everything in Plus" now that Plus sits directly below Elite. This said
    // "Everything in Pro" while Plus did not exist; leaving it would skip a
    // rung and understate what Elite includes.
    features: [`Everything in ${TIER_PERKS.plus.name}`, ...TIER_PERKS.elite.featureBullets],
  },
];

export const TierIcon = ({ name, className, style }: { name: TierIconName; className?: string; style?: React.CSSProperties }) => {
  if (name === "leaf") return <Leaf className={className} style={style} strokeWidth={2} />;
  if (name === "star") return <Star className={className} style={style} strokeWidth={2} />;
  if (name === "sparkles") return <Sparkles className={className} style={style} strokeWidth={2} />;
  return <Crown className={className} style={style} strokeWidth={2} />;
};
