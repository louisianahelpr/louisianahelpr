/**
 * subscriptionTiers.ts — canonical perk definitions for the CONSUMER
 * membership tiers (Free / Basic / Pro / Elite) plus a Business row
 * that exists here ONLY as the fee-percent reference for business accounts.
 *
 * Consumer prices MUST equal the live Stripe Price objects (verified):
 *   pro  $10/mo  $100/yr   elite  $20/mo  $200/yr
 * `annualPrice` is stored as the monthly-equivalent of the annual plan
 * (yearly ÷ 12) because the /subscription page renders it as "$X/mo annual".
 *
 * BUSINESS IS NOT A SUBSCRIBABLE CONSUMER TIER. Business accounts are
 * billed per-seat on the FOUR seat-plan tiers defined in
 * `supabase/functions/_shared/businessSeatTiers.ts` (Starter free · Crew
 * $20/mo · Team $30/mo · Enterprise $40/mo). The `business` entry below
 * carries `price: null` and `annualPrice: null` on purpose so any code that
 * reads them can never accidentally render a fictional "$50/mo Business"
 * price. The in-app Business product was REMOVED on 2026-08-25; this row
 * survives only as the fee-percent reference the ladder and the edge
 * functions still read.
 *
 * The tier IDs align with the subscription_tier column on profiles
 * ("basic", "pro", "elite", "business"). "free" is the
 * default/null case. The commission ladder is five rungs:
 * free 12% → basic 11% → pro 10% → elite 8% → business 6%.
 * There is deliberately NO 9% rung: the 9% step existed only for the Plus
 * tier, which was removed on 2026-08-28, and Elite's larger fee drop is now
 * the reason to climb to the top tier. Do not invent a replacement rung.
 *
 * BASIC positioning: entry paid tier ($5/mo) for helpers testing the
 * marketplace who want the utility perks (Instant Payouts, 5-min Early
 * Access, Helpr Badge, 20% off boosts) without the full Pro spend.
 * Everything Pro has, Basic has too PLUS Pro adds priority placement,
 * portfolio showcase, and 10-min early access (vs Basic's 5-min).
 */

// The boost discount is a PRICE, owned by productPrices.ts (which the edge
// function's create-boost-payment mirror is parity-tested against). The bullet
// below advertises it, so it reads the number rather than restating it — no
// cycle: productPrices imports only lib/format, which imports nothing.
import { BOOST_DISCOUNT_PCT } from "@/lib/productPrices";
// The display NAMES live in `_shared/tierNames.ts` so the edge functions that
// print a tier at a user (expire-subscriptions' "your pass ended" notice, the
// Helpr Pass wallet TIER field) read the SAME strings as the app — a Deno
// function cannot import this module's `@/lib/...` aliases. `TIER_PERKS.name`
// below is populated from it, and `tierNames.parity.test.ts` pins the two
// together. Re-exported so UI code has one import for tier naming.
import { TIER_DISPLAY_NAMES, tierDisplayName } from "../../supabase/functions/_shared/tierNames";

export { tierDisplayName };

/**
 * How long a "Once" (one-time) tier purchase actually entitles the buyer.
 *
 * This is NOT a perpetual unlock. `stripe-webhook`'s checkoutSessionCompleted
 * handler stamps `subscription_expires_at = now + 30 days` for any session
 * whose `billing_cycle` is `one_time`, after which the tier lapses to Free.
 * The purchase surface said only "one-time" next to two genuinely-recurring
 * cycles, so the entitlement sold and the entitlement displayed disagreed.
 *
 * Keep in step with that handler — the edge runtime can't import from `src/`,
 * so the two are mirrored by hand and this comment is the link between them.
 */
export const ONE_TIME_PASS_DAYS = 30;

export type SubscriptionTier = "free" | "basic" | "pro" | "elite" | "business";

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
  // Marketing perk bullets shown on BOTH the public /subscription page and the
  // in-app membership tab. Single source of truth for the copy so the two
  // surfaces can never drift into advertising different (or unshipped) perks
  // for the same tier. Every bullet MUST map to a real, shipping feature — the
  // fee % is rendered separately (prominently) on both surfaces, so it is
  // deliberately NOT duplicated here.
  featureBullets: string[];
}

