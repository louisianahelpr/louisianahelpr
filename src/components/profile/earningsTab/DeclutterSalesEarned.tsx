import { ErrorState } from "@/components/ui/ErrorState";
import { formatCents } from "./earningsTabHelpers";
import { salePayoutWords, type SalePayout } from "@/lib/declutter/salePayouts";

/**
 * A3-56: what Declutter paid the seller, in Money > Earned, one row per sale payout: "Sold: Oak rocking chair ·
 * $40.00 · Paid Oct 29" (or "Not sent yet" / "Didn't go through"). Newest first, every payout (the sold cards keep
 * about 30 days). Nothing when the member has sold nothing.
 */
export function DeclutterSalesEarned({ rows, failed, onRetry }: { rows: SalePayout[]; failed: boolean; onRetry: () => void }) {
  if (failed) return <ErrorState variant="inline" title="We couldn't load your Declutter sales." onRetry={onRetry} />;
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl liquid-glass p-card" aria-labelledby="declutter-sales-earned">
      <h2 id="declutter-sales-earned" className="font-display font-bold leading-tight text-ds-17 mb-2" style={{ color: "hsl(var(--ink-deep))" }}>
        Declutter sales
      </h2>
      <ul className="divide-y divide-border/40">
        {rows.map((r) => (
          <li key={r.order_id} data-sale-payout={r.order_id} className="py-2 flex items-baseline justify-between gap-3 text-ds-13">
            <span className="min-w-0 truncate" style={{ color: "hsl(var(--ink-deep))" }}>Sold: {r.title}</span>
            <span className="shrink-0 tabular-nums text-right" style={{ color: r.status === "failed" ? "hsl(var(--burnt-sienna))" : "hsl(var(--olivewood) / 0.9)" }}>
              {formatCents(r.amount_cents)} · {salePayoutWords(r)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
