// tierPerks — the ONE place that answers "does this tier get feature X?".
//
// WHY THIS FILE EXISTS. Every entitlement gate in this codebase used to be
// written as a hand-typed tier list — `tier === "basic" || tier === "pro" ||
// tier === "elite"` — and each one was a separate copy of the same fact. When
// Plus was restored on 2026-09-05 that shape failed in five places at once
// (CC-019):
//
//   • supabase/functions/instant-payout — a paying Plus member got a 403 and
//     the copy "Upgrade to Basic, Pro or Elite", i.e. told to buy a CHEAPER
//     plan than the one they already hold.
//   • src/components/profile/EarningsTab.tsx — same gate, client side, so the
//     button was hidden too.
//   • src/lib/applicantScoring.ts — Plus scored 0 placement points despite
//     TIER_PERKS.plus.priorityPlacement === true.
//   • src/components/dashboard/JobPosterCard.tsx — no tier badge, no trust row.
//   • src/components/admin/AdminDisputes.tsx — Plus sorted below Basic in the
//     dispute queue.
//
// This is the "registries checked against themselves" failure: a literal list
// cannot fail a test for a member it never had. The fix is not to add "plus"
// to five lists — it is to have no lists. Callers ask `hasPerk(tier, perk)`,
// which reads the matrix below, and the matrix is walked key-by-key by
// src/lib/tierPerks.parity.test.ts, so a tier added tomorrow either gets an
// explicit row here or fails to compile.
//
// It lives in `_shared` (plain TS, no Deno imports at module scope) for the
// same reason `tierNames.ts` and `proTiers.ts` do: the Deno edge runtime
// cannot import `src/lib/...` through the `@/` alias, and instant-payout and
// create-boost-payment are two of the gates that must agree with the UI.
// `src/lib/subscriptionTiers.ts` POPULATES TIER_PERKS from this matrix rather
// than restating it, so there is one table, not two that a parity test hopes
// to keep aligned.

/** Every tier that can appear in `profiles.subscription_tier` (plus the free default). */
export type TierId = "free" | "basic" | "pro" | "plus" | "elite";

/**
 * The commission ladder, cheapest first. Also the PRIORITY ORDER wherever a
 * higher-paying member is served first (the admin dispute queue). Index in
 * this array is the tier's rank; an unrecognised id ranks 0 alongside free.
 */
export const TIER_ORDER: readonly TierId[] = ["free", "basic", "pro", "plus", "elite"] as const;

/** The perks a gate can ask about. Adding one here forces a value on every tier. */
export type TierPerkKey =
  | "instantPayout"        // cash out before the standard payout schedule (3% fee)
  | "priorityPlacement"    // application floated higher in the poster's list
  | "earlyAccess"          // sees new jobs before free members
  | "advancedAnalytics"    // earnings trends, category breakdown, best hours
  | "featuredBadge"        // gold/crown badge on profile and applicant cards
  | "dedicatedSupport"     // priority support SLA
  | "boostDiscount"        // pays a reduced price for a Job Boost
  | "freeBoosts"           // Job Boosts included in the plan, unlimited
  | "monthlyFreeBoost"     // one Job Boost per calendar month, then the discount
  | "portfolioShowcase"    // photo portfolio rendered on the public profile
  | "referralUpgradeBonus" // upgrading to this tier pays the referrer the extra bonus
  | "helprPass"           // the Helpr Pass wallet card
  | "tierBadge";           // renders a subscriber badge / trust row anywhere a tier is shown

/**
 * THE truth table. One row per tier, one column per perk, no gaps.
 *
 * LADDER RULE: a higher tier must never hold FEWER perks than a lower one —
 * that is what "Everything in Pro" means on the storefront, and it is what
 * `plus` inherits. The one deliberate exception is `boostDiscount`: Elite does
 * not get a discount because it gets `freeBoosts` instead, which is strictly
 * better. `tierPerks.parity.test.ts` asserts the ladder and hard-codes that
 * single exemption, so a second one cannot be introduced silently.
 */
