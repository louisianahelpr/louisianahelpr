// Board 177, ONE PAYOUT: what a single bank payout was made of.
//
// Stripe pays a connected account out on its automatic schedule, so a payout
// is a bundle of the transfers Helpr sent the account since the last one.
// Stripe answers which balance transactions a payout carried
// (balanceTransactions.list({ payout }), docs.stripe.com/payouts/reconciliation),
// and on a connected account a transfer from the platform lands as a
// `payment` whose source (py_…) names the platform transfer it came from in
// `source_transfer`. That tr_ id is the stripe_transfer_id our own ledgers
// stamp, so each line is named from the caller's OWN ledger row: a job, a
// cancellation fee, a sale, a Shops order, a delivery or a referral credit.
// A line no ledger claims keeps Stripe's figure under a plain label, so the
// lines always add up to what reached the bank.
//
// A TIP (F267a, audit 11-10: a payout read "Payment $3.00" nine times) is not
// a transfer our ledgers stamp: create-payment and auto-tip-charge charge the
// poster with transfer_data.destination (a destination charge), so its tr_ id
// is Stripe's, and only the PaymentIntent id is on the tips row. For a
// transfer no ledger named, the platform's own transfer is read (no
// stripeAccount: the transfer lives on the platform) and its transfer_group
// (group_<pi>, Stripe's default for a destination charge) names the
// PaymentIntent; the caller's own tips row (helper_id = caller) names the job.
// Measured 11-14 on the test Helpr's account (Stripe test mode, read-only):
// tr_3Ub2A5… transfer_group group_pi_3Ub2A5…, PaymentIntent metadata
// type "tip", tips row "[E2E DO NOT ACCEPT] tipdub6zs".
//
// A MANUAL payout (instant-payout's payouts.create, an instant cash-out)
// cannot be reconciled this way: Stripe refuses to filter balance transactions
// by it ("you control the timing and amount"). It answers one line, the
// cash-out itself, so the lines still add up (lh-authz-rls review of a287f43dd3).
/** The fields read from Stripe's BalanceTransaction (local, so the app's tsc checks this file too). */
export interface PayoutBalanceTxn {
  type: string;
  net: number;
  source?: unknown;
}
interface PayoutObject {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrival_date: number;
  created: number;
  destination?: unknown;
  /** false for a manual payout (an instant cash-out). */
  automatic?: boolean;
}
/** The fields read from a platform Transfer: its destination charge's group names the PaymentIntent. */
interface TransferObject {
  id: string;
  transfer_group?: string | null;
}
/** The Stripe reads payoutDetail makes; the real Stripe client satisfies it. */
export interface PayoutReader {
  transfers: {
    retrieve(id: string): Promise<TransferObject>;
  };
  payouts: {
    retrieve(id: string, params: { expand: string[] }, opts: { stripeAccount: string }): Promise<PayoutObject>;
  };
  balanceTransactions: {
    list(
      params: { payout: string; limit: number; expand: string[] },
      opts: { stripeAccount: string },
    ): { autoPagingToArray(o: { limit: number }): Promise<PayoutBalanceTxn[]> };
  };
}
// deno-lint-ignore no-explicit-any
type Admin = any;

export interface PayoutLine {
  kind: "job" | "cancellation_fee" | "sale" | "shop_sale" | "delivery" | "referral" | "tip" | "fee_owed" | "reversal" | "other";
  label: string;
  amount_cents: number;
  /** In-app path to the job or sale this line came from, when there is one. */
  href: string | null;
}

export interface PayoutDetail {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  arrival_date: number;
  created: number;
  bank_last4: string | null;
  lines: PayoutLine[];
}

const PAYOUT_ID = /^po_[A-Za-z0-9]{6,64}$/;
export const isPayoutId = (v: unknown): v is string => typeof v === "string" && PAYOUT_ID.test(v);

