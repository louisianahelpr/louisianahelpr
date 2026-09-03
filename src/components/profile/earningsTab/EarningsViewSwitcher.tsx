import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

/** The four things this tab is actually about. */
export type EarningsView = "money" | "history" | "insights" | "payouts";

const EARNINGS_VIEWS: SegmentedOption<EarningsView>[] = [
  { value: "money", label: "Money" },
  { value: "history", label: "History" },
  { value: "insights", label: "Insights" },
  { value: "payouts", label: "Payouts" },
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
    <SegmentedControl
      /* `semantics="tab"` and not a <Tabs> primitive: the panels are large,
         lazy, and query-backed, so only the selected one should mount at all —
         a primitive that renders every panel and hides the inactive ones would
         keep paying for the analytics dashboard and both chart sets on every
         visit, which is the cost this switcher exists to avoid. The shared
         control gives the tablist roles, `aria-selected`, arrow keys and a
         roving tabindex without mounting anything. */
      semantics="tab"
      ariaLabel="Earnings sections"
      /* Four labels can outgrow the card's ~303px inner width once the reader
         has scaled their type up. `min-w-fit` on each segment means they never
         truncate, and this lets the overflow become a scroll rather than a
         clipped word. */
      className="overflow-x-auto scrollbar-hide"
      options={EARNINGS_VIEWS}
      value={value}
      onChange={onChange}
    />
  );
}
