/**
 * The seller's payout line on a handed-over order card (row 93). What it is made of and why a $0 payout is $0 come
 * from D2-6's pure rules (src/lib/declutter/payoutWords.ts); audit 1b D2-2 adds one thing: while a problem is open a
 * pending payout says it is held.
 */
import type { MyPayout } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";
import { PAYOUT_TRIES, payoutBreakdown, payoutStatusWords } from "@/lib/declutter/payoutWords";
import { checkWindowEnds, payoutDay, payoutDayAfterWindow } from "@/lib/declutter/timeLeft";

/** D2-2: a pending payout while a problem is open. */
const PAYOUT_HELD = "It's held while Louisiana Helpr looks at the problem.";

/** F360b: what the line knows besides the payout row. */
export interface PayoutLineContext {
  /** The handover row's confirmed_at: the sale is final (and sent) 24 hours later (declutter_sale_final). */
  handedOverAt?: string | null;
  /** A refund request is open, offered, returning or with Louisiana Helpr: declutter_sale_final holds the payout. */
  refundOpen?: boolean;
  /**
   * The one-time setup fee declutter_payout_take_setup_fee will take from THIS row when it is sent (0 when none, or
   * when it cannot be told which of several unsent payouts takes it): computed by setupFeeAheadByOrder.
   */
  setupFeeAhead?: number;
  /**
   * The seller's payout account is ready (payoutAccountReady: Stripe answered payouts on). Without it the payout run
   * puts the row off (declutter-money "no_account"), so no day is promised. Absent counts as ready.
   */
  payoutReady?: boolean;
  /** A refund request the seller declined: declutter_sale_final waits for the later of handover + 24 h and declined_at + 24 h. */
  declinedAt?: string | null;
  /**
   * F360b loose end (lead 11-11): a refund request the two sides AGREED (a part refund), with that refund's Stripe
   * status ("unknown" while the view has none). declutter_payouts_due holds the payout while the refund_request_part
   * refund is pending or failed; once it went through the sale is decided (declutter_sale_decided) and final at once.
   */
  refundAgreed?: "pending" | "succeeded" | "failed" | "held_for_review" | "settled_by_hand" | "unknown" | null;
  /**
   * F360b loose end (lead 11-11): Louisiana Helpr decided a problem on this order, or confirmed the handover itself
   * (declutter_sale_decided: a 'decided' problem or confirmed_by = 'admin'): the sale is final at once.
   */
  saleDecided?: boolean;
  now?: number;
}

/**
 * The part-refund states that hold the seller's payout (declutter_payouts_due), plus a status not read yet. Money review
 * 11-11 (20261111211749): a part refund held for review holds it too, until it is settled.
 */
const REFUND_HOLDS: ReadonlySet<string> = new Set(["pending", "failed", "held_for_review", "unknown"]);

/** The SQL caps the fee at $100 (declutter_setup_fee_due_cents: least(10000, ...)). */
const SETUP_FEE_CAP = 10_000;

/**
 * F360b / F398 / F404 (owner 11-11 ~2:10 PM): every seller order card says "You get $X, paid on <date>", with the
 * delivery ("You get $50 ($45 + $5 delivery)") and a part refund ("You get $25 after the $20 refund"), from the payout
 * row's own numbers (amount_cents = items + delivery - refunded - manager share - debt; the setup fee taken at the send,
 * 20261031214749 / 20261101233256), and no fee words. The parts are shown only when they add up to the amount.
 * Audit 11-10 F392 (High): every status reads as words, and a payout that went out says when (executed_at, Central).
 */
