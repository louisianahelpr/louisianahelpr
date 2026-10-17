/**
 * Class guard: EVERY refund keeps the card fee (owner, 2026-10-14: "if admin
 * refunds we keep the fee also. we should never absorb any fee"), EXCEPT a
 * refund caused by our own mistake, which goes back in full.
 *
 * The bug: create-payment admin_refund_general sent Stripe a full refund with
 * no amount (prod job b108a7ae, 2026-10-14: 2606 of a 2606 charge refunded, the
 * $1.06 card fee Stripe kept paid by the platform), while cancel_escrow on the
 * same kind of job kept it (4f9f4431: 2500 of 2606).
 *
 * Inventory from source (comments blanked): every `stripe.refunds.create(` in
 * supabase/functions, plus every caller of a pass-through wrapper. Each must be
 * classified in REFUND_SITES (EXACT both ways: a new site fails until it is
 * classified, a stale entry fails), and then:
 *
 *   keeps-fee    the `amount` sent to Stripe is derived (traced through the
 *                nearest preceding declarations) from the shared definition in
 *                supabase/functions/_shared/refundAmount.ts, AND its definition
 *                (the amount expression, then the right-hand side of the
 *                nearest declaration of each money identifier behind it, up to
 *                five hops) is PINNED exactly in AMOUNT_DEFS: "any identifier
 *                traces to the helper" alone
 *                accepted `capturedCents - generalSplit.setupKeptCents`, the
 *                pre-fix shape (lh-silent-failure review of 79e9a6bb5, #1);
 *   own-mistake  the call carries the comment "own-mistake full refund (owner,
 *                2026-10-14)" just above it, naming why it is our error;
 *   both         a call that sends either (a fee-withheld amount, or nothing
 *                for a full refund of our own error): both checks apply.
 *   sql-policy   the amount is DECIDED IN SQL, not TypeScript (Declutter,
 *                2026-10-15): the call sends exactly `<row>.refund_cents`, a
 *                column of a refund row the site reads through a named RPC, and
 *                the entry names the SQL function and migration that decide
 *                it (SQL_POLICIES). That migration must hold the NEWEST
 *                definition of the function and of each pinned table CHECK
 *                (a later restatement fails until it is reviewed and named),
 *                and the reason -> fee policy mapping, read from BOTH the
 *                table CHECK and the function's CASE, must equal the pinned
 *                map EXACTLY, both ways: a new reason fails until classified,
 *                and a reason moved to a full refund fails. Only our own
 *                mistakes refund the fee ('full_platform_absorbs'); a seller's
 *                fault refunds in full and the fee becomes the seller's debt;
 *                every other reason keeps the card fee or the buyer's fee.
 *
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             ...(isPartial ? { amount: requestedCents } : {}),
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             amount: capturedCents - generalSplit.setupKeptCents,
 * @mutate supabase/functions/create-payment/index.ts |           const refundAmount = cancelSplit.refundCents; |           const refundAmount = capturedCents - cancelSplit.setupKeptCents;
 * @mutate supabase/functions/execute-dispute-split/index.ts | refundableCents = posterBase.ceilingCents | refundableCents = capturedCents - posterBase.setupKeptCents
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const owedCents = unfilledCents - flatCardFeeKeptCents + feeReturnCents + taxReturnCents; | const owedCents = unfilledCents - flatCardFeeKeptCents + feeProRataCents + taxReturnCents;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       const feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: crewStripeFeeCents, proRataCents: feeProRataCents }); |       const feeReturnCents = feeProRataCents;
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |         // own-mistake full refund (owner, 2026-10-14): we charged the one-time |         // we charged the one-time
 * The three charge-recurring-visits own-mistake branches (owner pop-up, 2026-10-14 ~3 PM CT, confirmed each):
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): this run charged | // this run charged
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14), as Q415 (e): the visit | // as Q415 (e): the visit
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): everything goes back. | // everything goes back.
 * @mutate supabase/functions/charge-recurring-visits/index.ts |   const refundCents = Number.isFinite(captured)\n    ? refundToPayerCents({ capturedCents: captured, actualFeeCents: actualOrEstimatedFeeCents(pi, captured) }).refundCents |   const refundCents = Number.isFinite(captured)\n    ? captured
 * The Declutter sql-policy sites (2026-10-15): (a) a no-fault reason moved to a full refund, in the function and
 * in the table CHECK; the keep-card-fee amount refunding the fee; (b) a new reason added unclassified; the sites
 * sending something other than the row's refund_cents.
 * @mutate supabase/migrations/20261017052705_declutter_helpr_delivery.sql | WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee' | WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout') THEN 'keep_card_fee'
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee' | WHEN reason IN ('buyer_no_show') THEN 'keep_buyer_fee'
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents | WHEN fee_policy = 'keep_card_fee' THEN paid_cents
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql |     'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault')); |     'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault', 'buyer_changed_mind'));
 * @mutate supabase/functions/declutter-money/index.ts |           amount: r.refund_cents, |           amount: r.refund_cents + r.attempts,
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |         amount: refund.refund_cents, |         payment_intent: paymentIntentId,
 * lh-money-escrow review of ecf5c93a0 (request-changes): each of its green mutations, now red. Function bodies
 * (M1 fee zeroed for one reason, M8 kept fee shrunk, M4 a caller passing no fee, M9 a caller recording our-mistake,
 * M5 the fee estimate, note 1 the reader projection); table statements (M2 an UPDATE, M6 a trigger, an order
 * card-fee UPDATE); the site (M3 the fee handed to the SQL, M12 a second amount spread in).
 * @mutate supabase/migrations/20261017052705_declutter_helpr_delivery.sql |     v_fee := least(v_fee, p_paid_cents - 1); |     v_fee := least(v_fee, p_paid_cents - 1);\n    IF p_reason = 'admin_no_fault' THEN v_fee := 0; END IF;
 * @mutate supabase/migrations/20261017052705_declutter_helpr_delivery.sql |     v_kept := v_order.premium_cents; |     v_kept := v_order.premium_cents;\n    v_kept := 1;
 * @mutate supabase/migrations/20261017052705_declutter_helpr_delivery.sql |   v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents); |   v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, 0);
 * @mutate supabase/migrations/20261014224914_declutter_slice3b_payments.sql | 'duplicate_payment', p_amount_cents, p_card_fee_cents)); | 'order_closed', p_amount_cents, 0));
 * @mutate supabase/migrations/20261014224914_declutter_slice3b_payments.sql | round(greatest(p_amount_cents, 0) * 0.029)::integer + 30 | 0
 * @mutate supabase/migrations/20261017052705_declutter_helpr_delivery.sql | r.stripe_payment_intent_id, r.refund_cents, r.attempts, | r.stripe_payment_intent_id, r.paid_cents, r.attempts,
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | UPDATE public.declutter_refunds SET card_fee_cents = 0, refund_cents = paid_cents WHERE fee_policy = 'keep_card_fee';\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | CREATE TRIGGER trg_zero_fee BEFORE INSERT ON public.declutter_refunds FOR EACH ROW EXECUTE FUNCTION public.declutter_zero_fee();\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | UPDATE public.declutter_orders SET card_fee_cents = 0;\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     p_card_fee_cents: fee, |     p_card_fee_cents: 0,
 * @mutate supabase/functions/declutter-money/index.ts |           amount: r.refund_cents, |           amount: r.refund_cents,\n          ...({ amount: 0 }),
 * Re-review of a701ff757 (N-F the fee's source, N-H / N-G the row changed before the chain ends, N-J an edge write):
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     const bt = typeof charge === "object" && charge ? charge.balance_transaction : null; |     const bt = { fee: 0 } as { fee: number };
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   const answer = data as MarkPaidAnswer \| null; |   const answer = data as MarkPaidAnswer \| null;\n  if (answer && answer.result === "refund") (answer as { refund_cents: number }).refund_cents = amount;
 * @mutate supabase/functions/declutter-money/index.ts |   for (const r of refunds) { |   refunds.forEach((x) => { (x as { refund_cents: number }).refund_cents += 100; });\n  for (const r of refunds) {
 * @mutate supabase/functions/declutter-money/index.ts |   for (const r of refunds) { |   await admin.from("declutter_orders").update({ status: "paid" }).eq("id", "x");\n  for (const r of refunds) {
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles, parseDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = process.cwd();
const FN = join(ROOT, "supabase/functions");
const HELPERS = ["refundToPayerCents(", "crewFeeShareReturnCents(", "refundLessStripeFeeCents("];
const OWN_MISTAKE_MARK = "own-mistake full refund (owner, 2026-10-14)";

type Kind = "keeps-fee" | "own-mistake" | "both" | "pass-through" | "sql-policy";

/**
 * Where a sql-policy site's amount comes from: the RPC it calls, the SQL function that reads refund_cents off the
 * row, the exact `amount` it sends, the identifier holding the row, and the source chain from the RPC to the call
 * (whitespace-collapsed fragments, comments blanked, EXACT, in order; the last one declares `row`, and nothing
 * between it and the call may assign to `row`). The chain includes the card fee the site hands the SQL.
 */
