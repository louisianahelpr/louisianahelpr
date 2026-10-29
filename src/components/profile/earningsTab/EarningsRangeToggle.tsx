import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

/**
 * The date-range the "Money" view's EARNED figures are being read for.
 *
 * It does two jobs, and until 2026-08-31 it only did the second one:
 *  1. It scopes the headline take-home, the job count and the tips figure in
 *     <EarningsSummaryCard /> (see `completedWithin` / `rangeStartMs` in
 *     earningsTabHelpers). Before that it scoped NOTHING — every figure on the
 *     screen was lifetime whichever option was selected, so "This year" was a
 *     pure no-op and "This week" printed a lifetime total beneath a control
 *     that said otherwise.
 *  2. It surfaces the two forward-looking cards that used to sit permanently
 *     on the page (the Sunday projection and the monthly-goal streak card), so
 *     a helpr who wants "what am I on pace for this week" opts into it.
 */
export type EarningsRange = "lifetime" | "week" | "month" | "year";

/**
 * Each option's full name, and the short word it shows when the row is too
 * narrow for the full names (audit 2026-10-28 P4-3: at 375 the four full names
 * need a 324px track in a 299px card, so "This year" was cut to "This ye" at
 * the scroll edge). `.range-cq` in src/index.css swaps them by the TRACK's own
 * width, so a phone gets "Lifetime / Week / Month / Year" in one row with
 * nothing cut, and a card wide enough keeps the full names. The full name is
 * always the option's accessible name.
 */
const RANGES: { value: EarningsRange; label: string; short: string }[] = [
  { value: "lifetime", label: "Lifetime", short: "Lifetime" },
  { value: "week", label: "This week", short: "Week" },
  { value: "month", label: "This month", short: "Month" },
  { value: "year", label: "This year", short: "Year" },
];

const RANGE_OPTIONS: SegmentedOption<EarningsRange>[] = RANGES.map(({ value, label, short }) => ({
  value,
  ariaLabel: label,
  label:
    label === short ? (
      label
    ) : (
      <>
        <span className="range-label-full">{label}</span>
        <span className="range-label-short" aria-hidden>
          {short}
        </span>
      </>
    ),
}));

/**
 * Rendered INSIDE <EarningsSummaryCard />, not floating above the wallet.
 *
 * It used to sit full-width between the tab bar and the wallet card, attached
 * to nothing, one screen above a second near-identical pill (PaymentTab's
 * poster-spend scope, whose options read "Lifetime / This week / August / This
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
    <div className="range-cq">
      <SegmentedControl
        ariaLabel={ariaLabel}
        /* ONE ROW (owner, 2026-10-01: "make lifetime week month year scroll
           left and right"; they used to wrap 2x2). Below a 324px track the
           pills show their short words and fit at 320 and 375 (P4-3); the
           row still scrolls sideways when a larger text size (Senior Mode)
           outgrows even those, and no pill's word is ever cut (`min-w-fit`). */
        layout="row"
        className="overflow-x-auto scrollbar-hide"
        options={RANGE_OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
