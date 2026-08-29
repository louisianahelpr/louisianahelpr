import { useState } from "react";
import { ShieldCheck, ChevronDown } from "lucide-react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
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
  const [showMath, setShowMath] = useState(false);
  const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
  const perHelper = confirmApplyJob.budget / helpers;
  const commission = perHelper * platformFee / 100;
  // Urgent bonus nets its own bundled Stripe processing cost, then splits across
  // the roster like the budget (#114), so the "+ urgent bonus" line and the
  // Take-home total both equal what the edge transfers to each helper.
  const netUrgent = netUrgentFeeDollars(confirmApplyJob.urgent_fee) / helpers;
  const payout = perHelper - commission + netUrgent;
  const hasUrgent = (confirmApplyJob.urgent_fee ?? 0) > 0;

  // The plain-words summary. Same facts as the receipt, one line, no columns.
  const summary = [
    `$${formatPrice(confirmApplyJob.budget)} budget`,
    helpers > 1 ? `÷ ${helpers} helprs` : null,
    `− ${platformFee}% fee`,
    hasUrgent ? "+ urgent bonus" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="rounded-ds-md p-3.5"
      style={{
        background:
          "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
          "var(--surface-premium)",
        border: "0.5px solid hsl(var(--bark) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.6), " +
          "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22)",
      }}
    >
      {/* HEADLINE — floors, matching JobPrice and every other headline
          take-home in the app. The itemised rows below keep exact cents
          because they have to add up. */}
      <p
        className="font-sans font-semibold uppercase text-ds-10 mb-0.5"
        style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.14em" }}
      >
        You earn
      </p>
      <p
        className="font-display italic font-bold tabular-nums leading-none text-ds-32"
        style={{ color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
      >
        ${formatPriceFloor(payout)}
      </p>

      <button
        type="button"
        onClick={() => setShowMath((v) => !v)}
        aria-expanded={showMath}
        className="mt-1.5 flex items-center gap-1 text-left min-h-[32px] active:opacity-70 transition-opacity"
        style={{ color: "hsl(var(--olivewood) / 0.85)" }}
      >
        <span className="font-sans text-ds-11 leading-snug">{summary}</span>
        <ChevronDown
          className="w-3.5 h-3.5 shrink-0 transition-transform"
          style={{ transform: showMath ? "rotate(180deg)" : undefined }}
          aria-hidden
        />
      </button>

      {showMath && (
        <div
          className="space-y-1 text-ds-12 mt-2 pt-2.5"
          style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
        >
          <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <span className="font-sans">Budget{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${formatPrice(perHelper)}</span>
          </div>
          <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            <span className="font-sans">− {platformFee}% platform fee</span>
            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${formatPrice(commission)}</span>
          </div>
          {hasUrgent && (
            <div className="flex justify-between">
              <span className="font-sans" style={{ color: "hsl(var(--burnt-sienna))" }}>+ urgent bonus{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
              <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>+${formatPrice(netUrgent)}</span>
            </div>
          )}
          <div
            className="flex justify-between pt-1.5 mt-1.5 items-baseline"
            style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
          >
            <span className="font-sans font-semibold text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>Take-home</span>
            <span
              className="font-display italic font-bold tabular-nums text-ds-14"
              style={{ color: "hsl(var(--bark))" }}
            >
              ${formatPriceFloor(payout)}
            </span>
          </div>
        </div>
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
