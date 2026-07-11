import { useId, useState } from "react";
import { DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatPrice } from "@/lib/format";
import { netUrgentFeeDollars } from "@/lib/stripeFees";

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
  /**
   * The job's pricing mode. When `"accept_bids"` the posted budget is only a
   * reference — the helper proposes their own price — so the net "You earn"
   * figure would misread. In that mode JobPrice shows the gross budget under
   * an "Open to bids" label and suppresses the net-take-home breakdown.
   */
  pricingMode?: string;
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
 * the urgent bonus AFTER it covers its own bundled Stripe processing cost
 * (`netUrgentFeeDollars`) — so the "You earn" figure equals what the edge
 * actually transfers. (The 10% sales tax on the commission is paid by the
 * platform, not the helpr — so it is NOT deducted here.)
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
  // The urgent bonus is charged to the poster bundled into escrow ONCE, so it
  // passes to the helper minus only its marginal 2.9% (never the once-per-
  // transaction 30¢ flat). On a group job it is split across the roster like
  // the budget is — otherwise N helpers would each be paid the full urgent fee
  // against a single urgent fee the poster paid, over-paying the platform N×.
  // Netting then dividing keeps every term reconciling to the shown take-home.
  const netUrgent = netUrgentFeeDollars(urgentFee) / helpers;
  const netEarnings = perHelperBudget - commission + netUrgent;
  return { helpers, perHelperBudget, commission, netEarnings, netUrgent };
}

