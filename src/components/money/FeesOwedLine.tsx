import { formatUsd } from "@/components/money/MoneyNote";
import { useFeesOwed } from "@/components/money/payoutProblems";

/**
 * Board 143, fee owed: a READ-ONLY line for You → Money (lead 10-21). Each
 * debt is shown as the server recorded it (remaining cents), one line per
 * kind; the payout runs take them, nothing here does. Renders nothing when
 * nothing is owed, while loading, or on a read error.
 */
export function FeesOwedLine() {
  const { data } = useFeesOwed();
  if (!data || data.length === 0) return null;
  const fault = data.filter((d) => d.kind === "fault");
  const seller = data.filter((d) => d.kind === "seller");
  // Where each debt is taken from (the payout runs, not this screen):
  // take_helpr_fault_fee runs in the JOB payout paths; declutter_consume_fee_debt
  // in the Declutter/Shops SALE payout paths.
  const rows: { label: string; when: string; items: typeof data }[] = [
    { label: "Amount owed from a job you were ruled at fault on", when: "Comes out of your next job payout", items: fault },
    { label: "Amount owed from a sale that was refunded", when: "Comes out of your next sale payout", items: seller },
  ].filter((r) => r.items.length > 0);
  return (
    <div
      data-fees-owed=""
      className="rounded-2xl px-4 py-3"
      style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
    >
      <p className="font-sans font-bold text-ds-14 text-foreground">You owe Helpr</p>
      <ul className="mt-2 space-y-1.5">
        {rows.flatMap((r) =>
          r.items.map((d) => (
            <li key={d.id} className="flex items-start justify-between gap-3 text-ds-13">
              <span className="leading-snug">
                <span className="block text-foreground">{r.label}</span>
                <span className="block text-ds-12 text-muted-foreground">{r.when}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums" style={{ color: "hsl(var(--accent-ink))" }}>
                −{formatUsd(d.cents)}
              </span>
            </li>
          )),
        )}
      </ul>
      <p className="mt-2 text-ds-12 text-muted-foreground">Nothing to do.</p>
    </div>
  );
}