export const TIER_PERKS: Record<SubscriptionTier, TierPerks> = {
  free: {
    name: TIER_DISPLAY_NAMES.free,
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
    tagline: "No commitment",
    ctaLabel: "Current Plan",
    featureBullets: ["Access to all open jobs", "Basic applicant visibility"],
  },
  basic: {
    name: TIER_DISPLAY_NAMES.basic,
    price: 5,
    // Annual = $50/yr → monthly-equivalent 4.17 (2 months free vs $60/yr
    // at monthly). Matches the "2 months free" pattern used by Pro/Elite.
    annualPrice: 4.17,
    platformFeePercent: 11,
    priorityPlacement: false,
    featuredBadge: false,
    // 5-min early access (see earlyAccess.ts). Boolean here just signals
    // "gets some tier of early access"; the concrete minute count lives
    // in earlyAccess.ts's tier switch.
    earlyAccess: true,
    advancedAnalytics: false,
    multiTech: false,
    verifiedBusiness: false,
    dedicatedSupport: false,
    tagline: "Faster payouts",
    ctaLabel: "Upgrade",
    featureBullets: [
      "Helpr Badge",
      "Instant Payouts",
      "5-min early access",
      `${BOOST_DISCOUNT_PCT}% off Job Boosts`,
    ],
  },
  pro: {
    name: TIER_DISPLAY_NAMES.pro,
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
    tagline: "For serious earners",
    ctaLabel: "Upgrade",
    featureBullets: [
      "Priority Placement",
      "Portfolio Showcase",
      "10-min early access",
      "1 free Job Boost every month",
      "Advanced Analytics",
    ],
  },
  elite: {
    name: TIER_DISPLAY_NAMES.elite,
    // Raised $15 → $20 by the owner on 2026-08-27. The test-mode Stripe
    // Prices ($20/mo, $200/yr, $20 once) were created and the
    // STRIPE_PRICE_ELITE_* secrets repointed at the same time; this row was
    // the half of the change that had not landed yet, so the storefront was
    // advertising $15 for a checkout that charged $20.
    price: 20,
    annualPrice: 16.67,
    platformFeePercent: 8,
    priorityPlacement: true,
    featuredBadge: true,
    earlyAccess: true,
    advancedAnalytics: true,
    multiTech: false,
    verifiedBusiness: false,
    dedicatedSupport: true,
    tagline: "Maximum visibility",
    ctaLabel: "Upgrade",
    featureBullets: [
      "Featured Crown Badge",
      "20-min early access",
      "Free unlimited Job Boosts",
      "Reliability Shield — 1 strike forgiven",
      "Priority Support",
    ],
  },
  business: {
    name: TIER_DISPLAY_NAMES.business,
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
    tagline: "Teams and crews",
    ctaLabel: "See Seat Plans",
    featureBullets: [
      "Manage a team of technicians",
      "Verified Business badge",
      "Priority Placement",
      "Advanced Analytics",
      "Priority Support",
    ],
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
  return `Save $${feesSaved.toFixed(0)}/month on fees at ${jobsPerMonth} job${jobsPerMonth === 1 ? "" : "s"}`;
}

/** Map a raw subscription_tier string (may be null) to the canonical type.
 * Unknown / null / empty → "free" (the safe default that never charges a
 * user for perks they didn't opt into). */
export function toSubscriptionTier(raw: string | null | undefined): SubscriptionTier {
  if (raw === "basic" || raw === "pro" || raw === "elite" || raw === "business") return raw;
  return "free";
}

/**
 * Resolve the tiered platform-fee percent from a raw `subscription_tier` and its
 * `subscription_expires_at`. An expired paid tier reverts to the free rate even
 * if the `expire-subscriptions` cron hasn't nulled the column yet — this mirrors
 * the edge payout resolver (`_shared/helperFees.ts` `getHelperFeePercent`) so the
 * commission the UI SHOWS a helper matches the fee their payout is actually
 * charged. The ladder is identical for poster and helper (free 12 / basic
 * 11 / pro 10 / elite 8 / business 6). Case is normalized so "PRO"
 * resolves like "pro".
 */
export function tierFeePercent(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return TIER_PERKS[toSubscriptionTier(expired ? "free" : (rawTier ?? "").toLowerCase())].platformFeePercent;
}