interface SqlSite {
  decidedBy: keyof typeof SQL_POLICIES; rpc: string; reader: string; amount: string; row: string; chain: string[];
  /** Functions in the site's file that must be called exactly `count` times (the one call that hands the row on). */
  calls?: Record<string, number>;
  /**
   * Every line of the site's file that names refund_cents (comments blanked, whitespace-collapsed), in order.
   * EXACT: a write to the row's refund_cents anywhere in the file (before the chain, on an alias) adds a line
   * and fails until reviewed (lh-money-escrow re-review of a701ff757, item 2).
   */
  mentions: string[];
}

/**
 * Every refund site, keyed by file and a substring of its call text. EXACT.
 * own-mistake entries are the owner's exceptions (2026-10-14, asked twice):
 * our own errors are refunded in full, card fee included.
 */
const REFUND_SITES: Array<{ file: string; key: string; kind: Kind; why: string; sql?: SqlSite }> = [
  { file: "supabase/functions/create-payment/index.ts", key: "cancel-escrow-", kind: "keeps-fee", why: "poster/admin cancel of a funded job" },
  { file: "supabase/functions/create-payment/index.ts", key: "refund-dispute-", kind: "keeps-fee", why: "Quick Refund of a dispute (card cost only)" },
  { file: "supabase/functions/create-payment/index.ts", key: "refund-general-", kind: "keeps-fee", why: "admin refund, full or partial" },
  { file: "supabase/functions/execute-dispute-split/index.ts", key: "poster_share", kind: "keeps-fee", why: "the poster's leg of a dispute split" },
  { file: "supabase/functions/void-cancelled-payments/index.ts", key: "cancel-refund-", kind: "keeps-fee", why: "cancelled job settlement" },
  { file: "supabase/functions/process-scheduled-payouts/index.ts", key: "crew-dispute-refund-", kind: "keeps-fee", why: "crew unfilled spots / crew dispute" },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "refunds.create(params, opts)", kind: "pass-through", why: "createRefundOnce: callers checked below" },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "visitRefundKey(stripe, intent.id)", kind: "own-mistake", why: "a second charge for one visit (our double charge; owner pop-up 2026-10-14 ~3 PM CT)" },
  { file: "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts", key: "ONBOARDING_FEE_CENTS", kind: "own-mistake", why: "the $2 setup fee charged twice" },
  { file: "supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts", key: "duplicate-funding-refund:", kind: "own-mistake", why: "a second payment for an already-funded job" },
  { file: "supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts", key: "recurring-visit-refund:", kind: "own-mistake", why: "a visit checkout we could not settle" },
  {
    file: "supabase/functions/declutter-money/index.ts", key: "payment_intent: r.payment_intent_id", kind: "sql-policy",
    why: "Declutter refund queue: a refund row the webhook did not finish",
    sql: {
      decidedBy: "declutter_record_refund", rpc: "declutter_refunds_due", reader: "declutter_refunds_due",
      amount: "r.refund_cents", row: "r",
      chain: [
        "const [refundsRes, payoutsRes, helprRes, deliveryRes] = await Promise.all([ admin.rpc(\"declutter_refunds_due\", { p_limit: BATCH }),",
        "const refunds = (refundsRes.data ?? []) as RefundDue[];",
        "for (const r of refunds) {",
      ],
      mentions: [
        "refund_cents: number;",
        "refund_cents: number;",
        "amount: r.refund_cents,",
        "message: `Stripe answered ${refund.status} for refund row ${r.refund_id} (${dollars(r.refund_cents)}, order ${r.order_id ?? \"none\"}). ${r.attempts + 1 >= 12 ? \"That was the last try: refund it by hand.\" : \"It will be retried with back-off.\"}`,",
        "await tellBuyerRefunded(admin, r.buyer_id, r.refund_cents);",
        "payment_intent_id: d.payment_intent_id, refund_cents: d.refund_cents, attempts: d.attempts, livemode: null,",
        "amount: d.refund_cents,",
        "message: `Stripe answered ${dRefund.status} for delivery refund ${d.delivery_refund_id} (${dollars(d.refund_cents)}, order ${d.order_id}). ${d.attempts + 1 >= 12 ? \"That was the last try: refund it by hand.\" : \"It will be retried with back-off.\"}`,",
        "await tellBuyerRefunded(admin, d.buyer_id, d.refund_cents);",
      ],
    },
  },
  // Slice 5 (owner row 40, 2026-10-14): no Helpr took the delivery in 48 h, or an admin paid the seller on a
  // delivery that never happened: the DELIVERY FEE alone goes back in full (the buyer did nothing wrong; the
  // service we sold did not happen). Amount = declutter_delivery_refunds.refund_cents = the order's frozen
  // delivery_cents (declutter_delivery_refund, 20261017052705).
  { file: "supabase/functions/declutter-money/index.ts", key: "payment_intent: d.payment_intent_id", kind: "own-mistake", why: "Helpr delivery fee back: no Helpr in 48 h (row 40) or the delivery never happened" },
  {
    file: "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts", key: "payment_intent: paymentIntentId", kind: "sql-policy",
    why: "Declutter payment the order could not take (declutter_mark_order_paid answered refund)",
    sql: {
      decidedBy: "declutter_record_refund", rpc: "declutter_mark_order_paid", reader: "declutter_refund_answer",
      amount: "refund.refund_cents", row: "refund",
      chain: [
        // The card fee handed to the SQL: Stripe's own balance-transaction fee, else null (the SQL estimates it),
        // from the retrieve call on (re-review item 1).
        "const pi = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: [\"latest_charge.balance_transaction\"] });",
        "const charge = pi.latest_charge as Stripe.Charge | string | null;",
        "const bt = typeof charge === \"object\" && charge ? charge.balance_transaction : null;",
        "const fee = typeof bt === \"object\" && bt ? bt.fee : null;",
        "fee: typeof fee === \"number\" && Number.isInteger(fee) && fee >= 0 ? fee : null,",
        "const amount = session.amount_total;",
        "const facts = await chargeFacts(stripe, paymentIntentId, logStep); const fee = facts.fee;",
        "const { data, error } = await supabase.rpc(\"declutter_mark_order_paid\", { p_order_id: orderId, p_payment_intent_id: paymentIntentId, p_amount_cents: amount, p_paid_at: paidAt, p_card_fee_cents: fee, });",
        "const answer = data as MarkPaidAnswer | null;",
        "const refunded = await executeRefund(ctx, paymentIntentId, answer, orderId);",
        "refund: Extract<MarkPaidAnswer, { result: \"refund\" }>,",
      ],
      calls: { executeRefund: 1, chargeFacts: 1 },
      mentions: [
        "result: \"refund\"; refund_id: string; reason: string; fee_policy: string; refund_cents: number; refund_status: string;",
        "`${dollars(answer.refund_cents)} is on its way back to your card. Card refunds usually show up in 5 to 10 business days.`);",
        "amount: refund.refund_cents,",
        "message: `Refund ${refund.refund_id} (${refund.reason}, ${dollars(refund.refund_cents)}) for order ${orderId} could not be created; the webhook asks Stripe to redeliver.`,",
      ],
    },
  },
];

