import { formatPriceExact } from "@/lib/format";
import { allocateCents } from "../../../supabase/functions/_shared/crewShares";
import { seriesLaterVisitsCharged, seriesVisitsSuffix } from "@/lib/seriesMoneyCopy";

/**
 * The review step's secondary line under the Total: the budget, and what sits on top of it.
 * F18 (audit 2026-10-28): only when it says something the total does not. A plain $40 job read
 * "$40.00" over "$40.00 budget", the same number twice.
 *
 * A2-C36 (audit 2026-10-29): a Repeats job's total is its FIRST visit only, so the line says "$40 a visit ·
 * 4 visits" and when the rest is charged (charge-recurring-visits, FUND_LEAD_DAYS = 3). Not "charged now": under
 * card_hold_at_post (on for everyone) a card is only held until the hire.
 * A2-C33: a crew job says how its budget splits, at the smallest frozen share (allocateCents, the server's
 * largest-remainder split), as the form's "~$30/Helpr" hint does.
 */
export function CheckoutBudgetLine({
  budgetNum, totalWithTax, hasGift, giftAppliedAmount, isUrgent, urgentFeeNum, onboardingFeeAmount, visitCount = 1, crewSize = 1,
  taxable = false,
}: {
  budgetNum: number;
  totalWithTax: number;
  hasGift: boolean;
  giftAppliedAmount: number;
  isUrgent: boolean;
  urgentFeeNum: number;
  onboardingFeeAmount: number;
  /** Visits in a Repeats series (1 for a one-off job). */
  visitCount?: number;
  /** Helprs on a crew job (1 for a one-Helpr job). */
  crewSize?: number;
  /** The category's labor carries Louisiana sales tax (hasTaxableLine): later visits are charged it too. */
  taxable?: boolean;
}) {
  const series = visitCount > 1;
  const crew = crewSize > 1;
  const crewShare = crew ? allocateCents(Math.round(budgetNum * 100), crewSize, crewSize - 1) / 100 : 0;
  const crewLine = crew && budgetNum > 0 ? (
    <p className="text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {crewSize} Helprs, about ${formatPriceExact(crewShare)} each
    </p>
  ) : null;
  if (series && budgetNum > 0) {
    return (
      <>
        <p className="text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          <span className="font-semibold text-foreground">${formatPriceExact(budgetNum)}</span>
          {seriesVisitsSuffix(visitCount)}
          {hasGift ? ` · $${formatPriceExact(giftAppliedAmount)} gift applied` : ""}
        </p>
        <p className="text-ds-12 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {`The total is for the first visit; ${seriesLaterVisitsCharged(taxable)}.`}
        </p>
        {crewLine}
      </>
    );
  }
  if (!(budgetNum > 0 && (hasGift || Math.round(totalWithTax * 100) !== Math.round(budgetNum * 100)))) return crewLine;
  return (
    <>
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
    {crewLine}
    </>
  );
}
