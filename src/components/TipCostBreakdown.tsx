// What a tip costs the poster, quoted from the SAME function the server charges
// with (`tipChargeBreakdown`, supabase/functions/_shared/tipFees.ts). The Helpr
// receives 100% of the tip; Stripe's card-processing fee is added on top.
// Every tip prompt (TipDialog, CompletionPrompts) shows this before the poster
// is sent to pay, and Stripe Checkout repeats the same two line items.
import { tipChargeBreakdown, type TipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";

/** The server's breakdown for a tip entered in dollars (rounded to whole cents, as create-payment does). */
export function tipQuoteForDollars(tipDollars: number): TipChargeBreakdown {
  return tipChargeBreakdown(Number.isFinite(tipDollars) ? Math.round(tipDollars * 100) : 0);
}

/** Cents as "$12.34" (always two decimals: this is a receipt line). */
export function centsLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The poster's total for a tip, e.g. "You pay $5.46" under a $5 quick-pick. */
export function TipTotalHint({ tipDollars }: { tipDollars: number }) {
  const q = tipQuoteForDollars(tipDollars);
  if (q.tipCents <= 0) return null;
  return <span className="block text-ds-11 font-medium text-muted-foreground">You pay {centsLabel(q.chargeCents)}</span>;
}

/** Tip / card processing / you pay / your Helpr receives, for one amount. */
export function TipCostBreakdown({ tipDollars }: { tipDollars: number }) {
  const q = tipQuoteForDollars(tipDollars);
  if (q.tipCents <= 0) return null;
  const rows: Array<[string, string]> = [
    ["Tip", centsLabel(q.tipCents)],
    ["Card processing", centsLabel(q.feeCents)],
    ["You pay", centsLabel(q.chargeCents)],
    ["Your Helpr receives", centsLabel(q.helperCents)],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-ds-12 font-sans" aria-label="Tip cost breakdown">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums font-semibold text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