const MIGRATIONS = join(ROOT, "supabase/migrations");

/**
 * Every place app or edge code (supabase/functions and src, tests and the generated types excluded) touches the
 * Declutter money tables or a card fee directly: each `.from("declutter_refunds" | "declutter_orders")` call
 * up to its `;`, and each line naming card_fee_cents / p_card_fee_cents. EXACT, in file order. The service key
 * bypasses RLS, so an edge `.update({ card_fee_cents: 0 })` would let a refund return the fee with every SQL pin
 * still green (lh-money-escrow re-review of a701ff757, item 3). Today they are reads and the one pinned fee.
 */
const TS_MONEY_TOUCHES: string[] = [
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders") .select("id, handover, stripe_checkout_session_id") .eq("buyer_id", user.id).eq("seller_id", sellerId).eq("status", "awaiting_payment").maybeSingle()',
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders").select("stripe_checkout_session_id, status") .eq("id", order.order_id).maybeSingle()',
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders").select("buyer_id, seller_id, handover").eq("id", orderId).maybeSingle()',
  "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: p_card_fee_cents: fee,",
];

/**
 * Refund amounts decided in SQL, pinned. `migration` must hold the NEWEST
 * definition of the function and of every constraint below; each `text` is the
 * whitespace-collapsed body (comments blanked) and is EXACT.
 *
 * Declutter (slices 3b + 4, owner 2026-10-14 and rows 19/60/95): the reason
 * decides the fee policy and the policy decides the amount, in a table CHECK
 * and again in declutter_record_refund. Fee outcome per policy:
 *   full_platform_absorbs  our own mistake: everything goes back (the ONLY full refund we pay for);
 *   full_seller_pays_fee   the seller's fault: everything goes back, and the card fee Stripe kept
 *                          becomes a declutter_seller_fee_debts row taken from the seller's payouts;
 *   keep_card_fee          refund = paid - the card fee;
 *   keep_buyer_fee         refund = paid - the buyer's fee (premium_cents, 5% + 70c under F1).
 * Proven by the PGlite proofs listed (every reason and policy named there).
 */
const SQL_POLICIES = {
  declutter_record_refund: {
    migration: "20261017052705_declutter_helpr_delivery.sql",
    proofs: ["src/test/pglite/declutterSlice3b.pglite.mjs", "src/test/pglite/declutterSlice4.pglite.mjs", "src/test/pglite/declutterDelivery.pglite.mjs"],
    reasonCheck: "declutter_refunds_reason_check",
    policyCheck: "declutter_refunds_policy",
    reasons: {
      superseded: "full_platform_absorbs",
      order_closed: "full_platform_absorbs",
      amount_mismatch: "full_platform_absorbs",
      duplicate_payment: "full_platform_absorbs",
      order_missing: "full_platform_absorbs",
      sold_elsewhere: "full_platform_absorbs",
      seller_backed_out: "full_seller_pays_fee",
      seller_no_show: "full_seller_pays_fee",
      not_as_described: "full_seller_pays_fee",
      buyer_cancelled: "keep_card_fee",
      buyer_restarted_checkout: "keep_card_fee",
      admin_no_fault: "keep_card_fee",
      buyer_no_show: "keep_buyer_fee",
      admin_buyer_fault: "keep_buyer_fee",
      // Row 43 (owner 2026-10-14): damaged in a Helpr delivery = the buyer gets everything back and
      // Louisiana Helpr absorbs it (the seller is still paid, the Helpr is not).
      delivery_damage: "full_platform_absorbs",
    } as Record<string, "full_platform_absorbs" | "full_seller_pays_fee" | "keep_card_fee" | "keep_buyer_fee">,
    /** Our own mistakes, the only reasons the platform refunds the fee on (owner, 2026-10-14). EXACT. */
    ownMistakes: ["superseded", "order_closed", "amount_mismatch", "duplicate_payment", "order_missing", "sold_elsewhere",
      // Row 43: the platform absorbs damage in a delivery it arranged (owner decision, not a guess).
      "delivery_damage"],
    constraints: [
      {
        name: "declutter_refunds_fee_policy_check",
        file: "20261015042253_declutter_slice4_handover_payout.sql",
        text: "fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee', 'keep_buyer_fee')",
      },
      {
        name: "declutter_refunds_amount",
        file: "20261015042253_declutter_slice4_handover_payout.sql",
        text: "refund_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents ELSE paid_cents END AND refund_cents > 0 AND kept_cents >= 0 AND (fee_policy = 'keep_buyer_fee' OR kept_cents = 0) AND (fee_policy <> 'keep_buyer_fee' OR kept_cents > 0)",
      },
      // The buyer's fee keep_buyer_fee keeps (F1: 5% + 70c, at least 70c).
      {
        name: "declutter_orders_premium_rule",
        file: "20261015023613_declutter_buyer_fee_f1.sql",
        text: "(fee_rule = 'f1' AND premium_cents = round(items_cents * 0.05)::integer + 70) OR (fee_rule = 'premium15' AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100))",
      },
      { name: "declutter_orders_premium_cents_check", file: "20261015023613_declutter_buyer_fee_f1.sql", text: "premium_cents >= 70" },
    ],
    /**
     * EVERY SQL function that decides, feeds or can change a Declutter refund amount (refundMoneyFunctions():
     * names declutter_refunds, declutter_record_refund, declutter_card_fee_estimate, or card_fee_cents together
     * with declutter_orders, or runs as a trigger on declutter_refunds), pinned to its newest migration and the
     * sha256 (first 16 hex) of its comment-blanked, whitespace-collapsed definition. EXACT both ways: a new
     * caller, a changed reason or fee argument, a changed reader projection or fee estimate fails until it is
     * reviewed and re-pinned (lh-money-escrow review of ecf5c93a0, must-fix 1, 3, 4; note 1).
     */
    functions: {
      declutter_admin_decide_delivery_damage: "20261017052705_declutter_helpr_delivery.sql fe11a9a3460b2a93",
      declutter_card_fee_estimate: "20261014224914_declutter_slice3b_payments.sql c3eec727dc09fe3e",
      declutter_close_paid_order: "20261017052705_declutter_helpr_delivery.sql 0c52fabd4123f2d4",
      declutter_hand_refund_failed: "20261017052700_declutter_refund_hand_settle.sql df3bdc676a1d434c",
      declutter_mark_order_paid: "20261014224914_declutter_slice3b_payments.sql 12d9424a8c148d38",
      declutter_money_rows_seed: "20261014224914_declutter_slice3b_payments.sql eb41800cf45bee87",
      declutter_order_refunds_recorded_cents: "20261017052705_declutter_helpr_delivery.sql 180fd5a89917ba6d",
      declutter_record_hand_refund: "20261017052700_declutter_refund_hand_settle.sql e91bafe49bc1f340",
      declutter_record_refund: "20261017052705_declutter_helpr_delivery.sql 54faa84a9b513f1e",
      declutter_refund_answer: "20261015042253_declutter_slice4_handover_payout.sql bf344cb7353cb326",
      declutter_refund_executed: "20261017052700_declutter_refund_hand_settle.sql fda24c97dc66b80c",
      declutter_refund_gave_up_check: "20261017052700_declutter_refund_hand_settle.sql 1fa348b4a38b6f7c",
      declutter_refund_paid_order: "20261014224914_declutter_slice3b_payments.sql 2e178605dfca8501",
      declutter_refund_reversed: "20261017052700_declutter_refund_hand_settle.sql df1710d5a746e90b",
      declutter_refund_set_mode: "20261015042253_declutter_slice4_handover_payout.sql c41b6779b527f9c7",
      declutter_refunds_due: "20261017052705_declutter_helpr_delivery.sql fcc24a16eaf31209",
    } as Record<string, string>,
    /**
     * Every top-level statement (outside a function body) that names declutter_refunds (table, ALTER, policy,
     * trigger, rule, DML), and every one on declutter_orders that names card_fee_cents (PINNED_TABLES).
     * "<table> <migration>" -> sha256 (first 16 hex) of each statement, in order. EXACT: a new UPDATE, trigger,
     * policy or constraint change fails until reviewed (must-fix 2).
     */
    statements: {
      "declutter_refunds 20261014224914_declutter_slice3b_payments.sql": ["4bff57b818038dfb", "501086bd450ecad3", "3dac3faed7ee24b1", "f5f2155930f94544"],
      "declutter_orders 20261014224914_declutter_slice3b_payments.sql": ["09890255c7e1c936", "594addefda2af9a3"],
      "declutter_refunds 20261017052700_declutter_refund_hand_settle.sql": ["ae2d271f25de116b"],
      "declutter_refunds 20261017052705_declutter_helpr_delivery.sql": ["1192c0e245b11665", "aa722c4315c803d9", "afb94a44f9fb4011", "97fe1330f0f7f13d"],
      "declutter_refunds 20261015042253_declutter_slice4_handover_payout.sql": ["997e0a466b670952", "1192c0e245b11665", "2fd39357580a2cf8", "4cf2e4567f6437bd", "7ba23fa882b28f10", "afb94a44f9fb4011", "97fe1330f0f7f13d", "9eb0bd77676aa5f0", "c63b7d95e91cc6a9", "6ca67d8b1161e8fe", "50ba5fd871e1f2c0", "acc8636c50c78d27"],
    } as Record<string, string[]>,
    /** Fragments of declutter_record_refund's body, whitespace-collapsed, that decide the fee and the amount. */
    body: [
      "v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));",
      "IF v_policy = 'keep_card_fee' THEN v_fee := least(v_fee, p_paid_cents - 1);",
      "v_kept := v_order.premium_cents;",
      "CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept ELSE p_paid_cents END",
      "IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN",
      "INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents) VALUES (v_seller, v_id, v_fee, v_fee)",
    ],
  },
};