function transferIdOf(bt: PayoutBalanceTxn): string | null {
  const src = bt.source as unknown;
  if (!src || typeof src !== "object") return null;
  const st = (src as { source_transfer?: unknown }).source_transfer;
  if (typeof st === "string") return st;
  if (st && typeof st === "object" && typeof (st as { id?: unknown }).id === "string") return (st as { id: string }).id;
  return null;
}

function last4Of(dest: unknown): string | null {
  if (dest && typeof dest === "object") {
    const l4 = (dest as { last4?: unknown }).last4;
    if (typeof l4 === "string" && /^\d{4}$/.test(l4)) return l4;
  }
  return null;
}

const titleOr = (t: unknown, fallback: string) => (typeof t === "string" && t.trim() ? t.trim() : fallback);

/**
 * Names every transfer id from the caller's own ledgers. Each read is scoped
 * to the caller as the row's payee, so a transfer id that is not theirs names
 * nothing (it could not be on their account anyway; this is the second lock).
 * A read error throws: the screen says "couldn't load", never a wrong label.
 */
async function nameTransfers(admin: Admin, userId: string, ids: string[]): Promise<Map<string, PayoutLine[]>> {
  const out = new Map<string, PayoutLine[]>();
  if (ids.length === 0) return out;
  const must = <T>(r: { data: T | null; error: unknown }): T => {
    if (r.error) throw r.error;
    return (r.data ?? []) as T;
  };

  const [jobs, cancels, sales, shops, deliveries, referrals, deliveryTips, heldTips, clawbackRepays] = await Promise.all([
    admin.from("payout_transfers").select("stripe_transfer_id, job_id, jobs(title)").eq("helper_id", userId).in("stripe_transfer_id", ids),
    admin.from("cancellation_fee_transfers").select("stripe_transfer_id, job_id, jobs(title)").eq("helper_id", userId).in("stripe_transfer_id", ids),
    admin.from("declutter_payouts").select("stripe_transfer_id, order_id, items_cents, debt_cents, setup_fee_cents, amount_cents").eq("seller_id", userId).in("stripe_transfer_id", ids),
    admin.from("shop_payouts").select("stripe_transfer_id, order_id, items_cents, debt_cents, amount_cents, shop_orders!inner(seller_id)").eq("shop_orders.seller_id", userId).in("stripe_transfer_id", ids),
    admin.from("helpr_task_payouts").select("stripe_transfer_id, task_id, helpr_tasks(title)").eq("helpr_id", userId).in("stripe_transfer_id", ids),
    admin.from("referral_credits").select("stripe_transfer_id").eq("user_id", userId).in("stripe_transfer_id", ids),
    // A delivery tip is paid out by its own platform transfer (payout_transfer_id), F267a.
    admin.from("helpr_task_tips").select("payout_transfer_id, helpr_tasks(title)").eq("helpr_id", userId).in("payout_transfer_id", ids),
    // A tip held back during a payout hold and re-paid once it lifted (heldTipRepay.ts) is a NEW platform transfer
    // in the group tip_<tip id>, stamped only here (repay_transfer_id); the tip itself names the job or delivery.
    admin.from("tip_hold_redrives").select("repay_transfer_id, tip_source, tips(job_id, jobs(title)), helpr_task_tips(helpr_tasks(title))").eq("helper_id", userId).in("repay_transfer_id", ids),
    // A job payout a chargeback took back and re-paid when the dispute was won (chargebackClawback.ts): its
    // payout_transfers row names it already; this names it when that upsert failed (which pages ops).
    admin.from("chargeback_clawbacks").select("repay_transfer_id, job_id, jobs(title)").eq("helper_id", userId).in("repay_transfer_id", ids),
  ]).then((rs) => rs.map(must) as unknown[][]);

  for (const r of jobs as { stripe_transfer_id: string; job_id: string; jobs: { title?: string } | null }[]) {
    out.set(r.stripe_transfer_id, [{ kind: "job", label: titleOr(r.jobs?.title, "A job"), amount_cents: 0, href: `/jobs/${r.job_id}` }]);
  }
  for (const r of cancels as { stripe_transfer_id: string; job_id: string; jobs: { title?: string } | null }[]) {
    out.set(r.stripe_transfer_id, [{ kind: "cancellation_fee", label: `Cancelled job: ${titleOr(r.jobs?.title, "a job")}`, amount_cents: 0, href: `/jobs/${r.job_id}` }]);
  }

  // A sale's transfer is its items less any fee it paid back (declutter_consume_fee_debt):
  // two lines, the sale and the fee (the payout rows' CHECK holds amount = items - debt).
  const saleOrderIds = (sales as { order_id: string }[]).map((r) => r.order_id);
  const titlesByOrder = new Map<string, string[]>();
  if (saleOrderIds.length > 0) {
    const lines = must(await admin.from("declutter_cart_items").select("order_id, declutter_items(title)").in("order_id", saleOrderIds)) as { order_id: string; declutter_items: { title?: string } | null }[];
    for (const l of lines) {
      const t = titleOr(l.declutter_items?.title, "");
      if (!t) continue;
      titlesByOrder.set(l.order_id, [...(titlesByOrder.get(l.order_id) ?? []), t]);
    }
  }
  const saleLines = (kind: "sale" | "shop_sale", label: string, href: string, r: { items_cents: number; debt_cents: number; setup_fee_cents?: number | null; amount_cents: number }): PayoutLine[] => {
    // A Declutter payout's one-time setup fee sits inside debt_cents (owner 2026-10-30), named on its own line.
    const setupFee = Number(r.setup_fee_cents ?? 0);
    const owed = r.debt_cents - setupFee;
    if (owed <= 0 && setupFee <= 0) return [{ kind, label, amount_cents: 0, href }];
    const lines: PayoutLine[] = [{ kind, label, amount_cents: r.items_cents, href }];
    if (owed > 0) lines.push({ kind: "fee_owed", label: "Fee owed, paid back", amount_cents: -owed, href: null });
    if (setupFee > 0) lines.push({ kind: "fee_owed", label: "One-time setup fee", amount_cents: -setupFee, href: null });
    return lines;
  };
  for (const r of sales as { stripe_transfer_id: string; order_id: string; items_cents: number; debt_cents: number; setup_fee_cents?: number | null; amount_cents: number }[]) {
    const titles = titlesByOrder.get(r.order_id) ?? [];
    const label = titles.length === 0 ? "A Declutter sale" : titles.length === 1 ? titles[0] : `${titles[0]} and ${titles.length - 1} more`;
    out.set(r.stripe_transfer_id, saleLines("sale", label, "/declutter?tab=selling", r));
  }
  for (const r of shops as { stripe_transfer_id: string; items_cents: number; debt_cents: number; amount_cents: number }[]) {
    out.set(r.stripe_transfer_id, saleLines("shop_sale", "A Shops order", "/declutter?tab=selling", r));
  }
  for (const r of deliveries as { stripe_transfer_id: string; helpr_tasks: { title?: string } | null }[]) {
    out.set(r.stripe_transfer_id, [{ kind: "delivery", label: titleOr(r.helpr_tasks?.title, "A delivery"), amount_cents: 0, href: "/declutter?view=deliver" }]);
  }
  for (const r of referrals as { stripe_transfer_id: string }[]) {
    out.set(r.stripe_transfer_id, [{ kind: "referral", label: "Referral credit", amount_cents: 0, href: null }]);
  }
  for (const r of deliveryTips as { payout_transfer_id: string; helpr_tasks: { title?: string } | null }[]) {
    out.set(r.payout_transfer_id, [{ kind: "tip", label: `Tip: ${titleOr(r.helpr_tasks?.title, "a delivery")}`, amount_cents: 0, href: "/declutter?view=deliver" }]);
  }
  for (const r of heldTips as {
    repay_transfer_id: string;
    tip_source: string;
    tips: { job_id?: string | null; jobs: { title?: string } | null } | null;
    helpr_task_tips: { helpr_tasks: { title?: string } | null } | null;
  }[]) {
    out.set(r.repay_transfer_id, [r.tip_source === "delivery"
      ? { kind: "tip", label: `Tip: ${titleOr(r.helpr_task_tips?.helpr_tasks?.title, "a delivery")}`, amount_cents: 0, href: "/declutter?view=deliver" }
      : { kind: "tip", label: `Tip: ${titleOr(r.tips?.jobs?.title, "a job")}`, amount_cents: 0, href: r.tips?.job_id ? `/jobs/${r.tips.job_id}` : null }]);
  }
  for (const r of clawbackRepays as { repay_transfer_id: string; job_id: string; jobs: { title?: string } | null }[]) {
    out.set(r.repay_transfer_id, [{ kind: "job", label: titleOr(r.jobs?.title, "A job"), amount_cents: 0, href: `/jobs/${r.job_id}` }]);
  }
  return out;
}

