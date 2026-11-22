/**
 * The seller's payout line on a handed-over order card (row 93). What it is made of and why a $0 payout is $0 come
 * from D2-6's pure rules (src/lib/declutter/payoutWords.ts); audit 1b D2-2 adds one thing: while a problem is open a
 * pending payout says it is held.
 */
import type { MyPayout } from "@/lib/declutter/handover";
import { formatPrice } from "@/lib/declutter/distance";
import { PAYOUT_TRIES, payoutBreakdown, payoutStatusWords, payoutWentOut } from "@/lib/declutter/payoutWords";
import { checkWindowEnds, payoutDay, payoutDayAfterWindow } from "@/lib/declutter/timeLeft";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enDeclPayout";

/** D2-2: a pending payout while a problem is open says dpo.heldProblem ("It's held while Louisiana Helpr looks at the problem."). */

/** The two lines that wait on the seller's payout account. */
const SETUP_LINES = ["dpo.onceSetup", "dpo.onceReady"] as const;

/**
 * Audit 11-20 night Low 6: does this payout line wait on payout setup? Asked by the "Set up payouts" link beside the
 * line (FailedPayoutLink), which matched the English words. It reads the same dictionary templates the line is built
 * from, in the language showing, so the line and its link never part.
 */
export function payoutLineWaitsOnSetup(line: string): boolean {
  return SETUP_LINES.some((key) => {
    const [before, after] = t(key, { gets: "\u0000" }).split("\u0000");
    return after !== undefined && line.length > before.length + after.length && line.startsWith(before) && line.endsWith(after);
  });
}

/** F360b: what the line knows besides the payout row. */
export interface PayoutLineContext {
  /** The handover row's confirmed_at: the sale is final (and sent) 24 hours later (declutter_sale_final). */
  handedOverAt?: string | null;
  /** A refund request is open, offered, returning or with Louisiana Helpr: declutter_sale_final holds the payout. */
  refundOpen?: boolean;
  /**
   * The seller's payout account is ready (payoutAccountReady: Stripe answered payouts on). Without it the payout run
   * puts the row off (declutter-money "no_account"), so no day is promised. Absent counts as ready.
   */
  payoutReady?: boolean;
  /**
   * usePayoutSetupPaused() from the caller: while payout setup is not offered (paused, or not open to this member),
   * the line never tells the seller to set up payouts; it says the payout waits for the account. Absent counts as paused.
   */
  setupPaused?: boolean;
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

/**
 * F360b / F398 / F404 (owner 11-11 ~2:10 PM): every seller order card says "You get $X, paid on <date>", with the
 * delivery ("You get $50 ($45 + $5 delivery)") and a part refund ("You get $25 after the $20 refund"), from the payout
 * row's own numbers (amount_cents = items + delivery - refunded - manager share - debt; owner 2026-11-20: no setup fee
 * is taken from a Declutter payout any more, so a row's setup_fee_cents is only ever a past one), and no fee words. The parts are shown only when they add up to the amount.
 * Audit 11-10 F392 (High): every status reads as words, and a payout that went out says when (executed_at, Central).
 */
export function payoutLine(payout: MyPayout, problemOpen: boolean, ctx: PayoutLineContext = {}): string {
  if (payout.status === "nothing_due") return payoutStatusWords(payout);
  const amount = payout.amount_cents;
  const addsUp = (payout.setup_fee_cents ?? 0) === 0
    && payout.items_cents + (payout.delivery_cents ?? 0) - (payout.refunded_cents ?? 0) - payout.debt_cents === payout.amount_cents;
  const parts = addsUp ? payoutBreakdown(payout) : "";
  const gets = t("dpo.gets", { amount: formatPrice(amount), parts });
  const paidOut = payoutWentOut(payout.status);
  if (paidOut) return payout.executed_at ? t("dpo.paidOn", { gets, day: payoutDay(payout.executed_at) }) : `${gets}. ${payoutStatusWords(payout)}`;
  if (problemOpen && payout.status === "pending") return `${gets}. ${t("dpo.heldProblem")}`;
  if (payout.status !== "pending" || (payout.attempts ?? 0) >= PAYOUT_TRIES) return `${gets}. ${payoutStatusWords(payout)}`;
  if (ctx.refundOpen) return `${gets}. ${t("dpo.waitsRefund")}`;
  if (ctx.payoutReady === false) return t(ctx.setupPaused === false ? "dpo.onceSetup" : "dpo.onceReady", { gets });
  // declutter_payouts_due holds while the part refund is pending, failed or held for review (20261111211749; unknown:
  // not promised); succeeded and settled_by_hand do not hold it, so it goes in the next run.
  // Scope: this reads only the AGREED request's own refund. A refund of another reason held on the same payment also
  // holds the payout on the server, and this line would still say "send it next" (rare; no day is promised).
  if (ctx.refundAgreed && REFUND_HOLDS.has(ctx.refundAgreed)) return `${gets}. ${t("dpo.refundHold")}`;
  const final = `${gets}. ${t("dpo.final")}`;
  if (ctx.refundAgreed) return final;
  if (ctx.saleDecided) return final;
  if (!ctx.handedOverAt) return t("dpo.after24", { gets });
  // declutter_sale_final: the later of the handover and a declined refund request, plus 24 hours.
  const from = ctx.declinedAt && Date.parse(ctx.declinedAt) > Date.parse(ctx.handedOverAt) ? ctx.declinedAt : ctx.handedOverAt;
  const ends = checkWindowEnds(from, ctx.now);
  if (ends && ctx.declinedAt) return t("dpo.onUnlessLook", { gets, day: payoutDayAfterWindow(ends) });
  return ends ? t("dpo.onUnlessRefund", { gets, day: payoutDayAfterWindow(ends) }) : final;
}

/**
 * The seller's pre-handover "You get" (no payout row yet): items + delivery (declutter_complete_handover's payout).
 * Owner 2026-11-20: no setup fee ever comes out of a Declutter payout.
 */
export function preHandoverSellerCents(itemsCents: number, deliveryCents: number): number {
  return itemsCents + Math.max(0, deliveryCents);
}
