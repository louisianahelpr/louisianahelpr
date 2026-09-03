import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

/**
 * The date-range the "Money" view's EARNED figures are being read for.
 *
 * It does two jobs, and until 2026-08-31 it only did the second one:
 *  1. It scopes the headline take-home, the job count and the tips figure in
 *     <EarningsSummaryCard /> (see `completedWithin` / `rangeStartMs` in
 *     earningsTabHelpers). Before that it scoped NOTHING — every figure on the
 *     screen was lifetime whichever option was selected, so "This Year" was a
 *     pure no-op and "This Week" printed a lifetime total beneath a control
 *     that said otherwise.
 *  2. It surfaces the two forward-looking cards that used to sit permanently
 *     on the page (the Sunday projection and the monthly-goal streak card), so
 *     a helpr who wants "what am I on pace for this week" opts into it.
 */
export type EarningsRange = "lifetime" | "week" | "month" | "year";

const RANGE_OPTIONS: SegmentedOption<EarningsRange>[] = [
  { value: "lifetime", label: "Lifetime" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

/**
 * Rendered INSIDE <EarningsSummaryCard />, not floating above the wallet.
 *
 * It used to sit full-width between the tab bar and the wallet card, attached
 * to nothing, one screen above a second near-identical pill (PaymentTab's
 * poster-spend scope, whose options read "Lifetime / This Week / August / This
 * Year"). Two unlabelled segmented controls with different option sets and no
 * visible owner is why the screen read as though nobody could say which
 * control governed which number. Each toggle now lives in the card whose
 * figures it scopes, and both spell the month the same way.
 */
export function EarningsRangeToggle({
  value,
  onChange,
}: {
  value: EarningsRange;
  onChange: (v: EarningsRange) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="Earnings date range"
      /* WRAPS, never scrolls or clips. "Lifetime / This Week / This Month /
         This Year" needs ~331px of track and the card's inner width is ~303px
         at 375 and ~248px at 320 — so the previous `overflow-x-auto` single
         row silently cut "This Year" in half on the most common phone width,
         with no scroll affordance to say there was more. `layout="wrap"` puts
         two options per row on a phone and all four on one row from ~640px up,
         and nothing is ever hidden. */
      layout="wrap"
      options={RANGE_OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}