const GROUP_PI = /^group_(pi_[A-Za-z0-9]{6,64})$/;
/** At most this many unnamed transfers are looked up per payout (one Stripe read each). */
const TIP_LOOKUP_CAP = 50;
/** Stripe reads in flight at once (Stripe's test-mode read limit is about 25 a second; money review N2). */
const TIP_LOOKUP_PARALLEL = 5;

const isMissing = (e: unknown) => !!e && typeof e === "object" && (e as { code?: unknown }).code === "resource_missing";

/**
 * Names the tips among the transfers no ledger claimed (F267a). A tip is a destination charge, so its transfer's
 * group names the PaymentIntent the caller's own tips row (a job tip) or helpr_task_tips row (a delivery tip charged
 * straight to the Helpr) holds. A transfer Stripe says does not exist keeps its plain "Payment" line (it still adds
 * up; logged). Any other Stripe error, and a tips read error, throws, like the ledgers: the screen says it couldn't
 * load rather than hiding a misconfigured key or a rate limit behind a plain label (lh-money-escrow review N1).
 */
async function nameTips(stripe: PayoutReader, admin: Admin, userId: string, ids: string[]): Promise<Map<string, PayoutLine[]>> {
  const out = new Map<string, PayoutLine[]>();
  if (ids.length === 0) return out;
  if (ids.length > TIP_LOOKUP_CAP) {
    console.warn(`[stripe-payouts] ${ids.length} unnamed transfers in one payout; only the first ${TIP_LOOKUP_CAP} are looked up, the rest stay "Payment"`);
  }
  const piByTransfer = new Map<string, string>();
  const todo = ids.slice(0, TIP_LOOKUP_CAP);
  for (let i = 0; i < todo.length; i += TIP_LOOKUP_PARALLEL) {
    await Promise.all(todo.slice(i, i + TIP_LOOKUP_PARALLEL).map(async (id) => {
      try {
        const tr = await stripe.transfers.retrieve(id);
        const pi = GROUP_PI.exec(tr.transfer_group ?? "")?.[1];
        if (pi) piByTransfer.set(id, pi);
      } catch (e) {
        if (!isMissing(e)) throw e;
        console.warn(`[stripe-payouts] transfer ${id} does not exist on this key; its line stays "Payment"`);
      }
    }));
  }
  if (piByTransfer.size === 0) return out;
  const pis = [...new Set(piByTransfer.values())];
  const [jobTips, taskTips] = await Promise.all([
    admin.from("tips").select("stripe_payment_intent_id, job_id, jobs(title)").eq("helper_id", userId).in("stripe_payment_intent_id", pis),
    admin.from("helpr_task_tips").select("stripe_payment_intent_id, helpr_tasks(title)").eq("helpr_id", userId).in("stripe_payment_intent_id", pis),
  ]);
  if (jobTips.error) throw jobTips.error;
  if (taskTips.error) throw taskTips.error;
  const byPi = new Map<string, PayoutLine>();
  for (const t of (jobTips.data ?? []) as { stripe_payment_intent_id: string; job_id: string | null; jobs: { title?: string } | null }[]) {
    byPi.set(t.stripe_payment_intent_id, { kind: "tip", label: `Tip: ${titleOr(t.jobs?.title, "a job")}`, amount_cents: 0, href: t.job_id ? `/jobs/${t.job_id}` : null });
  }
  for (const t of (taskTips.data ?? []) as { stripe_payment_intent_id: string; helpr_tasks: { title?: string } | null }[]) {
    byPi.set(t.stripe_payment_intent_id, { kind: "tip", label: `Tip: ${titleOr(t.helpr_tasks?.title, "a delivery")}`, amount_cents: 0, href: "/declutter?view=deliver" });
  }
  for (const [tr, pi] of piByTransfer) {
    const line = byPi.get(pi);
    if (line) out.set(tr, [line]);
  }
  return out;
}

