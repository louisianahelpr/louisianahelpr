import { hapticLight } from "@/lib/haptics";

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

const RANGE_OPTIONS: { key: EarningsRange; label: string }[] = [
  { key: "lifetime", label: "Lifetime" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
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
    <div
      role="radiogroup"
      aria-label="Earnings date range"
      /* WRAPS, never scrolls or clips. "Lifetime / This Week / This Month /
         This Year" needs ~331px of track and the card's inner width is ~303px
         at 375 and ~248px at 320 — so the previous `overflow-x-auto` single
         row silently cut "This Year" in half on the most common phone width,
         with no scroll affordance to say there was more. `flex-wrap` puts two
         options per row on a phone and all four on one row from ~640px up, and
         nothing is ever hidden. The track goes `rounded-2xl` because a
         two-row pill reads as a broken capsule; the options stay `rounded-full`
         so the selected state is still the same shape as every other segmented
         control in the app. */
      className="flex flex-wrap items-center gap-0.5 p-0.5 rounded-2xl"
      style={{
        background: "hsl(var(--ivory-sand) / 0.4)",
        border: "0.5px solid hsl(var(--olivewood) / 0.08)",
      }}
    >
      {RANGE_OPTIONS.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            role="radio"
            type="button"
            aria-checked={active}
            onClick={() => { hapticLight(); onChange(key); }}
            /* SELECTED = the app's GLOSSY primary surface (`btn-grad-primary`),
               never a flat brand fill. Standing project rule; this control was
               painting a flat `hsl(var(--bark))` with `--elev-bark-flat`, which
               the glossyPrimaryInvariant test could not see because the fill was
               an inline `style`, not a className. `h-11` rather than `h-7`: the
               bare `button { min-height: 44px }` in index.css already forced the
               real height to 44, so `h-7` was a 28px declaration the browser
               silently overrode — the exact trap JobFilters' chipBase documents.
               Declare the height that actually renders. */
            className={
              "grow basis-[calc(50%-0.125rem)] sm:basis-auto min-w-fit px-3 h-11 rounded-full text-ds-11 font-sans font-semibold whitespace-nowrap transition-all " +
              (active
                ? "btn-grad-primary !text-[hsl(var(--parchment))] shadow-[inset_0_1px_0_hsl(var(--parchment)/0.22),0_2px_8px_-3px_hsl(var(--bark)/0.55)]"
                : "")
            }
            style={active ? undefined : { color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
