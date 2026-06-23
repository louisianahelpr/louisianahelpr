import { useId, useState } from "react";
import { ChevronDown, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useReducedMotion } from "@/lib/accessibility";
import { formatPrice } from "@/lib/format";

export interface JobPriceProps {
  /** Gross posted budget (the customer's total). */
  budget: number;
  /** Platform commission percent applied to the per-helper share. */
  effectiveFee: number;
  /** Customer-paid urgent bonus, added on top of the net take-home. */
  urgentFee?: number;
  /** Helpers splitting the budget (group jobs). Defaults to 1. */
  helpersNeeded?: number;
  /**
   * Render style:
   * - `chip` — the small price tile that lives in a feed/Browse card's
   *   right column. Collapsed "You earn $72" with a tap-to-reveal
   *   "Budget $80 − 10% fee" line.
   * - `detail` — the large featured payout pill for the job-detail view,
   *   with a tap-to-expand line-by-line breakdown.
   */
  variant?: "chip" | "detail";
  /**
   * When true, show the gross posted budget + neutral framing instead of
   * the helper-side net "You earn" figure. Used by guest/poster surfaces
   * where the viewer has no fee tier and a one-sided "You earn" misreads.
   */
  showBudget?: boolean;
  /**
   * `detail` only — render a "Helper Pro reduces your fee to 10%" upsell
   * line. Show for free-tier helpers, not already-subscribed users.
   */
  showProUpsell?: boolean;
  className?: string;
}

/**
 * JobPrice — THE single money element for the browsing experience.
 *
 * Every place a job price appears (Browse card, compact row, job detail)
 * renders this, so a number never means two things: the default shows the
 * helper's net take-home ("You earn $72") and reveals the gross breakdown
 * ("Budget $80 − 10% fee") on tap.
 *
 * The net math is the project's canonical formula, identical to JobCard /
 * JobDetailDialog: per-helper share, minus the platform commission, plus
 * the customer-paid urgent bonus. (The 10% sales tax on the commission is
 * paid by the platform, not the helpr — so it is NOT deducted here.)
 */
export function computeNet(
  budget: number,
  effectiveFee: number,
  urgentFee: number,
  helpersNeeded: number,
) {
  const helpers = helpersNeeded > 0 ? helpersNeeded : 1;
  const perHelperBudget = budget / helpers;
  const commission = perHelperBudget * (effectiveFee / 100);
  const netEarnings = perHelperBudget - commission + urgentFee;
  return { helpers, perHelperBudget, commission, netEarnings };
}

