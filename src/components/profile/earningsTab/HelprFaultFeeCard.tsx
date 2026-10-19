import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

/**
 * Card fees this Helpr owes from jobs an admin ruled them at fault on (a no-show
 * or a backout refunded in full; owner 2026-10-18 "J4"). Each fee comes out of
 * the Helpr's next payouts (take_helpr_fault_fee). The bill notice links here,
 * and until now this tab never said what was owed or already taken
 * (lh-money-escrow re-review of b1730c932 #7). Reads the Helpr's own
 * job_helpr_fault_rulings rows (RLS: the Helpr reads own).
 */
export interface HelprFaultFeeRow {
  card_fee_cents: number | null;
  card_fee_remaining_cents: number | null;
}

export function helprFaultFeeTotals(rows: HelprFaultFeeRow[]): { owedCents: number; takenCents: number } {
  let owedCents = 0;
  let takenCents = 0;
  for (const r of rows) {
    const billed = Math.max(0, Number(r.card_fee_cents ?? 0));
    const left = Math.min(billed, Math.max(0, Number(r.card_fee_remaining_cents ?? 0)));
    owedCents += left;
    takenCents += billed - left;
  }
  return { owedCents, takenCents };
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function HelprFaultFeeCard({ userId }: { userId: string | null | undefined }) {
  const { data, isError } = useQuery({
    queryKey: ["helpr-fault-fees", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("job_helpr_fault_rulings")
        .select("card_fee_cents, card_fee_remaining_cents")
        .eq("helper_id", userId as string);
      if (error) {
        report(error, { severity: "warning", tags: { source: "EarningsTab.helprFaultFees" } });
        throw error;
      }
      return (rows ?? []) as HelprFaultFeeRow[];
    },
  });
  if (isError) {
    return (
      <p role="status" className="text-sm text-muted-foreground px-1">
        Couldn't load the card fees you owe. Pull to refresh to try again.
      </p>
    );
  }
  const { owedCents, takenCents } = helprFaultFeeTotals(data ?? []);
  if (owedCents <= 0 && takenCents <= 0) return null;
  return (
    <section aria-label="Card fees you owe" className="rounded-2xl border border-border bg-card p-4 space-y-1">
      <h3 className="text-sm font-semibold text-foreground">Card fees from jobs you were ruled at fault on</h3>
      {owedCents > 0 && (
        <p className="text-sm text-foreground">
          {dollars(owedCents)} still owed. It comes out of your next payout.
        </p>
      )}
      {takenCents > 0 && (
        <p className="text-sm text-muted-foreground">
          {dollars(takenCents)} already taken from your payouts.
        </p>
      )}
    </section>
  );
}
