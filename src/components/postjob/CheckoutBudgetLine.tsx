import { formatPriceExact } from "@/lib/format";

/**
 * The review step's secondary line under the Total: the budget, and what sits on top of it.
 * F18 (audit 2026-10-28): only when it says something the total does not. A plain $40 job read
 * "$40.00" over "$40.00 budget", the same number twice.
 */
export function CheckoutBudgetLine({
  budgetNum, totalWithTax, hasGift, giftAppliedAmount, isUrgent, urgentFeeNum, onboardingFeeAmount,
}: {
  budgetNum: number;
  totalWithTax: number;
  hasGift: boolean;
  giftAppliedAmount: number;
  isUrgent: boolean;
  urgentFeeNum: number;
  onboardingFeeAmount: number;
}) {
  if (!(budgetNum > 0 && (hasGift || Math.round(totalWithTax * 100) !== Math.round(budgetNum * 100)))) return null;
  return (
    <p className="text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      <span className="font-semibold text-foreground">${formatPriceExact(budgetNum)}</span>
      {/* Names what the total holds. F3 (owner 2026-10-14/15): there
          is no service fee or card-cost line, so "budget + fees"
          would name fees that are not there; only the urgent
          bonus and the one-time setup fee can sit on top. On a
          gift-funded post the number above is what's left after
          the gift, so name the gift instead. */}
      {hasGift
        ? ` budget · $${formatPriceExact(giftAppliedAmount)} gift applied`
        : ` budget${isUrgent && urgentFeeNum > 0 ? " + urgent bonus" : ""}${onboardingFeeAmount > 0 ? " + one-time setup" : ""}`}
    </p>
  );
}
