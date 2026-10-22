import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";
import { spentRows } from "@/lib/posterSpend";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { rowMs as spentRowMs } from "@/components/profile/earningsTab/SpentSection";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { useFeesOwed } from "@/components/money/payoutProblems";
import { TAB_TITLES } from "@/pages/profile/types";

/**
 * Board 177, RECEIPTS, FEES OWED, TAX FORMS (You → Money → Receipts).
 *
 * Receipts are what left this member's card: the jobs they paid for, as the
 * Spent half counts them (posterSpend.spentRows, the same read and the same
 * figures), and the Declutter orders they paid for. Fees owed are the debts the
 * payout runs take (useFeesOwed, the same read as the Money tab's line). The
 * tax row says only what is true: Stripe issues a 1099-K in January to anyone
 * who passes the federal threshold; nothing is generated here.
 */

interface Receipt {
  key: string;
  title: string;
  ms: number;
  /** null: no figure (a refunded order). */
  cents: number | null;
  note: string;
}

/** A Declutter order this member paid for (RLS: the two sides read). */
export interface PaidOrderRow {
  id: string;
  status: string;
  total_cents: number;
  paid_at: string | null;
}

export function orderReceipts(orders: readonly PaidOrderRow[]): Receipt[] {
  return orders
    .filter((o) => o.paid_at && (o.status === "paid" || o.status === "handed_over" || o.status === "refunded"))
    .map((o) => ({
      key: `order-${o.id}`,
      title: "Declutter purchase",
      ms: Date.parse(o.paid_at!),
      // A refund returns the order less the card fee Stripe keeps, so a refunded
      // order shows "Refunded", not a total that no longer left the card.
      cents: o.status === "refunded" ? null : o.total_cents,
      note: o.status === "refunded" ? " · Refunded" : "",
    }));
}

const card = "rounded-2xl liquid-glass";
const ink = { color: "hsl(var(--ink-deep))" };
const quiet = { color: "hsl(var(--olivewood) / 0.7)" };
const rust = { color: "hsl(var(--accent-ink))" };
const label = "text-ds-11 font-semibold uppercase tracking-wide";

export default function Receipts({ onBack }: { onBack?: () => void }) {
  const { user } = useCurrentUser();
  const uid = user?.id;
  const spend = usePosterSpendData(uid);
  const orders = useQuery<PaidOrderRow[]>({
    queryKey: ["declutter", "paidOrders", uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async () =>
      (unwrap(
        await supabase
          .from("declutter_orders")
          .select("id, status, total_cents, paid_at")
          .eq("buyer_id", uid!)
          .not("paid_at", "is", null),
      ) ?? []) as PaidOrderRow[],
  });
  const owed = useFeesOwed();

  const loading = spend.isLoading || orders.isLoading;
  const failed = spend.isError || orders.isError;

  const receipts: Receipt[] = [];
  if (spend.data) {
    const { jobs, refunds, tips, gifts, blockFees } = spend.data;
    for (const r of spentRows(jobs, refunds, gifts, tips, blockFees)) {
      if (r.cents <= 0) continue;
      receipts.push({
        key: r.job ? `job-${r.job.id}` : `tip-${r.tip?.id}`,
        title: r.job ? r.job.title ?? "Job" : "Tip",
        ms: spentRowMs(r),
        cents: r.cents,
        note: r.job?.status === "cancelled" ? " · Cancelled" : "",
      });
    }
  }
  receipts.push(...orderReceipts(orders.data ?? []));
  receipts.sort((a, b) => b.ms - a.ms);

  const year = new Date().getFullYear();

  return (
    <ProfileTabBody>
      <ProfileTabHeader title={TAB_TITLES.receipts} onBack={onBack} />
      {/* The same clothes the tab's chunk waited in (ProfileTabFallback's TAB_SHAPES), so one placeholder, not two. */}
      {loading ? <ProfileTabBodyReserve tab="receipts" /> : (
      <div className="space-y-3">
        {failed ? (
          <ErrorState
            variant="inline"
            title="We couldn't load your receipts."
            body="Your money is fine; the page just couldn't reach it. Tap Try again."
            onRetry={() => { void spend.refetch(); void orders.refetch(); }}
          />
        ) : receipts.length === 0 ? (
          <p className="text-ds-13 px-1" style={quiet}>Nothing paid by card yet. Jobs and Declutter buys you pay for show here.</p>
        ) : (
          <ul data-receipts="" className={`${card} px-4 divide-y`} style={{ borderColor: "hsl(var(--border))" }}>
            {receipts.map((r) => (
              <li key={r.key} className="py-3 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-ds-14 font-semibold truncate" style={ink}>{r.title}</span>
                  <span className="block text-ds-12 mt-0.5" style={quiet}>{r.ms ? formatShortDate(new Date(r.ms)) : ""}{r.note}</span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-ds-15" style={rust}>{r.cents == null ? "Refunded" : formatCents(r.cents)}</span>
              </li>
            ))}
          </ul>
        )}

        {owed.data && owed.data.length > 0 && (
          <div data-receipts-fees-owed="" className={`${card} px-4 py-3`}>
            <p className={label} style={quiet}>Fees owed</p>
            <ul className="mt-1.5 space-y-1.5">
              {owed.data.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-ds-14 font-semibold" style={ink}>
                      {d.kind === "fault" ? "Card fee from a job" : "Card fee from a refunded sale"}
                    </span>
                    <span className="block text-ds-12 mt-0.5" style={quiet}>Taken from your next payout</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-ds-15" style={rust}>{formatCents(d.cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div data-receipts-tax="" className={`${card} px-4 py-3`}>
          <p className={label} style={quiet}>Tax forms</p>
          <p className="mt-1.5 text-ds-14 font-semibold" style={ink}>{year} earnings summary</p>
          <p className="text-ds-12 mt-0.5" style={quiet}>Available in January if you qualify</p>
        </div>
      </div>
      )}
    </ProfileTabBody>
  );
}
