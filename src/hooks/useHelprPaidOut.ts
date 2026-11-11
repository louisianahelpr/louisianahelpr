import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

/**
 * F287 (audit 11-10): the hired Helpr's page for a paid job said only "Approved and paid out to you." with no amount
 * or date. This reads what was actually sent to them: their own paid payout_transfers rows for the job (the same read
 * as the tip page's "Job, paid to you", TipMoment.tsx), summed, and when the last one was paid (paid_at, else the
 * row's created_at). Null until known, when there is no paid row, and on a read error: the line then keeps its words
 * without a number (never a guessed amount). No arrival date: bank timing is Stripe's schedule.
 */
export function useHelprPaidOut(jobId: string, helperId: string | null | undefined, enabled: boolean): { cents: number; at: string } | null {
  const { data } = useQuery({
    queryKey: ["payment", "helprPaidOut", jobId, helperId],
    enabled: enabled && !!helperId,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = (unwrap(
        await supabase.from("payout_transfers").select("amount_cents, paid_at, created_at").eq("job_id", jobId).eq("helper_id", helperId as string).eq("status", "paid"),
      ) ?? []) as { amount_cents: number | null; paid_at: string | null; created_at: string }[];
      const cents = rows.reduce((s, r) => s + Math.max(0, Math.round(Number(r.amount_cents ?? 0))), 0);
      const stamps = rows.map((r) => r.paid_at ?? r.created_at).sort();
      const at = stamps[stamps.length - 1];
      return cents > 0 && at ? { cents, at } : null;
    },
  });
  return data ?? null;
}
