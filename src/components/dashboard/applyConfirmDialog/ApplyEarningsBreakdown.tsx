import { STANDARD_PAYOUT_PHRASE } from "../../../../supabase/functions/_shared/escrowTiming";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useApplyTakeHome } from "./applyTakeHome";
// formatPriceExact: this component IS the arithmetic — budget, fee, urgent
// bonus, take-home. Whole-dollar rounding is right for a headline price and
// wrong for the lines that justify it, where the column has to add up.
import { formatPriceFloor } from "@/lib/format";
import { setupFeeWords } from "@/lib/takeHomeFeeWords";

/**
 * ApplyEarningsBreakdown — the "You earn" take-home block on the apply step.
 *
 * THE NUMBER, THEN THE MATH — not the math, then the number.
 *
 * This used to open with a four-row receipt (budget, −12% platform fee,
 * + urgent bonus, Take-home) in which the one figure the helper actually
 * decides on — what lands in their pocket — was the LAST line, at the bottom,
 * after three rows of accounting they did not ask for. The subtraction was
 * louder than the result.
 *
 * So the take-home is now the headline, at display size, and the receipt that
 * justifies it collapses behind a disclosure. Nothing is hidden: the itemised
 * rows are one tap away and the summary line under the number always names the
 * inputs in words ("$70 budget − 12% fee + urgent bonus"), so a helper who
 * only wants the number gets it instantly and a helper who wants to audit it
 * still can. Fee transparency is preserved; fee PROMINENCE is not the same
 * thing as fee transparency.
 */
export function ApplyEarningsBreakdown({
  confirmApplyJob,
  platformFee,
}: {
  confirmApplyJob: EnrichedJob;
  platformFee: number;
}) {
  // Owner 2026-10-25: members never see the Helpr fee or its maths, only what they take home.
  // The one fee a member may see is the one-time $2 setup fee, on the job whose payout it comes out of.
  const { firstPayoutFee, takeHome } = useApplyTakeHome(confirmApplyJob, platformFee);

  return (
    // Polish audit 11-27 #45/#22: on white, no tinted box; the price is ink like every other price (rust is for warnings).
    // Guard: src/test/applySheetFlat1127.test.tsx.
    <div data-apply-money="">
      {/* HEADLINE — floors, matching JobPrice and every other headline
          take-home in the app. The itemised rows below keep exact cents
          because they have to add up. */}
      {/* Owner 2026-10-30: the giveaway shows its $50 with no words. Owner 2026-11-22 ("One number, small
          label"): the figure, then the small grey "after fees" note, as on every other Helpr screen. */}
      <p
        className="font-sans font-bold tabular-nums leading-none text-ds-24"
        style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
      >
        ${formatPriceFloor(takeHome)}
      </p>
      {/* Owner 2026-11-27 (polish audit #1): the price stands alone, no "after fees". Guard: src/test/noAfterFeesAnywhere1127.test.ts. */}

      {firstPayoutFee > 0 && (
        <p className="mt-1.5 font-sans text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }} data-testid="apply-setup-fee-line">
          {setupFeeWords(firstPayoutFee)}
        </p>
      )}

      {/* When the pay comes (polish audit 11-27 #45): one 13px grey line under the figure, no shield or dashed rule. */}
      <p className="mt-1.5 font-sans text-ds-13 leading-snug text-muted-foreground" data-apply-paid-when="">
        Paid {STANDARD_PAYOUT_PHRASE}.
      </p>
    </div>
  );
}