/** Callers of the pass-through wrapper (charge-recurring-visits createRefundOnce), in source order. EXACT. */
const WRAPPER = { file: "supabase/functions/charge-recurring-visits/index.ts", name: "createRefundOnce" };
const WRAPPER_CALLERS: Array<{ kind: Exclude<Kind, "pass-through" | "sql-policy">; why: string }> = [
  { kind: "keeps-fee", why: "stale-visit sweep, series ended or date changed hands" },
  // Owner pop-up 2026-10-14 ~3 PM CT confirmed both full-refund branches below as our own mistakes.
  { kind: "own-mistake", why: "stale-visit sweep, paid and never booked for no party reason (Q415 (e))" },
  { kind: "both", why: "mid-run: fee withheld when the series ended / date changed hands, full when the insert simply failed" },
];

/**
 * The pinned definition of each keeps-fee amount, whitespace-collapsed: the
 * `amount:` expression itself when it is not a bare identifier, else the
 * right-hand side of that identifier's nearest preceding declaration or
 * assignment. EXACT: changing how a refund amount is computed fails here until
 * the new expression is reviewed and pinned. Keyed by REFUND_SITES key, or
 * `createRefundOnce#<n>` for the wrapper's callers.
 */
const AMOUNT_DEFS: Record<string, string[]> = {
  "cancel-escrow-": [
    "refundAmount",
    "refundAmount = cancelSplit.refundCents",
    "cancelSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: serviceFeeCents, setupFeeCents, alreadyRefundedCents, })",
  ],
  "refund-dispute-": [
    "refundAmount",
    "refundAmount = disputeSplit.refundCents",
    "disputeSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: disputeOtherRefundedCents, })",
  ],
  "refund-general-": [
    "generalSplit.refundCents",
    "generalSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: generalAlreadyRefundedCents, requestedCents: isPartial ? requestedCents : null, })",
  ],
  "poster_share": [
    "refundCents",
    "refundCents = Math.max(0, Math.round(refundableCents * posterShare))",
    "refundableCents = posterBase.ceilingCents",
    "posterBase = refundToPayerCents({ capturedCents, actualFeeCents: pi ? actualOrEstimatedFeeCents(pi, capturedCents) : 0, customerFeeCents: pi ? cardCostFeeCents(job) : 0, setupFeeCents: pi ? setupFeeKeptCents(job) : 0, })",
  ],
  "crew-dispute-refund-": [
    "refundCents",
    "refundCents = Math.min(cardOwedCents, chargeLeftCents)",
    "cardOwedCents = Math.max(0, owedCents - giftRestoredCents)",
    "chargeLeftCents = a.isPifFunded ? Math.min(capturedCents, Math.max(0, capturedCents + a.giftAppliedCents - a.paidCents - giftRestoredCents - blockFeeCents)) : Math.max(0, a.capturedCents - a.paidCents - blockFeeCents)",
    "owedCents = unfilledCents - flatCardFeeKeptCents + feeReturnCents + taxReturnCents",
    "giftRestoredCents = Math.max(0, Math.round(Number(restore?.restore_cents ?? 0)))",
    "capturedCents = a.capturedCents",
    "blockFeeCents = Math.min(a.blockFeeCents, unpaidBudgetCents)",
    "unfilledCents = unpaidBudgetCents - blockFeeCents + Math.max(0, urgentCents - paidUrgent)",
    // Roadmap F3 (lh-money-escrow review N2, 2026-10-15): a flat-fee crew job
    // has no poster fee line to hold Stripe's fee, so the unfilled share of
    // the card fee is kept out of the refund here.
    "flatCardFeeKeptCents = isFlatFeeJob(job) && a.capturedCents > 0 && budgetCents > 0 ? Math.min(unfilledCents, Math.floor((crewStripeFeeCents * (unpaidBudgetCents - blockFeeCents)) / budgetCents)) : 0",
    "feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: crewStripeFeeCents, proRataCents: feeProRataCents })",
    "taxReturnCents = budgetCents > 0 ? Math.floor((taxCents * unpaidBudgetCents) / budgetCents) : 0",
    "unpaidBudgetCents = Math.max(0, budgetCents - paidBudget)",
    "urgentCents = Math.round(Number(job.urgent_fee ?? 0) * 100)",
    "budgetCents = Math.round(Number(job.budget ?? 0) * 100)",
    "crewStripeFeeCents = a.stripeFeeCents ?? stripeProcessingCostCents(a.capturedCents)",
    "taxCents = Math.max(0, Math.round(Number(job.sales_tax_amount ?? 0) * 100))",
  ],
  "cancel-refund-": [
    "refundAmount",
    "refundAmount = voidSplit.refundCents > 0 || refundedAtStripe ? voidSplit.refundCents : capturedCents - Math.round(cancellationFee * 100) - blockFeeCents - nonRefundableCents",
    "voidSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: fullSeriesRefund ? 0 : serviceFeeCents, setupFeeCents: setupFeeKeptCents(job), otherKeptCents: Math.round(cancellationFee * 100) + blockFeeCents, alreadyRefundedCents: chargeRefundedCents, })",
    "capturedCents = pi.amount_received ?? pi.amount",
    "blockFeeCents = crewBlockFeeCents(blockFeeRows)",
    "nonRefundableCents = voidSplit.nonRefundableCents",
  ],
  "createRefundOnce#0": [
    "owedCents",
    "owedCents = withholdFee ? lessFeeCents : amountCents",
    "lessFeeCents = Number.isFinite(amountCents) ? refundToPayerCents({ capturedCents: amountCents, actualFeeCents: actualOrEstimatedFeeCents(piObj, amountCents) }).refundCents : Number.NaN",
    "amountCents = Number(row.amount_cents)",
  ],
  "createRefundOnce#2": [
    "split.refundCents",
    "split = await refundLessStripeFeeCents(stripe, intent, capturedCents)",
  ],
};

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/** The nearest preceding declaration or assignment of `id` before `at`: its right-hand side and position. */
function declOf(code: string, id: string, at: number): { text: string; at: number } | null {
  const decl = new RegExp(`(?:\\b(?:const|let)\\s+${id}\\b[^=]*=|(?<![.\\w$])${id}\\s*=(?!=))`, "g");
  let best = -1;
  for (const d of code.slice(0, at).matchAll(decl)) best = d.index ?? best;
  if (best < 0) return null;
  const start = code.indexOf("=", best) + 1;
  let end = code.indexOf(";", start);
  if (end < 0 || end > at) end = at;
  return { text: code.slice(start, end), at: best };
}

