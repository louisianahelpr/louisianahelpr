/**
 * subscriptionTiers.ts — canonical perk definitions for the membership tiers.
 * There are exactly four: Free / Basic / Pro / Elite.
 *
 * Consumer prices MUST equal the live Stripe Price objects (verified):
 *   basic $5/mo $50/yr   pro $10/mo $100/yr   plus $15/mo $150/yr   elite $20/mo $200/yr
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
 * ladder is five rungs: free 12% → basic 11% → pro 10% → plus 9% → elite 8%.
 *
 * PLUS, restored 2026-09-05 on the owner's call: $15/mo, 9% fee, between Pro
 * and Elite. It shipped 2026-08-27 and was pulled a day later — NOT because
 * the tier was wrong, but because its three LIVE Stripe Price ids were
 * `price_TODO_LIVE_PLUS_*` placeholders while both storefronts sold it, so
 * every purchase would have 500'd the moment the live key went in.
 *
 * The condition that removal set — "do not reintroduce a rung between Pro and
 * Elite without live Stripe Prices" — is now met: three real Prices were
 * created on acct_1RQbAfKp2H4b7tEC and read back to confirm their amounts
 * ($15 / $150 / $15). proTiers.parity.test.ts additionally forbids a
 * placeholder id on ANY paid tier and cycle, so the failure mode is guarded in
 * general rather than patched for this one tier.
 *
 * Its only NEW perk is the 15-minute early-access step (Pro 10 → Plus 15 →
 * Elite 20); everything else it grants, it grants by inheriting Pro, which the
 * ladder requires — a higher tier can never hold fewer perks than a lower one.
 * Elite's identity perks (Featured Crown Badge, priority support) are
 * deliberately NOT moved down: which of them Plus should get is a pricing
 * judgement for the owner, not an interpolation, so Plus ships thin-but-honest
 * rather than advertising a perk that does not exist or gutting Elite unasked.
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
// The early-access minute counts are DERIVED, never retyped. Every bullet
// below used to state its own literal ("10-min early access"), which made the
// storefront's promise a second, independent copy of a number Postgres
// enforces — and `earlyAccess.parity.test.ts` only ever pinned the SQL to
// `earlyAccess.ts`, not to these strings. Reading them through the module the
// parity test already grades puts the copy inside that guard. No cycle:
// earlyAccess.ts imports nothing.
import {
  MAX_EARLY_ACCESS_DELAY_MINUTES,
  earlyAccessHeadStartMinutes,
} from "@/lib/earlyAccess";
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

export type SubscriptionTier = "free" | "basic" | "pro" | "plus" | "elite";

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
    // "Access to all open jobs" full stop was true but incomplete, and it was
    // the ONLY thing the app ever told a Helpr about the early-access gate:
    // free members wait MAX_EARLY_ACCESS_DELAY_MINUTES before a new job is
    // visible to them at all (`public.early_access_cutoff()`), and nothing on
    // any surface said so. It also left every paid tier's "N-min early access"
    // bullet measured against a baseline the reader had never been given —
    // early compared to WHAT. Naming the wait here is the disclosure and the
    // upsell in one line.
    featureBullets: [
      `All open jobs, ${MAX_EARLY_ACCESS_DELAY_MINUTES} min after posting`,
      "Basic applicant visibility",
    ],
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
      `${earlyAccessHeadStartMinutes("basic")}-min early access`,
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
      `${earlyAccessHeadStartMinutes("pro")}-min early access`,
      "1 free Job Boost every month",
      "Advanced Analytics",
    ],
  },
  plus: {
    name: TIER_DISPLAY_NAMES.plus,
    price: 15,
    annualPrice: 12.5, // $150/yr ÷ 12
    platformFeePercent: 9,
    // Everything Pro grants, because a tier above Pro must never grant less.
    priorityPlacement: true,
    earlyAccess: true, // 15 min — see earlyAccess.ts
    advancedAnalytics: true,
    // Elite-only, left alone on purpose (see the PLUS note in the header).
    featuredBadge: false,
    dedicatedSupport: false,
    tagline: "A lower cut on every job",
    ctaLabel: "Upgrade",
    // ONE bullet, and that is the honest state of this tier: the only thing
    // Plus adds over Pro that is a real shipping feature is the extra five
    // minutes of early access. Its actual value proposition is the 9% fee,
    // which both storefronts render prominently and separately (which is why
    // fees are deliberately absent from every tier's bullets). Do not pad this
    // list with a perk that isn't built.
    featureBullets: [`${earlyAccessHeadStartMinutes("plus")}-min early access`],
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
      `${earlyAccessHeadStartMinutes("elite")}-min early access`,
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
  // DERIVED from TIER_PERKS, not a hand-written allowlist. This read
  // `raw === "basic" || raw === "pro" || raw === "elite"` and was missed when
  // Plus was restored on 2026-09-05, so every client-side Plus fee resolved to
  // the FREE rate: the storefront would have shown a Plus member 12% while the
  // edge payout resolver charged them the correct 9%. The UI and the money
  // disagreeing about commission is the exact class this file exists to
  // prevent, and a hardcoded list here cannot fail for a tier it never had.
  //
  // hasOwnProperty rather than `in`, so an inherited key like "constructor"
  // cannot resolve to a tier — the same prototype-lookup hole create-pro-
  // checkout's ALLOWED_TIERS guards against.
  if (raw && Object.prototype.hasOwnProperty.call(TIER_PERKS, raw)) {
    return raw as SubscriptionTier;
  }
  return "free";
}

/**
 * Resolve the tiered platform-fee percent from a raw `subscription_tier` and its
 * `subscription_expires_at`. An expired paid tier reverts to the free rate even
 * if the `expire-subscriptions` cron hasn't nulled the column yet — this mirrors
 * the edge payout resolver (`_shared/helperFees.ts` `getHelperFeePercent`) so the
 * commission the UI SHOWS a helper matches the fee their payout is actually
 * charged. The ladder is identical for poster and helper (free 12 / basic
 * 11 / pro 10 / plus 9 / elite 8). Case is normalized so "PRO" resolves like "pro",
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
