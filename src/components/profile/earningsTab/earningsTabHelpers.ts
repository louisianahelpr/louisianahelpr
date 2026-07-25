import { formatTimestamp } from "@/lib/format";
import type { StripePayout } from "./types";

// Payout-status pills are a separate concern from job-status chips: this
// table is the Stripe payout pipeline (`paid` / `in_transit` / `pending`
// / `failed` / `canceled`), not the `job_status` enum. Job-status chips
// in the earnings list below route through the canonical
// `jobStatusColorClasses` from `@/lib/statusColors` so they paint the
// same as every other status chip in the app.
export const payoutStatusColors: Record<string, string> = {
  paid: "bg-[hsl(var(--bark)/0.10)] text-[hsl(var(--bark))]",
  in_transit: "bg-[hsl(var(--burnt-sienna)/0.10)] text-[hsl(var(--burnt-sienna))]",
  pending: "bg-[hsl(var(--olivewood)/0.10)] text-[hsl(var(--olivewood))]",
  failed: "bg-destructive/10 text-destructive",
  canceled: "bg-destructive/10 text-destructive",
};

export const formatCents = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

export const formatDate = (unixSec: number) => formatTimestamp(new Date(unixSec * 1000));

// Builds the tax-prep CSV for a given year from the Stripe payout list.
// Returns the filtered rows (so the caller can toast the count / handle
// the empty case) and the assembled CSV string. Pure — no DOM/toast.
export const buildPayoutsCsv = (
  payouts: StripePayout[],
  year: number,
): { rows: StripePayout[]; csv: string } => {
  const rows = payouts.filter(
    (p) => new Date(p.arrival_date * 1000).getFullYear() === year
  );

  const escape = (val: string | number | null | undefined) => {
    const s = val == null ? "" : String(val);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["Arrival Date", "Description", "Status", "Method", "Currency", "Net Payout (USD)"];
  const csvLines = [header.join(",")];
  let total = 0;

  rows.forEach((p) => {
    const dollars = p.amount / 100;
    total += dollars;
    csvLines.push(
      [
        new Date(p.arrival_date * 1000).toISOString().slice(0, 10),
        escape(p.description ?? `Stripe Payout ${p.id}`),
        escape(p.status),
        escape(p.method),
        escape(p.currency.toUpperCase()),
        dollars.toFixed(2),
      ].join(",")
    );
  });

  csvLines.push("");
  csvLines.push(`Total Net Payouts,${total.toFixed(2)}`);
  csvLines.push(`Tax Year,${year}`);
  csvLines.push("Note,Net amounts paid to your bank. Excludes platform fees & sales tax (Helpr's responsibility).");

  return { rows, csv: csvLines.join("\n") };
};