/**
 * The definition AMOUNT_DEFS pins for an amount expression at `at`: the
 * expression, then (breadth first, up to three hops) the right-hand side of
 * the nearest declaration of every money identifier it uses (named *Cents,
 * *Split, *Base or split), up to five hops. A right-hand side
 * that calls a shared refund helper is pinned whole (its arguments included)
 * and not followed further. One hop was not enough: `refundableCents` behind
 * the dispute split's `Math.round(refundableCents * posterShare)` could be
 * re-defined unseen (lh-silent-failure re-review of 9a52981da).
 */
function amountDefinition(code: string, expr: string, at: number): string[] {
  const parts: string[] = [norm(expr)];
  const seen = new Set<string>();
  let frontier: Array<{ text: string; at: number }> = [{ text: expr, at }];
  for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
    const next: Array<{ text: string; at: number }> = [];
    for (const f of frontier) {
      if (depth > 0 && HELPERS.some((h) => f.text.includes(h))) continue;
      for (const m of f.text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
        const id = m[1];
        if (KEYWORDS.has(id) || seen.has(id)) continue;
        // An object key (`{ capturedCents: ...`) is not a use.
        const idx = m.index ?? 0;
        if (/^\s*:(?!:)/.test(f.text.slice(idx + id.length)) && /[{,]\s*$/.test(f.text.slice(0, idx))) continue;
        // Past the amount itself, only money amounts are followed: in these
        // functions every one is named *Cents (or is a refundToPayerCents
        // result, *Split / *Base / split). Flags and Stripe objects are left
        // to the edge tests.
        if (depth > 0 && !/(?:Cents|Split|Base)$|^split$/.test(id)) continue;
        seen.add(id);
        const def = declOf(code, id, f.at);
        if (!def) continue;
        parts.push(`${id} = ${norm(def.text)}`);
        next.push(def);
      }
    }
    frontier = next;
  }
  return parts;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The text of a call from its opening paren to the matching close. */
function callText(code: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") {
      depth--;
      if (depth === 0) return code.slice(openIdx, i + 1);
    }
  }
  return code.slice(openIdx);
}

const KEYWORDS = new Set(["const", "let", "await", "Math", "Number", "String", "true", "false", "null", "undefined", "typeof", "new", "async", "return"]);

/**
 * Does the value of `expr` (an expression at `at`) come from a shared refund
 * helper? Follows each root identifier to its nearest preceding declaration or
 * assignment, breadth first, a few hops deep.
 */
function tracesToHelper(code: string, expr: string, at: number): boolean {
  const seen = new Set<string>();
  let frontier: Array<{ text: string; at: number }> = [{ text: expr, at }];
  for (let depth = 0; depth < 7 && frontier.length > 0; depth++) {
    const next: Array<{ text: string; at: number }> = [];
    for (const f of frontier) {
      if (HELPERS.some((h) => f.text.includes(h))) return true;
      for (const m of f.text.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
        const id = m[1];
        if (KEYWORDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        const decl = new RegExp(`(?:\\b(?:const|let)\\s+${id}\\b[^=]*=|(?<![.\\w$])${id}(?:\\.amount)?\\s*=(?!=))`, "g");
        let best = -1;
        for (const d of code.slice(0, f.at).matchAll(decl)) best = d.index ?? best;
        if (best < 0) continue;
        const start = code.indexOf("=", best) + 1;
        let end = code.indexOf(";", start);
        if (end < 0 || end > f.at) end = f.at;
        next.push({ text: code.slice(start, end), at: best });
      }
    }
    frontier = next;
  }
  return false;
}

function amountExpr(call: string): string | null {
  const m = call.match(/\bamount:\s*([^,}\n]+)/);
  return m ? m[1].trim() : null;
}

function hasOwnMistakeComment(raw: string, at: number): boolean {
  const before = raw.slice(0, at).split("\n").slice(-9).join("\n");
  return before.includes(OWN_MISTAKE_MARK);
}

interface Found { file: string; at: number; call: string }

function refundSites(): Found[] {
  const found: Found[] = [];
  for (const abs of walk(FN)) {
    const code = blankComments(readFileSync(abs, "utf8"));
    for (const m of code.matchAll(/\bstripe\.refunds\.create\(/g)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      found.push({ file: relative(ROOT, abs), at: m.index ?? 0, call: "refunds.create" + callText(code, open) });
    }
  }
  return found;
}

const sha16 = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 16);