export function JobPrice({
  budget,
  effectiveFee,
  urgentFee = 0,
  helpersNeeded = 1,
  variant = "chip",
  showBudget = false,
  showProUpsell = false,
  className,
}: JobPriceProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const panelId = useId();

  const { helpers, perHelperBudget, commission, netEarnings } = computeNet(
    budget,
    effectiveFee,
    urgentFee,
    helpersNeeded,
  );

  const amount = showBudget ? budget : netEarnings;
  const earnings = formatPrice(amount);
  const transition = reducedMotion ? "none" : undefined;

  // ──────────────────────────────────────────────────────────────────────
  // chip — the small feed/Browse card price tile.
  // ──────────────────────────────────────────────────────────────────────
  if (variant === "chip") {
    return (
      <button
        type="button"
        // Stop the tap bubbling to the card root (which opens the detail
        // view) — tapping the price only ever toggles the breakdown.
        onClick={(e) => {
          if (showBudget) return; // guest/poster: no net breakdown to reveal
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={showBudget ? undefined : expanded}
        aria-controls={showBudget ? undefined : panelId}
        className={`inline-flex flex-col items-center justify-center px-2.5 py-1 rounded-ds-md text-center ${className ?? ""}`}
        style={{
          background: "hsl(var(--bark) / 0.10)",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
          cursor: showBudget ? "default" : "pointer",
          // Override the global 44px min-height/width that every <button>
          // gets (it's a tap-target rule) so the price chip hugs the
          // amount tightly — the whole card is the real tap target.
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <span
          className="font-display leading-none tabular-nums"
          style={{
            fontWeight: 800,
            fontSize: "1.05rem",
            color: "hsl(var(--bark))",
            letterSpacing: "-0.02em",
          }}
        >
          {/* Literal `$` pulled tight to the digits so the amount reads as
              one confident figure. */}
          <span style={{ fontSize: "0.82em", verticalAlign: "0.02em", marginRight: "0.5px" }}>
            $
          </span>
          {earnings}
        </span>
        {/* No caption under the amount — the feed chip is a single clean
            net figure. The "You earn" framing, the fee math, and the urgent
            bonus all live in the corner badge + the job-detail breakdown,
            so they're one tap away rather than crowding the card. */}
        {/* Tap-to-reveal breakdown — "Budget $80 − 10% fee". Kept compact;
            collapses by default so the chip stays the size of the title row. */}
        {!showBudget && expanded && (
          <span
            id={panelId}
            className="font-sans tabular-nums text-[9px] tracking-[0.02em] mt-1 pt-1 whitespace-nowrap"
            style={{ color: "hsl(var(--olivewood) / 0.8)", borderTop: "0.5px solid hsl(var(--bark) / 0.18)" }}
          >
            Budget ${budget.toFixed(0)} − {effectiveFee}% fee
            {helpers > 1 ? ` ÷ ${helpers}` : ""}
            {urgentFee > 0 ? ` + $${urgentFee.toFixed(0)}` : ""}
          </span>
        )}
      </button>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // detail — the large featured payout pill in the job-detail view.
  // ──────────────────────────────────────────────────────────────────────
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-controls={panelId}
      className={`w-full text-left glass-press rounded-ds-md p-3 transition-shadow hover:shadow-lg relative overflow-hidden ${className ?? ""}`}
      style={{
        background:
          "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
          "var(--surface-premium)",
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
            <DollarSign className="w-3 h-3" /> {showBudget ? "Budget" : "You earn"}
          </p>
          <p
            className="font-display font-bold tabular-nums leading-none mt-1"
            style={{ fontSize: "1.5rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
          >
            ${amount.toFixed(2)}
          </p>
          {/* Always-visible micro-breakdown so helpers see the math without
              needing to tap-expand. */}
          {!showBudget && (
            <p
              className="font-sans tabular-nums text-ds-10 tracking-[0.02em] mt-1"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              ${budget.toFixed(0)} budget − {effectiveFee}% fee
              {urgentFee > 0 ? ` + $${urgentFee.toFixed(0)} urgent` : ""}
            </p>
          )}
          {/* Only pitch the Pro fee reduction when the fee actually shown
              is above the Pro rate (10%) — otherwise "reduces your fee to
              10%" contradicts a fee line already reading 10% or lower. */}
          {!showBudget && showProUpsell && effectiveFee > 10 && (
            <p className="font-serif italic text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              <span style={{ color: "hsl(var(--burnt-sienna))" }}>Helper Pro</span> reduces your fee to 10%
              {" "}·{" "}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate("/subscription"); }}
                className="underline underline-offset-2"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Learn more
              </button>
            </p>
          )}
        </div>
        {!showBudget && (
          <ChevronDown
            className={`shrink-0 w-4 h-4 ${expanded ? "rotate-180" : ""}`}
            style={{ color: "hsl(var(--olivewood) / 0.8)", transition }}
          />
        )}
      </div>
      {!showBudget && expanded && (
        <div
          id={panelId}
          className="mt-2 pt-2 space-y-0.5 text-ds-11 font-serif italic"
          style={{ color: "hsl(var(--olivewood) / 0.85)", borderTop: "0.5px solid hsl(var(--bark) / 0.18)" }}
        >
          <div className="flex justify-between">
            <span>Budget</span>
            <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${budget.toFixed(2)}</span>
          </div>
          {helpers > 1 && (
            <div className="flex justify-between">
              <span>÷ {helpers} helprs</span>
              <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>${perHelperBudget.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span>− {effectiveFee}% platform fee</span>
            <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>−${commission.toFixed(2)}</span>
          </div>
          {urgentFee > 0 && (
            <div className="flex justify-between">
              <span>+ urgent bonus</span>
              <span className="tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>+${urgentFee.toFixed(2)}</span>
            </div>
          )}
          <div
            className="flex justify-between pt-1 mt-1 font-display not-italic font-bold"
            style={{ color: "hsl(var(--ink-deep))", borderTop: "0.5px dashed hsl(var(--bark) / 0.18)" }}
          >
            <span>Take-home</span>
            <span className="tabular-nums">${netEarnings.toFixed(2)}</span>
          </div>
        </div>
      )}
    </button>
  );
}

export default JobPrice;