export const TIER_PERK_MATRIX: Record<TierId, Record<TierPerkKey, boolean>> = {
  free: {
    instantPayout: false,
    priorityPlacement: false,
    earlyAccess: false,
    advancedAnalytics: false,
    featuredBadge: false,
    dedicatedSupport: false,
    boostDiscount: false,
    freeBoosts: false,
    monthlyFreeBoost: false,
    portfolioShowcase: false,
    referralUpgradeBonus: false,
    helprPass: false,
    tierBadge: false,
  },
  basic: {
    instantPayout: true,
    priorityPlacement: false,
    earlyAccess: true, // 5 min — see earlyAccess.ts
    advancedAnalytics: false,
    featuredBadge: false,
    dedicatedSupport: false,
    boostDiscount: true,
    freeBoosts: false,
    monthlyFreeBoost: false,
    portfolioShowcase: false,
    referralUpgradeBonus: false,
    helprPass: false,
    tierBadge: true,
  },
  pro: {
    instantPayout: true,
    priorityPlacement: true,
    earlyAccess: true, // 10 min
    advancedAnalytics: true,
    featuredBadge: false,
    dedicatedSupport: false,
    boostDiscount: true,
    freeBoosts: false,
    monthlyFreeBoost: true,
    portfolioShowcase: true,
    referralUpgradeBonus: true,
    helprPass: false,
    tierBadge: true,
  },
  plus: {
    // Everything Pro grants. Plus's own perk is the 9% fee and the 15-minute
    // early-access step; it adds nothing Pro lacks, but it must never lack
    // anything Pro has.
    instantPayout: true,
    priorityPlacement: true,
    earlyAccess: true, // 15 min
    advancedAnalytics: true,
    // Elite identity perks, left with Elite on purpose (see the PLUS note in
    // src/lib/subscriptionTiers.ts).
    featuredBadge: false,
    dedicatedSupport: false,
    boostDiscount: true,
    freeBoosts: false,
    monthlyFreeBoost: true,
    portfolioShowcase: true,
    referralUpgradeBonus: true,
    helprPass: false,
    tierBadge: true,
  },
  elite: {
    instantPayout: true,
    priorityPlacement: true,
    earlyAccess: true, // 20 min
    advancedAnalytics: true,
    featuredBadge: true,
    dedicatedSupport: true,
    // Not a discount — boosts are included outright, which the boost pricer
    // checks first.
    boostDiscount: false,
    freeBoosts: true,
    monthlyFreeBoost: true,  // moot — freeBoosts is checked first and is unlimited
    portfolioShowcase: true,
    referralUpgradeBonus: true,
    helprPass: true,
    tierBadge: true,
  },
};

/**
 * Normalise a raw `profiles.subscription_tier` to a known tier id.
 *
 * Unknown / null / empty / legacy ('business') → "free". Case-insensitive, so
 * a legacy "PRO" row resolves. `hasOwnProperty` rather than `in`, so an
 * inherited key like "constructor" cannot resolve to a tier.
 */
export function normalizeTier(raw: string | null | undefined): TierId {
  const t = (raw ?? "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(TIER_PERK_MATRIX, t) ? (t as TierId) : "free";
}

/**
 * Rank on the commission ladder — 0 (free) to TIER_ORDER.length - 1 (elite).
 * Unknown ids rank 0, which is the safe direction everywhere it is used.
 */
export function tierRank(raw: string | null | undefined): number {
  return TIER_ORDER.indexOf(normalizeTier(raw));
}

/**
 * THE entitlement predicate. Replaces every hand-written tier list.
 *
 * @param raw    raw `profiles.subscription_tier` (may be null; case-insensitive)
 * @param perk   which perk to test
 * @param active whether the subscription is still live. Callers resolve this
 *               with the house convention — a NULL `subscription_expires_at`
 *               on a paid tier means "no scheduled end" and counts as ACTIVE;
 *               a past expiry counts as lapsed even if the
 *               `expire-subscriptions` cron has not nulled the column yet.
 *               Pass `false` and every perk is denied, which is what a lapsed
 *               member must get. Defaults to true so a caller with no expiry
 *               in hand (pure display of another user's tier) reads naturally.
 */
export function hasPerk(
  raw: string | null | undefined,
  perk: TierPerkKey,
  active = true,
): boolean {
  if (!active) return false;
  return TIER_PERK_MATRIX[normalizeTier(raw)][perk];
}

/**
 * The same question, resolved straight from the two raw profile columns, for
 * the many callers that hold exactly those. Keeps the expiry convention in ONE
 * place instead of re-deriving `subActive` at each gate (which is how the
 * poster and helper fee resolvers drifted before `feePercentForTier` folded
 * expiry in).
 *
 * An unparseable / absent `expiresAt` is treated as NOT expired, so a
 * malformed timestamp never silently strips someone's paid perks.
 */
export function profileHasPerk(
  rawTier: string | null | undefined,
  expiresAt: string | null | undefined,
  perk: TierPerkKey,
): boolean {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  return hasPerk(rawTier, perk, !expired);
}

/**
 * Human-readable list of the tiers that grant a perk, for upgrade copy —
 * "Upgrade to Basic, Pro, Plus or Elite". DERIVED, so the sentence a 403
 * returns can never name a different set than the gate that produced it. That
 * exact mismatch is what told a Plus member to downgrade to Basic.
 *
 * @param displayName maps a tier id to its user-facing name (tierNames.ts's
 *                    `tierDisplayName` — passed in rather than imported to
 *                    keep this module dependency-free).
 */
export function tiersGrantingPerk(perk: TierPerkKey): TierId[] {
  return TIER_ORDER.filter((t) => t !== "free" && TIER_PERK_MATRIX[t][perk]);
}

export function tiersGrantingPerkSentence(
  perk: TierPerkKey,
  displayName: (t: string) => string,
): string {
  const names = tiersGrantingPerk(perk).map(displayName);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
