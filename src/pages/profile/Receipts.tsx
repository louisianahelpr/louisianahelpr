import { useRef, useState } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { ProfileTabHeader } from "@/components/profile/ProfileTabHeader";
import { ErrorState } from "@/components/ui/ErrorState";
import { ProfileTabBodyReserve } from "@/components/profile/ProfileTabFallback";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";

/** "Nov 9, 2026" in Central time: the day a receipt was paid, written out on the opened receipt (F090). */
function formatLongDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
}
import { CARD_COST_NOT_REFUNDED } from "@/lib/refundWords";
import { cancelledStatusWord } from "@/lib/expiredListing";
import { jobRefundLines, refundedReceiptNote, spentRows } from "@/lib/posterSpend";
import { usePosterSpendData } from "@/components/profile/earningsTab/usePosterSpendData";
import { rowMs as spentRowMs } from "@/components/profile/earningsTab/SpentSection";
import { formatCents } from "@/components/profile/earningsTab/earningsTabHelpers";
import { useFeesOwed } from "@/components/money/payoutProblems";
import { TAB_TITLES } from "@/pages/profile/types";
import { fetchMyCart } from "@/lib/declutter/api";
import { fetchMyPaidCents } from "@/lib/declutter/paidCents";
import { fetchMyRefundedCents, netOfRefund } from "@/lib/declutter/refundedCents";

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
 *
 * F380 (audit 11-10; owner 11-11 ~12:25 AM, an exception to the 10-25 rule for receipts only): the opened Declutter
 * receipt shows a "Service fee" line (the order's premium_cents, the figure checkout charged) and the one-time setup
 * fee as its own line, so the lines add up to "Total paid", the card charge, to the cent; a refund shows under it.
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
  /** F380: a Declutter order's card charge, the sum of its lines ("Total paid"). */
  chargedCents?: number;
  /** F380: what came back to the card for that order (declutter_my_refunded_cents), 0 when nothing did. */
  refundedCents?: number;
  /** F089: the amount's caption ("You paid") when the row is net of a refund, so the figure is never a bare number. */
  amountCaption?: string;
  /** Where the opened receipt links (a Declutter order: the Buying list). */
  detailLink?: { to: string; label: string };
  /** A plain line under the breakdown (owner 2026-11-09: why a part-refunded job kept some of the charge). */
  detailNote?: string;
}


/** A Declutter order this member paid for (RLS: the two sides read). */
export interface PaidOrderRow {
  id: string;
  status: string;
  total_cents: number;
  paid_at: string | null;
  /** The items after any bundle discount, and the delivery, shipping and tax the order froze (absent in older reads). */
  items_cents?: number | null;
  /** F380: the service fee the order froze and checkout charged (absent in older reads). */
  premium_cents?: number | null;
  delivery_cents?: number | null;
  shipping_cents?: number | null;
  tax_cents?: number | null;
}

/**
 * F091 (owner UI audit 11-09): job titles showed exactly as typed ("GIVE AWAY!!", "clean"), so the list looked messy.
 * On receipts only (the original stays everywhere else), a title in all capitals reads in lower case, and every title
 * starts with a capital: "Give away!!", "Clean", "Clean my house". Mixed case is left as typed (names, "TV mount").
 */
