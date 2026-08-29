import { hapticLight } from "@/lib/haptics";

/** The four things this tab is actually about. */
export type EarningsView = "money" | "history" | "insights" | "payouts";

export const EARNINGS_VIEWS: { key: EarningsView; label: string }[] = [
  { key: "money", label: "Money" },
  { key: "history", label: "History" },
  { key: "insights", label: "Insights" },
  { key: "payouts", label: "Payouts" },
];

/**
 * EarningsViewSwitcher — one segmented control that decides which quarter of
 * the Earnings tab is on screen.
 *
 * The tab had merged three former screens ("My earnings", "Earnings &
 * Analytics", "Payout & Payments") into one, and the merge was right — they
 * are one subject. But everything rendered AT ONCE: on a connected, active
 * helpr that is roughly 25-30 cards and four charts in a single column, and
 * the four `SectionRule` hairlines that grouped them were doing the work of
 * navigation with the weight of a divider (owner, 2026-08-28: "Earnings and
 * payout tab is also entirely too long").
 *
 * The four groups already existed in the source, labelled in comments — YOUR
 * MONEY, COMING UP, HISTORY, INSIGHTS — plus the payout settings. This turns
 * those latent groups into a real switch, so the merge keeps its one-subject
 * shape while the reader gets one screen's worth at a time.
 *
 * `role="tablist"` and not a `<Tabs>` primitive: the panels are large, lazy,
 * and query-backed, so only the selected one should mount at all — a
 * primitive that renders every panel and hides the inactive ones would keep
 * paying for the analytics dashboard and both chart sets on every visit,
 * which is the cost this switcher exists to avoid.
 */
export function EarningsViewSwitcher({
  value,
  onChange,
}: {
  value: EarningsView;
  onChange: (v: EarningsView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Earnings sections"
      className="flex gap-1 p-1 rounded-ds-md overflow-x-auto"
      style={{
        background: "hsl(var(--olivewood) / 0.07)",
        border: "0.5px solid hsl(var(--olivewood) / 0.14)",
      }}
    >
      {EARNINGS_VIEWS.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => { hapticLight(); onChange(key); }}
            className="flex-1 min-w-0 rounded-ds-sm font-sans text-ds-12 font-semibold transition-colors whitespace-nowrap px-3"
            style={{
              // NO min-height override here. index.css sets a bare
              // `button { min-height: 44px }` for the HIG touch minimum, and
              // this control deliberately lets it stand: a segmented control
              // is often drawn at ~36px, but that is below the tap target this
              // codebase holds every other control to — see the 2026-08-28
              // sweep that raised Legal's search buttons, ChatComposer's
              // cancel-reply and SavedSearches' notify/delete from 24-32px to
              // min-44px. A brand-new control shipping under the bar the same
              // week would just be the next thing on that list.
              background: active ? "hsl(var(--parchment))" : "transparent",
              color: active ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.85)",
              boxShadow: active
                ? "0 1px 2px hsl(var(--olivewood) / 0.14), inset 0 1px 1px 0 rgba(255,255,255,0.6)"
                : "none",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
