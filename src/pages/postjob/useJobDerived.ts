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
  } = params;

  const budgetNum = parseFloat(budget) || 0;
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;
  // Charged once per account on the first funded job — mirror the edge
  // function so the shown total equals the Stripe charge (see state above).
  const onboardingFeeAmount = onboardingFeePaid ? 0 : onboardingFeeCents / 100;
  // The poster service fee is their OWN tier percent (12/10/8/6), floored at
  // Stripe's real processing cost on the whole transaction so a tiny job can
  // never lose the platform money to fees. Compute in cents via the same
  // authority the create-payment edge function uses (posterFees), so the shown
  // total equals the Stripe charge. Default 12 = free tier (never-undercharge).
  const budgetCents = Math.round(budgetNum * 100);
  const urgentFeeCents = Math.round(urgentFeeNum * 100);
  const onboardingCents = onboardingFeePaid ? 0 : onboardingFeeCents;
  const customerFeeAmount =
    posterServiceFeeCents(budgetCents, customerFee ?? 12, urgentFeeCents + onboardingCents) / 100;
  // Every charged line EXCEPT sales tax. Tax is added by CheckoutStep, which
  // is where the parish rate resolves — and for the great majority of
  // categories it is $0, because create-payment marks every line but assembly
  // labor `txcd_00000000`. See `src/lib/salesTax.ts`.
  const totalCharge = budgetNum + customerFeeAmount + urgentFeeNum + onboardingFeeAmount;
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
