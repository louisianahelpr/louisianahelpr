import { categoryPricing } from "@/lib/pricingGuide";
import { categories } from "@/components/postjob/DetailsSection";
import { hasUnfilledPlaceholders } from "@/lib/postingTemplates";
import { useCategoryPriceStats } from "@/hooks/useCategoryPriceStats";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import type { PricingMode } from "@/components/postjob/BudgetSection";
import { computeBudgetPresets } from "./postJobFormHelpers";

/**
 * useJobDerived — pure derived values for the Post-a-Task form: checkout
 * money math (budget, fees, protection, onboarding, total), per-chapter
 * completion flags for the progress bar, live pricing stats, two-sided
 * liquidity signal, and the budget preset pills. Structural extraction
 * from usePostJobForm; every calculation is unchanged.
 */
export interface UseJobDerivedParams {
  budget: string;
  isUrgent: boolean;
  urgentFee: string;
  customerFee: number | null;
  protectionOptedIn: boolean;
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
  estimatedHours: string;
  pricingMode: PricingMode;
  parish: string | null;
}

export function useJobDerived(params: UseJobDerivedParams) {
  const {
    budget,
    isUrgent,
    urgentFee,
    customerFee,
    protectionOptedIn,
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
    estimatedHours,
    pricingMode,
    parish,
  } = params;

  const budgetNum = parseFloat(budget) || 0;
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;
  const customerFeeAmount = budgetNum * ((customerFee ?? 10) / 100);
  const protectionFeeNum = protectionOptedIn ? 3.0 : 0;
  // Charged once per account on the first funded job — mirror the edge
  // function so the shown total equals the Stripe charge (see state above).
  const onboardingFeeAmount = onboardingFeePaid ? 0 : onboardingFeeCents / 100;
  const totalCharge = budgetNum + customerFeeAmount + urgentFeeNum + protectionFeeNum + onboardingFeeAmount; // + Sales tax at checkout
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  // Section completion for the 3-step progress bar. Photos are optional
  // (strongly nudged, never required), so the Details chapter is "done"
  // once title, description, and category are set.
  const detailsComplete = !!(title.trim() && description.trim() && category && !hasUnfilledPlaceholders(description));
  const logisticsComplete = !!(streetAddress.trim() && city.trim() && addrState.trim() && zipCode.trim() && dateNeeded && startTime && estimatedHours && parseFloat(estimatedHours) >= 0.5);
  // In accept_bids mode the budget is optional — helpers set their own price.
  const budgetComplete =
    pricingMode === "accept_bids"
      ? true
      : !!(budget && parseFloat(budget) >= 5);

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
    protectionFeeNum,
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