export function JobPrice({
  budget,
  effectiveFee,
  urgentFee = 0,
  helpersNeeded = 1,
  variant = "chip",
  showBudget = false,
  showProUpsell = false,
  pricingMode,
  className,
}: JobPriceProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const panelId = useId();

  const { helpers, netEarnings, netUrgent } = computeNet(
    budget,
    effectiveFee,
    urgentFee,
    helpersNeeded,
  );

  // Bid jobs have no fixed take-home, so we never show the helper-side net
  // figure or its breakdown — only the poster's budget as a reference.
  const isBidMode = pricingMode === "accept_bids";
  const useGross = showBudget || isBidMode;
  const amount = useGross ? budget : netEarnings;
  const earnings = formatPrice(amount);

  // ──────────────────────────────────────────────────────────────────────
  // chip — the small feed/Browse card price tile.
  // ──────────────────────────────────────────────────────────────────────
  if (variant === "chip") {
    const amountNode = (
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
    );

    const chipClass = `inline-flex flex-col items-center justify-center px-2.5 py-1 rounded-ds-md text-center ${className ?? ""}`;
    const chipSurface = {
      background: "hsl(var(--bark) / 0.10)",
      border: "0.5px solid hsl(var(--bark) / 0.28)",
    };

    // Bid jobs have NO posted price — the whole point is that helpers propose
    // their own number — so the chip shows only an "Open to bids" label and
    // never a dollar figure or reference budget.
    if (isBidMode) {
      return (
        <div className={chipClass} style={chipSurface}>
          <span
            className="font-serif italic uppercase leading-tight"
            style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: "hsl(var(--bark) / 0.85)" }}
          >
            Open to bids
          </span>
        </div>
      );
    }

    // Guest/poster surfaces show a static budget with no net breakdown to
    // reveal, so the chip is purely presentational. Render a plain <div>,
    // NOT a <button> — these surfaces wrap the whole card in an outer
    // <button> (guest Browse), and a <button> may not nest inside a
    // <button> (validateDOMNesting). A non-interactive element keeps the
    // markup valid while the outer card stays the single tap target.
    if (useGross) {
      return (
        <div className={chipClass} style={chipSurface}>
          {amountNode}
        </div>
      );
    }

    return (
      <button
        type="button"
        // Stop the tap bubbling to the card root (which opens the detail
        // view) — tapping the price only ever toggles the breakdown.
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={chipClass}
        style={{
          ...chipSurface,
          cursor: "pointer",
          // Override the global 44px min-height/width that every <button>
          // gets (it's a tap-target rule) so the price chip hugs the
          // amount tightly — the whole card is the real tap target.
          minHeight: 0,
          minWidth: 0,
        }}
      >
        {amountNode}
        {/* No caption under the amount — the feed chip is a single clean
            net figure. The "You earn" framing, the fee math, and the urgent
            bonus all live in the corner badge + the job-detail breakdown,
            so they're one tap away rather than crowding the card. */}
        {/* Tap-to-reveal breakdown — "Budget $80 − 10% fee". Kept compact;
            collapses by default so the chip stays the size of the title row. */}
        {expanded && (
          <span
            id={panelId}
            className="font-sans tabular-nums text-[9px] tracking-[0.02em] mt-1 pt-1 whitespace-nowrap"
            style={{ color: "hsl(var(--olivewood) / 0.8)", borderTop: "0.5px solid hsl(var(--bark) / 0.18)" }}
          >
            Budget ${formatPrice(budget)} − {effectiveFee}% fee
            {helpers > 1 ? ` ÷ ${helpers}` : ""}
            {netUrgent > 0 ? ` + $${formatPrice(netUrgent)}` : ""}
          </span>
        )}
      </button>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // detail — the large featured payout pill in the job-detail view.
  // Non-interactive: the amount + always-visible micro-breakdown already show
  // the full math (budget ÷ helpers − fee + urgent), so a tap-to-expand panel
  // only repeated the same numbers. Rendered as a plain <div>.
  // ──────────────────────────────────────────────────────────────────────
  return (
    <div
      className={`w-full rounded-ds-md p-3 relative overflow-hidden ${className ?? ""}`}
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
      <p
        className="text-[0.6rem] font-serif italic uppercase tracking-[0.18em] flex items-center gap-1"
        style={{ color: "hsl(var(--burnt-sienna))" }}
      >
        <DollarSign className="w-3 h-3" /> {isBidMode ? "Open to bids" : showBudget ? "Budget" : "You earn"}
      </p>
      {/* Bid jobs have no posted price — helpers propose their own — so we show
          a plain prompt instead of the big dollar figure + reference budget. */}
      {isBidMode ? (
        <p
          className="font-display font-bold leading-none mt-1"
          style={{ fontSize: "1.15rem", color: "hsl(var(--bark))", letterSpacing: "-0.01em" }}
        >
          Send your bid
        </p>
      ) : (
        <p
          className="font-display font-bold tabular-nums leading-none mt-1"
          style={{ fontSize: "1.5rem", color: "hsl(var(--bark))", letterSpacing: "-0.02em" }}
        >
          ${earnings}
        </p>
      )}
      {isBidMode && (
        <p
          className="font-sans text-ds-10 tracking-[0.02em] mt-1"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          No set price · you name your price
        </p>
      )}
      {/* Always-visible micro-breakdown so helpers see the math at a glance. */}
      {!useGross && (
        <p
          className="font-sans tabular-nums text-ds-10 tracking-[0.02em] mt-1"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          ${formatPrice(budget)} budget{helpers > 1 ? ` ÷ ${helpers}` : ""} − {effectiveFee}% fee
          {netUrgent > 0 ? ` + $${formatPrice(netUrgent)} urgent` : ""}
        </p>
      )}
      {/* Only pitch the Pro fee reduction when the fee actually shown is above
          the Pro rate (10%) — otherwise "reduces your fee to 10%" contradicts
          a fee line already reading 10% or lower. */}
      {!useGross && showProUpsell && effectiveFee > 10 && (
        <p className="font-serif italic text-ds-11 mt-1" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          <span style={{ color: "hsl(var(--burnt-sienna))" }}>Helpr Pro</span> reduces your fee to 10%
          {" "}·{" "}
          <button
            type="button"
            onClick={() => navigate("/subscription")}
            className="underline underline-offset-2"
            // Inline text link inside a sentence — override the global 44px
            // tap-target min-height/width (it's meant for standalone controls)
            // so the button doesn't inflate this line's box and strand dead
            // space above + below the Helper Pro upsell. The pill itself is the
            // real tap surface.
            style={{ color: "hsl(var(--burnt-sienna))", minHeight: 0, minWidth: 0 }}
          >
            Learn more
          </button>
        </p>
      )}
    </div>
  );
}

export default JobPrice;
