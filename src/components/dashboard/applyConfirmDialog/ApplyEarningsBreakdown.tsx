import type { EnrichedJob } from "@/components/dashboard/types";

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
  const payout = perHelper - commission + (confirmApplyJob.urgent_fee ?? 0);
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
        style={{ fontSize: "0.6rem", color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
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
            <span className="font-serif italic" style={{ color: "hsl(var(--burnt-sienna))" }}>+ urgent bonus</span>
            <span className="font-display italic tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>+${Number(confirmApplyJob.urgent_fee).toFixed(2)}</span>
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
    </div>
  );
}