/** See SQL_POLICIES.functions. name -> "file sha16", plus the text for a readable failure. */
function refundMoneyFunctions(): Map<string, { pin: string; text: string }> {
  const triggerFns = new Set<string>();
  for (const file of migrationFiles(MIGRATIONS)) {
    const code = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const trig = /\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b[^;]*?\bon\s+(?:only\s+)?(?:public\.)?"?declutter_refunds"?\s[^;]*?\bexecute\s+(?:function|procedure)\s+(?:public\.)?"?(\w+)"?/gi;
    for (const m of code.matchAll(trig)) triggerFns.add(m[1].toLowerCase());
  }
  const out = new Map<string, { pin: string; text: string }>();
  for (const [name, def] of effectiveDefs(MIGRATIONS)) {
    const text = norm(blankSqlComments(def.stmt));
    const touches = triggerFns.has(name)
      || /\bdeclutter_refunds\b/i.test(text)
      || /\bdeclutter_record_refund\s*\(/i.test(text)
      || /\bdeclutter_card_fee_estimate\s*\(/i.test(text)
      || (/\bcard_fee_cents\b/i.test(text) && /\bdeclutter_orders\b/i.test(text));
    if (touches) out.set(name, { pin: `${def.file} ${sha16(text)}`, text });
  }
  return out;
}

const tableStmt = (table: string) => new RegExp(String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|alter\s+table(?:\s+if\s+exists)?|truncate(?:\s+table)?|drop\s+table(?:\s+if\s+exists)?|create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b[^;]*?\bon|create\s+policy\b[^;]*?\bon|alter\s+policy\b[^;]*?\bon|create\s+(?:or\s+replace\s+)?rule\b[^;]*?\bon|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:only\s+)?(?:public\.)?"?${table}"?(?![\w])`, "gi");

/**
 * Tables whose top-level statements are pinned: every one on declutter_refunds, and those on declutter_orders
 * that name card_fee_cents (the fee every keep_card_fee refund keeps is read from there).
 */
const PINNED_TABLES: Array<{ table: string; only?: RegExp }> = [
  { table: "declutter_refunds" },
  { table: "declutter_orders", only: /\bcard_fee_cents\b/i },
];

/** See SQL_POLICIES.statements: "<table> <migration>" -> each statement, in order. */
function refundTableStatements(): Record<string, Array<{ pin: string; text: string }>> {
  const out: Record<string, Array<{ pin: string; text: string }>> = {};
  for (const file of migrationFiles(MIGRATIONS)) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const code = blankSqlComments(sql);
    const bodies = parseDefs(sql).map((d) => [d.index, d.index + d.stmt.length]);
    for (const { table, only } of PINNED_TABLES) {
      for (const m of code.matchAll(tableStmt(table))) {
        const at = m.index ?? 0;
        if (bodies.some(([a, b]) => at >= a && at < b)) continue;
        const end = code.indexOf(";", at);
        const text = norm(code.slice(at, end < 0 ? code.length : end));
        if (only && !only.test(text)) continue;
        (out[`${table} ${file}`] ??= []).push({ pin: sha16(text), text });
      }
    }
  }
  return out;
}

/** The balanced `( ... )` starting at `open`, without the outer parens. */
function parenBody(code: string, open: number): string {
  return callText(code, open).slice(1, -1);
}

/**
 * The NEWEST definition of a named CHECK constraint across every migration, in
 * order (comments blanked; `ADD CONSTRAINT name CHECK (...)` or an inline
 * `CONSTRAINT name CHECK (...)`, the name quoted or not); a later
 * `DROP CONSTRAINT name` or `RENAME CONSTRAINT name` with no re-add leaves null.
 */
function newestConstraint(name: string): { file: string; text: string } | null {
  let out: { file: string; text: string } | null = null;
  for (const file of migrationFiles(MIGRATIONS)) {
    const code = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const events: Array<{ at: number; text: string | null }> = [];
    for (const m of code.matchAll(new RegExp(`\\bconstraint\\s+"?${name}"?\\s+check\\s*\\(`, "gi"))) {
      events.push({ at: m.index ?? 0, text: norm(parenBody(code, (m.index ?? 0) + m[0].length - 1)) });
    }
    // A drop, or a rename away (quoted or not), leaves no constraint of that name.
    for (const m of code.matchAll(new RegExp(`\\b(?:drop\\s+constraint\\s+(?:if\\s+exists\\s+)?|rename\\s+constraint\\s+)"?${name}"?(?![\\w])`, "gi"))) {
      events.push({ at: m.index ?? 0, text: null });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) out = e.text === null ? null : { file, text: e.text };
  }
  return out;
}

/**
 * `<subject> -> value` arms of a `CASE WHEN subject IN (...) THEN '..' ... ELSE '..' END`.
 * Anything else inside the CASE (a LIKE, a nested CASE, a second subject) is unreadable: null.
 */
function readCase(caseText: string, subject: string): { arms: Array<{ values: string[]; result: string }>; otherwise: string } | null {
  const body = caseText.replace(/^\s*CASE\b/i, "").replace(/\bEND\s*$/i, "");
  const arms: Array<{ values: string[]; result: string }> = [];
  const arm = new RegExp(`\\bWHEN\\s+${subject}\\s+(?:IN\\s*\\(([^()]*)\\)|=\\s*'(\\w+)')\\s+THEN\\s+'(\\w+)'`, "gi");
  let rest = body;
  for (const m of body.matchAll(arm)) {
    const values = m[1] !== undefined ? [...m[1].matchAll(/'(\w+)'/g)].map((v) => v[1]) : [m[2]];
    arms.push({ values, result: m[3] });
    rest = rest.replace(m[0], "");
  }
  const els = rest.match(/^\s*ELSE\s+'(\w+)'\s*$/i);
  return els ? { arms, otherwise: els[1] } : null;
}

/** reason -> policy for every reason, as a CASE decides it. */
function evalCase(c: NonNullable<ReturnType<typeof readCase>>, reasons: string[]): Record<string, string> {
  return Object.fromEntries(reasons.map((r) => [r, c.arms.find((a) => a.values.includes(r))?.result ?? c.otherwise]));
}

/** Problems with the SQL that decides a sql-policy site's amount. */
function checkSqlPolicy(name: keyof typeof SQL_POLICIES): string[] {
  const p = SQL_POLICIES[name];
  const problems: string[] = [];
  const def = effectiveDefs(MIGRATIONS).get(name);
  if (!def) return [`${name}: no migration defines it`];
  if (def.file !== p.migration) {
    problems.push(`${name} is now defined by ${def.file}, not the pinned ${p.migration}: review that every reason still keeps the fee except our own mistakes, then pin it`);
  }
  const body = norm(blankSqlComments(def.stmt));
  for (const frag of p.body) if (!body.includes(frag)) problems.push(`${name}: the body no longer contains "${frag}"`);

  const pinned = Object.keys(p.reasons).sort();
  // The reasons a refund row may carry (the table CHECK): exactly the classified ones.
  const reasonCheck = newestConstraint(p.reasonCheck);
  if (!reasonCheck) problems.push(`${p.reasonCheck}: no migration leaves it in place`);
  else {
    if (reasonCheck.file !== p.migration) problems.push(`${p.reasonCheck} is now defined by ${reasonCheck.file}, not ${p.migration}`);
    const listed = [...reasonCheck.text.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
    if (JSON.stringify(listed) !== JSON.stringify(pinned)) {
      problems.push(`${p.reasonCheck} allows ${JSON.stringify(listed)}, classified ${JSON.stringify(pinned)}: classify each new reason in SQL_POLICIES (does it keep the card fee?)`);
    }
  }
  // reason -> policy, from the table CHECK and from the function, each exactly the pinned map.
  const fromTable = newestConstraint(p.policyCheck);
  const tableCase = fromTable?.text.match(/^fee_policy\s*=\s*(CASE\b.*\bEND)$/i)?.[1];
  const fnCase = body.match(/v_policy\s*:=\s*(CASE\b.*?\bEND)\s*;/i)?.[1];
  for (const [where, text, subject, file] of [
    [p.policyCheck, tableCase, "reason", fromTable?.file],
    [`${name} v_policy`, fnCase, "p_reason", def.file],
  ] as const) {
    if (where === p.policyCheck && file !== p.migration) problems.push(`${p.policyCheck} is now defined by ${file ?? "nothing"}, not ${p.migration}`);
    const c = text ? readCase(text, subject) : null;
    if (!c) {
      problems.push(`${where}: the reason -> fee policy CASE cannot be read (${text ?? "missing"})`);
      continue;
    }
    const got = evalCase(c, [...new Set([...pinned, ...c.arms.flatMap((a) => a.values)])].sort());
    if (JSON.stringify(got) !== JSON.stringify(Object.fromEntries(pinned.map((r) => [r, p.reasons[r]])))) {
      problems.push(`${where} maps ${JSON.stringify(got)}, pinned ${JSON.stringify(p.reasons)}: a reason that is not our own mistake must keep the fee`);
    }
  }
  // Only our own mistakes refund the fee at our cost.
  const absorbs = pinned.filter((r) => p.reasons[r] === "full_platform_absorbs");
  if (JSON.stringify(absorbs) !== JSON.stringify([...p.ownMistakes].sort())) {
    problems.push(`full_platform_absorbs is used for ${JSON.stringify(absorbs)}, our own mistakes are ${JSON.stringify(p.ownMistakes)}`);
  }
  for (const c of p.constraints) {
    const got = newestConstraint(c.name);
    if (!got || got.file !== c.file || got.text !== c.text) {
      problems.push(`${c.name}: newest is ${JSON.stringify(got)}, pinned ${JSON.stringify({ file: c.file, text: c.text })}: review that it keeps the fee, then pin it`);
    }
  }
  // Every function that decides, feeds or can change the amount, and every statement on the table: exactly pinned.
  const fns = refundMoneyFunctions();
  const gotFns = Object.fromEntries([...fns].map(([n, f]) => [n, f.pin]).sort());
  for (const n of new Set([...Object.keys(gotFns), ...Object.keys(p.functions)])) {
    if (gotFns[n] !== p.functions[n]) {
      problems.push(`${n}: is ${JSON.stringify(gotFns[n] ?? "gone")}, pinned ${JSON.stringify(p.functions[n] ?? "not classified")}: review that every refund it can record keeps the fee except our own mistakes, then pin it. Its definition: ${fns.get(n)?.text.slice(0, 3000) ?? "-"}`);
    }
  }
  const stmts = refundTableStatements();
  for (const f of new Set([...Object.keys(stmts), ...Object.keys(p.statements)])) {
    const got = (stmts[f] ?? []).map((x) => x.pin);
    if (JSON.stringify(got) !== JSON.stringify(p.statements[f] ?? [])) {
      problems.push(`${f}: pinned statements are ${JSON.stringify(got)}, pinned ${JSON.stringify(p.statements[f] ?? [])}: review each (does it let a refund return the fee?), then pin. They read: ${JSON.stringify((stmts[f] ?? []).map((x) => x.text.slice(0, 400)))}`);
    }
  }
  // The proofs exist and name every reason and policy.
  const proofText = p.proofs.map((f) => {
    try {
      return blankComments(readFileSync(join(ROOT, f), "utf8"));
    } catch {
      problems.push(`${f}: the PGlite proof is missing`);
      return "";
    }
  }).join("\n");
  for (const w of [...pinned, ...new Set(Object.values(p.reasons))]) {
    if (!new RegExp(`\\b${w}\\b`).test(proofText)) problems.push(`no PGlite proof (${p.proofs.join(", ")}) exercises ${w}`);
  }
  return problems;
}

function walkCode(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      out.push(...walkCode(p));
    } else if (/\.(?:tsx?|mjs|js)$/.test(name) && !/\.(?:test|spec)\.[a-z]+$/.test(name)) out.push(p);
  }
  return out;
}

/** See TS_MONEY_TOUCHES. */
function tsMoneyTouches(): string[] {
  const out: string[] = [];
  for (const abs of [...walkCode(FN), ...walkCode(join(ROOT, "src"))].sort()) {
    const file = relative(ROOT, abs);
    if (file === "src/integrations/supabase/types.ts") continue;
    const code = blankComments(readFileSync(abs, "utf8"));
    const hits: Array<{ at: number; text: string }> = [];
    for (const m of code.matchAll(/\.from\(\s*["'`]declutter_(?:refunds|orders)["'`]\s*\)/g)) {
      const at = m.index ?? 0;
      const end = code.indexOf(";", at);
      hits.push({ at, text: norm(code.slice(at, end < 0 ? code.length : end)) });
    }
    for (const m of code.matchAll(/\b(?:p_)?card_fee_cents\b/g)) {
      const at = m.index ?? 0;
      const start = code.lastIndexOf("\n", at) + 1;
      const end = code.indexOf("\n", at);
      hits.push({ at, text: norm(code.slice(start, end < 0 ? code.length : end)) });
    }
    out.push(...hits.sort((a, b) => a.at - b.at).map((h) => `${file}: ${h.text}`));
  }
  return out;
}

