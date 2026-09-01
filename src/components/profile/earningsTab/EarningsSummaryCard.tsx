import { TrendingUp, Gift } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { earnedRangeLabel, formatCents } from "./earningsTabHelpers";
import { EarningsRangeToggle, type EarningsRange } from "./EarningsRangeToggle";

/**
 * WHY THIS CARD EXISTS (owner, 2026-08-30: "357 is oddly placed. Fix it.").
 *
 * The lifetime take-home used to be printed as a bare `<p>` between two cards:
 * left-aligned straight onto the page background, with no container of its
 * own, wedged between the poster-spend card above and the Money/History/
 * Insights/Payouts tab bar below. Every other figure on the screen lived in a
 * card; that one didn't, which is exactly what "oddly placed" describes.
 *
 * Boxing it up would not have been enough, because the same number was ALSO
 * the first of the three small tiles further down the Money view — one figure,
 * stated twice, from the same variable, on one screen. So the orphan and the
 * tile row are both gone and this is their single replacement.
 *
 * ANATOMY IS DELIBERATELY WalletCard'S. This card renders directly above
 * <WalletCard /> and copies its shape exactly — icon + title header, a two-up
 * figure grid split by a left border, a footer strip. The two then read as a
 * matched pair answering the two halves of the same question: what you have
 * EARNED (this card) and where that money currently SITS (the wallet).
 *
 * THE RANGE TOGGLE LIVES INSIDE THE CARD IT SCOPES. It used to float
 * full-width between the tab bar and the wallet, governing nothing visible,
 * one screen below a second, near-identical segmented control (PaymentTab's
 * poster-spend scope). Two identical-looking pills, neither attached to
 * anything, was the real reason the screen read as incoherent. Placing it in
 * the card — the way the spend toggle already sits in the spend card — makes
 * ownership obvious without a single word of explanatory copy.
 *
 * THE FOOTER IS NOT RANGE-SCOPED, AND SAYS SO. "In progress right now" is a
 * count of live work, not money earned in a window; it would be a lie under a
 * "This Week" heading, so it is stated in its own row with an explicit "right
 * now".
 */
interface EarningsSummaryCardProps {
  loading: boolean;
  range: EarningsRange;
  onRangeChange: (r: EarningsRange) => void;
  /** Take-home for the selected range, in dollars. */
  earnedDollars: number;
  /** Completed jobs inside the selected range. */
  jobCount: number;
  /** Tips (net of their own processing cost) inside the selected range. */
  tipsDollars: number;
  tipCount: number;
  /** Jobs in flight. Deliberately NOT range-scoped — see the note above. */
  inProgressCount: number;
}

export function EarningsSummaryCard({
  loading,
  range,
  onRangeChange,
  earnedDollars,
  jobCount,
  tipsDollars,
  tipCount,
  inProgressCount,
}: EarningsSummaryCardProps) {
  return (
    <div className="rounded-2xl liquid-glass p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <TrendingUp className="w-4 h-4 text-primary" />
        </div>
        <h2
          className="font-display italic font-bold leading-tight text-ds-17"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          Earned
        </h2>
      </div>

      {/* Own row rather than sharing the header line: four options plus a
          title do not fit at 320px, and a toggle that wraps mid-control is
          worse than one that owns its own line at every width. */}
      <div className="mb-4">
        <EarningsRangeToggle value={range} onChange={onRangeChange} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className={i === 1 ? "border-l border-border/40 pl-4 space-y-2" : "space-y-2"}>
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-7 w-24 rounded" />
              <Skeleton className="h-3 w-16 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              {/* Sighted readers get the label from the caption under the
                  figure; the eyebrow pattern was removed app-wide. */}
              <span className="sr-only">{earnedRangeLabel(range)}</span>
            </div>
            {/* `formatCents`, the SAME formatter <WalletCard /> uses 8px below
                this card — never `formatPriceExact`. Both are exact to the cent
                (the tile this replaces once said "$229" against a "$228.80"
                ledger row, which is why exactness is non-negotiable), but
                formatPriceExact drops a whole-dollar ".00" and formatCents does
                not. Side by side that rendered "$357" directly above "$180.00":
                two money figures, one screen, two shapes. The whole Money view
                is 2dp — the wallet, and PaymentTab's spend counter — so this is
                too. */}
            <p
              className="font-display italic font-bold tabular-nums leading-none text-ds-28"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            >
              {formatCents(Math.round(earnedDollars * 100))}
            </p>
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              {earnedRangeLabel(range)} · {jobCount} job{jobCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="border-l border-border/40 pl-4">
            <div className="flex items-center gap-1.5 mb-1">
              <Gift className="w-3 h-3 text-primary" />
              <span className="sr-only">Tips</span>
            </div>
            <p
              className="font-display italic font-bold tabular-nums leading-none text-ds-28"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
            >
              {formatCents(Math.round(tipsDollars * 100))}
            </p>
            <p className="font-serif italic mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              in tips · {tipCount} tip{tipCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      {!loading && inProgressCount > 0 && (
        <div
          className="mt-3 rounded-ds-sm px-3 py-2 flex items-baseline justify-between gap-3"
          style={{ background: "hsl(var(--bark) / 0.07)" }}
        >
          <span className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
            In progress right now
          </span>
          <span
            className="font-display italic font-bold tabular-nums text-ds-15 shrink-0"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {inProgressCount} job{inProgressCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}
