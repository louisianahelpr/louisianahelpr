import { ShieldCheck } from "lucide-react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useApplyTakeHome } from "./applyTakeHome";
// formatPriceExact: this component IS the arithmetic — budget, fee, urgent
// bonus, take-home. Whole-dollar rounding is right for a headline price and
// wrong for the lines that justify it, where the column has to add up.
import { formatPriceExact as formatPrice, formatPriceFloor } from "@/lib/format";

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
    // Board 58: a money note, so the money tint and rust (spec §1.1, §3 "Status bubbles and money notes").
    <div className="rounded-ds-md p-3.5" style={{ background: "hsl(var(--burnt-sienna) / 0.08)" }}>
      {/* HEADLINE — floors, matching JobPrice and every other headline
          take-home in the app. The itemised rows below keep exact cents
          because they have to add up. */}
      <p className="font-sans font-semibold text-ds-13 mb-0.5" style={{ color: "hsl(var(--ink-deep))" }}>
        You take home
      </p>
      <p
        className="font-sans font-bold tabular-nums leading-none text-ds-32"
        style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "-0.02em" }}
      >
        ${formatPriceFloor(takeHome)}
      </p>

      {firstPayoutFee > 0 && (
        <p className="mt-1.5 font-sans text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }} data-testid="apply-setup-fee-line">
          After the one-time ${formatPrice(firstPayoutFee)} setup fee, taken from your first payout.
        </p>
      )}

      {/* Escrow reassurance at the conversion moment — a helper deciding
          whether to apply needs to know the money is already secured, not
          contingent on the poster paying up after the work is done. */}
      <div
        className="flex items-center gap-1.5 mt-2.5 pt-2"
        style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={2} style={{ color: "hsl(var(--bark))" }} />
        <span className="font-sans text-ds-11 leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Held securely, released when the job is marked complete.
        </span>
      </div>
    </div>
  );
}