export function receiptTitle(raw: string): string {
  const t = raw.trim();
  if (!t) return raw;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const shouting = letters.length > 1 && letters === letters.toUpperCase();
  const base = shouting ? t.toLowerCase() : t;
  return base.charAt(0).toUpperCase() + base.slice(1);
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
  /** What came back per order (declutter_my_refunded_cents): a part refund is netted and said. Null: not deployed. */
  refundedBack: ReadonlyMap<string, number> | null = null,
): Receipt[] {
  return orders
    .filter((o) => o.paid_at && (o.status === "paid" || o.status === "handed_over" || o.status === "refunded"))
    .map((o) => {
      const charged = paid?.get(o.id) ?? o.total_cents;
      const back = Math.max(0, refundedBack?.get(o.id) ?? 0);
      // F380 (owner 11-11): the receipt's lines add up to what the card was charged, to the cent. Each figure is the
      // order row's own frozen column (declutter_orders, the buyer's granted read), never a recomputed rule:
      //   items_cents (after any bundle discount) + premium_cents (the service fee checkout charged) + delivery_cents
      //   (Helpr or seller delivery) + shipping_cents + tax_cents = total_cents (CHECK declutter_orders_total,
      //   20261020024605), and the card charge (declutter_my_paid_cents) = total_cents + the one-time setup fee that
      //   stood, so the setup line is that charge less total_cents.
      // Without items_cents or premium_cents (an older read) the parts can't be proven, so only the total shows.
      const known = o.items_cents != null && o.premium_cents != null;
      const setup = Math.max(0, charged - o.total_cents);
      const lines = known
        ? [
            { label: "Items", cents: o.items_cents ?? 0 },
            { label: "Service fee", cents: o.premium_cents ?? 0 },
            { label: "Delivery", cents: o.delivery_cents ?? 0 },
            { label: "Shipping", cents: o.shipping_cents ?? 0 },
            { label: "Tax", cents: o.tax_cents ?? 0 },
            { label: "One-time account setup fee", cents: setup },
          ].filter((l) => l.cents > 0)
        : [];
      return {
        key: `order-${o.id}`,
        title: itemsTitle(titles.get(o.id)),
        ms: Date.parse(o.paid_at!),
        // A refund returns the order less the card fee Stripe keeps, so a refunded
        // order shows "Refunded", not a total that no longer left the card.
        cents: o.status === "refunded" ? null : netOfRefund(charged, refundedBack?.get(o.id)).cents,
        note: o.status === "refunded" ? " · Refunded" : netOfRefund(charged, refundedBack?.get(o.id)).note,
        lines,
        chargedCents: charged,
        refundedCents: Math.min(back, charged),
        detailLink: { to: "/declutter?view=buying", label: "See the order" },
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
          .select("id, status, total_cents, paid_at, items_cents, premium_cents, delivery_cents, shipping_cents, tax_cents")
          .eq("buyer_id", uid!)
          .not("paid_at", "is", null),
      ) ?? []) as PaidOrderRow[],
  });
  const owed = useFeesOwed();
  // The names only: a failed read keeps the plain title, it never hides a receipt.
  const cart = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetchMyCart, enabled: !!uid, staleTime: 60_000 });
  // F276: the job page's "See your receipt" sends ?job=<id>; that job's receipt opens on arrival, not the bare list.
  const [params] = useSearchParams();
  const jobParam = params.get("job");
  const [open, setOpen] = useState<string | null>(jobParam ? `job-${jobParam}` : null);
  const scrolled = useRef(false);
  const scrollOnce = (el: HTMLLIElement | null) => {
    if (!el || scrolled.current) return;
    scrolled.current = true;
    el.scrollIntoView?.({ block: "center" });
  };
  // The card charge per paid order (the "You paid" lines' read and cache key). A failed read is a failed load: never a
  // receipt $2 under what Stripe charged. Null (not deployed) falls back to total_cents.
  const paidIds = [...new Set((orders.data ?? []).filter((o) => o.paid_at).map((o) => o.id))].sort();
  const paid = useQuery({
    queryKey: ["declutter", "my-paid-cents", paidIds.join(",")],
    queryFn: () => fetchMyPaidCents(paidIds),
    enabled: paidIds.length > 0,
  });

  // A3-112 follow-up: what came back per order, so a part refund is netted (Spent reads the same, purchaseSpend.ts).
  const back = useQuery({
    queryKey: ["declutter", "my-refunded-cents", paidIds.join(",")],
    queryFn: () => fetchMyRefundedCents(paidIds),
    enabled: paidIds.length > 0,
  });

  const loading = spend.isLoading || orders.isLoading || (paidIds.length > 0 && (paid.isLoading || back.isLoading));
  const failed = spend.isError || orders.isError || paid.isError || back.isError;

  const receipts: Receipt[] = [];
  if (spend.data) {
    const { jobs, refunds, tips, gifts, blockFees } = spend.data;
    for (const r of spentRows(jobs, refunds, gifts, tips, blockFees)) {
      // AUD31-55 (lead decision 10-31): a job refunded in full stays, "Refunded in full", at its $0 net.
      if (r.cents <= 0 && !r.refundedInFull) continue;
      const refundLines = r.job ? jobRefundLines(r) : undefined;
      receipts.push({
        key: r.job ? `job-${r.job.id}` : `tip-${r.tip?.id}`,
        title: r.job ? receiptTitle(r.job.title ?? "Job") : "Tip",
        ms: spentRowMs(r),
        cents: r.cents,
        // F104 (owner UI audit 2026-11-09): a listing that expired with nobody hired is "Expired", never "Cancelled"
        // (owner 10-31: expired jobs are not cancellations), the word the poster's Jobs list and job page use.
        note: `${r.job && r.job.status === "cancelled" ? ` · ${cancelledStatusWord(r.job)}` : ""}${refundedReceiptNote(r)}`,
        // F090 (owner UI audit 11-09): every job receipt opens (it could not be opened at all): the lines when there was
        // a refund, the total, the day it was paid and a link to the job. Display only: the same figures as the row.
        lines: r.job ? refundLines ?? [] : undefined,
        detailLink: r.job ? { to: `/jobs/${r.job.id}`, label: "See the job" } : undefined,
        amountCaption: refundLines ? "You paid" : undefined,
        // Only when nobody was owed for their time: a late cancel keeps the Helpr's part too, said on the cancel screen.
        detailNote: refundLines && !(Number(r.job?.cancellation_fee ?? 0) > 0) ? CARD_COST_NOT_REFUNDED : undefined,
      });
    }
  }
  receipts.push(...orderReceipts(orders.data ?? [], titlesByOrder(cart.data ?? []), paid.data ?? null, back.data ?? null));
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
          <>
          {jobParam && !receipts.some((r) => r.key === `job-${jobParam}`) && (
            <p data-receipt-job-missing="" className="text-ds-13 px-1" style={quiet}>No card receipt for this job yet.</p>
          )}
          <ul data-receipts="" className={`${card} px-4 divide-y`} style={{ borderColor: "hsl(var(--border))" }}>
            {receipts.map((r) => {
              const row = (
                <>
                  <span className="min-w-0">
                    <span className="block text-ds-14 font-semibold truncate" style={ink}>{r.title}</span>
                    <span className="block text-ds-12 mt-0.5" style={quiet}>{r.ms ? formatShortDate(new Date(r.ms)) : ""}{r.note}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    {r.amountCaption && <span className="block text-ds-12" style={quiet} data-receipt-amount-caption="">{r.amountCaption}</span>}
                    <span className="block font-bold tabular-nums text-ds-15" style={rust}>{r.cents == null ? "Refunded" : formatCents(r.cents)}</span>
                  </span>
                </>
              );
              if (!r.lines) return <li key={r.key} className="py-3 flex items-center justify-between gap-3">{row}</li>;
              const shown = open === r.key;
              return (
                <li key={r.key} className="py-3" ref={shown && r.key === `job-${jobParam}` ? scrollOnce : undefined}>
                  <ListRow className="-mx-2 w-[calc(100%+1rem)] gap-3 px-2 py-0" aria-expanded={shown}
                    onClick={() => setOpen(shown ? null : r.key)} data-receipt-toggle="">
                    {row}
                  </ListRow>
                  {shown && (
                    <div className="mt-2 space-y-1.5 text-ds-13" data-receipt-detail="">
                      <dl className="space-y-1">
                        {r.ms > 0 && (
                          <div className="flex justify-between gap-3" data-receipt-paid-on=""><dt style={quiet}>Paid on</dt><dd style={ink}>{formatLongDate(new Date(r.ms))}</dd></div>
                        )}
                        {r.lines.map((l) => (
                          <div key={l.label} className="flex justify-between gap-3"><dt style={quiet}>{l.label}</dt><dd className="tabular-nums" style={ink}>{formatCents(l.cents)}</dd></div>
                        ))}
                        {r.chargedCents != null ? (
                          <>
                            {/* F380: the lines above add up to this, what the card was charged. */}
                            <div className="flex justify-between gap-3 font-semibold" data-receipt-total-paid=""><dt style={ink}>Total paid</dt><dd className="tabular-nums" style={ink}>{formatCents(r.chargedCents)}</dd></div>
                            {!!r.refundedCents && (
                              <div className="flex justify-between gap-3"><dt style={quiet}>Refunded</dt><dd className="tabular-nums" style={ink}>−{formatCents(r.refundedCents)}</dd></div>
                            )}
                            {!!r.refundedCents && r.cents != null && (
                              <div className="flex justify-between gap-3 font-semibold"><dt style={ink}>You paid</dt><dd className="tabular-nums" style={ink}>{formatCents(r.cents)}</dd></div>
                            )}
                          </>
                        ) : r.cents != null && (
                          <div className="flex justify-between gap-3 font-semibold"><dt style={ink}>{r.amountCaption ?? "Total"}</dt><dd className="tabular-nums" style={ink}>{formatCents(r.cents)}</dd></div>
                        )}
                      </dl>
                      {r.detailNote && <p className="text-ds-12" style={quiet} data-receipt-detail-note="">{r.detailNote}</p>}
                      {r.detailLink && <Link to={r.detailLink.to} className="link-standard text-ds-13 font-medium">{r.detailLink.label}</Link>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </>
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