export function payoutLine(payout: MyPayout, problemOpen: boolean, ctx: PayoutLineContext = {}): string {
  if (payout.status === "nothing_due") return payoutStatusWords(payout);
  const ahead = Math.max(0, ctx.setupFeeAhead ?? 0);
  const amount = payout.amount_cents - ahead;
  const addsUp = ahead === 0 && (payout.setup_fee_cents ?? 0) === 0
    && payout.items_cents + (payout.delivery_cents ?? 0) - (payout.refunded_cents ?? 0) - payout.debt_cents === payout.amount_cents;
  const parts = addsUp ? payoutBreakdown(payout) : "";
  const gets = `You get ${formatPrice(amount)}${parts}`;
  const paidOut = payout.status === "succeeded" || payout.status === "settled_by_hand";
  if (paidOut) return payout.executed_at ? `${gets}, paid on ${payoutDay(payout.executed_at)}.` : `${gets}. ${payoutStatusWords(payout)}`;
  if (problemOpen && payout.status === "pending") return `${gets}. ${PAYOUT_HELD}`;
  if (payout.status !== "pending" || (payout.attempts ?? 0) >= PAYOUT_TRIES) return `${gets}. ${payoutStatusWords(payout)}`;
  if (ctx.refundOpen) return `${gets}. It waits until the refund request is settled.`;
  if (ctx.payoutReady === false) return `${gets} once you set up payouts in Settings.`;
  // declutter_payouts_due holds while the part refund is pending, failed or held for review (20261111211749; unknown:
  // not promised); succeeded and settled_by_hand do not hold it, so it goes in the next run.
  // Scope: this reads only the AGREED request's own refund. A refund of another reason held on the same payment also
  // holds the payout on the server, and this line would still say "send it next" (rare; no day is promised).
  if (ctx.refundAgreed && REFUND_HOLDS.has(ctx.refundAgreed)) return `${gets}. It's on hold until the buyer's refund goes through.`;
  if (ctx.refundAgreed) return `${gets}. The sale is final, so we send it next.`;
  if (ctx.saleDecided) return `${gets}. The sale is final, so we send it next.`;
  if (!ctx.handedOverAt) return `${gets}, paid 24 hours after the handover unless the buyer asks for a refund.`;
  // declutter_sale_final: the later of the handover and a declined refund request, plus 24 hours.
  const from = ctx.declinedAt && Date.parse(ctx.declinedAt) > Date.parse(ctx.handedOverAt) ? ctx.declinedAt : ctx.handedOverAt;
  const ends = checkWindowEnds(from, ctx.now);
  if (ends && ctx.declinedAt) return `${gets}, paid on ${payoutDayAfterWindow(ends)} unless the buyer asks Louisiana Helpr to look.`;
  return ends ? `${gets}, paid on ${payoutDayAfterWindow(ends)} unless the buyer asks for a refund.` : `${gets}. The sale is final, so we send it next.`;
}

/**
 * The setup fee each unsent payout will lose at its send, by order id. declutter_payout_take_setup_fee takes the fee
 * from the first row the payout run sends (ORDER BY next_attempt_at) that has no fee yet, no try yet, and leaves at
 * least $1; the client cannot see next_attempt_at, so the fee is shown only when exactly one row qualifies.
 */
export function setupFeeAheadByOrder(payouts: MyPayout[], feeCents: number): Map<string, number> {
  const out = new Map<string, number>();
  const fee = Math.min(feeCents, SETUP_FEE_CAP);
  // A row already carries the fee: it is taken (the cached profile may not say so yet), so no other row loses it.
  if (fee <= 0 || payouts.some((p) => (p.setup_fee_cents ?? 0) > 0)) return out;
  const could = payouts.filter((p) => (p.status === "pending" || p.status === "failed") && (p.setup_fee_cents ?? 0) === 0
    && p.attempts === 0 && p.amount_cents - fee >= 100);
  if (could.length === 1) out.set(could[0].order_id, fee);
  return out;
}

/**
 * Owner 11-11 ~3:25 PM: with the server's answer (declutter_my_setup_fee) the fee shows on the ONE sale it names, and
 * only while that sale's payout row is still unsent with no fee taken (a row that took it already shows its own
 * smaller amount). No row is unsure: the server named the sale.
 */
export function setupFeeAheadFromServer(payouts: MyPayout[], feeCents: number, orderId: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const fee = Math.min(feeCents, SETUP_FEE_CAP);
  if (fee <= 0 || !orderId) return out;
  const row = payouts.find((p) => p.order_id === orderId);
  if (row && (row.status === "pending" || row.status === "failed") && (row.setup_fee_cents ?? 0) === 0) out.set(orderId, fee);
  return out;
}

/**
 * Owner 11-11 ~3:25 PM: the seller's pre-handover "You get" (no payout row yet): items + delivery, less the one-time
 * setup fee only on the sale the server names (declutter_my_setup_fee). `fee` null: the server's answer is not used
 * (the pre-deploy fallback shows no fee here, as before).
 */
export function preHandoverSellerCents(orderId: string, itemsCents: number, deliveryCents: number,
  fee: { cents: number; orderId?: string | null } | null): number {
  const gross = itemsCents + Math.max(0, deliveryCents);
  const cut = fee && fee.orderId === orderId ? Math.min(Math.max(0, fee.cents), SETUP_FEE_CAP) : 0;
  return cut > 0 && gross - cut >= 100 ? gross - cut : gross;
}

/**
 * lh-money-escrow review 4: the unsent rows whose figure cannot be told, so they show none rather than one too high
 * by the fee: when two or more could take it (the run's next_attempt_at order is not readable), and any unsent row
 * whose try count is unknown (the read without `attempts`).
 */
export function setupFeeUnsureOrders(payouts: MyPayout[], feeCents: number): Set<string> {
  const fee = Math.min(feeCents, SETUP_FEE_CAP);
  if (fee <= 0 || payouts.some((p) => (p.setup_fee_cents ?? 0) > 0)) return new Set();
  const unsent = payouts.filter((p) => (p.status === "pending" || p.status === "failed") && p.amount_cents - fee >= 100);
  const could = unsent.filter((p) => p.attempts === 0);
  return new Set([...(could.length > 1 ? could : []), ...unsent.filter((p) => p.attempts === undefined)].map((p) => p.order_id));
}
