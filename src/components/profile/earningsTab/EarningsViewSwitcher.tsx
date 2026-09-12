import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

/** The TWO questions this tab answers.
 *
 * It was four — Money · History · Insights · Payouts — and those four were a
 * faithful description of the source file's comment headings rather than of
 * anything a helpr comes here to ask. "Money", "History" and "Insights" are
 * three slices of ONE question ("how am I doing"): the same jobs, summed,
 * listed and charted. Splitting them made a reader tab three times to see one
 * subject, while payout SETUP — a different question asked at a different
 * moment ("where is my money and how does it reach me") — sat as a peer of the
 * pie chart (owner, 2026-09-11: "earnings and payout page also needs to be
 * better organized", then chose two tabs: Earnings vs Payouts).
 *
 * `money`/`history`/`insights` are gone rather than aliased: the value is
 * local state with no persisted or linked form, so there is nothing to keep
 * compatible. */
export type EarningsView = "earnings" | "payouts";

const EARNINGS_VIEWS: SegmentedOption<EarningsView>[] = [
  { value: "earnings", label: "Earnings" },
  { value: "payouts", label: "Payouts" },
];

/**
 * EarningsViewSwitcher — one segmented control that decides which half of
 * the Earnings & Payouts tab is on screen.
 *
 * The tab had merged three former screens ("My earnings", "Earnings &
 * Analytics", "Payout & Payments") into one, and the merge was right — they
 * are one subject. But everything rendered AT ONCE: on a connected, active
 * helpr that is roughly 25-30 cards and four charts in a single column, and
 * the four `SectionRule` hairlines that grouped them were doing the work of
 * navigation with the weight of a divider (owner, 2026-08-28: "Earnings and
 * payout tab is also entirely too long").
 *
 * That switch started as four segments mirroring the source's own comment
 * headings. It is two now — see the type above — because three of the four
 * answered the same question.
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
      /* Two labels fit the card's ~303px inner width comfortably, but a
         reader who has scaled their type up can still outgrow it. `min-w-fit`
         on each segment means they never truncate, and this lets the overflow
         become a scroll rather than a clipped word. */
      className="overflow-x-auto scrollbar-hide"
      options={EARNINGS_VIEWS}
      value={value}
      onChange={onChange}
    />
  );
}
