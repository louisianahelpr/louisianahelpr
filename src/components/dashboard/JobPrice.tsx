import { useId, useState } from "react";
import { formatPrice, formatPriceExact, formatPriceFloor } from "@/lib/format";
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
  className?: string;
  /**
   * `chip` only — `lg` bumps the type size for contexts with room to spare
   * (JobDetailDialog's title row, where the chip is the one money element on
   * the whole screen). Feed cards and the map popup stay at the default
   * `sm` so nothing there changes size.
   */
  size?: "sm" | "lg";
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
  className,
  size = "sm",
}: JobPriceProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const { helpers, netEarnings, netUrgent } = computeNet(
    budget,
    effectiveFee,
    urgentFee,
    helpersNeeded,
  );

  // Bidding was removed (zero production usage), so a job's price is always the
  // poster's set budget: gross on guest/poster surfaces, net take-home otherwise.
  const amount = showBudget ? budget : netEarnings;
  // TAKE-HOME IS FLOORED TO WHOLE DOLLARS (owner, 2026-08-19); the gross
  // budget keeps ordinary rounding. See formatPriceFloor: rounding $83.60 to
  // "$84" would promise 40c the helpr never receives, and a payout figure may
  // never read higher than the payout. A gross budget is a number the poster
  // typed, not money owed to anyone, so it rounds. Every headline take-home
  // surface (this component, CompactJobCard, AppliedJobCard's title amount,
  // the apply sheet's Take-home) uses the same floor; only breakdown LINE
  // ITEMS keep exact cents, because those must visibly add up.
  const earnings = showBudget ? formatPrice(amount) : formatPriceFloor(amount);

  // ──────────────────────────────────────────────────────────────────────
  // chip — the small feed/Browse card price tile.
  // ──────────────────────────────────────────────────────────────────────
  if (variant === "chip") {
    const amountNode = (
      <span
        className={`font-display leading-none tabular-nums ${size === "lg" ? "text-ds-22" : "text-ds-17"}`}
        style={{
          fontWeight: 800,
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

    const chipClass = `inline-flex flex-col items-center justify-center rounded-ds-md text-center ${size === "lg" ? "px-3.5 py-2" : "px-2.5 py-1"} ${className ?? ""}`;
    // `lg` gets a raised shadow + a stronger border so it visually leads the
    // row it sits in (owner: "add some sort of effect to where this stands
    // out more, above the rest") — the default `sm` chip stays flat, since
    // that's the feed card's dense list context where a shadow per card
    // would be visual noise, not emphasis.
    const chipSurface = size === "lg"
      ? {
          background: "hsl(var(--bark) / 0.10)",
          border: "0.5px solid hsl(var(--bark) / 0.4)",
          boxShadow: "var(--elev-bark-raised)",
        }
      : {
          background: "hsl(var(--bark) / 0.10)",
          border: "0.5px solid hsl(var(--bark) / 0.28)",
        };

    // Guest/poster surfaces show a static budget with no net breakdown to
    // reveal, so the chip is purely presentational. Render a plain <div>,
    // NOT a <button> — these surfaces wrap the whole card in an outer
    // <button> (guest Browse), and a <button> may not nest inside a
    // <button> (validateDOMNesting). A non-interactive element keeps the
    // markup valid while the outer card stays the single tap target.
    if (showBudget) {
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
        // Only point at the panel while it exists. The breakdown below is
        // mounted on expand, so an unconditional `aria-controls` left every
        // collapsed chip referencing a missing id — a dangling IDREF that
        // axe flags and that assistive tech cannot follow. Collapsed, the
        // chip is described by `aria-expanded` alone.
        aria-controls={expanded ? panelId : undefined}
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
            className="font-sans tabular-nums text-ds-9 tracking-[0.02em] mt-1 pt-1 whitespace-nowrap"
            style={{ color: "hsl(var(--olivewood) / 0.8)", borderTop: "0.5px solid hsl(var(--bark) / 0.18)" }}
          >
            Budget ${formatPriceExact(budget)} − {effectiveFee}% fee
            {helpers > 1 ? ` ÷ ${helpers}` : ""}
            {netUrgent > 0 ? ` + $${formatPriceExact(netUrgent)}` : ""}
          </span>
        )}
      </button>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // detail — the large featured payout pill in the job-detail view.
  // Non-interactive: just the headline take-home figure. The fee-math
  // breakdown line was REMOVED here (owner, 2026-08-30: "i dont think i
  // should show the math bc people will see i am collecting from both
  // sides") — showing "budget ÷ helpers − fee" spells out that the
  // platform commission comes out of the helper's side on top of whatever
  // the poster's own fee is, which the owner does not want visible.
  // Rendered as a plain <div>.
  // ──────────────────────────────────────────────────────────────────────
  return (
    // Flattened (owner, via the job-dialog mockup: "basically identical to
    // this") — the heavy gradient/inset-shadow "surface-premium" treatment
    // read as a different design language than the mockup's plain tinted
    // panel. This variant renders ONLY here (JobDetailDialog), so simplifying
    // it doesn't touch the feed card or map popup, which use `chip`.
    <div
      // Deeper tint + border than the metacells/Details boxes around it
      // (owner: "it just feels off" — everything had gone the same flat
      // gray, so nothing but the Apply button pulled the eye). The payout
      // is the one number that matters most; it should visually lead the
      // stack, not blend into it.
      className={`w-full rounded-ds-md p-3 relative overflow-hidden ${className ?? ""}`}
      style={{
        backgroundColor: "hsl(var(--bark) / 0.11)",
        border: "0.5px solid hsl(var(--bark) / 0.26)",
      }}
    >
      {/* Big italic display serif, matching the mockup's `.money-big` — the
          number IS the label now that "You earn" is gone (owner: "remove
          you earn"), so it earns the size and weight to read as the
          headline of the whole card. */}
      <p
        className="font-display font-bold italic tabular-nums leading-none text-ds-32"
        style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
      >
        ${earnings}
      </p>
      {/* Guest/poster surfaces still see the plain gross budget label — that
          number is what the poster typed, not a helper-side calculation, so
          it doesn't carry the same disclosure concern. */}
      {showBudget && (
        <p
          className="font-serif italic tabular-nums text-ds-12 mt-1"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Budget
        </p>
      )}
      {/* The "Helpr Pro reduces your fee to 10% · Learn more" line was REMOVED
          here (owner, 2026-08-19: "Remove the info about helpr pro here").

          It pitched a paid upgrade inside the job-detail sheet — the moment a
          helpr is deciding whether to take THIS job — and its "Learn more"
          navigated to /subscription, the long-form marketing page the owner
          has separately said should not appear inside the app at all. */}
    </div>
  );
}

export default JobPrice;