/** A sql-policy site sends the row's refund_cents, read through the named RPC. */
function checkSqlSite(file: string, call: string, argExpr: string | null, sql: SqlSite | undefined): string[] {
  if (!sql) return [`${file}: a sql-policy entry must name the SQL that decides it (sql: { decidedBy, rpc, reader })`];
  const problems: string[] = [];
  if (argExpr !== sql.amount || !/\.refund_cents$/.test(sql.amount)) {
    problems.push(`${file}: ${call.slice(0, 80)} must send exactly ${sql.amount}, the refund row's refund_cents (sends ${argExpr ?? "no amount: a full refund"})`);
  }
  // One amount, and nothing spread in that could carry another (review note 2).
  if ((call.match(/\bamount\s*:/g) ?? []).length !== 1 || call.includes("...")) {
    problems.push(`${file}: ${call.slice(0, 80)} must carry exactly one \`amount:\` and no spread`);
  }
  const code = blankComments(readFileSync(join(ROOT, file), "utf8"));
  if (!code.includes(`.rpc("${sql.rpc}"`)) problems.push(`${file}: does not read its refund row through ${sql.rpc}`);
  // The chain from the RPC to the call, in order; the row is not reassigned after it is declared.
  const flat = norm(code);
  let pos = 0;
  for (const frag of sql.chain) {
    const at = flat.indexOf(frag, pos);
    if (at < 0) {
      problems.push(`${file}: the refund row's source chain no longer reads "${frag}" (after the previous link): review where the amount and card fee come from, then pin it`);
      return problems;
    }
    pos = at + frag.length;
  }
  const callAt = flat.indexOf(norm(call), pos);
  if (callAt < 0) problems.push(`${file}: the refund call does not follow its pinned source chain`);
  else {
    const between = flat.slice(pos, callAt);
    const row = sql.row.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![.\\w$])${row}(?:\\.\\w+|\\[[^\\]]*\\])?\\s*(?:[-+*/]|\\?\\?|\\|\\||&&)?=(?![=>])|\\b(?:const|let|var)\\s+${row}\\b|[{,]\\s*${row}\\s*[,}=]|Object\\.assign\\(\\s*${row}\\b`).test(between)) {
      problems.push(`${file}: ${sql.row} is reassigned or shadowed between its pinned declaration and the refund call`);
    }
  }
  const mentions = code.split("\n").filter((l) => /\brefund_cents\b/.test(l)).map(norm);
  if (JSON.stringify(mentions) !== JSON.stringify(sql.mentions)) {
    problems.push(`${file}: the lines naming refund_cents are ${JSON.stringify(mentions, null, 2)}, pinned ${JSON.stringify(sql.mentions, null, 2)}: a write to the row's refund_cents (on any alias) must be reviewed, then pinned`);
  }
  for (const [fn, n] of Object.entries(sql.calls ?? {})) {
    const count = [...code.matchAll(new RegExp(`(?<!function\\s)\\b${fn}\\(`, "g"))].length;
    if (count !== n) problems.push(`${file}: ${fn} is called ${count} times, pinned ${n}: a second caller could hand it another row`);
  }
  const defs = effectiveDefs(MIGRATIONS);
  const reader = defs.get(sql.reader);
  const readerBody = reader ? norm(blankSqlComments(reader.stmt)) : "";
  if (!/\br\.refund_cents\b/.test(readerBody) || !/FROM public\.declutter_refunds r\b/.test(readerBody)) {
    problems.push(`${sql.reader}: does not return refund_cents straight off the declutter_refunds row`);
  }
  if (sql.rpc !== sql.reader) {
    const rpcBody = norm(blankSqlComments(defs.get(sql.rpc)?.stmt ?? ""));
    if (!rpcBody.includes(`${sql.reader}(`) || /'refund_cents'/.test(rpcBody)) {
      problems.push(`${sql.rpc}: its refund answer is not built by ${sql.reader} alone`);
    }
  }
  return problems;
}

