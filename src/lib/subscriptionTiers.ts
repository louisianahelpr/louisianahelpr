/**
 * subscriptionTiers.ts — canonical perk definitions for the membership tiers.
 * There are exactly four: Free / Basic / Pro / Elite.
 *
 * Consumer prices MUST equal the live Stripe Price objects (verified):
 *   basic $5/mo $50/yr   pro  $10/mo  $100/yr   elite  $20/mo  $200/yr
 * `annualPrice` is stored as the monthly-equivalent of the annual plan
 * (yearly ÷ 12) because the membership cards render it as "$X/mo annual".
 *
 * THE ONLY SURFACE THAT SELLS THESE IS `/profile?tab=subscription`
 * (`SubscriptionTab` → `subscriptionTab/tierConfig.tsx`). This header, and
 * several comments elsewhere in the codebase, used to describe a "public
 * /subscription page" as a second storefront. There is no such route: `App.tsx`
 * registers 47 paths and `/subscription` is not among them, and
 * `SubscriptionPage.tsx` no longer exists. Verified 2026-09-01. The only
 * survivor is a dead allow-list entry in `src/lib/desktopNavRoutes.ts`.
 *
 * THERE IS NO BUSINESS TIER. A `business` row used to sit at the bottom of
 * this table at 6%, described as the fee reference for business accounts. It
 * was removed on 2026-09-01 because nothing could reach it, in either
 * direction:
 *   • Nothing could SELL it — `create-pro-checkout`'s ALLOWED_TIERS is
 *     ["basic","pro","elite"] and throws on anything else (verified live in
 *     test mode: a `business` checkout returns an error, `basic`/`pro`/`elite`
 *     return a session); `ProTierKey` is "basic"|"pro"|"elite"; no Stripe Price
 *     maps to it; `_shared/PRODUCT_TO_TIER` maps no product to it; there is no
 *     seat-checkout function.
 *   • Nothing could HOLD it — the business backend (`businesses`,
 *     `business_members`, the seat ladder) was dropped by migrations
 *     20260828004538 / 20260828011811, and
 *     `supabase/functions/_shared/businessSeatTiers.ts` — which several file
 *     headers cited as the pricing authority — does not exist. A prod census
 *     immediately before the removal found ZERO `profiles` rows holding
 *     'business'; `profiles.subscription_tier` is the only column that stores
 *     a tier, so nobody was re-rated.
 *
 * A stray 'business' string surviving somewhere resolves to the FREE rate (12%)
 * through `toSubscriptionTier`, `tierFeePercent` and the edge
 * `DEFAULT_TIER_FEE_PERCENT` — the safe direction: an unrecognised tier
 * over-charges the user's account rather than under-charging the platform.
 *
 * The tier IDs align with the subscription_tier column on profiles
 * ("basic", "pro", "elite"). "free" is the default/null case. The commission
 * ladder is four rungs: free 12% → basic 11% → pro 10% → elite 8%.
 *
 * There is deliberately NO 9% rung. A "Plus" tier ($15/mo, 9%) shipped on
 * 2026-08-27 and was removed by the owner on 2026-08-28 — it was never wired
 * into LIVE Stripe (its three Price IDs were placeholders), so selling it the
 * moment the live key went in would have 500'd every purchase. Do not
 * reintroduce a rung between Pro and Elite without live Stripe Prices.
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

export type SubscriptionTier = "free" | "basic" | "pro" | "elite";

export interface TierPerks {
  name: string;
  price: number | null;         // monthly USD, null = free
  annualPrice: number | null;   // annual plan's monthly-equivalent (yearly ÷ 12), null = free
  platformFeePercent: number;   // % taken from helper payout — descends as price rises (free 12% → basic 11% → pro 10% → elite 8%)
  priorityPlacement: boolean;   // application floated higher in poster's recommended list
  featuredBadge: boolean;       // gold/crown badge on profile and applicant cards
  earlyAccess: boolean;         // sees new jobs before non-subscribers (basic 5m / pro 10m / elite 20m)
  advancedAnalytics: boolean;   // earnings trends, category breakdown, best hours
  // `multiTech` and `verifiedBusiness` were removed on 2026-09-01, ahead of the
  // Business tier itself. Both were Business-only booleans describing features
  // whose backends were deleted by migration
  // 20260828004538_remove_business_seats_dead_backend: seat/team management has
  // no UI and no edge function, and `is_user_verified_business_member()` was
  // dropped along with the whole verification queue. Neither flag was ever read
  // anywhere — a repo-wide grep found hits only in this file and its own
  // `featureBullets` copy — so they were pure marketing description of things
  // that do not exist. Do not reintroduce a perk flag before the feature that
  // satisfies it.
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
    dedicatedSupport: true,
    tagline: "Maximum visibility",
    ctaLabel: "Upgrade",
    featureBullets: [
      "Featured Crown Badge",
      "20-min early access",
      "Free unlimited Job Boosts",
      // Fits ONE line on the in-app Membership card, which is the tightest
      // surface: its bullets get 160.6px at 402pt (the price column takes the
      // right edge), and the longest other bullet — "1 free Job Boost every
      // month" — is 158.7px. Measured, not guessed. The owner's suggested
      // "Reliability Shield — 1 strike forgiven" is 192.2px and wrapped, so
      // "forgiven" is dropped: "Shield" already carries it, and this leaves
      // 16px of slack for font variance and larger Dynamic Type. The dropped
      // "every 6 months" cadence was also a bug on the Once 30-day pass,
      // which can never reach a 6-month window.
      "Reliability Shield — 1 strike",
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
  if (raw === "basic" || raw === "pro" || raw === "elite") return raw;
  return "free";
}

/**
 * Resolve the tiered platform-fee percent from a raw `subscription_tier` and its
 * `subscription_expires_at`. An expired paid tier reverts to the free rate even
 * if the `expire-subscriptions` cron hasn't nulled the column yet — this mirrors
 * the edge payout resolver (`_shared/helperFees.ts` `getHelperFeePercent`) so the
 * commission the UI SHOWS a helper matches the fee their payout is actually
 * charged. The ladder is identical for poster and helper (free 12 / basic
 * 11 / pro 10 / elite 8). Case is normalized so "PRO" resolves like "pro",
 * and any value off the ladder — including a legacy "business" — falls to the
 * free rate, which never under-charges.
 */
export function tierFeePercent(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return TIER_PERKS[toSubscriptionTier(expired ? "free" : (rawTier ?? "").toLowerCase())].platformFeePercent;
}
