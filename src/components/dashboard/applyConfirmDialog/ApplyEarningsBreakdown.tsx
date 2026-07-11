import { ShieldCheck } from "lucide-react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { netUrgentFeeDollars } from "@/lib/stripeFees";

/**
 * ApplyEarningsBreakdown — the "You earn" take-home card shown at the top of
 * ApplyConfirmDialog. Extracted verbatim from the dialog's earnings IIFE; the
 * math (per-helper split, platform commission, urgent bonus, take-home) and
 * markup are unchanged.
 */
export function ApplyEarningsBreakdown({
  confirmApplyJob,
  platformFee,
}: {
  confirmApplyJob: EnrichedJob;
  platformFee: number;
}) {
  const helpers = confirmApplyJob.is_group_job && confirmApplyJob.helpers_needed ? confirmApplyJob.helpers_needed : 1;
  const perHelper = confirmApplyJob.budget / helpers;
  const commission = perHelper * platformFee / 100;
  // Urgent bonus nets its own bundled Stripe processing cost, then splits across
  // the roster like the budget (#114), so the "+ urgent bonus" line and the
  // Take-home total both equal what the edge transfers to each helper.
  const netUrgent = netUrgentFeeDollars(confirmApplyJob.urgent_fee) / helpers;
  const payout = perHelper - commission + netUrgent;
  return (
    <div
      className="rounded-ds-md p-3"
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
      <p
        className="font-serif italic uppercase mb-1.5"
        style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
      >
        You earn
      </p>
      <div className="space-y-1 text-[0.78rem]">
        <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          <span className="font-serif italic">Budget{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
          <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${perHelper.toFixed(2)}</span>
        </div>
        <div className="flex justify-between" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          <span className="font-serif italic">− {platformFee}% platform fee</span>
          <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${commission.toFixed(2)}</span>
        </div>
        {(confirmApplyJob.urgent_fee ?? 0) > 0 && (
          <div className="flex justify-between">
            <span className="font-serif italic" style={{ color: "hsl(var(--burnt-sienna))" }}>+ urgent bonus{helpers > 1 ? ` ÷ ${helpers}` : ""}</span>
            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>+${netUrgent.toFixed(2)}</span>
          </div>
        )}
        <div
          className="flex justify-between pt-1.5 mt-1.5 items-baseline"
          style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
        >
          <span className="font-display italic font-bold" style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}>Take-home</span>
          <span
            className="font-display italic font-bold tabular-nums"
            style={{ fontSize: "1.15rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
          >
            ${payout.toFixed(2)}
          </span>
        </div>
      </div>
      {/* Escrow reassurance at the conversion moment — a helper deciding
          whether to apply needs to know the money is already secured, not
          contingent on the poster paying up after the work is done. */}
      <div
        className="flex items-center gap-1.5 mt-2.5 pt-2"
        style={{ borderTop: "0.5px dashed hsl(var(--bark) / 0.22)" }}
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={2} style={{ color: "hsl(var(--bark))" }} />
        <span className="text-[0.7rem] leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Funds are held safe in escrow and released to you when the job is marked complete.
        </span>
      </div>
    </div>
  );
}
