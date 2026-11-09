import { useMemo } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { spentRows } from "@/lib/posterSpend";
import type { JobRefund } from "@/lib/refundWords";

/**
 * F105 (owner UI audit 2026-11-09, data): a cancelled card said "Your payment was refunded" while Receipts showed a
 * leftover charge for the same job (53c98775 "Pick up packages/ deliver to UPS": $28.83 refunded, $1.17 kept, read
 * on prod). The card now reads the SAME numbers Receipts shows: the poster's one spend read (usePosterSpendData,
 * one query per poster, shared by every card through React Query) and posterSpend.spentRows.
 *
 * Only for the poster's own cancelled job whose money came back (payment_status 'refunded'); null while loading, on
 * error, or for anything else (the words then say a refund was sent, never that it was whole).
 */
export function usePosterJobRefund(job: { id: string; customer_id?: string | null; status?: string | null; payment_status?: string | null }): JobRefund | null {
  const { user } = useCurrentUser();
  const mine = !!user?.id && job.customer_id === user.id;
  const enabled = mine && job.status === "cancelled" && job.payment_status === "refunded";
  const spend = usePosterSpendData(enabled ? user!.id : undefined);
  return useMemo(() => {
    if (!enabled || !spend.data) return null;
    const { jobs, refunds, gifts, tips, blockFees } = spend.data;
    const own = jobs.filter((j) => j.id === job.id);
    if (own.length === 0) return null;
    const row = spentRows(own, refunds, gifts, tips, blockFees).find((r) => r.job?.id === job.id);
    if (!row || row.refundedCents <= 0) return null;
    return { refundedCents: row.refundedCents, keptCents: Math.max(0, row.cents - row.tipCents) };
  }, [enabled, spend.data, job.id]);
}
