import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";
import { refundedReceiptNote, spentRows } from "@/lib/posterSpend";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { rowMs as spentRowMs } from "@/components/profile/earningsTab/SpentSection";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { useFeesOwed } from "@/components/money/payoutProblems";
import { TAB_TITLES } from "@/pages/profile/types";
import { fetchMyCart } from "@/lib/declutter/api";
import { fetchMyPaidCents } from "@/lib/declutter/paidCents";

/**
 * Board 177, RECEIPTS, FEES OWED, TAX FORMS (You → Money → Receipts).
 *
 * Receipts are what left this member's card: the jobs they paid for, as the
 * Spent half counts them (posterSpend.spentRows, the same read and the same
 * figures), and the Declutter orders they paid for. Fees owed are the debts the
 * payout runs take (useFeesOwed, the same read as the Money tab's line). The
 * tax row says only what is true: Stripe issues a 1099-K in January to anyone
 * who passes the federal threshold; nothing is generated here.
 *
 * Audit 2026-10-30 DB-13: a Declutter receipt said only "Declutter purchase" and a total, and did nothing when
 * tapped. It now names the items (from declutter_my_cart, the order card's own read, which keeps 30 days; an older
 * order keeps the plain title) and opens to its lines: items, delivery, tax, the total, and the service fee in
 * words only (owner 2026-10-25: members never see a fee name or number), with a way to the order.
 *
 * B96 (from B93's DB-13 note): a first purchase's one-time account setup fee is charged OUTSIDE total_cents
 * (declutter-checkout adds it as its own Stripe line, "One-time account setup fee"), and its columns are not granted
 * to members, so the receipt said ~$2 less than the card was charged. The figure is now the card charge from
 * declutter_my_paid_cents (20261029161237, the read every "You paid" line uses), and the setup fee is said under the
 * total in the cart's own words ("Includes the one-time $2 account setup fee.", board 161: never a fee line).
 */

interface Receipt {
  key: string;
  title: string;
  ms: number;
  /** null: no figure (a refunded order). */
  cents: number | null;
  note: string;
  /** A Declutter order's lines (what the order row holds), shown when the receipt is opened. */
  lines?: { label: string; cents: number }[];
  /** The total holds more than the lines (the buyer's service fee), said in words only. */
  feeWords?: boolean;
  /** The one-time account setup fee the card paid on top of the order (a first purchase), said in words under the total. */
  setupCents?: number;
}

/** A Declutter order this member paid for (RLS: the two sides read). */
export interface PaidOrderRow {
  id: string;
  status: string;
  total_cents: number;
  paid_at: string | null;
  /** The items after any bundle discount, and the delivery, shipping and tax the order froze (absent in older reads). */
  items_cents?: number | null;
  delivery_cents?: number | null;
  shipping_cents?: number | null;
  tax_cents?: number | null;
}

/** "Blue mug", "Blue mug and 1 more", or the plain title when the items aren't known. */
function itemsTitle(titles: readonly string[] | undefined): string {
  if (!titles?.length) return "Declutter purchase";
  return titles.length === 1 ? titles[0] : `${titles[0]} and ${titles.length - 1} more`;
}

export function orderReceipts(
  orders: readonly PaidOrderRow[],
  titles: ReadonlyMap<string, string[]> = new Map(),
  /** What the card was charged per order (declutter_my_paid_cents); null before that read is deployed. */
  paid: ReadonlyMap<string, number> | null = null,
): Receipt[] {
  return orders
    .filter((o) => o.paid_at && (o.status === "paid" || o.status === "handed_over" || o.status === "refunded"))
    .map((o) => {
      const lines = [
        { label: "Items", cents: o.items_cents ?? 0 },
        { label: "Delivery", cents: o.delivery_cents ?? 0 },
        { label: "Shipping", cents: o.shipping_cents ?? 0 },
        { label: "Tax", cents: o.tax_cents ?? 0 },
      ].filter((l) => l.cents > 0);
      // The service fee is what total_cents holds beyond its lines; the setup fee is what the card paid beyond total_cents.
      const feeWords = o.items_cents != null && o.total_cents > lines.reduce((s, l) => s + l.cents, 0);
      const charged = paid?.get(o.id) ?? o.total_cents;
      const setup = Math.max(0, charged - o.total_cents);
      return {
        key: `order-${o.id}`,
        title: itemsTitle(titles.get(o.id)),
        ms: Date.parse(o.paid_at!),
        // A refund returns the order less the card fee Stripe keeps, so a refunded
        // order shows "Refunded", not a total that no longer left the card.
        cents: o.status === "refunded" ? null : charged,
        note: o.status === "refunded" ? " · Refunded" : "",
        lines,
        feeWords,
        setupCents: setup,
      };
    });
}

