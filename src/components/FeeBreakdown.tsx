import { useState } from "react";
import { DollarSign, ChevronDown } from "lucide-react";

export interface FeeBreakdownProps {
  budget: number;
  commissionPercent: number;
  urgentFee?: number;
  /** Number of helpers splitting the budget; default 1. */
  helperCount?: number;
  className?: string;
}

/**
 * FeeBreakdown — expandable payout pill shown inside job detail views.
 *
 * Shows "You earn $XX.XX" as the headline with an optional tap-to-expand
 * line-by-line breakdown (budget ÷ helpers − fee + urgent bonus = take-home).
 * Extracted from JobDetailDialog so it can be reused wherever the same
 * payout math needs to be surfaced.
 */
export function FeeBreakdown({
  budget,
  commissionPercent,
  urgentFee = 0,
  helperCount = 1,
  className,
}: FeeBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  const helpers = helperCount > 0 ? helperCount : 1;
  const perHelper = budget / helpers;
  const commission = (perHelper * commissionPercent) / 100;
  const payout = perHelper - commission + urgentFee;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className={`w-full text-left glass-press rounded-ds-md p-3 transition-shadow hover:shadow-lg relative overflow-hidden ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
          "linear-gradient(180deg, hsla(38, 50%, 96%, 0.92) 0%, hsla(38, 30%, 92%, 0.74) 100%)",
        backdropFilter: "blur(20px) saturate(170%)",
        WebkitBackdropFilter: "blur(20px) saturate(170%)",
        border: "0.5px solid hsl(var(--bark) / 0.22)",
        boxShadow:
          "inset 0 1.5px 0 0 hsla(0, 0%, 100%, 0.95), " +
          "inset 0 1px 2px 0 rgba(255, 255, 255, 0.6), " +
          "inset 0 -1px 2px 0 hsl(var(--bark) / 0.12), " +
          "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 8px 18px -5px hsl(var(--bark) / 0.26)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p
            className="text-[0.6rem] font-serif italic uppercase tracking-[0.18em] flex items-center gap-1"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
          >
            <DollarSign className="w-3 h-3" /> You earn
          </p>
          <p
            className="font-display font-bold tabular-nums leading-none mt-1"
            style={{
              fontSize: "1.5rem",
              color: "hsl(var(--bark))",
              letterSpacing: "-0.02em",
            }}
          >
            ${payout.toFixed(2)}
          </p>
          {/* Always-visible micro-breakdown so helpers see the math
              without needing to tap-expand. */}
          <p
            className="font-sans tabular-nums text-ds-10 tracking-[0.02em] mt-1"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            ${budget.toFixed(0)} budget − {commissionPercent}% fee
            {urgentFee > 0 ? ` + $${urgentFee.toFixed(0)} urgent` : ""}
          </p>
        </div>
        <ChevronDown
          className={`shrink-0 w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "hsl(var(--olivewood) / 0.6)" }}
        />
      </div>
      {expanded && (
        <div
          className="mt-2 pt-2 space-y-0.5 text-ds-11 font-serif italic"
          style={{
            color: "hsl(var(--olivewood) / 0.85)",
            borderTop: "0.5px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <div className="flex justify-between">
            <span>Budget</span>
            <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
              ${budget.toFixed(2)}
            </span>
          </div>
          {helpers > 1 && (
            <div className="flex justify-between">
              <span>÷ {helpers} helprs</span>
              <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                ${perHelper.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span>− {commissionPercent}% platform fee</span>
            <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
              −${commission.toFixed(2)}
            </span>
          </div>
          {urgentFee > 0 && (
            <div className="flex justify-between">
              <span>+ urgent bonus</span>
              <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>
                +${urgentFee.toFixed(2)}
              </span>
            </div>
          )}
          <div
            className="flex justify-between pt-1 mt-1 font-display not-italic font-bold"
            style={{
              color: "hsl(var(--ink-deep))",
              borderTop: "0.5px dashed hsl(var(--bark) / 0.18)",
            }}
          >
            <span>Take-home</span>
            <span className="tabular-nums">${payout.toFixed(2)}</span>
          </div>
        </div>
      )}
    </button>
  );
}