function check(file: string, at: number, call: string, kind: Exclude<Kind, "pass-through" | "sql-policy">, argExpr: string | null, defKey: string): string[] {
  const raw = readFileSync(join(ROOT, file), "utf8");
  const code = blankComments(raw);
  const problems: string[] = [];
  if (kind === "keeps-fee" || kind === "both") {
    if (!argExpr) problems.push(`${file}: ${call.slice(0, 80)} sends no amount (a full refund) but must keep the card fee`);
    else {
      if (!tracesToHelper(code, argExpr, at)) {
        problems.push(`${file}: the amount "${argExpr}" of ${call.slice(0, 60)} does not come from _shared/refundAmount.ts`);
      }
      const def = amountDefinition(code, argExpr, at);
      if (JSON.stringify(AMOUNT_DEFS[defKey]) !== JSON.stringify(def)) {
        problems.push(`${file}: the amount of ${defKey} is defined as ${JSON.stringify(def, null, 2)}, pinned as ${JSON.stringify(AMOUNT_DEFS[defKey], null, 2)}: review that it keeps the card fee, then pin it`);
      }
    }
    if (!/from\s+["'](?:\.\.\/)+_shared\/refundAmount\.ts["']/.test(code)) problems.push(`${file}: does not import _shared/refundAmount.ts`);
  }
  if (kind === "own-mistake" || kind === "both") {
    if (!hasOwnMistakeComment(raw, at)) problems.push(`${file}: ${call.slice(0, 60)} is a full refund without the "${OWN_MISTAKE_MARK}" comment`);
  }
  return problems;
}

describe("every refund keeps the card fee, except our own mistakes (owner, 2026-10-14)", () => {
  const sites = refundSites();

  it("the inventory is read from source and every site is classified, both ways", () => {
    expect(sites.length).toBeGreaterThan(8);
    const unmatched = sites.filter((s) => REFUND_SITES.filter((e) => e.file === s.file && s.call.includes(e.key)).length !== 1);
    expect(unmatched.map((s) => `${s.file}: ${s.call.slice(0, 100)}`), "classify each new refund site in REFUND_SITES").toEqual([]);
    const stale = REFUND_SITES.filter((e) => sites.filter((s) => s.file === e.file && s.call.includes(e.key)).length !== 1);
    expect(stale.map((e) => `${e.file} ${e.key}`), "stale REFUND_SITES entry: remove it").toEqual([]);
    // 5 since slice 5: the Helpr delivery fee given back on its own (owner row 40).
    expect(REFUND_SITES.filter((e) => e.kind === "own-mistake").length).toBe(5);
  });

  it("each refund either keeps the card fee through the shared helper or is a named own-mistake full refund", () => {
    const problems: string[] = [];
    for (const s of sites) {
      const entry = REFUND_SITES.find((e) => e.file === s.file && s.call.includes(e.key));
      if (!entry || entry.kind === "pass-through") continue;
      if (entry.kind === "sql-policy") {
        problems.push(...checkSqlSite(s.file, s.call, amountExpr(s.call), entry.sql));
        continue;
      }
      problems.push(...check(s.file, s.at, s.call, entry.kind, amountExpr(s.call), entry.key));
    }
    expect(problems).toEqual([]);
  });

  it("an amount decided in SQL keeps the fee for every reason but our own mistakes, read from the newest migration", () => {
    const named = [...new Set(REFUND_SITES.filter((e) => e.kind === "sql-policy").map((e) => e.sql?.decidedBy))];
    expect(named.length).toBeGreaterThan(0);
    expect(named.sort()).toEqual(Object.keys(SQL_POLICIES).sort());
    expect(Object.keys(SQL_POLICIES.declutter_record_refund.reasons).length).toBeGreaterThan(10);
    const problems = (Object.keys(SQL_POLICIES) as Array<keyof typeof SQL_POLICIES>).flatMap((n) => checkSqlPolicy(n));
    expect(problems).toEqual([]);
  });

  it("app and edge code touch the Declutter money tables and the card fee only where pinned", () => {
    const got = tsMoneyTouches();
    expect(got.length).toBeGreaterThan(3);
    expect(got, "review each new write (could it let a Declutter refund return the fee?), then pin it in TS_MONEY_TOUCHES").toEqual(TS_MONEY_TOUCHES);
  });

  it("the CASE reader reads only plain arms, and a new reason falls to the ELSE", () => {
    const c = readCase("CASE WHEN reason IN ('a', 'b') THEN 'keep' WHEN reason = 'c' THEN 'seller' ELSE 'full' END", "reason");
    expect(c && evalCase(c, ["a", "b", "c", "d"])).toEqual({ a: "keep", b: "keep", c: "seller", d: "full" });
    expect(readCase("CASE WHEN reason LIKE 'a%' THEN 'keep' ELSE 'full' END", "reason")).toBeNull();
  });

  it("AMOUNT_DEFS pins exactly the keeps-fee sites, no more", () => {
    const keys = [
      ...REFUND_SITES.filter((e) => e.kind === "keeps-fee" || e.kind === "both").map((e) => e.key),
      ...WRAPPER_CALLERS.map((c, i) => (c.kind === "keeps-fee" || c.kind === "both" ? `${WRAPPER.name}#${i}` : null)).filter(Boolean),
    ];
    expect(keys.length).toBeGreaterThan(5);
    expect(Object.keys(AMOUNT_DEFS).sort()).toEqual([...keys].sort());
  });

  it("the pass-through wrapper's callers are each classified and checked", () => {
    const raw = readFileSync(join(ROOT, WRAPPER.file), "utf8");
    const code = blankComments(raw);
    const calls = [...code.matchAll(new RegExp(`(?<!function\\s)\\b${WRAPPER.name}\\(`, "g"))];
    expect(calls.length, "classify each createRefundOnce caller in WRAPPER_CALLERS").toBe(WRAPPER_CALLERS.length);
    const problems: string[] = [];
    calls.forEach((m, i) => {
      const at = m.index ?? 0;
      const call = callText(code, at + m[0].length - 1);
      const params = call.match(/^\(\s*stripe\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null;
      // The amount on the params object: its own nearest `amount:` / `.amount =`.
      const before = code.slice(0, at);
      const objAssign = [...before.matchAll(new RegExp(`\\b${params}\\s*=\\s*\\{[^;]*?\\bamount:\\s*([^,}\\n]+)`, "g"))].pop();
      const propAssign = [...before.matchAll(new RegExp(`\\b${params}\\.amount\\s*=\\s*([^;\\n]+)`, "g"))].pop();
      const pick = [objAssign, propAssign].filter(Boolean).sort((a, b) => (b!.index ?? 0) - (a!.index ?? 0))[0];
      problems.push(...check(WRAPPER.file, at, `${WRAPPER.name}${call}`, WRAPPER_CALLERS[i].kind, pick ? pick[1].trim() : null, `${WRAPPER.name}#${i}`));
    });
    // The wrapper's own fee path: refundLessStripeFeeCents computes through the shared helper.
    const body = code.slice(code.indexOf("async function refundLessStripeFeeCents("));
    expect(body.slice(0, body.indexOf("\n}\n")).includes("refundToPayerCents(")).toBe(true);
    expect(problems).toEqual([]);
  });
});
