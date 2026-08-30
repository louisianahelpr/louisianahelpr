import { hapticLight } from "@/lib/haptics";

/**
 * The date-range this page's "Money" view is being read for. "week" and
 * "month" are more than a filter — selecting them surfaces the two cards
 * that used to sit permanently on the page (the Sunday projection and the
 * monthly-goal streak card). Folding them in here means a helpr who wants
 * "what am I on pace for this week" opts into it instead of it always being
 * the first thing under the wallet.
 */
export type EarningsRange = "lifetime" | "week" | "month" | "year";

const RANGE_OPTIONS: { key: EarningsRange; label: string }[] = [
  { key: "lifetime", label: "Lifetime" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

/**
 * Sits directly below EarningsViewSwitcher — the tab decides WHICH section of
 * the page you're on, this decides WHICH slice of time the Money view's
 * numbers cover. Same segmented-control shape as the view switcher and
 * PaymentTab's lifetime/month toggle so the three read as one family of
 * control rather than three different widgets.
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
      role="tablist"
      aria-label="Earnings date range"
      className="flex items-center gap-0.5 p-0.5 rounded-full overflow-x-auto"
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
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => { hapticLight(); onChange(key); }}
            className="flex-1 min-w-fit px-3 h-7 rounded-full text-ds-11 font-sans font-semibold whitespace-nowrap transition-all"
            style={
              active
                ? {
                    background: "hsl(var(--bark))",
                    color: "hsl(var(--parchment))",
                    boxShadow: "var(--elev-bark-flat)",
                  }
                : { color: "hsl(var(--olivewood) / 0.8)" }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
