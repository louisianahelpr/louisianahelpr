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
 * control governed which number. The toggle now lives in the card whose
 * figures it scopes, and since Q1177 (Earned | Spent views) the Spent card
 * uses THIS control too, with its own label, so the two cards' range rows are
 * one shape with one option set.
 */
export function EarningsRangeToggle({
  value,
  onChange,
  ariaLabel = "Earnings date range",
}: {
  value: EarningsRange;
  onChange: (v: EarningsRange) => void;
  ariaLabel?: string;
}) {
  return (
    <SegmentedControl
      ariaLabel={ariaLabel}
      /* ONE ROW THAT SCROLLS SIDEWAYS (owner, 2026-10-01: "make lifetime week
         month year scroll left and right"). The four options need ~331px and
         the card is ~303px wide at 375, so they used to wrap 2x2. Each pill
         keeps its full label (`min-w-fit`) and the row scrolls instead. */
      layout="row"
      className="overflow-x-auto scrollbar-hide"
      options={RANGE_OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}
