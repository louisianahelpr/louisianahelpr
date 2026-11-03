import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * Q2701 (owner 11-03: "YES"): what came back to the poster on a refunded job, in cents, so the cancelled line can
 * say "$90.40 was refunded" instead of "The rest was refunded". Read from the payment_refunds ledger (one row per
 * Stripe refund; RLS "Customers can read their own refunds"), the same source as the Spent tab (posterSpend.ts).
 * A cancelled job carries no tips, so every row on it is the job's own refund. Null until known, when there is no
 * row, and on a read error: the line then keeps its words without a number (never a guessed amount).
 */
export function useJobRefundedCents(jobId: string | null | undefined, enabled = true): number | null {
  const { data } = useQuery({
    queryKey: ["payment", "jobRefundedCents", jobId],
    enabled: !!jobId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from("payment_refunds").select("amount_cents").eq("job_id", jobId as string),
      ) as { amount_cents: number | null }[] | null;
      const cents = (rows ?? []).reduce((s, r) => s + Math.max(0, Math.round(Number(r.amount_cents ?? 0))), 0);
      return cents > 0 ? cents : null;
    },
  });
  return typeof data === "number" ? data : null;
}
