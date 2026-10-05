import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

/** The TWO halves of the Money tab (Q1177, owner 2026-10-04: "earning and
 *  payouts are the same. So do earning and spent instead").
 *
 * It was Earnings | Payouts (2026-09-11), which split one subject — the money a
 * helpr makes and how it reaches them — across two views and listed the same
 * money in both. Earned and Spent are the two halves of one person's
 * finances: what they made doing jobs, and what they paid for jobs they
 * posted. Every account does both (never role-based).
 *
 * `?view=spent` opens on Spent. Read ONCE, at mount, and never written back —
 * the same contract the Earnings | Payouts switch had: mirroring the switch
 * into the URL is deliberately not done (WebKit throttles replaceState; see
 * useSearchParamMirror). */
export type MoneyView = "earned" | "spent";

const MONEY_VIEWS: SegmentedOption<MoneyView>[] = [
  { value: "earned", label: "Earned" },
  { value: "spent", label: "Spent" },
];

export const moneyViewFromSearch = (params: URLSearchParams): MoneyView =>
  params.get("view") === "spent" ? "spent" : "earned";

/**
 * One segmented control that decides which half of the Money tab is on
 * screen. Was EarningsViewSwitcher (Earnings | Payouts), renamed with its new
 * subject.
 *
 * `semantics="tab"` and not a <Tabs> primitive: only the selected half mounts
 * at all, so the Spent half's read runs only when a reader asks for it. The
 * shared control gives the tablist roles, `aria-selected`, arrow keys and a
 * roving tabindex without mounting anything.
 */
export function MoneyViewSwitcher({
  value,
  onChange,
}: {
  value: MoneyView;
  onChange: (v: MoneyView) => void;
}) {
  return (
    <SegmentedControl
      semantics="tab"
      ariaLabel="Money sections"
      /* `min-w-fit` on each segment means they never truncate at large type;
         this lets the overflow become a scroll rather than a clipped word. */
      className="overflow-x-auto scrollbar-hide"
      options={MONEY_VIEWS}
      value={value}
      onChange={onChange}
    />
  );
}
