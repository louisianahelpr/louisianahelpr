import { categoryPricing } from "@/lib/pricingGuide";
import { categories } from "@/components/postjob/DetailsSection";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { posterServiceFeeCents } from "@/lib/posterFees";
import { MIN_JOB_BUDGET_DOLLARS } from "@/lib/moneyLimits";
import { useCategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import { computeBudgetPresets } from "./postJobFormHelpers";

/**
 * useJobDerived — pure derived values for the Post-a-Task form: checkout
 * money math (budget, fees, onboarding, total), per-chapter
 * completion flags for the progress bar, live pricing stats, two-sided
 * liquidity signal, and the budget preset pills. Structural extraction
 * from usePostJobForm; every calculation is unchanged.
 */
export interface UseJobDerivedParams {
  budget: string;
  isUrgent: boolean;
  urgentFee: string;
  customerFee: number | null;
  onboardingFeePaid: boolean;
  onboardingFeeCents: number;
  category: string;
  title: string;
  description: string;
  streetAddress: string;
  city: string;
  addrState: string;
  zipCode: string;
  dateNeeded: string;
  startTime: string;
  parish: string | null;
  /**
   * Value of the Pay It Forward gift riding on this post, in dollars, or
   * `null` when there is no gift (or one that `redeem_pif_credit` would
   * refuse — see usePifCredit). Drives the gift math below.
   */
  pifCreditAmount?: number | null;
}

export function useJobDerived(params: UseJobDerivedParams) {
  const {
    budget,
    isUrgent,
    urgentFee,
    customerFee,
    onboardingFeePaid,
    onboardingFeeCents,
    category,
    title,
    description,
    streetAddress,
    city,
    addrState,
    zipCode,
    dateNeeded,
    startTime,
    parish,
    pifCreditAmount = null,
  } = params;

  const budgetNum = parseFloat(budget) || 0;
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;

  /* ── Pay It Forward gift — THE SERVER IS THE AUTHORITY ON PRICE ─────────
     Everything below mirrors two server files exactly; it does not invent a
     second formula, because two formulas drift and the drift lands on the
     poster's card.

     1. `redeem_pif_credit` (migration 20260831233515) computes the cost the
        gift is applied against as

            v_cost_cents := round((budget + coalesce(urgent_fee, 0)) * 100)

        — sum first, THEN round, which is why `giftCostCents` below rounds the
        sum rather than each line (they differ by a cent on halves). The urgent
        fee is INSIDE the covered amount on purpose: release-payout pays the
        helper `budget + netUrgentFeeDollars(urgent_fee)`, so a gift that
        stopped at the budget left the platform funding the bonus (F-GIFT-2).
     2. `create-payment` (action=escrow) short-circuits into the PIF branch
        BEFORE the tier/fee/tax pricing, so a gift-funded post carries NO
        poster service fee (the donor already paid the processing floor at
        donate time), NO one-time account-setup fee, and NO sales tax — the
        settled branch never touches Stripe at all, and the shortfall session
        prices its single line `txcd_00000000` (non-taxable).

     So the poster's real cost is `budget + urgent fee − gift`, floored at
     zero, and nothing else. `jobs.urgent_fee` is written as
     `isUrgent ? parseFloat(urgentFee) || 0 : 0` (jobSubmitHelpers), which is
     `urgentFeeNum` — the same number, so the two sides cannot disagree. */
  const giftCreditCents = Math.max(0, Math.round((pifCreditAmount ?? 0) * 100));
  const hasGift = giftCreditCents > 0;
  const giftCostCents = Math.round((budgetNum + urgentFeeNum) * 100);
  const giftAppliedCents = Math.min(giftCostCents, giftCreditCents);
  const giftDueCents = giftCostCents - giftAppliedCents;
  /** Dollars the gift actually covers — the "Gift applied −$X" line. */
  const giftAppliedAmount = giftAppliedCents / 100;
  /** Full face value of the gift; > applied when the gift outruns the job. */
  const giftCreditAmount = giftCreditCents / 100;

  // Charged once per account on the first funded job — mirror the edge
  // function so the shown total equals the Stripe charge (see state above).
  // Waived on a gift-funded post: create-payment returns before this line
  // item exists, so quoting it would overstate the charge.
  const onboardingFeeAmount = hasGift || onboardingFeePaid ? 0 : onboardingFeeCents / 100;
  // The poster service fee is their OWN tier percent (12/11/10/8), floored at
  // Stripe's real processing cost on the whole transaction so a tiny job can
  // never lose the platform money to fees. Compute in cents via the same
  // authority the create-payment edge function uses (posterFees), so the shown
  // total equals the Stripe charge. Default 12 = free tier (never-undercharge).
  // Also waived on a gift-funded post, for the same reason as above.
  const budgetCents = Math.round(budgetNum * 100);
  const urgentFeeCents = Math.round(urgentFeeNum * 100);
  const onboardingCents = onboardingFeePaid ? 0 : onboardingFeeCents;
  const customerFeeAmount = hasGift
    ? 0
    : posterServiceFeeCents(budgetCents, customerFee ?? 12, urgentFeeCents + onboardingCents) / 100;
  // Every charged line EXCEPT sales tax. Tax is added by CheckoutStep, which
  // is where the parish rate resolves — and for the great majority of
  // categories it is $0, because create-payment marks every line but assembly
  // labor `txcd_00000000`. See `src/lib/salesTax.ts`.
  //
  // On the gift path this IS the final number: no fees and no tax follow it,
  // so CheckoutStep must not add tax on top (see `hasGift` there).
  const totalCharge = hasGift
    ? giftDueCents / 100
    : budgetNum + customerFeeAmount + urgentFeeNum + onboardingFeeAmount;
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  // Section completion for the 3-step progress bar. Photos are optional
  // (strongly nudged, never required), so the Details chapter is "done"
  // once title, description, and category are set.
  const detailsComplete = !!(title.trim() && description.trim() && category && !hasUnfilledPlaceholders(description));
  const logisticsComplete = !!(streetAddress.trim() && city.trim() && addrState.trim() && zipCode.trim() && dateNeeded && startTime);
  // The budget is always required now. It used to be optional in "Accept bids"
  // mode, where helpers named the price — that mode is gone
  // (PRICING_MODE_REMOVED in BudgetSection).
  const budgetComplete = !!(budget && parseFloat(budget) >= MIN_JOB_BUDGET_DOLLARS);

  // Smart Pricing Guidance — live budget range from real completed jobs
  // in this category (+ parish), with a graceful fallback to the static
  // categoryPricing table when the RPC is missing or data is thin.
  const { stats: priceStats, loading: priceStatsLoading } = useCategoryPriceStats(category, parish);

  // Two-sided liquidity signal — a conservative count of helprs who've
  // worked in the poster's parish, shown at checkout so they know the
  // other side of the marketplace is active before they pay. Null when
  // the parish is unknown or the count is too thin to be honest.
  const { activity: helprActivity } = useHelprActivity(parish);

  // Budget presets derived from category suggested range. Prefer the
  // live stats range when available so the quick-tap pills track the
  // real market; otherwise fall back to the static guide.
  const suggested = category && categoryPricing[category] ? categoryPricing[category] : null;
  const presetRange = priceStats ?? suggested;
  // Snap each preset to the nearest $25 ($25 floor) so the quick-tap pills
  // read as clean round numbers instead of raw market values like $38.
  // A bump pass keeps the three values distinct and ascending when two
  // snap to the same multiple (e.g. 38 & 60 → 50 & 50 → 50 & 75).
  const budgetPresets = computeBudgetPresets(presetRange, priceStats?.median);

  return {
    budgetNum,
    urgentFeeNum,
    customerFeeAmount,
    onboardingFeeAmount,
    totalCharge,
    hasGift,
    giftAppliedAmount,
    giftCreditAmount,
    categoryLabel,
    detailsComplete,
    logisticsComplete,
    budgetComplete,
    priceStats,
    priceStatsLoading,
    helprActivity,
    suggested,
    budgetPresets,
  };
}