/** The lines of one payout, in Stripe's order, summing to the payout. */
export function linesFor(bts: PayoutBalanceTxn[], named: Map<string, PayoutLine[]>): PayoutLine[] {
  const lines: PayoutLine[] = [];
  for (const bt of bts) {
    if (bt.type === "payout") continue;
    const tr = transferIdOf(bt);
    const mine = tr ? named.get(tr) : undefined;
    if (mine && mine.length > 0) {
      // A single line takes Stripe's net, which is what moved. Split lines
      // (a sale and the fee it paid back) carry the ledger's parts, and only
      // while those parts add up to what Stripe moved; otherwise one line at
      // Stripe's net, so the lines always sum to the payout.
      const parts = mine.reduce((s, l) => s + l.amount_cents, 0);
      if (mine.length > 1 && parts === bt.net) lines.push(...mine.map((l) => ({ ...l })));
      else lines.push({ ...mine[0], amount_cents: bt.net });
      continue;
    }
    const reversal = bt.type === "payment_refund" || bt.type === "transfer_refund" || bt.net < 0;
    lines.push({ kind: reversal ? "reversal" : "other", label: reversal ? "Taken back" : "Payment", amount_cents: bt.net, href: null });
  }
  return lines;
}

export async function payoutDetail(stripe: PayoutReader, admin: Admin, userId: string, accountId: string, payoutId: string): Promise<PayoutDetail> {
  const opts = { stripeAccount: accountId };
  const payout = await stripe.payouts.retrieve(payoutId, { expand: ["destination"] }, opts);
  if (payout.automatic === false) {
    return {
      id: payout.id,
      amount_cents: payout.amount,
      currency: payout.currency,
      status: payout.status,
      arrival_date: payout.arrival_date,
      created: payout.created,
      bank_last4: last4Of(payout.destination),
      lines: [{ kind: "other", label: "Instant cash-out", amount_cents: payout.amount, href: null }],
    };
  }
  // 100 is Stripe's page ceiling; a weekly payout of a neighbor's jobs and
  // sales is far under it, and autoPagingToArray caps a runaway at 500.
  const bts = await stripe.balanceTransactions
    .list({ payout: payoutId, limit: 100, expand: ["data.source"] }, opts)
    .autoPagingToArray({ limit: 500 });
  const ids = [...new Set(bts.map(transferIdOf).filter((x): x is string => !!x))];
  const named = await nameTransfers(admin, userId, ids);
  for (const [tr, lines] of await nameTips(stripe, admin, userId, ids.filter((id) => !named.has(id)))) named.set(tr, lines);
  return {
    id: payout.id,
    amount_cents: payout.amount,
    currency: payout.currency,
    status: payout.status,
    arrival_date: payout.arrival_date,
    created: payout.created,
    bank_last4: last4Of(payout.destination),
    lines: linesFor(bts, named),
  };
}
