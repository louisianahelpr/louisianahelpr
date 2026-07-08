/**
 * subscriptionTiers.ts — canonical perk definitions for the CONSUMER
 * membership tiers (Free / Helpr Pro / Helpr Elite) plus a Business row
 * that exists here ONLY as the fee-percent reference for business accounts.
 *
 * Consumer prices MUST equal the live Stripe Price objects (verified):
 *   pro  $10/mo  $100/yr   elite  $15/mo  $150/yr
 * `annualPrice` is stored as the monthly-equivalent of the annual plan
 * (yearly ÷ 12) because the /subscription page renders it as "$X/mo annual".
 *
 * BUSINESS IS NOT A SUBSCRIBABLE CONSUMER TIER. Business accounts are
 * billed per-seat on the FOUR seat-plan tiers defined in
 * `businessSeatTiers.ts` (Starter free · Crew $20/mo · Team $30/mo ·
 * Enterprise $40/mo). The `business` entry below carries `price: null` and
 * `annualPrice: null` on purpose so any code that reads them can never
 * accidentally render a fictional "$50/mo Business" price — the real
 * pricing surface is /for-business, and SubscriptionTab redirects Business
 * subscribers there.
 *
 * The tier IDs align with the subscription_tier column on profiles
 * ("pro", "elite", "business"). Business is self-serve upgradable via the
 * seat plans, then gated behind license + insurance verification before
 * the verified-business badge unlocks. "free" is the default/null case.
 * The commission ladder is a clean four rungs:
 * free 12% → pro 10% → elite 8% → business 6%.
 */

export type SubscriptionTier = "free" | "pro" | "elite" | "business";

export interface TierPerks {
  name: string;
  price: number | null;         // monthly USD, null = free
  annualPrice: number | null;   // annual plan's monthly-equivalent (yearly ÷ 12), null = free
  platformFeePercent: number;   // % taken from helper payout — descends as price rises (free 12% → pro 10% → elite 8% → business 6%)
  priorityPlacement: boolean;   // application floated higher in poster's recommended list
  featuredBadge: boolean;       // gold/crown badge on profile and applicant cards
  earlyAccess: boolean;         // sees new jobs before non-subscribers (pro 10m / elite 20m)
  advancedAnalytics: boolean;   // earnings trends, category breakdown, best hours
  multiTech: boolean;           // business: manage a team of technicians under one account
  verifiedBusiness: boolean;    // business: verified entity badge surfaced to posters
  dedicatedSupport: boolean;    // priority support response SLA
  tagline: string;
  ctaLabel: string;
}

export const TIER_PERKS: Record<SubscriptionTier, TierPerks> = {
  free: {
    name: "Free",
    price: null,
    annualPrice: null,
    platformFeePercent: 12,
    priorityPlacement: false,
    featuredBadge: false,
    earlyAccess: false,
    advancedAnalytics: false,
    multiTech: false,
    verifiedBusiness: false,
    dedicatedSupport: false,
    tagline: "Get started, no commitment",
    ctaLabel: "Current plan",
  },
  pro: {
    name: "Helpr Pro",
    price: 10,
    annualPrice: 8.33,
    platformFeePercent: 10,
    priorityPlacement: true,
    featuredBadge: false,
    earlyAccess: true,
    advancedAnalytics: true,
    multiTech: false,
    verifiedBusiness: false,
    dedicatedSupport: false,
    tagline: "For helpers serious about earning",
    ctaLabel: "Upgrade to Pro",
  },
  elite: {
    name: "Helpr Elite",
    price: 15,
    annualPrice: 12.5,
    platformFeePercent: 8,
    priorityPlacement: true,
    featuredBadge: true,
    earlyAccess: true,
    advancedAnalytics: true,
    multiTech: false,
    verifiedBusiness: false,
    dedicatedSupport: true,
    tagline: "Top helpers. Maximum visibility.",
    ctaLabel: "Go Elite",
  },
  business: {
    name: "Business",
    // NOT a consumer subscription price. Business is billed per-seat
    // (Starter free · Crew $20/mo · Team $30/mo · Enterprise $40/mo) —
    // see supabase/functions/_shared/businessSeatTiers.ts. These stay
    // null so no surface can accidentally render a fictional consumer
    // "$50/mo Business" tier. platformFeePercent below is the real
    // shared rate across all seat plans.
    price: null,
    annualPrice: null,
    platformFeePercent: 6,
    priorityPlacement: true,
    featuredBadge: true,
    earlyAccess: true,
    advancedAnalytics: true,
    multiTech: true,
    verifiedBusiness: true,
    dedicatedSupport: true,
    tagline: "For companies, contractors, and crews",
    ctaLabel: "See seat plans",
  },
};

/**
 * Returns a human-friendly "pays for itself" string for paid tiers,
 * e.g. "Pays for itself after just 2 jobs/month".
 *
 * @param tier         - The target paid tier
 * @param avgJobValue  - Average job budget in dollars
 * @param jobsPerMonth - Typical jobs completed per month
 */
export function getPaysSelfBack(
  tier: SubscriptionTier,
  avgJobValue: number,
  jobsPerMonth: number,
): string {
  const perks = TIER_PERKS[tier];
  if (!perks.price) return "";
  const freeFeeRate = TIER_PERKS.free.platformFeePercent / 100;
  const tierFeeRate = perks.platformFeePercent / 100;
  const feesSavedPerJob = (freeFeeRate - tierFeeRate) * avgJobValue;
  if (feesSavedPerJob <= 0) return "";
  const jobsNeeded = Math.ceil(perks.price / feesSavedPerJob);
  const feesSaved = feesSavedPerJob * jobsPerMonth;
  if (feesSaved >= perks.price) {
    return `Pays for itself after just ${jobsNeeded} job${jobsNeeded === 1 ? "" : "s"}/month`;
  }
  return `Save $${feesSaved.toFixed(0)}/month on fees at ${jobsPerMonth} jobs`;
}

/** Map a raw subscription_tier string (may be null) to the canonical type.
 * A legacy "basic" value (the retired tier) degrades to "free" — there are no
 * paid Basic subscribers, so this only guards stale rows. */
export function toSubscriptionTier(raw: string | null | undefined): SubscriptionTier {
  if (raw === "pro" || raw === "elite" || raw === "business") return raw;
  return "free";
}

/**
 * Resolve the tiered platform-fee percent from a raw `subscription_tier` and its
 * `subscription_expires_at`. An expired paid tier reverts to the free rate even
 * if the `expire-subscriptions` cron hasn't nulled the column yet — this mirrors
 * the edge payout resolver (`_shared/helperFees.ts` `getHelperFeePercent`) so the
 * commission the UI SHOWS a helper matches the fee their payout is actually
 * charged. The ladder is identical for poster and helper (free 12 / pro 10 /
 * elite 8 / business 6). Case is normalized so "PRO" resolves like "pro".
 */
export function tierFeePercent(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return TIER_PERKS[toSubscriptionTier(expired ? "free" : (rawTier ?? "").toLowerCase())].platformFeePercent;
}
