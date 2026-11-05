/**
 * Q1918 + Q2148 (2), part 2: the admin CSV of sales-tax corrections.
 *
 * Stripe's Tax report keeps a LOST dispute's tax, and the whole hold's tax on
 * a PARTIAL capture, for a Checkout automatic_tax charge. Each correction is a
 * row in public.sales_tax_adjustments; admin_sales_tax_adjustments(from, to)
 * returns only live, non-seed rows. This file turns those rows into the CSV
 * the owner files with: Stripe's report total for a month and state, minus the
 * "Subtract" column of that month and state here.
 */
export interface SalesTaxCorrectionRow {
  occurred_at: string;
  kind: string;
  flow: string;
  job_id: string | null;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  state_code: string | null;
  postal_code: string | null;
  tax_reported_cents: number;
  tax_collected_cents: number;
  adjustment_cents: number;
}

export const SALES_TAX_CORRECTIONS_HEADER =
  "Month (UTC),When (UTC),Why,Flow,State,ZIP,Job ID,Stripe PaymentIntent,Stripe Charge,Tax in Stripe's report,Tax we collected,Subtract from Stripe's report";

const KIND_WORDS: Record<string, string> = {
  dispute_lost: "Lost chargeback",
  partial_capture: "Card hold captured in part",
};

const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const dollars = (cents: number) => (Math.round(Number(cents)) / 100).toFixed(2);

/** One CSV line per correction, oldest first (the RPC's order). */
export function salesTaxCorrectionLines(rows: SalesTaxCorrectionRow[]): string[] {
  return rows.map((r) => {
    const when = new Date(r.occurred_at);
    const month = Number.isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 7);
    return [
      month,
      Number.isNaN(when.getTime()) ? r.occurred_at : when.toISOString().replace(".000Z", "Z"),
      KIND_WORDS[r.kind] ?? r.kind,
      r.flow,
      r.state_code,
      r.postal_code,
      r.job_id,
      r.stripe_payment_intent_id,
      r.stripe_charge_id,
      dollars(r.tax_reported_cents),
      dollars(r.tax_collected_cents),
      dollars(Math.max(0, -Number(r.adjustment_cents))),
    ].map(esc).join(",");
  });
}

/** The period the export covers: 1 January (UTC) of `now`'s year up to the next UTC midnight. */
export function salesTaxCorrectionsPeriod(now: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from: from.toISOString(), to: to.toISOString() };
}
