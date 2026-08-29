// helperFees — single source of truth for the tiered platform commission that
// is deducted from a helper's payout, for the Deno edge runtime.
//
// The helper's subscription tier sets the percentage the platform keeps from
// each completed-job payout:
//
//     free → 12%   basic → 11%   pro → 10%   plus → 9%   elite → 8%
//     business → 6%
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
  business: 6,
};

/**
 * Fee percent for an unknown / unrecognized tier. Uses the advertised free
 * rate so an unexpected value never under-charges the platform.
 */
export const DEFAULT_TIER_FEE_PERCENT = TIER_FEE_PERCENT.free; // 12

/** Map a raw `profiles.subscription_tier` value (may be null) to a fee percent. */
export function feePercentForTier(rawTier: string | null | undefined): number {
  const tier = (rawTier ?? "").toLowerCase();
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
    const expired = data.subscription_expires_at
      ? new Date(data.subscription_expires_at).getTime() < Date.now()
      : false;
    return feePercentForTier(expired ? "free" : data.subscription_tier);
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
