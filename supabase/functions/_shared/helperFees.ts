// helperFees — single source of truth for the tiered platform fee, for the Deno
// edge runtime. It is the commission deducted from a helper's payout AND (via
// `posterFees.ts`, which aliases the resolver below) the service fee a poster is
// charged at checkout: one user, one tier, one percent, whichever side of the
// job they are on.
//
// The subscription tier sets the percentage:
//
//     free → 12%   basic → 11%   pro → 10%   elite → 8%
//
// There is no `plus` tier — this header used to list "plus → 9%", which has
// never existed in `TIER_FEE_PERCENT`, in `subscriptionTiers.ts`, or as a
// purchasable Stripe price. A raw "plus" therefore resolves to the free rate
// (12) via DEFAULT_TIER_FEE_PERCENT, which is the safe direction, but the
// comment implied a discount the code does not grant.
//
// There is no `business` tier either. A `business: 6` rung sat in the table
// below until 2026-09-01. Nothing could sell it (`create-pro-checkout`'s
// ALLOWED_TIERS is ["basic","pro","elite"] and throws otherwise; `ProTierKey`
// is "basic"|"pro"|"elite"; no Stripe Price maps to it; there is no
// seat-checkout function) and nothing could hold it (the business backend was
// dropped by migrations 20260828004538 / 20260828011811, and the
// `_shared/businessSeatTiers.ts` several headers cited as its pricing authority
// does not exist). A prod census immediately before the removal found ZERO
// `profiles` rows holding it, so nobody was re-rated. It had to come out of
// this table and `TIER_PERKS` in one commit, because the parity tests pin the
// two key sets together and removing it from one side alone reds the build.
//
// A stray "business" now resolves to DEFAULT_TIER_FEE_PERCENT (12) like any
// other unrecognised value — the same safe direction as "plus".
//
// This MUST stay in lock-step with `src/lib/subscriptionTiers.ts` TIER_PERKS
// (the React/TS source the UI renders from). The edge runtime is Deno and
// cannot import that React module, so the ladder is duplicated here and a
// vitest parity test (`src/lib/helperFees.parity.test.ts`) fails the build if
// the two ever drift.
//
// Why resolve the fee at PAYOUT and not at checkout: no helper is assigned
// when a poster funds escrow, so the helper's tier is unknown then. Every site
// that actually moves money to a helper resolves the tier from the helper's
// live profile at payout time.

/** Tier id (lowercased `profiles.subscription_tier`) → platform fee percent. */
export const TIER_FEE_PERCENT: Record<string, number> = {
  free: 12,
  basic: 11,
  pro: 10,
  elite: 8,
};

/**
 * Fee percent for an unknown / unrecognized tier. Uses the advertised free
 * rate so an unexpected value never under-charges the platform.
 */
export const DEFAULT_TIER_FEE_PERCENT = TIER_FEE_PERCENT.free; // 12

/**
 * THE tier → fee-percent resolver, for BOTH roles.
 *
 * Product rule: one user, one tier, one percent — the percentage a person is
 * charged must be identical whether they are posting a job or helping on one.
 * So this function is the single resolver both sides call, and it must take the
 * SAME inputs on both sides or the two roles can still diverge on the inputs
 * even while sharing the table.
 *
 * `expiresAt` used to live only on the poster side (`posterFeePercentForTier`),
 * which meant the two resolvers had different signatures and only one of them
 * could see a lapsed subscription. Nothing shipped a wrong percent because every
 * helper-side CALLER (`getHelperFeePercent`, `money-reconciliation`) did its own
 * `expires_at` comparison before calling in — but the asymmetry was a live trap:
 * any new helper-side caller that passed just the tier would keep charging a
 * lapsed Pro 10% while the poster side charged them 12%. Folding expiry in here
 * removes the trap: an expired paid tier reverts to the free rate on both sides
 * even if the `expire-subscriptions` cron hasn't nulled the column yet.
 *
 * An unparseable / absent `expiresAt` is treated as NOT expired (NaN < now is
 * false), so a malformed timestamp never silently re-rates someone.
 *
 * @param rawTier   raw `profiles.subscription_tier` (may be null; case-insensitive)
 * @param expiresAt raw `profiles.subscription_expires_at` (may be null)
 */
export function feePercentForTier(
  rawTier: string | null | undefined,
  expiresAt?: string | null,
): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  const tier = (expired ? "free" : (rawTier ?? "")).toLowerCase();
  return TIER_FEE_PERCENT[tier] ?? DEFAULT_TIER_FEE_PERCENT;
}

/** Minimal shape of the service-role Supabase client this helper needs. */
interface FeeAdminClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{
          data: { subscription_tier: string | null; subscription_expires_at: string | null } | null;
          error: unknown;
        }>;
      };
    };
  };
}

/**
 * Resolve the helper-fee percent for one helper from their live subscription
 * tier. An expired paid tier reverts to free pricing even if the
 * `expire-subscriptions` cron hasn't nulled the column yet, so a lapsed Pro is
 * never charged the discounted rate.
 *
 * On any read failure we return `fallbackPercent` (the caller's prior
 * `platform_settings.helper_fee_percent`/literal value) so a transient error
 * never silently changes a payout.
 */
export async function getHelperFeePercent(
  admin: FeeAdminClient,
  helperId: string | null | undefined,
  fallbackPercent: number,
): Promise<number> {
  if (!helperId) return fallbackPercent;
  try {
    const { data, error } = await admin
      .from("profiles")
      .select("subscription_tier, subscription_expires_at")
      .eq("user_id", helperId)
      .single();
    if (error || !data) {
      // Falling back IS silently changing the fee (an Elite helper's 8% becomes
      // the 10-12% fallback) — the fallback is the right call for a payout path
      // (never block money on a transient read), but it must be findable.
      console.warn(`[helperFees] tier read failed for ${helperId}, using fallback ${fallbackPercent}%:`, error);
      return fallbackPercent;
    }
    // Expiry is handled INSIDE feePercentForTier so this path and the poster
    // path (`posterFeePercentForTier`) cannot drift on the lapsed-tier rule.
    return feePercentForTier(data.subscription_tier, data.subscription_expires_at);
  } catch (e) {
    console.warn(`[helperFees] tier read threw for ${helperId}, using fallback ${fallbackPercent}%:`, e);
    return fallbackPercent;
  }
}

/**
 * THE helper commission, in whole cents.
 *
 * Two payout paths computed this differently and disagreed by a cent on 2,243
 * (budget, tier) pairs under $200 — so the `payout_transfers` ledger could not
 * reconcile bit-for-bit depending on which path paid:
 *
 *   release-payout:            Math.round(perHelperBudget * pct) / 100
 *   process-scheduled-payouts: (perHelperBudget * pct) / 100      ← no rounding
 *
 * The FIRST one is right, and the reason is a small arithmetic coincidence
 * worth stating: `dollars × percent` is already the commission in CENTS
 * ($100 × 12 = 1200¢ = $12.00). So rounding that product to a whole number is
 * rounding money to the cent — which is what money must do — while the second
 * form carried sub-cent precision into the payout and let it fall differently
 * once the payout itself was rounded.
 *
 * Callers should take cents and convert once, rather than round twice.
 */
export function helperCommissionCents(
  perHelperBudgetDollars: number,
  feePercent: number,
): number {
  return Math.round(perHelperBudgetDollars * feePercent);
}

/** The same commission expressed in dollars, exact to the cent. */
export function helperCommissionDollars(
  perHelperBudgetDollars: number,
  feePercent: number,
): number {
  return helperCommissionCents(perHelperBudgetDollars, feePercent) / 100;
}