/** The item titles of each order this member bought (the order card's read; lines the buyer sees). */
function titlesByOrder(lines: readonly { order_id: string | null; item_title: string; my_side: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of lines) {
    if (!l.order_id || l.my_side !== "buyer") continue;
    out.set(l.order_id, [...(out.get(l.order_id) ?? []), l.item_title]);
  }
  return out;
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
          .select("id, status, total_cents, paid_at, items_cents, delivery_cents, shipping_cents, tax_cents")
          .eq("buyer_id", uid!)
          .not("paid_at", "is", null),
      ) ?? []) as PaidOrderRow[],
  });
  const owed = useFeesOwed();
  // The names only: a failed read keeps the plain title, it never hides a receipt.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: !!uid, staleTime: 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  // The card charge per paid order (the "You paid" lines' read and cache key). A failed read is a failed load: never a
  // receipt $2 under what Stripe charged. Null (not deployed) falls back to total_cents.
  const paidIds = [...new Set((orders.data ?? []).filter((o) => o.paid_at).map((o) => o.id))].sort();
  const paid = useQuery({
    queryKey: ["declutter", "my-paid-cents", paidIds.join(",")],
    queryFn: () => fetchMyPaidCents(paidIds),
    enabled: paidIds.length > 0,
  });

  const loading = spend.isLoading || orders.isLoading || (paidIds.length > 0 && paid.isLoading);
  const failed = spend.isError || orders.isError || paid.isError;

  const receipts: Receipt[] = [];
  if (spend.data) {
    const { jobs, refunds, tips, gifts, blockFees } = spend.data;
    for (const r of spentRows(jobs, refunds, gifts, tips, blockFees)) {
      // AUD31-55 (lead decision 10-31): a job refunded in full stays, "Refunded in full", at its $0 net.
      if (r.cents <= 0 && !r.refundedInFull) continue;
      receipts.push({
        key: r.job ? `job-${r.job.id}` : `tip-${r.tip?.id}`,
        title: r.job ? r.job.title ?? "Job" : "Tip",
        ms: spentRowMs(r),
        cents: r.cents,
        note: `${r.job?.status === "cancelled" ? " · Cancelled" : ""}${refundedReceiptNote(r)}`,
      });
    }
  }
  receipts.push(...orderReceipts(orders.data ?? [], titlesByOrder(cart.data ?? []), paid.data ?? null));
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
            onRetry={() => { void spend.refetch(); void orders.refetch(); void paid.refetch(); }}
          />
        ) : receipts.length === 0 ? (
          <p className="text-ds-13 px-1" style={quiet}>Nothing paid by card yet. Jobs and Declutter buys you pay for show here.</p>
        ) : (
          <ul data-receipts="" className={`${card} px-4 divide-y`} style={{ borderColor: "hsl(var(--border))" }}>
            {receipts.map((r) => {
              const row = (
                <>
                  <span className="min-w-0">
                    <span className="block text-ds-14 font-semibold truncate" style={ink}>{r.title}</span>
                    <span className="block text-ds-12 mt-0.5" style={quiet}>{r.ms ? formatShortDate(new Date(r.ms)) : ""}{r.note}</span>
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-ds-15" style={rust}>{r.cents == null ? "Refunded" : formatCents(r.cents)}</span>
                </>
              );
              if (!r.lines) return <li key={r.key} className="py-3 flex items-center justify-between gap-3">{row}</li>;
              const shown = open === r.key;
              return (
                <li key={r.key} className="py-3">
                  <button type="button" className="flex w-full min-h-11 items-center justify-between gap-3 text-left" aria-expanded={shown}
                    onClick={() => setOpen(shown ? null : r.key)} data-receipt-toggle="">
                    {row}
                  </button>
                  {shown && (
                    <div className="mt-2 space-y-1.5 text-ds-13" data-receipt-detail="">
                      <dl className="space-y-1">
                        {r.lines.map((l) => (
                          <div key={l.label} className="flex justify-between gap-3"><dt style={quiet}>{l.label}</dt><dd className="tabular-nums" style={ink}>{formatCents(l.cents)}</dd></div>
                        ))}
                        {r.cents != null && (
                          <div className="flex justify-between gap-3 font-semibold"><dt style={ink}>Total</dt><dd className="tabular-nums" style={ink}>{formatCents(r.cents)}</dd></div>
                        )}
                      </dl>
                      {r.feeWords && <p className="text-ds-12" style={quiet}>Includes a small Louisiana Helpr service fee.</p>}
                      {!!r.setupCents && <p className="text-ds-12" style={quiet} data-receipt-setup-fee="">Includes the one-time {formatCents(r.setupCents)} account setup fee.</p>}
                      <Link to="/declutter?view=buying" className="link-standard text-ds-13 font-medium">See the order</Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {owed.data && owed.data.length > 0 && (
          <div data-receipts-fees-owed="" className={`${card} px-4 py-3`}>
            <p className={label} style={quiet}>Amounts owed</p>
            <ul className="mt-1.5 space-y-1.5">
              {owed.data.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-ds-14 font-semibold" style={ink}>
                      {d.kind === "fault" ? "Amount owed from a job you were ruled at fault on" : "Amount owed from a refunded sale"}
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
