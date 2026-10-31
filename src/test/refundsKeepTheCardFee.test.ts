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
 *   helpr-fault  Q2082 (b), owner 2026-10-18 ("J4"): an admin ruled the Helpr
 *                at fault, so the poster gets the card fee back too and it
 *                becomes the Helpr's debt. The amount is pinned like keeps-fee
 *                (zero card fee through the shared helper; owner 2026-10-18
 *                ~22:30Z: a first job's $2 setup fee is still KEPT, and when
 *                the Helpr's account is gone the ordinary fee-keeping
 *                generalSplit applies, since nobody can be billed),
 *                the ruling RPC (admin_rule_helpr_fault) must run BEFORE the
 *                call and the Helpr billing RPC (bill_helpr_fault_card_fee)
 *                AFTER it, in the same file: a full refund with no ruling, or
 *                one that never bills the Helpr, is the platform absorbing the
 *                fee.
 * @mutate supabase/functions/create-payment/index.ts |   const { data: billed, error: billErr } = await supabaseAdmin.rpc("bill_helpr_fault_card_fee", { |   const { data: billed, error: billErr } = await supabaseAdmin.rpc("noop", {
 * @mutate supabase/functions/create-payment/index.ts |   const { error: ruleErr } = await asAdmin.rpc("admin_rule_helpr_fault", { |   const { error: ruleErr } = await asAdmin.rpc("noop", {
 * @mutate supabase/functions/create-payment/index.ts |         disputeHelprFaultBill = await billHelprFaultCardFee( |         disputeHelprFaultBill = await Promise.resolve(
 * @mutate supabase/functions/create-payment/index.ts |         const ruled = await ruleHelprFaultFirst(authHeader, supabaseAdmin, jobId, disputeHelprFault); |         const ruled = { gone: false };
 * @mutate supabase/functions/create-payment/index.ts | setupFeeCents: setupFeeKeptCents(job), // the $2 stays on a disputed Helpr fault too | setupFeeCents: 0, // the $2 stays on a disputed Helpr fault too
 * @mutate supabase/functions/create-payment/index.ts |             amount: split.refundCents, |             amount: helprFaultSplit.refundCents + 1,
 * @mutate supabase/functions/create-payment/index.ts | setupFeeCents: setupFeeKeptCents(job), // the $2 stays on a Helpr fault too | setupFeeCents: 0, // the $2 stays on a Helpr fault too
 * @mutate supabase/functions/create-payment/index.ts | const split = helprFault && !helprFaultGone ? helprFaultSplit : generalSplit; | const split = helprFault ? helprFaultSplit : generalSplit;
 *
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             ...(isPartial ? { amount: requestedCents } : {}),
 * @mutate supabase/functions/create-payment/index.ts |             amount: generalSplit.refundCents, |             amount: capturedCents - generalSplit.setupKeptCents,
 * @mutate supabase/functions/create-payment/index.ts |           const refundAmount = cancelSplit.refundCents; |           const refundAmount = capturedCents - cancelSplit.setupKeptCents;
 * @mutate supabase/functions/execute-dispute-split/index.ts | refundableCents = posterBase.ceilingCents | refundableCents = capturedCents - posterBase.setupKeptCents
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const owedCents = unfilledCents - flatCardFeeKeptCents + feeReturnCents + taxReturnCents; | const owedCents = unfilledCents - flatCardFeeKeptCents + feeProRataCents + taxReturnCents;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       const feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: feeHoldsCardFee ? crewStripeFeeCents : 0, proRataCents: feeProRataCents }); |       const feeReturnCents = feeProRataCents;
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |         // own-mistake full refund (owner, 2026-10-14): we charged the one-time |         // we charged the one-time
 * @mutate supabase/functions/_shared/cardHold.ts |   // own-mistake full refund (owner, 2026-10-14): the card was charged for a job |   // the card was charged for a job
 * Q2082 (a), delta review of 2e397597d #1: a poster-fee visit's taxed fee line stays inside the tax base.
 * @mutate supabase/functions/charge-recurring-visits/index.ts | budgetCents + (posterFeeSeries ? feeCents : 0) + taxCents); | budgetCents + taxCents);
 * The three charge-recurring-visits own-mistake branches (owner pop-up, 2026-10-14 ~3 PM CT, confirmed each):
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): this run charged | // this run charged
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14), as Q415 (e): the visit | // as Q415 (e): the visit
 * @mutate supabase/functions/charge-recurring-visits/index.ts | // own-mistake full refund (owner, 2026-10-14): everything goes back. | // everything goes back.
 * @mutate supabase/functions/charge-recurring-visits/index.ts |   const refundCents = Number.isFinite(captured)\n    ? refundToPayerCents({ capturedCents: captured, actualFeeCents: actualOrEstimatedFeeCents(pi, captured), taxCents: chargeTaxCents(pi, knownTaxCents), taxBaseCents: knownTaxBaseCents }).refundCents |   const refundCents = Number.isFinite(captured)\n    ? captured
 * The Declutter sql-policy sites (2026-10-15): (a) a no-fault reason moved to a full refund, in the function and
 * in the table CHECK; the keep-card-fee amount refunding the fee; (b) a new reason added unclassified; the sites
 * sending something other than the row's refund_cents.
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql | WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee' | WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'refund_request_full') THEN 'keep_card_fee'
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql | WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee' | WHEN reason IN ('buyer_no_show') THEN 'keep_buyer_fee'
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql | WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents | WHEN fee_policy = 'keep_card_fee' THEN paid_cents
 * @mutate supabase/migrations/20261026155251_declutter_refund_requests.sql |     'refund_request_full', 'refund_request_part'));   -- 141d |     'refund_request_full', 'refund_request_part', 'buyer_changed_mind'));   -- 141d
 * @mutate supabase/functions/declutter-money/index.ts |           amount: r.refund_cents, |           amount: r.refund_cents + r.attempts,
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |         amount: refund.refund_cents, |         payment_intent: paymentIntentId,
 * lh-money-escrow review of ecf5c93a0 (request-changes): each of its green mutations, now red. Function bodies
 * (M1 fee zeroed for one reason, M8 kept fee shrunk, M4 a caller passing no fee, M9 a caller recording our-mistake,
 * M5 the fee estimate, note 1 the reader projection); table statements (M2 an UPDATE, M6 a trigger, an order
 * card-fee UPDATE); the site (M3 the fee handed to the SQL, M12 a second amount spread in).
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql |     v_fee := least(v_fee, p_paid_cents - 1); |     v_fee := least(v_fee, p_paid_cents - 1);\n    IF p_reason = 'admin_no_fault' THEN v_fee := 0; END IF;
 * @mutate supabase/migrations/20261031105148_declutter_refund_debt_notice_names_the_item.sql |     v_kept := v_order.premium_cents; |     v_kept := v_order.premium_cents;\n    v_kept := 1;
 * @mutate supabase/migrations/20261027170717_declutter_free_section.sql |   v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, o.card_fee_cents); |   v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents - v_reserved, 0);
 * @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql | 'duplicate_payment', p_amount_cents, p_card_fee_cents)); | 'order_closed', p_amount_cents, 0));
 * @mutate supabase/migrations/20261014224914_declutter_slice3b_payments.sql | round(greatest(p_amount_cents, 0) * 0.029)::integer + 30 | 0
 * @mutate supabase/migrations/20261019070737_payout_waits_for_payee_setup.sql | r.stripe_payment_intent_id, r.refund_cents, r.attempts, | r.stripe_payment_intent_id, r.paid_cents, r.attempts,
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | UPDATE public.declutter_refunds SET card_fee_cents = 0, refund_cents = paid_cents WHERE fee_policy = 'keep_card_fee';\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | CREATE TRIGGER trg_zero_fee BEFORE INSERT ON public.declutter_refunds FOR EACH ROW EXECUTE FUNCTION public.declutter_zero_fee();\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/migrations/20261015042253_declutter_slice4_handover_payout.sql | ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean; | UPDATE public.declutter_orders SET card_fee_cents = 0;\nALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |       p_paid_at: paidAt,\n      p_card_fee_cents: fee, |       p_paid_at: paidAt,\n      p_card_fee_cents: 0,
 * @mutate supabase/functions/declutter-money/index.ts |           amount: r.refund_cents, |           amount: r.refund_cents,\n          ...({ amount: 0 }),
 * Re-review of a701ff757 (N-F the fee's source, N-H / N-G the row changed before the chain ends, N-J an edge write):
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |     const bt = typeof charge === "object" && charge ? charge.balance_transaction : null; |     const bt = { fee: 0 } as { fee: number };
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   const answer = data as MarkPaidAnswer \| null; |   const answer = data as MarkPaidAnswer \| null;\n  if (answer && answer.result === "refund") (answer as { refund_cents: number }).refund_cents = amount;
 * @mutate supabase/functions/declutter-money/index.ts |   for (const r of refunds) { |   refunds.forEach((x) => { (x as { refund_cents: number }).refund_cents += 100; });\n  for (const r of refunds) {
 * @mutate supabase/functions/declutter-money/index.ts |   for (const r of refunds) { |   await admin.from("declutter_orders").update({ status: "paid" }).eq("id", "x");\n  for (const r of refunds) {
 * Shops (lead, shops-m3 run 3: the same reader for every family whose amount SQL decides):
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'keep_card_fee' |     WHEN p_reason IN ('buyer_cancelled', 'problem_no_fault') THEN 'full_platform_absorbs'
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     WHEN p_reason = 'problem_our_mistake' THEN 'full_platform_absorbs' |     WHEN p_reason IN ('problem_our_mistake', 'shop_removed') THEN 'full_platform_absorbs'
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |   CONSTRAINT shop_refunds_policy CHECK (fee_policy = public.shop_refund_fee_policy(reason)), |   CONSTRAINT shop_refunds_policy CHECK (fee_policy IN ('keep_card_fee', 'full_shop_pays_fee', 'full_platform_absorbs')),
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     SELECT o.*, CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept FROM o |     SELECT o.*, 0 AS kept FROM o
 * @mutate supabase/migrations/20261019071055_shops_refunds_cancels_strikes.sql |     'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed', |     'buyer_cancelled', 'shop_cancelled', 'no_ready_photo', 'shop_removed', 'goodwill',
 * @mutate supabase/functions/_shared/shopRefunds.ts |           amount: row.refund_cents, |           amount: row.refund_cents + 30,
 * @mutate supabase/functions/declutter-money/index.ts |         const done = await sendShopRefund(stripe, admin, r); |         r.refund_cents = r.refund_cents + 30;\n        const done = await sendShopRefund(stripe, admin, r);
 * @mutate supabase/functions/shop-checkout/index.ts |     const outcome = await sendShopRefund(await stripeForOrder(admin, o, "refund"), admin, row); |     const outcome = await sendShopRefund(await stripeForOrder(admin, o, "refund"), admin, { ...row, refund_cents: row.refund_cents + 30 });
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
// withheldFeeReturnCents (Q1915): a released withheld fee plus its kept tax, never the card fee.
const HELPERS = ["refundToPayerCents(", "crewFeeShareReturnCents(", "refundLessStripeFeeCents(", "withheldFeeReturnCents(", "posterCancelSplit("];
const OWN_MISTAKE_MARK = "own-mistake full refund (owner, 2026-10-14)";

type Kind = "keeps-fee" | "own-mistake" | "both" | "pass-through" | "sql-policy" | "helpr-fault";

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
  /** The refund table the reader returns refund_cents from (default declutter_refunds). */
  table?: string;
  /**
   * A site in a SHARED sender that takes its row as a parameter (Shops: _shared/shopRefunds.ts sendShopRefund):
   * the row is read in each caller instead. Each feeder reads it through `rpc` (whose body returns refund_cents
   * straight off `table`), declares it by the pinned `chain`, and hands it on unchanged by `call`, called exactly
   * `calls` times in that file. The site's own `chain` then starts at the parameter.
   */
  feeders?: Array<{ file: string; rpc: string; row: string; chain: string[]; call: string; calls: Record<string, number> }>;
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
  { file: "supabase/functions/create-payment/index.ts", key: "refund-helpr-fault-", kind: "helpr-fault", why: "admin ruled the Helpr at fault: the card fee back (billed to the Helpr), a first job's $2 kept (Q2082 (b))" },
  { file: "supabase/functions/create-payment/index.ts", key: "helpr-fault-dispute-refund-", kind: "helpr-fault", why: "the same ruling from the dispute tools (Quick Refund of a disputed no-show / backout, Q2082 (b))" },
  { file: "supabase/functions/execute-dispute-split/index.ts", key: "poster_share", kind: "keeps-fee", why: "the poster's leg of a dispute split" },
  // A10 (owner, 2026-10-17): a Declutter setup job cancelled because the seller backed out comes back in full
  // (card fee included, the seller owes it); every other cancellation keeps the fee.
  { file: "supabase/functions/void-cancelled-payments/index.ts", key: "cancel-refund-", kind: "both", why: "cancelled job settlement; full for a seller-fault Declutter setup job (A10)" },
  // Q1915 (owner 2026-10-21): a deleted crew member's late-cancel share, withheld when the job settled, goes back to
  // the person who posted it (plus the sales tax the cancel refund kept on it). The card fee stays kept.
  { file: "supabase/functions/void-cancelled-payments/index.ts", key: "crew-share-returned-", kind: "keeps-fee", why: "a deleted crew member's withheld fee share back to the person who posted the job (Q1915)" },
  { file: "supabase/functions/process-scheduled-payouts/index.ts", key: "crew-dispute-refund-", kind: "keeps-fee", why: "crew unfilled spots / crew dispute" },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "refunds.create(params, opts)", kind: "pass-through", why: "createRefundOnce: callers checked below" },
  {
    // Shops M3 (20261019071055): the shared sender sends exactly a shop_refunds row's refund_cents. The amount is
    // decided in SQL (shop_refund_amounts by reason, held by the shop_refunds CHECKs); the row comes from
    // shop-checkout's tap (shop_refund_to_send) and declutter-money's retry (shop_refunds_due).
    file: "supabase/functions/_shared/shopRefunds.ts", key: "payment_intent: row.payment_intent_id", kind: "sql-policy",
    why: "Shops refund row, sent by the tap or the retry",
    sql: {
      decidedBy: "shop_refund_amounts", rpc: "shop_refunds_due", reader: "shop_refunds_due", table: "shop_refunds",
      amount: "row.refund_cents", row: "row",
      chain: ["export async function sendShopRefund(stripe: Stripe, admin: Db, row: ShopRefundRow): Promise<ShopRefundOutcome> {"],
      feeders: [
        {
          file: "supabase/functions/shop-checkout/index.ts", rpc: "shop_refund_to_send", row: "row",
          chain: [
            "const { data, error } = await admin.rpc(\"shop_refund_to_send\", { p_refund_id: refundId });",
            "const row = ((data ?? []) as ShopRefundRow[])[0];",
          ],
          call: "sendShopRefund(await stripeForOrder(admin, o, \"refund\"), admin, row)", calls: { sendShopRefund: 1 },
        },
        {
          file: "supabase/functions/declutter-money/index.ts", rpc: "shop_refunds_due", row: "r",
          chain: [
            "const dueRefunds = await admin.rpc(\"shop_refunds_due\", { p_limit: BATCH });",
            "for (const r of (dueRefunds.data ?? []) as ShopRefundRow[]) {",
          ],
          call: "sendShopRefund(stripe, admin, r)", calls: { sendShopRefund: 1 },
        },
      ],
      mentions: [
        "refund_cents: number;",
        "if (!Number.isInteger(row.refund_cents) || row.refund_cents <= 0) {",
        "amount: row.refund_cents,",
        "fields: { Refund: row.refund_id, Order: row.order_id, Cents: String(row.refund_cents) },",
      ],
    },
  },
  { file: "supabase/functions/charge-recurring-visits/index.ts", key: "visitRefundKey(stripe, intent.id)", kind: "own-mistake", why: "a second charge for one visit (our double charge; owner pop-up 2026-10-14 ~3 PM CT)" },
  { file: "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts", key: "ONBOARDING_FEE_CENTS", kind: "own-mistake", why: "the $2 setup fee charged twice" },
  // Q2352 (owner 2026-10-22, terms #9: charged ONCE per account): a Declutter order that carried the setup fee
  // after the account had paid it elsewhere first sends exactly that fee back (declutter_claim_setup_fee: refund_due).
  { file: "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts", key: "payment_intent: feeIntentId", kind: "own-mistake", why: "the $2 setup fee charged a second time on a Declutter order (Q2352)" },
  { file: "supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts", key: "duplicate-funding-refund:", kind: "own-mistake", why: "a second payment for an already-funded job" },
  { file: "supabase/functions/_shared/cardHold.ts", key: "card-hold-nobody-refund-", kind: "own-mistake", why: "Q2399: a held card captured for a job that closed with nobody hired (a capture racing the close); the hold model charges only at a hire" },
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
        // Payout readiness: the eight skipRow lines pass refund_cents to noteWaiting for the wait record and the ops
        // page (an amount shown, never sent); skipRow defers the row and moves no money.
        "refund_cents: number;",
        "refund_cents: number;",
        // Q1929: the raise-refund row's type (its own charge, step 4b; never a declutter_refunds row).
        "refund_cents: number;",
        "await skipRow(\"declutter_refund\", r.refund_id, r.buyer_id, r.refund_cents, 60, \"ban_review\", \"a party is under ban review\");",
        "await skipRow(\"declutter_refund\", r.refund_id, r.buyer_id, r.refund_cents, 1440, \"data_defect\", \"no order and no recorded Stripe mode\");",
        "amount: r.refund_cents,",
        "await skipRow(\"declutter_refund\", r.refund_id, r.buyer_id, r.refund_cents, 15, \"record_failed\", `refund ${refund.id} not recorded`);",
        "message: `Stripe answered ${refund.status} for refund row ${r.refund_id} (${dollars(r.refund_cents)}, order ${r.order_id ?? \"none\"}). ${r.attempts + 1 >= 12 ? \"That was the last try: refund it by hand.\" : \"It will be retried with back-off.\"}`,",
        "await tellBuyerRefunded(admin, r.buyer_id, r.refund_cents);",
        "await skipRow(\"declutter_refund\", r.refund_id, r.buyer_id, r.refund_cents, 1440, \"mixed_parties\", partyWhy(e, \"the order\"));",
        "await skipRow(\"delivery_refund\", d.delivery_refund_id, d.buyer_id, d.refund_cents, 60, \"ban_review\", \"a party is under ban review\");",
        "payment_intent_id: d.payment_intent_id, refund_cents: d.refund_cents, attempts: d.attempts, livemode: null,",
        "await skipRow(\"delivery_refund\", d.delivery_refund_id, d.buyer_id, d.refund_cents, 1440, \"data_defect\", \"no Stripe mode\");",
        "amount: d.refund_cents,",
        "await skipRow(\"delivery_refund\", d.delivery_refund_id, d.buyer_id, d.refund_cents, 15, \"record_failed\", `refund ${dRefund.id} not recorded`);",
        "message: `Stripe answered ${dRefund.status} for delivery refund ${d.delivery_refund_id} (${dollars(d.refund_cents)}, order ${d.order_id}). ${d.attempts + 1 >= 12 ? \"That was the last try: refund it by hand.\" : \"It will be retried with back-off.\"}`,",
        "await tellBuyerRefunded(admin, d.buyer_id, d.refund_cents);",
        "await skipRow(\"delivery_refund\", d.delivery_refund_id, d.buyer_id, d.refund_cents, 1440, \"mixed_parties\", partyWhy(e, \"the order\"));",
        // Q1929, step 4b: a raise refund's page text, the mode resolver's input, the amount it sends (the raise row's
        // refund_cents, decided in SQL) and the buyer's email. None writes a refund_cents.
        "`Raise ${x.raise_id} (${dollars(x.refund_cents)} to the buyer of order ${x.order_id}, payment ${x.payment_intent_id}) was not refunded: ${stuck}. Refund it by hand in Stripe; the refund settles the raise.`);",
        "payment_intent_id: x.payment_intent_id, refund_cents: x.refund_cents, attempts: x.attempts, livemode: x.livemode,",
        "amount: x.refund_cents,",
        "message: `Stripe answered ${xRefund.status} for raise refund ${x.raise_id} (${dollars(x.refund_cents)}, order ${x.order_id}). ${x.attempts + 1 >= 12 ? \"That was the last try: refund it by hand.\" : \"It will be retried with back-off.\"}`,",
        "await tellBuyerRefunded(admin, x.buyer_id, x.refund_cents);",
      ],
    },
  },
  // Slice 5 (owner row 40, 2026-10-14): no Helpr took the delivery in 48 h, or an admin paid the seller on a
  // delivery that never happened: the DELIVERY FEE alone goes back in full (the buyer did nothing wrong; the
  // service we sold did not happen). Amount = declutter_delivery_refunds.refund_cents = the order's frozen
  // delivery_cents (declutter_delivery_refund, 20261017055505).
  { file: "supabase/functions/declutter-money/index.ts", key: "payment_intent: d.payment_intent_id", kind: "own-mistake", why: "Helpr delivery fee back: no Helpr in 48 h (row 40) or the delivery never happened" },
  // Q1929 (owner 2026-10-21: build the raise): a delivery-pay RAISE is its own charge. It goes back in full when
  // the delivery we sold did not happen (no Helpr, damage, a cancel that was not the buyer's) or our system took a
  // payment it could not use (the delivery stopped waiting, a replaced page, a wrong amount). A sale cancelled for
  // the buyer's own reason keeps the raise's card fee: decided in SQL (declutter_delivery_raises_on_task_close,
  // CHECK declutter_delivery_raises_refund_amount, 20261021185418; proven by declutterDeliveryRaise.pglite.mjs).
  { file: "supabase/functions/declutter-money/index.ts", key: "payment_intent: x.payment_intent_id", kind: "own-mistake", why: "delivery-pay raise back on its own charge: the delivery never had a Helpr, or a payment we could not use (Q1929)" },
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
        // Q2307: an order a party has left is refunded by declutter_refund_party_gone (order_closed, the platform carries
        // the fee), any other order is decided by declutter_mark_order_paid; both answer through declutter_refund_answer.
        "const { data, error } = partyGone ? await supabase.rpc(\"declutter_refund_party_gone\", { p_order_id: orderId, p_payment_intent_id: paymentIntentId, p_amount_cents: amount, p_card_fee_cents: fee, }) : await supabase.rpc(\"declutter_mark_order_paid\", { p_order_id: orderId, p_payment_intent_id: paymentIntentId, p_amount_cents: amount, p_paid_at: paidAt, p_card_fee_cents: fee, });",
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
  // Shops M4: the admin Shops orders screen's row TYPE names the order's recorded card fee (shown, never written).
  "src/components/admin/AdminShopsOrders.tsx: card_fee_cents: number | null; handover_mode: string; problem_at: string; problem_note: string; ready_at: string | null; is_seed: boolean;",
  // Q2170: the admin "Bill the Helpr" button READS whether the ruling is billed yet (no write; the bill is server-side).
  'src/components/admin/helprFault/BillHelprFaultButton.tsx: .select("card_fee_cents")',
  "src/components/admin/helprFault/BillHelprFaultButton.tsx: if (live) setUnbilled({ jobId, value: !error && !!data && data.card_fee_cents == null });",
  // Q1929: the buyer's raise panel row TYPE names each raise's card fee (shown, never written).
  "src/lib/declutter/deliveryRaise.ts: card_fee_cents: number;",
  // BUY-2: the buyer's no-Helpr choice row TYPE names the card fee declutter_no_helpr_choice reports (read only, never written;
  // members see only "You get $X back", membersSeeNoFeeWords).
  "src/lib/declutter/noHelpr.ts: card_fee_cents: number;",
  // Declutter reviews (Builder 3c s3): READS the order's two parties to name who is being reviewed; no money column, no write.
  'src/lib/declutter/reviews.ts: .from("declutter_orders").select("buyer_id, seller_id").eq("id", orderId).maybeSingle(), ) as { buyer_id: string | null',
  // Board 177 Receipts: READS the buyer's own paid orders (total and date) to list what left their card; no fee column, no write.
  // DB-13 (audit 2026-10-30): also the order's item, delivery, shipping and tax amounts for the receipt's lines; still no fee column.
  'src/pages/profile/Receipts.tsx: .from("declutter_orders") .select("id, status, total_cents, paid_at, items_cents, delivery_cents, shipping_cents, tax_cents") .eq("buyer_id", uid!) .not("paid_at", "is", null), ) ?? []) as PaidOrderRow[], })',
  // Q2171 (b94-fee-debt-blocks-delete): the .or() filter findFeeDebtOwed READS job_helpr_fault_rulings with (select id) to block
  // self-delete while a fault ruling's card fee is unpriced or unpaid; no write, refund or fee change.
  'supabase/functions/_shared/accountPurge.ts: export const FEE_DEBT_RULING_FILTER = "card_fee_cents.is.null,card_fee_remaining_cents.gt.0";',
  // Shops M1: the card fee Stripe kept at capture, recorded on the order (no refund here).
  'supabase/functions/_shared/shopHolds.ts: const { error } = await admin.rpc("shop_order_captured", { p_order_id: orderId, p_card_fee_cents: fee });',
  // Q2170: admin_bill_helpr_fault READS the ruling's card fee (already billed?) and audits what it billed; the
  // only write is bill_helpr_fault_card_fee below (once per ruling), never a card_fee_cents update.
  'supabase/functions/create-payment/index.ts: .from("job_helpr_fault_rulings").select("helper_id, card_fee_cents").eq("job_id", jobId).maybeSingle();',
  "supabase/functions/create-payment/index.ts: if (ruling.card_fee_cents != null) {",
  "supabase/functions/create-payment/index.ts: return reply({ success: true, alreadyBilled: true, helprFault: { cardFeeBilledCents: ruling.card_fee_cents, billFailed: false, helprGone } }, 200);",
  "supabase/functions/create-payment/index.ts: details: { helper_id: ruling.helper_id, stripe_refund_id: faultRefund.id, card_fee_cents: cardFeeCents, card_fee_billed_cents: bill.billedCents, bill_failed: bill.failed },",
  // Q2082 (b): the card fee a Helpr at fault is billed (bill_helpr_fault_card_fee), and its page if that fails.
  'supabase/functions/create-payment/index.ts: p_card_fee_cents: Math.max(0, Math.round(cardFeeCents ?? 0)),',
  'supabase/functions/create-payment/index.ts: fields: { job_id: jobId, helper_id: helperId, card_fee_cents: String(cardFeeCents ?? "") },',
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders") .select("id, handover, stripe_checkout_session_id, delivery_cents, bundle_discount_cents") .eq("buyer_id", user.id).eq("seller_id", sellerId).eq("status", "awaiting_payment").maybeSingle()',
  // Q2352: READS the setup fee the order froze, to put it on its own Stripe line; no refund, no write.
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders").select("setup_fee_cents") .eq("id", order.order_id).maybeSingle()',
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders").select("stripe_checkout_session_id, status") .eq("id", order.order_id).maybeSingle()',
  // Q1929 raise_pay: the raise row's card fee (decided by declutter_delivery_raise_start in SQL) is checked to add up
  // and sent with the raise as ONE Stripe line the BUYER pays (raise_cents + card_fee_cents = total_cents, checked
  // above; issue #3672, members never see a fee line); the order is READ for its two parties. No refund, no write.
  "supabase/functions/declutter-checkout/index.ts: type RaiseRow = { raise_id: string; raise_cents: number; card_fee_cents: number; total_cents: number; superseded_session_id: string | null };",
  'supabase/functions/declutter-checkout/index.ts: .from("declutter_orders") .select("buyer_id, seller_id").eq("id", orderId).maybeSingle()',
  "supabase/functions/declutter-checkout/index.ts: if (!raise?.raise_id || raise.raise_cents !== raiseCents || raise.raise_cents + raise.card_fee_cents !== raise.total_cents) {",
  'supabase/functions/declutter-checkout/index.ts: { quantity: 1, price_data: { currency: "usd", unit_amount: raise.raise_cents + raise.card_fee_cents,',
  // Q1929 settleRaise: READS the order's buyer to check the raise page's payer. No money column, no write.
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders").select("buyer_id").eq("id", meta.order_id).maybeSingle()',
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders").select("buyer_id, seller_id, handover, items_cents, delivery_cents").eq("id", orderId).maybeSingle()',
  // Q2307: the same Stripe fee handed to declutter_refund_party_gone (an order a party has left), then to mark_order_paid.
  "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: p_card_fee_cents: fee,",
  "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: p_card_fee_cents: fee,",
  // Q2352 rebase reviews: the receipt reads whether the claim won (read only); a hand refund of exactly a fee owed
  // back is found (read only) and recorded through declutter_setup_fee_refunded, never as a refund of the sale.
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders").select("setup_fee_state").eq("id", orderId).maybeSingle()',
  // Q2352: reads the setup fee owed back (state refund_due); writes nothing, the refund is recorded by RPC.
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders") .select("setup_fee_cents, setup_fee_state, stripe_payment_intent_id").eq("id", orderId).maybeSingle()',
  'supabase/functions/stripe-webhook/handlers/declutterCheckout.ts: .from("declutter_orders") .select("id, setup_fee_cents").eq("stripe_payment_intent_id", paymentIntentId).eq("setup_fee_state", "refund_due").maybeSingle()',
  // A10: the card fee Stripe kept on a seller-fault setup job's charge, billed to the seller after the full refund.
  "supabase/functions/void-cancelled-payments/index.ts: p_card_fee_cents: cardFeeCents,",
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
/**
 * One refund family whose amount SQL decides (Declutter, Shops): read the same way for each, so "we never absorb a
 * fee" is machine-checked per family, not per copy of a reader (lead, shops-m3 run 3).
 */
interface SqlPolicy {
  /** The migration holding the NEWEST definition of the decider, every policy source and the reason CHECK. */
  migration: string;
  /** When the decider FUNCTION was restated later than the constraints (a notice-only change), its newest file. The
   * function's policy CASE is still read and must equal the pinned map; the constraints stay pinned to `migration`. */
  functionMigration?: string;
  proofs: string[];
  /** The table CHECK listing the reasons a refund row may carry: exactly the classified reasons. */
  reasonCheck: string;
  /** Every place the reason -> fee policy map is decided, each read as a plain CASE (subject IN (...) THEN '...'). */
  policySources: Array<{ where: string; kind: "constraint" | "function"; name: string; pattern: RegExp; subject: string }>;
  reasons: Record<string, string>;
  /** Our own mistakes, the only reasons the platform refunds the fee on (owner, 2026-10-14). EXACT. */
  ownMistakes: string[];
  constraints: Array<{ name: string; file: string; text: string }>;
  /** Which SQL functions decide, feed or can change this family's refund amount (all pinned in `functions`). */
  touches: (text: string) => boolean;
  /** A trigger on this table runs a function that is pinned too. */
  triggerTable: string;
  /** Tables whose top-level statements are pinned in `statements` (only: just those naming it). */
  pinnedTables: Array<{ table: string; only?: RegExp }>;
  functions: Record<string, string>;
  statements: Record<string, string[]>;
  /** Fragments (whitespace-collapsed, comments blanked) each named function's newest body must contain. */
  bodies: Record<string, string[]>;
}

const SQL_POLICIES: Record<"declutter_record_refund" | "shop_refund_amounts", SqlPolicy> = {
  declutter_record_refund: {
    // Board 141, Declutter side (20261026155251_declutter_refund_requests.sql): the reason list, the reason -> policy CHECK and
    // declutter_record_refund restated with two reasons; nothing else in them changed.
    migration: "20261026155251_declutter_refund_requests.sql",
    // D2-6 (20261029232103, lh-money-escrow approve 2026-10-29): declutter_record_refund restated with a seller notice
    // only; its v_policy CASE is read again below and must still equal the pinned map.
    // BUY-30 (20261031105148): restated verbatim again; only that notice's words (it names the item) and link change.
    functionMigration: "20261031105148_declutter_refund_debt_notice_names_the_item.sql",
    proofs: ["src/test/pglite/declutterSlice3b.pglite.mjs", "src/test/pglite/declutterSlice4.pglite.mjs", "src/test/pglite/declutterDelivery.pglite.mjs",
      "src/test/pglite/declutterSellerOutPaysFee.pglite.mjs", "src/test/pglite/declutterRefundRequests.pglite.mjs"],
    reasonCheck: "declutter_refunds_reason_check",
    policySources: [
      { where: "declutter_refunds_policy", kind: "constraint", name: "declutter_refunds_policy", pattern: /^fee_policy\s*=\s*(CASE\b.*\bEND)$/i, subject: "reason" },
      { where: "declutter_record_refund v_policy", kind: "function", name: "declutter_record_refund", pattern: /v_policy\s*:=\s*(CASE\b.*?\bEND)\s*;/i, subject: "p_reason" },
    ],
    reasons: {
      superseded: "full_platform_absorbs",
      order_closed: "full_platform_absorbs",
      amount_mismatch: "full_platform_absorbs",
      duplicate_payment: "full_platform_absorbs",
      order_missing: "full_platform_absorbs",
      sold_elsewhere: "full_platform_absorbs",
      seller_backed_out: "full_seller_pays_fee",
      // Owner answer 7 (2026-10-17): the buyer paid as the seller could no longer sell (20261017060455).
      seller_out: "full_seller_pays_fee",
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
      // Board 141, Declutter side (owner 2026-10-22 #3): the seller refunds in full after the handover =
      // everything back EXCEPT the card fee (the buyer's fee included).
      refund_request_full: "keep_card_fee",
      // Owner 2026-10-21: a part refund is EXACTLY the amount the seller offered, below the item price, out of the
      // seller's payout. No card fee is refunded or kept on it (CHECK: card_fee_cents = 0, refund < paid); the
      // platform keeps the buyer's fee, which covers the card fee on the payment (B48).
      refund_request_part: "agreed_part",
    } as Record<string, "full_platform_absorbs" | "full_seller_pays_fee" | "keep_card_fee" | "keep_buyer_fee" | "agreed_part">,
    /** Our own mistakes, the only reasons the platform refunds the fee on (owner, 2026-10-14). EXACT. */
    ownMistakes: ["superseded", "order_closed", "amount_mismatch", "duplicate_payment", "order_missing", "sold_elsewhere",
      // Row 43: the platform absorbs damage in a delivery it arranged (owner decision, not a guess).
      "delivery_damage"],
    constraints: [
      {
        name: "declutter_refunds_fee_policy_check",
        file: "20261026155251_declutter_refund_requests.sql",
        text: "fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee', 'keep_buyer_fee', 'agreed_part')",
      },
      {
        name: "declutter_refunds_amount",
        file: "20261026155251_declutter_refund_requests.sql",
        text: "refund_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents WHEN fee_policy = 'agreed_part' THEN refund_cents ELSE paid_cents END AND refund_cents > 0 AND kept_cents >= 0 AND (fee_policy = 'keep_buyer_fee' OR kept_cents = 0) AND (fee_policy <> 'keep_buyer_fee' OR kept_cents > 0) AND (fee_policy <> 'agreed_part' OR (refund_cents < paid_cents AND card_fee_cents = 0))",
      },
      // The buyer's fee keep_buyer_fee keeps (F1: 5% + 70c, at least 70c). Shipping S1 (2026-10-20,
      // reviewed: still keeps the fee): f1/premium15 pinned to shipping = 0, and f1_ship = 5% of
      // (items + shipping) + 70c, so a shipped order's kept fee also covers its card fee.
      // Seller delivery (20261027153244, reviewed 2026-10-27 by lh-money-escrow: still keeps the fee): f1_seller_delivery
      // = 5% of (items + the seller's rate) + 70c, so its kept fee covers the card fee on the rate too; a FREE delivery
      // (rate 0) is the plain f1 fee on the items.
      // Q2419 the Free section (20261027170717, reviewed 2026-10-27: still keeps the fee): one arm added, fee_rule
      // 'free' with premium 0, which declutter_orders_free ties to paid_with 'free' AND every amount 0 AND no Stripe
      // payment, so a free order has nothing a refund could return; every card arm is unchanged.
      {
        name: "declutter_orders_premium_rule",
        file: "20261027170717_declutter_free_section.sql",
        text: "(fee_rule = 'f1' AND shipping_cents = 0 AND premium_cents = round(items_cents * 0.05)::integer + 70) OR (fee_rule = 'f1_ship' AND shipping_cents > 0 AND premium_cents = round((items_cents + shipping_cents) * 0.05)::integer + 70) OR (fee_rule = 'f1_seller_delivery' AND shipping_cents = 0 AND handover = 'seller_delivery' AND premium_cents = round((items_cents + delivery_cents) * 0.05)::integer + 70) OR (fee_rule = 'free' AND premium_cents = 0) OR (fee_rule = 'premium15' AND shipping_cents = 0 AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100))",
      },
      { name: "declutter_orders_premium_cents_check", file: "20261027170717_declutter_free_section.sql", text: "premium_cents >= 70 OR paid_with = 'free'" },
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
      // A2-14 (20261028223738): only the "Louisiana Helpr decided" notices added; the refund it records is unchanged.
      // 20261028232338: only the buyer's "Enjoy your item" is not sent on this path; the refund it records is unchanged.
      // 20261031184929 (AUD31-34): only the Helpr's and the buyer's notice words name the item; the refund is unchanged.
      declutter_admin_decide_delivery_damage: "20261031184929_declutter_damage_notices_name_the_item.sql b531d4e77fa8cfe0",
      declutter_card_fee_estimate: "20261014224914_declutter_slice3b_payments.sql c3eec727dc09fe3e",
      // Q2419 (20261027170717), reviewed: a FREE order (paid_with 'free', $0, no payment) closes with the strike rules
      // and records NO refund; every card order runs the unchanged body below it. declutter_checkout_free records none.
      declutter_close_paid_order: "20261027170717_declutter_free_section.sql c507c481a3209303",
      // #26 (20261028204431): only the "It's yours" notice line changed; it still records no refund.
      // #37 (20261028223036): only the "Free item claimed" link changed; it still records no refund.
      // #3730 (20261028235247, lh-money-escrow approved via the lead 2026-10-29): only the handover_not_offered refusal
      // added, before any order or page; it still records no refund.
      // D-NEW14 porch places (20261030164712, lh-money-escrow approved via the lead 2026-10-29): only the porch_place_needed
      // refusal (before any order) and the frozen-place INSERT added; it still records no refund.
      // LEAD-PLACE-TIMES (20261031164337). Reviewed 2026-10-31: the place read also runs for pickup_home; still $0 and records no refund.
      // LEAD-B49-REBUILD (20261031211922, Builder 28, for verdict): only the free-claim gate call added, before any order;
      // it raises or returns, and still records no refund.
      declutter_checkout_free: "20261031211922_free_claim_fee_then_id_restated.sql cbd27bb5698fddf0",
      // Q1929 (20261021185418), reviewed: a delivery-pay raise is its OWN charge and never a declutter_refunds row.
      // _start writes an unpaid raise row (its card fee is the buyer's to pay, grossed up); _status reads the
      // buyer's own raises; the close trigger moves applied raises to refunding: everything paid, except a sale
      // cancelled for a buyer-side reason (declutter_raise_card_fee_kept_reasons(): buyer_cancelled,
      // buyer_restarted_checkout, buyer_no_show, admin_buyer_fault; OWNER 2026-10-21), where the raise's card fee
      // is kept (refund = paid - card fee, held by CHECK declutter_delivery_raises_refund_amount). A seller-fault
      // close refunds everything and books the card fee as the seller's fee debt (raise_id source, row 60's rule):
      // never absorbed except our own mistake. Re-pinned 2026-10-21 (shell-declutter-4) after that change, and again
      // for the money review's fixes: _status now also returns refund_cents (what really goes back); the trigger logs a
      // cron defect when a seller-fault close has no seller left to bill. No refund amount changed.
      // None records or changes an order refund.
      declutter_delivery_raise_start: "20261021185418_declutter_delivery_raise_pay.sql f54438c6e9a4e1f9",
      declutter_delivery_raise_status: "20261021185418_declutter_delivery_raise_pay.sql 359d147a69ed2a51",
      declutter_delivery_raises_on_task_close: "20261021185418_declutter_delivery_raise_pay.sql adc539c67564a84c",
      declutter_hand_refund_failed: "20261017055500_declutter_refund_hand_settle.sql df3bdc676a1d434c",
      // Owner answer 7 (20261017060455): the three seller-out paths record
      // 'seller_out' (full refund, the card fee is the seller's debt) instead of order_closed / sold_elsewhere.
      // Board 158 (20261020064354): the same body, a 'paused' listing sells like a 'live' one (two status
      // lists only; diffed line by line by lander42, TRAIN25); the refund reasons and fee are unchanged.
      // Board 141 (20261026155251_declutter_refund_requests.sql): one line, a replayed paid event for a HANDED-OVER sale answers already_paid
      // (it used to fall through to a full 'order_closed' refund of that same payment). No reason or fee changed.
      // 20261028171944 (notice copy, lead 2026-10-28): only the four notice lines changed, diffed against prod's
      // prosrc: prices through declutter_price_text, "Buyer paid" links ?view=selling. No reason, amount or fee changed.
      // #26 (20261028204431): only the two "Payment received" lines changed (the next step from
      // declutter_paid_next_step). No reason, amount or fee changed.
      // A3-8 (20261028210552): only the "Payment received" / "Buyer paid" lines name the item. No reason, amount or fee changed.
      declutter_mark_order_paid: "20261028210552_declutter_sale_notices_name_inline.sql c653dda18a5645b1",
      // Not a refund path: it only NAMES the notice kind 'declutter_refunds' (20261028162048 / 20261028171944), so
      // the touches() test matches it. It maps a notice title to a push switch and records nothing.
      // 20261029194046 restates it verbatim plus two smart-offer titles under declutter_offers; still records nothing.
      // 20261030170443 (Q2488, lead lh-authz-rls approve "no money") adds the declutter_questions kind; still records nothing.
      declutter_notice_type: "20261030170443_declutter_question_kind.sql e7a9c90bee616b5e",
      // Q2307 (20261021204947), reviewed: a payment on an order a party has left is refunded in full as 'order_closed'
      // (full_platform_absorbs: nobody at the table did anything wrong); a replay answers the same refund row, and the
      // payment that already paid a settled order answers already_paid (money re-review R1).
      declutter_refund_party_gone: "20261021204947_declutter_sales_outlive_a_deleted_party.sql 59570f1f27aa5011",
      declutter_money_rows_seed: "20261014224914_declutter_slice3b_payments.sql eb41800cf45bee87",
      declutter_order_refunds_recorded_cents: "20261026154738_declutter_setup_fee_once.sql 22359b307c0f6993",
      declutter_record_hand_refund: "20261017055500_declutter_refund_hand_settle.sql e91bafe49bc1f340",
      // Board 141: + refund_request_full (keep_card_fee) and refund_request_part (agreed_part, which this function
      // refuses with refund_amount_unknown: only declutter_refund_after_handover writes it, with the offered amount).
      // D2-6 (20261029232103, lh-money-escrow approve 2026-10-29): restated verbatim from 20261026155251 plus one seller notice when a NEW debt row is inserted; reasons, policies, amounts and the debt row unchanged.
      // BUY-30 (20261031105148): restated verbatim from 20261029232103; only the debt notice names the item and links ?tab=selling. Reasons, policies, amounts and the debt row unchanged.
      declutter_record_refund: "20261031105148_declutter_refund_debt_notice_names_the_item.sql 2a8e367fe139aba5",
      // B100 (20261030134109): take back a problem report. Records no refund: it only marks the problem and the buyer's own
      // to_admin refund request 'withdrawn'; no amount, fee or payout is read or written.
      // T9 (20261031004529): taking back the buyer's no-show report also clears it, so the sweep can't refund on it; verdict owed.
      // LEAD-TAKENBACK-LINK (20261031103443): restated verbatim; only the "taken back" notice link reads ?tab=. Still records no refund.
      declutter_withdraw_problem: "20261031103443_declutter_taken_back_notice_opens_the_tab.sql aaa47fe596998b22",
      // T9 (20261031004529): names declutter_refunds only as its notice kind, since the notice moved to that switch; records no refund and moves no money (the seller's answer becomes an open problem, which holds the money).
      declutter_answer_no_show: "20261031004529_declutter_handover_both_confirm.sql 1def49eaa52f1de0",
      // BUY-2 (20261031133938, owner 10-31; money verdict owed): the buyer's cancel after no Helpr took the delivery. Its
      // only refund is declutter_close_paid_order(o.id, 'buyer_cancelled'), already pinned (keep_card_fee: the buyer bears
      // the card fee, as the owner chose); it refuses once a pickup is booked or a problem is open, and a replay answers already.
      declutter_cancel_after_no_helpr: "20261031133938_declutter_no_helpr_buyer_refund.sql e0426fab9dcc27c5",
      // BUY-2 (20261031133938): STABLE read for the buyer's own order; shows keep_card_fee's sum (paid minus the card fee,
      // at least 1 cent back) and the delivery coming back. Writes nothing.
      declutter_no_helpr_choice: "20261031133938_declutter_no_helpr_buyer_refund.sql 7fc7a17d711295b0",
      // soldstates-5 (20261031134217, owner 10-31; verdict owed): the Helpr's answer to the seller's "The Helpr didn't
      // come". Names declutter_refunds only as its notice kind; opens a problem (which holds the money) and records no refund.
      declutter_helpr_answer_no_show: "20261031134217_helpr_delivery_seller_reports_no_show.sql 7964c7f0efa841f1",
      // T9 (20261031004529): names declutter_refunds only as a notice kind on the 60-day hold; its own refunds all go through declutter_close_paid_order with reasons already pinned (buyer_no_show, seller_no_show), and it writes no amount or fee.
      // 20261031181404 (Builder 16): restated verbatim but for the (d) delivery-reminder loop, which now locks its order and
      // re-reads the booking so its notice names the item; that loop records no refund. Every refund path above unchanged.
      declutter_handover_sweep: "20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql f4d67855db1ff4c5",
      // Board 141: the ONE refund after the handover. Full = declutter_record_refund (keep_card_fee for the seller's
      // refund; the admin's fault reasons keep their policy) on the payment minus a delivery fee a Helpr earned (B69);
      // part = EXACTLY the offered amount (agreed_part, below the item price, card_fee_cents 0). Refuses a payout
      // already tried, marked or sent; rebooks the seller's payout before returning.
      // Seller delivery (20261027153244, reviewed 2026-10-27 by lh-money-escrow): the same refunds and fee policies;
      // only the seller's payout rebook changes (a full refund also undoes a seller delivery's rate for the seller).
      // D2-5 (20261029224147, lh-money-escrow approve 2026-10-29): notice words only (the card-network sentence on a keep_card_fee refund, the order chat instead of Messages), from the body 20261027172503 left; amounts, fee policies and the payout rebook unchanged.
      // BUY-25 (lead 10-30): never got it is reason seller_no_show (full_seller_pays_fee: the seller owes the card fee), already pinned; verdict owed.
      declutter_refund_after_handover: "20261031010243_declutter_never_got_it_no_return.sql 9789b5c5095d8eff",
      // Board 141 (lh-money-escrow review should-fix 1): the seller payout queue now also waits while an agreed part
      // refund on the order's payment is pending or failed; it reads declutter_refunds' status only, no amount.
      declutter_payouts_due: "20261026155251_declutter_refund_requests.sql a7c6262ff5abda7d",
      // Board 141: reads what a full refund would return (keep_card_fee's own formula, for the screen); writes nothing.
      declutter_full_refund_cents: "20261026155251_declutter_refund_requests.sql c6fc4e29fa827449",
      // Board 141: a party's view of the refund request; reads the settled refund row's amount and status only.
      // D2-5 (20261029224147): + admin_decided (the request ended with an admin decision); still reads the settled refund row's amount and status only.
      // D2-3 (20261029225634): + the request's photo_paths; still reads the settled refund row's amount and status only.
      // Returns (20261030071818) add the return fields (way, day, time, collect address, drop-off time); still no write.
      declutter_refund_request_view: "20261031010243_declutter_never_got_it_no_return.sql 45e59b8f95a4e7f1",
      // D2-3 (20261029225634, lh-authz-rls approve 2026-10-29): the other side's words and photos on an open problem; names declutter_refunds only as its notice kind; records no refund and moves no money.
      declutter_problem_add_side: "20261029225634_declutter_problem_both_sides_and_photos.sql d28dab3c3c9756cd",
      // Returns (20261030071818, builder 80; restated 20261030164712, Q2486: the distance reads the order's pickup points): names declutter_refunds only as its notice kind; records no refund and moves no money (the drop-off photo and time only).
      declutter_return_dropped_off: "20261030164712_declutter_porch_places.sql 93f622c906990eb9",
      // Returns (20261030071818, builder 80): names declutter_refunds only as its notice kind; records no refund and moves no money (the collect address only).
      declutter_set_return_address: "20261030071818_declutter_returns.sql 43bb0b4a006506dd",
      declutter_refund_answer: "20261015042253_declutter_slice4_handover_payout.sql bf344cb7353cb326",
      // Payout readiness (20261019070737): writes only a row still in the automatic path (status pending / failed),
      // never one an admin holds for review or settled by hand; the amount (refund_cents) is untouched, so the fee
      // policy recorded by declutter_record_refund stands.
      declutter_refund_executed: "20261019070737_payout_waits_for_payee_setup.sql d56d6750b97358bc",
      declutter_refund_gave_up_check: "20261017055500_declutter_refund_hand_settle.sql 1fa348b4a38b6f7c",
      declutter_refund_paid_order: "20261014224914_declutter_slice3b_payments.sql d970c83965cd57c2",
      declutter_refund_reversed: "20261017055500_declutter_refund_hand_settle.sql df1710d5a746e90b",
      declutter_refund_set_mode: "20261015042253_declutter_slice4_handover_payout.sql c41b6779b527f9c7",
      // Payout readiness (20261019070737): a deferred pending refund waits for next_attempt_at, and a delivery_damage
      // refund also counts a seller payout settled by hand as paid; the projected refund_cents is unchanged.
      declutter_refunds_due: "20261019070737_payout_waits_for_payee_setup.sql 42525eabe75fde8f",
      // Reads which order a refund belongs to and tells the seller the debt booked for it; writes no amount.
      declutter_seller_out_fee_notice: "20261017060455_declutter_seller_out_pays_fee.sql b469d8dcc79e1b10",
      // A10 (owner, 2026-10-17): the trigger on a seller-fault refund cancels the buyer's setup job (no fee) and
      // marks it; it records no refund and changes no refund amount.
      declutter_refund_cancels_setup_jobs: "20261017073146_declutter_add_a_helpr.sql ac0eabd46005cf1d",
      // A10: the trigger's (and the admin hand tool's) body: reads the refund row, cancels and marks setup jobs.
      declutter_apply_seller_fault: "20261017073146_declutter_add_a_helpr.sql 943675e46fc54277",
      // A10: adds the setup job's card fee to the seller's debt for that refund, once; never a refund amount.
      // Q1937 (20261027174633): capped at the order total across the order's linked jobs; still no refund amount.
      // + 20261027172503 (hide-fees) rewrites its notice literals only (lander re-pin, both reviewed).
      declutter_setup_job_fee_debt: "20261017073146_declutter_add_a_helpr.sql 554baba27b88ddd1",
      // Shops M1: records the card fee Stripe kept when a held order is captured (or the 2.9% + 30c estimate),
      // for a later refund to keep; it records no refund and decides no refund amount.
      shop_order_captured: "20261018164442_shops_orders_checkout.sql 3fe4dbb559a29a1f",
      // Payout readiness (20261019070737, lander33 pin for the lead's review). None of these decides or changes a refund
      // amount; each touches declutter_refunds only by status / time / review columns:
      // the admin page's list of held rows (a read; shows refund_cents as recorded).
      // Restated in 20261019112103 (shops-m3 run 3) with kind 'shop_refund' added: lists a held Shops refund too.
      admin_payouts_held_for_review: "20261019112103_shops_held_for_review_admin_tools.sql c1e1ff95266b714b",
      // puts a held refund back to 'pending' with its recorded refund_cents (the fee kept at record time is kept).
      // 20261019112103: + a held Shops refund / payout, refused while a refund made in Stripe stands (refunded_in_stripe)
      // or when the queue would not send it; a released Shops row starts its tries at 0. No amount changes.
      admin_payout_release: "20261031200034_declutter_payout_tries_restart.sql 78bddd7c72859a15",
      // records how a held refund was settled outside the app (Stripe re_/pyr_ id or "other:") and the amount the admin
      // says moved (settled_by_hand_cents, payout_settlements, the hand-refund ledger); it sends no money and never
      // changes refund_cents, so no new fee is returned by the app (owner: hand-settled = no new money movement).
      // A Stripe id (re_ or pyr_) makes the refund 'succeeded' only for at least refund_cents (settle_amount_short:
      // a short refund never closes the row); only "other:" ends 'settled_by_hand'.
      // 20261019112103: + a held Shops refund, by "other:" only (a Stripe id goes through shop-checkout, checked with
      // Stripe: stripe_check_required) and only for its whole refund_cents (settle_amount_differs); settle_amount_short kept.
      admin_payout_settle_by_hand: "20261019112103_shops_held_for_review_admin_tools.sql f65d8088fd3c48d3",
      // pushes next_attempt_at of a pending / failed row; no try used, no amount.
      payout_defer: "20261019070737_payout_waits_for_payee_setup.sql 64f967d0b2d0c9f4",
      // pages ops and tells the payee once per held row; writes only held_notified_at.
      // 20261019112103: + held Shops refunds on the ops ledger (the buyer is not told: refunded in Stripe already).
      payout_held_check: "20261019112103_shops_held_for_review_admin_tools.sql b489b512cdf15ef7",
      // Shops M3: the ONE refund formula for a Shops order (quote, write and CHECKs read it): keep_card_fee keeps the
      // card fee and its tax for buyer_cancelled / problem_no_fault; full otherwise (the shop is billed the fee as debt
      // for its own faults; the platform carries it only for problem_our_mistake).
      shop_refund_amounts: "20261019071055_shops_refunds_cancels_strikes.sql e33a946acc47db26",
      // the payout run holds a pending / failed row for review (status + reason); no amount.
      payout_hold_for_review: "20261019070737_payout_waits_for_payee_setup.sql 744e5a8f330d8f6f",
      // deletes wait / send-mark bookkeeping rows of ended payouts; reads declutter_refunds status only.
      payout_payee_waits_prune: "20261019070737_payout_waits_for_payee_setup.sql c4543482b291f2dc",
    } as Record<string, string>,
    /**
     * Every top-level statement (outside a function body) that names declutter_refunds (table, ALTER, policy,
     * trigger, rule, DML), and every one on declutter_orders that names card_fee_cents (PINNED_TABLES).
     * "<table> <migration>" -> sha256 (first 16 hex) of each statement, in order. EXACT: a new UPDATE, trigger,
     * policy or constraint change fails until reviewed (must-fix 2).
     */
    statements: {
      // Board 141: the reason, fee policy, policy and amount CHECKs swapped in one DO block (agreed_part added, every
      // other arm unchanged), and declutter_refund_requests.refund_id referencing a refund row (no amount).
      "declutter_refunds 20261026155251_declutter_refund_requests.sql": ["1192c0e245b11665", "7b90a5dbd6a21681", "4cf2e4567f6437bd", "2c0ac85e85bd01e6", "afb94a44f9fb4011", "7af5606b0b938d68", "9eb0bd77676aa5f0", "d2e483aa293ef495"],
      "declutter_refunds 20261014224914_declutter_slice3b_payments.sql": ["4bff57b818038dfb", "501086bd450ecad3", "3dac3faed7ee24b1", "f5f2155930f94544"],
      "declutter_orders 20261014224914_declutter_slice3b_payments.sql": ["09890255c7e1c936", "594addefda2af9a3"],
      // Q2419: declutter_orders_free (a free order is $0 everywhere, card fee 0, no Stripe session or payment).
      "declutter_orders 20261027170717_declutter_free_section.sql": ["2422b43339382e42"],
      "declutter_refunds 20261017055500_declutter_refund_hand_settle.sql": ["ae2d271f25de116b"],
      "declutter_refunds 20261017055505_declutter_helpr_delivery.sql": ["1192c0e245b11665", "aa722c4315c803d9", "afb94a44f9fb4011", "97fe1330f0f7f13d"],
      // Owner answer 7: the reason CHECK and the reason -> policy CHECK swapped to add 'seller_out' (seller pays);
      // slice 5's delivery_damage kept.
      "declutter_refunds 20261017060455_declutter_seller_out_pays_fee.sql": ["1192c0e245b11665", "47702b9f63c08805", "afb94a44f9fb4011", "12bd66289bce9d64"],
      // A10: AFTER INSERT ... WHEN fee_policy = 'full_seller_pays_fee' -> declutter_refund_cancels_setup_jobs.
      "declutter_refunds 20261017073146_declutter_add_a_helpr.sql": ["fcfe90bf2d9d7b5b"],
      // Payout readiness: the status CHECK swapped to add held_for_review / settled_by_hand (DROP + ADD in one DO block)
      // and the review / settled-by-hand / held_notified_at columns; none touches refund_cents, card_fee_cents or fee_policy.
      "declutter_refunds 20261019070737_payout_waits_for_payee_setup.sql": ["8e751398a6ae0f95","c964f08d0e8c041d","064bf163b9bea4fa","af87ef16f6190cb0"],
      "declutter_refunds 20261015042253_declutter_slice4_handover_payout.sql": ["997e0a466b670952", "1192c0e245b11665", "2fd39357580a2cf8", "4cf2e4567f6437bd", "7ba23fa882b28f10", "afb94a44f9fb4011", "97fe1330f0f7f13d", "9eb0bd77676aa5f0", "c63b7d95e91cc6a9", "6ca67d8b1161e8fe", "50ba5fd871e1f2c0", "acc8636c50c78d27"],
    } as Record<string, string[]>,
    touches: (text) => /\bdeclutter_refunds\b/i.test(text)
      || /\bdeclutter_record_refund\s*\(/i.test(text)
      || /\bdeclutter_card_fee_estimate\s*\(/i.test(text)
      || (/\bcard_fee_cents\b/i.test(text) && /\bdeclutter_orders\b/i.test(text)),
    triggerTable: "declutter_refunds",
    pinnedTables: [
      { table: "declutter_refunds" },
      { table: "declutter_orders", only: /\bcard_fee_cents\b/i },
    ],
    /** Fragments of declutter_record_refund's body, whitespace-collapsed, that decide the fee and the amount. */
    bodies: { declutter_record_refund: [
      "v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));",
      "IF v_policy = 'keep_card_fee' THEN v_fee := least(v_fee, p_paid_cents - 1);",
      "v_kept := v_order.premium_cents;",
      "CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept ELSE p_paid_cents END",
      "IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN",
      "INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents) VALUES (v_seller, v_id, v_fee, v_fee)",
    ] },
  },
  /**
   * Shops (M3, 20261019071055; owner 2026-10-14 and 2026-10-18): the reason decides the fee policy in ONE function
   * (shop_refund_fee_policy) that the table CHECK and shop_refund_amounts both call. Fee outcome per policy:
   *   full_platform_absorbs  our own mistake (problem_our_mistake): everything back, the ONLY one we pay for;
   *   full_shop_pays_fee     the shop's fault or removal: everything back, the card fee becomes the shop's
   *                          declutter_seller_fee_debts row (shop_refund_id), taken from its payouts;
   *   keep_card_fee          the buyer's free cancel / nobody's fault: refund = paid - the card fee - the tax on it.
   * Proven by src/test/pglite/shopsRefunds.pglite.mjs (every reason and policy named there).
   */
  shop_refund_amounts: {
    migration: "20261019071055_shops_refunds_cancels_strikes.sql",
    proofs: ["src/test/pglite/shopsRefunds.pglite.mjs"],
    reasonCheck: "shop_refunds_reason_check",
    policySources: [
      { where: "shop_refund_fee_policy", kind: "function", name: "shop_refund_fee_policy", pattern: /\bSELECT\s+(CASE\b.*?\bEND)\s*;/i, subject: "p_reason" },
    ],
    reasons: {
      buyer_cancelled: "keep_card_fee",
      problem_no_fault: "keep_card_fee",
      shop_cancelled: "full_shop_pays_fee",
      no_ready_photo: "full_shop_pays_fee",
      shop_removed: "full_shop_pays_fee",
      problem_shop_fault: "full_shop_pays_fee",
      problem_our_mistake: "full_platform_absorbs",
    },
    ownMistakes: ["problem_our_mistake"],
    constraints: [
      // The table's policy IS the one function (no second copy of the map).
      { name: "shop_refunds_policy", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "fee_policy = public.shop_refund_fee_policy(reason)" },
      { name: "shop_refunds_fee_policy_check", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "fee_policy IN ('keep_card_fee', 'full_shop_pays_fee', 'full_platform_absorbs')" },
      { name: "shop_refunds_kept", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "kept_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN card_fee_cents ELSE 0 END" },
      { name: "shop_refunds_tax_kept", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "tax_kept_cents = public.shop_refund_tax_kept(kept_cents, tax_cents, paid_cents)" },
      { name: "shop_refunds_amount", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "refund_cents = paid_cents - kept_cents - tax_kept_cents AND refund_cents > 0" },
      { name: "shop_refunds_settled_in_full", file: "20261019071055_shops_refunds_cancels_strikes.sql", text: "settled_by_hand_cents IS NULL OR settled_by_hand_cents = refund_cents" },
    ],
    touches: (text) => /\bshop_refunds\b/i.test(text)
      || /\bshop_refund_amounts\s*\(/i.test(text)
      || /\bshop_refund_fee_policy\s*\(/i.test(text)
      || /\bshop_refund_tax_kept\s*\(/i.test(text)
      || (/\bcard_fee_cents\b/i.test(text) && /\bshop_orders\b/i.test(text)),
    triggerTable: "shop_refunds",
    pinnedTables: [
      { table: "shop_refunds" },
      { table: "shop_orders", only: /\bcard_fee_cents\b/i },
    ],
    // Every function that reads or writes a Shops refund row, its amount or its status, read and pinned (run 3, the lead's
    // /code-review of shops-m3): amounts come only from shop_refund_amounts (held by the shop_refunds CHECKs); the
    // held-for-review admin tools move status and record what moved, never change refund_cents.
    functions: {
      admin_payout_release: "20261031200034_declutter_payout_tries_restart.sql 78bddd7c72859a15",
      admin_payout_settle_by_hand: "20261019112103_shops_held_for_review_admin_tools.sql f65d8088fd3c48d3",
      admin_payouts_held_for_review: "20261019112103_shops_held_for_review_admin_tools.sql c1e1ff95266b714b",
      payout_held_check: "20261019112103_shops_held_for_review_admin_tools.sql b489b512cdf15ef7",
      shop_hand_refund_failed: "20261019071055_shops_refunds_cancels_strikes.sql ba27ff33a9f0c110",
      shop_hold_order_for_hand_refund: "20261019071055_shops_refunds_cancels_strikes.sql 1e75907ab8fb3269",
      shop_money_rows_seed: "20261018211820_shops_handover_payout.sql 55e7c11ee19013d2",
      shop_order_captured: "20261018164442_shops_orders_checkout.sql 3fe4dbb559a29a1f",
      shop_record_hand_refund: "20261019071055_shops_refunds_cancels_strikes.sql 57f661acd2c47d64",
      shop_refund_amounts: "20261019071055_shops_refunds_cancels_strikes.sql e33a946acc47db26",
      shop_refund_executed: "20261019071055_shops_refunds_cancels_strikes.sql c9dd716154e3d67f",
      shop_refund_fee_policy: "20261019071055_shops_refunds_cancels_strikes.sql f658275f8b61b0af",
      shop_refund_reversed: "20261019071055_shops_refunds_cancels_strikes.sql df880e58ddff9ccd",
      // 20261030150104 (lead lh-authz-rls approve "refunds ... unchanged"): only the admin alert skips test accounts.
      shop_refund_sweep: "20261030150104_admin_alerts_skip_test_gaps.sql 073f789da078c7c4",
      shop_refund_tax_kept: "20261019071055_shops_refunds_cancels_strikes.sql 55fb2a820bce5eca",
      shop_refund_to_send: "20261019071055_shops_refunds_cancels_strikes.sql b349bdd3f8d3b813",
      shop_refunds_due: "20261019071055_shops_refunds_cancels_strikes.sql bbfc70978e922056",
      shop_write_refund: "20261019071055_shops_refunds_cancels_strikes.sql 8e2784ad6a3144e8",
      shops_admin_queue: "20261019071055_shops_refunds_cancels_strikes.sql 45af68a4538108a7",
      shops_admin_record_hand_refund: "20261019071055_shops_refunds_cancels_strikes.sql e84eb2bcd3a84095",
      shops_admin_refund_order: "20261019071055_shops_refunds_cancels_strikes.sql a7df4ee33cc5ef18",
      shops_admin_settle_held_refund: "20261019071055_shops_refunds_cancels_strikes.sql 6d0001f095b1ff76",
      shops_buyer_cancel_order: "20261019071055_shops_refunds_cancels_strikes.sql 69cdd0dcef74aa6b",
      shops_order_cancel_quote: "20261019071055_shops_refunds_cancels_strikes.sql fdc45c450183721c",
      shops_shop_cancel_order: "20261019071055_shops_refunds_cancels_strikes.sql c7cabc81cc0fc3e4",
    },
    statements: {
      "shop_orders 20261018164442_shops_orders_checkout.sql": ["c270fbd5dcbf5fcd"],
      "shop_refunds 20261019071055_shops_refunds_cancels_strikes.sql": ["75ac5d08aa20b56e", "3b8b9ce1c7e3e63c", "a5b2dee5e1716c6e", "e11df43619a2b9ad"],
    },
    bodies: {
      shop_refund_amounts: [
        "least(so.total_cents, COALESCE(so.card_fee_cents, public.declutter_card_fee_estimate(so.total_cents))) AS fee,",
        "public.shop_refund_fee_policy(p_reason) AS policy",
        "CASE WHEN o.policy = 'keep_card_fee' THEN o.fee ELSE 0 END AS kept",
        "k.total_cents - k.kept - public.shop_refund_tax_kept(k.kept, k.tax_cents, k.total_cents)",
      ],
      // The one writer of a Shops refund row reads the amounts from shop_refund_amounts and bills the shop's fee.
      shop_write_refund: [
        "SELECT * INTO a FROM public.shop_refund_amounts(o.id, p_reason);",
        "IF a.fee_policy = 'full_shop_pays_fee' AND a.card_fee_cents > 0 AND o.seller_id IS NOT NULL THEN INSERT INTO public.declutter_seller_fee_debts (seller_id, shop_refund_id, amount_cents, remaining_cents) VALUES (o.seller_id, r.id, a.card_fee_cents, a.card_fee_cents)",
      ],
    },
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
    "cancelSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: serviceFeeCents, setupFeeCents, alreadyRefundedCents, taxCents: await chargeTaxCentsFor(stripe, pi), })",
  ],
  "refund-dispute-": [
    "refundAmount",
    "refundAmount = disputeSplit.refundCents",
    "disputeSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: disputeOtherRefundedCents, taxCents: disputeTaxCents, })",
  ],
  "refund-helpr-fault-": [
    "split.refundCents",
    "split = helprFault && !helprFaultGone ? helprFaultSplit : generalSplit",
    "helprFaultSplit = refundToPayerCents({ capturedCents, actualFeeCents: 0, customerFeeCents: 0, setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: generalAlreadyRefundedCents, requestedCents: null, taxCents: generalTaxCents, })",
    "generalSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: generalAlreadyRefundedCents, requestedCents: isPartial ? requestedCents : null, taxCents: generalTaxCents, })",
  ],
  "helpr-fault-dispute-refund-": [
    "helprFaultDisputeRefundCents",
    "helprFaultDisputeRefundCents = helprFaultDisputeSplit.refundCents",
    "helprFaultDisputeSplit = refundToPayerCents({ capturedCents, actualFeeCents: 0, customerFeeCents: 0, setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: disputeOtherRefundedCents, taxCents: disputeTaxCents, })",
  ],
  "refund-general-": [
    "generalSplit.refundCents",
    "generalSplit = refundToPayerCents({ capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), customerFeeCents: cardCostFeeCents(job), setupFeeCents: setupFeeKeptCents(job), alreadyRefundedCents: generalAlreadyRefundedCents, requestedCents: isPartial ? requestedCents : null, taxCents: generalTaxCents, })",
  ],
  // Q2298 (owner, 2026-10-21): an agreed PART refund is EXACTLY the amount
  // asked (agreement.amountCents). It still keeps the card fee: the split
  // refuses one above refundableCents (posterBase.ceilingCents, the charge
  // less its kept card fee), so the card fee is never what comes back.
  // Owner 2026-10-21: plus the same share of the rush fee (rushBackCents); the
  // same refundableCents ceiling still refuses anything over it.
  // Helpr Guarantee (owner 2026-10-27): a dispute born of a guarantee request
  // refunds the poster's share of the job PRICE, capped by the same
  // refundableCents ceiling (Math.min), so the card fee still never comes back.
  "poster_share": [
    "refundCents",
    "refundCents = exactAgreed && agreement !== null ? agreement.amountCents + rushBackCents : guaranteePriceOnly ? Math.max(0, Math.min(refundableCents, Math.round(perHelperBudget * 100 * posterShare))) : Math.max(0, Math.round(refundableCents * posterShare))",
    "rushBackCents = exactAgreed && agreement !== null ? agreedRushRefundCents(rushCents, agreement.amountCents, agreement.budgetCents) : 0",
    "refundableCents = posterBase.ceilingCents",
    "rushCents = Math.round(netUrgentFeeDollars(job.urgent_fee) * 100)",
    "posterBase = refundToPayerCents({ capturedCents, actualFeeCents: pi ? actualOrEstimatedFeeCents(pi, capturedCents) : 0, customerFeeCents: pi ? cardCostFeeCents(job) : 0, setupFeeCents: pi ? setupFeeKeptCents(job) : 0, taxCents: chargeTaxCents, })",
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
    "feeReturnCents = crewFeeShareReturnCents({ customerFeeCents: feeCents, actualFeeCents: feeHoldsCardFee ? crewStripeFeeCents : 0, proRataCents: feeProRataCents })",
    "taxReturnCents = budgetCents > 0 ? Math.floor((taxCents * unpaidBudgetCents) / budgetCents) : 0",
    "unpaidBudgetCents = Math.max(0, budgetCents - paidBudget)",
    "urgentCents = Math.round(Number(job.urgent_fee ?? 0) * 100)",
    "budgetCents = Math.round(Number(job.budget ?? 0) * 100)",
    "crewStripeFeeCents = a.stripeFeeCents ?? stripeProcessingCostCents(a.capturedCents)",
    "taxCents = Math.max(0, Math.round(Number(job.sales_tax_amount ?? 0) * 100))",
  ],
  "cancel-refund-": [
    "refundAmount",
    "refundAmount = voidSplit.refundCents > 0 || refundedAtStripe ? voidSplit.refundCents : capturedCents - Math.round(cancellationFee * 100) - blockFeeCents - nonRefundableCents - voidSplit.taxKeptCents",
    // Boards 66/172 slice 2: through posterCancelSplit, the split the poster's cancel quote shows (its own
    // refundToPayerCents call is pinned in "posterCancelSplit keeps the card fee" below).
    "voidSplit = capturedSplit.split",
    "capturedCents = pi.amount_received ?? pi.amount",
    "blockFeeCents = crewBlockFeeCents(blockFeeRows)",
    "nonRefundableCents = voidSplit.nonRefundableCents",
    "capturedSplit = posterCancelSplit({ job, sellerFault, cancellationFeeCents: Math.round(cancellationFee * 100), blockFeeCents, charge: { state: \"captured\", capturedCents, actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents), alreadyRefundedCents: chargeRefundedCents, taxCents: await chargeTaxCentsFor(stripe, pi), }, })",
  ],
  // Q1915: a deleted crew member's withheld share plus the tax the cancel refund kept on it; the card fee stays kept.
  "crew-share-returned-": [
    "shareRefundCents",
    "shareRefundCents = withheldFeeReturnCents({ withheldCents: cents, keptTaxCents, capturedCents, refundedCents: Math.round(Number(charge?.amount_refunded ?? 0)), })",
  ],
  "createRefundOnce#0": [
    "owedCents",
    "owedCents = withholdFee ? lessFeeCents : amountCents",
    "lessFeeCents = Number.isFinite(amountCents) ? refundToPayerCents({ capturedCents: amountCents, taxCents: chargeTaxCents(piObj, Number(row.tax_cents ?? 0)), taxBaseCents: Number(row.amount_cents ?? 0) - Number(row.fee_cents ?? 0), actualFeeCents: actualOrEstimatedFeeCents(piObj, amountCents) }).refundCents : Number.NaN",
    "amountCents = Number(row.amount_cents)",
  ],
  "createRefundOnce#2": [
    "split.refundCents",
    "split = await refundLessStripeFeeCents(stripe, intent, capturedCents, taxCents, budgetCents + (posterFeeSeries ? feeCents : 0) + taxCents)",
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

/** See SqlPolicy.functions. name -> "file sha16", plus the text for a readable failure. */
function refundMoneyFunctions(p: SqlPolicy): Map<string, { pin: string; text: string }> {
  const triggerFns = new Set<string>();
  for (const file of migrationFiles(MIGRATIONS)) {
    const code = blankSqlComments(readFileSync(join(MIGRATIONS, file), "utf8"));
    const trig = new RegExp(String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b[^;]*?\bon\s+(?:only\s+)?(?:public\.)?"?${p.triggerTable}"?\s[^;]*?\bexecute\s+(?:function|procedure)\s+(?:public\.)?"?(\w+)"?`, "gi");
    for (const m of code.matchAll(trig)) triggerFns.add(m[1].toLowerCase());
  }
  const out = new Map<string, { pin: string; text: string }>();
  for (const [name, def] of effectiveDefs(MIGRATIONS)) {
    const text = norm(blankSqlComments(def.stmt));
    if (triggerFns.has(name) || p.touches(text)) out.set(name, { pin: `${def.file} ${sha16(text)}`, text });
  }
  return out;
}

const tableStmt = (table: string) => new RegExp(String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|alter\s+table(?:\s+if\s+exists)?|truncate(?:\s+table)?|drop\s+table(?:\s+if\s+exists)?|create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\b[^;]*?\bon|create\s+policy\b[^;]*?\bon|alter\s+policy\b[^;]*?\bon|create\s+(?:or\s+replace\s+)?rule\b[^;]*?\bon|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:only\s+)?(?:public\.)?"?${table}"?(?![\w])`, "gi");

/**
 * See SqlPolicy.statements: "<table> <migration>" -> each statement, in order. The pinned tables are every one on
 * the refund table, and those on its order table that name card_fee_cents (the fee every keep_card_fee refund keeps
 * is read from there).
 */
function refundTableStatements(pinnedTables: SqlPolicy["pinnedTables"]): Record<string, Array<{ pin: string; text: string }>> {
  const out: Record<string, Array<{ pin: string; text: string }>> = {};
  for (const file of migrationFiles(MIGRATIONS)) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const code = blankSqlComments(sql);
    const bodies = parseDefs(sql).map((d) => [d.index, d.index + d.stmt.length]);
    for (const { table, only } of pinnedTables) {
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
  if (els) return { arms, otherwise: els[1] };
  // No ELSE: an unlisted reason gets NULL, which a NOT NULL fee_policy refuses (nothing is decided for it).
  return arms.length > 0 && /^\s*$/.test(rest) ? { arms, otherwise: "NULL (refused)" } : null;
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
  if (def.file !== (p.functionMigration ?? p.migration)) {
    problems.push(`${name} is now defined by ${def.file}, not the pinned ${p.functionMigration ?? p.migration}: review that every reason still keeps the fee except our own mistakes, then pin it`);
  }
  const defs = effectiveDefs(MIGRATIONS);
  for (const [fn, frags] of Object.entries(p.bodies)) {
    const fnDef = defs.get(fn);
    const fnBody = fnDef ? norm(blankSqlComments(fnDef.stmt)) : "";
    if (!fnDef) problems.push(`${fn}: no migration defines it`);
    for (const frag of frags) if (fnDef && !fnBody.includes(frag)) problems.push(`${fn}: the body no longer contains "${frag}"`);
  }

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
  // reason -> policy, from every place it is decided (a table CHECK, a function), each exactly the pinned map.
  for (const src of p.policySources) {
    let text: string | undefined;
    let file: string | undefined;
    if (src.kind === "constraint") {
      const c = newestConstraint(src.name);
      text = c?.text.match(src.pattern)?.[1];
      file = c?.file;
    } else {
      const d = defs.get(src.name);
      text = d ? norm(blankSqlComments(d.stmt)).match(src.pattern)?.[1] : undefined;
      file = d?.file;
    }
    const want = src.kind === "function" ? (p.functionMigration ?? p.migration) : p.migration;
    if (file !== want) problems.push(`${src.where} is now defined by ${file ?? "nothing"}, not ${want}`);
    const c = text ? readCase(text, src.subject) : null;
    if (!c) {
      problems.push(`${src.where}: the reason -> fee policy CASE cannot be read (${text ?? "missing"})`);
      continue;
    }
    const got = evalCase(c, [...new Set([...pinned, ...c.arms.flatMap((a) => a.values)])].sort());
    if (JSON.stringify(got) !== JSON.stringify(Object.fromEntries(pinned.map((r) => [r, p.reasons[r]])))) {
      problems.push(`${src.where} maps ${JSON.stringify(got)}, pinned ${JSON.stringify(p.reasons)}: a reason that is not our own mistake must keep the fee`);
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
  const fns = refundMoneyFunctions(p);
  const gotFns = Object.fromEntries([...fns].map(([n, f]) => [n, f.pin]).sort());
  for (const n of new Set([...Object.keys(gotFns), ...Object.keys(p.functions)])) {
    if (gotFns[n] !== p.functions[n]) {
      problems.push(`[${name}] ${n}: is ${JSON.stringify(gotFns[n] ?? "gone")}, pinned ${JSON.stringify(p.functions[n] ?? "not classified")}: review that every refund it can record keeps the fee except our own mistakes, then pin it. Its definition: ${fns.get(n)?.text.slice(0, 3000) ?? "-"}`);
    }
  }
  const stmts = refundTableStatements(p.pinnedTables);
  for (const f of new Set([...Object.keys(stmts), ...Object.keys(p.statements)])) {
    const got = (stmts[f] ?? []).map((x) => x.pin);
    if (JSON.stringify(got) !== JSON.stringify(p.statements[f] ?? [])) {
      problems.push(`[${name}] ${f}: pinned statements are ${JSON.stringify(got)}, pinned ${JSON.stringify(p.statements[f] ?? [])}: review each (does it let a refund return the fee?), then pin. They read: ${JSON.stringify((stmts[f] ?? []).map((x) => x.text.slice(0, 400)))}`);
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

/** Is `row` (or one of its fields) assigned, redeclared or destructured in `between`? */
function rowTouched(between: string, rowName: string): boolean {
  const row = rowName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![.\\w$])${row}(?:\\.\\w+|\\[[^\\]]*\\])?\\s*(?:[-+*/]|\\?\\?|\\|\\||&&)?=(?![=>])|\\b(?:const|let|var)\\s+${row}\\b|[{,]\\s*${row}\\s*[,}=]|Object\\.assign\\(\\s*${row}\\b`).test(between);
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
  // A shared sender takes its row as a parameter; each feeder reads it (checked below).
  if (!sql.feeders && !code.includes(`.rpc("${sql.rpc}"`)) problems.push(`${file}: does not read its refund row through ${sql.rpc}`);
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
    if (rowTouched(flat.slice(pos, callAt), sql.row)) {
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
  const table = sql.table ?? "declutter_refunds";
  const readsRow = (fn: string) => {
    const d = defs.get(fn);
    const b = d ? norm(blankSqlComments(d.stmt)) : "";
    return /\br\.refund_cents\b/.test(b) && new RegExp(`FROM public\\.${table} r\\b`).test(b);
  };
  if (!readsRow(sql.reader)) problems.push(`${sql.reader}: does not return refund_cents straight off the ${table} row`);
  // A shared sender's callers: each reads the row through its RPC (straight off the table) and hands it on unchanged.
  for (const f of sql.feeders ?? []) {
    const fcode = blankComments(readFileSync(join(ROOT, f.file), "utf8"));
    const fflat = norm(fcode);
    if (!fcode.includes(`.rpc("${f.rpc}"`)) problems.push(`${f.file}: does not read the refund row through ${f.rpc}`);
    if (!readsRow(f.rpc)) problems.push(`${f.rpc}: does not return refund_cents straight off the ${table} row`);
    let fpos = 0;
    let lost = false;
    for (const frag of f.chain) {
      const at = fflat.indexOf(frag, fpos);
      if (at < 0) {
        problems.push(`${f.file}: the refund row's source chain no longer reads "${frag}" (after the previous link): review where the row comes from, then pin it`);
        lost = true;
        break;
      }
      fpos = at + frag.length;
    }
    if (!lost) {
      const at = fflat.indexOf(norm(f.call), fpos);
      if (at < 0) problems.push(`${f.file}: ${f.call} does not follow its pinned source chain`);
      else if (rowTouched(fflat.slice(fpos, at), f.row)) problems.push(`${f.file}: ${f.row} is reassigned or shadowed between its pinned declaration and ${f.call}`);
    }
    for (const [fn, n] of Object.entries(f.calls)) {
      const count = [...fcode.matchAll(new RegExp(`(?<!function\\s)\\b${fn}\\(`, "g"))].length;
      if (count !== n) problems.push(`${f.file}: ${fn} is called ${count} times, pinned ${n}: a second caller could hand it another row`);
    }
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
  if (kind === "helpr-fault") {
    // The ruling (ruleHelprFaultFirst, which calls admin_rule_helpr_fault as
    // the admin) BEFORE the refund in the same action, the bill
    // (billHelprFaultCardFee -> bill_helpr_fault_card_fee) AFTER it, before
    // the next action starts; and the two shared helpers really call the RPCs.
    const actionStart = code.lastIndexOf('if (action === "', at);
    const nextAction = code.indexOf('if (action === "', at);
    const ruled = code.lastIndexOf("await ruleHelprFaultFirst(", at);
    const billed = code.indexOf("await billHelprFaultCardFee(", at);
    if (ruled < 0 || ruled < actionStart) problems.push(`${file}: ${call.slice(0, 60)} refunds a Helpr fault with no admin_rule_helpr_fault ruling (ruleHelprFaultFirst) before it`);
    if (billed < 0 || (nextAction > 0 && billed > nextAction)) problems.push(`${file}: ${call.slice(0, 60)} refunds a Helpr fault but never bills the Helpr (billHelprFaultCardFee) after it`);
    const fnBody = (name: string) => {
      const i = code.indexOf(`async function ${name}(`);
      return i < 0 ? "" : code.slice(i, code.indexOf("\n}\n", i));
    };
    if (!/await asAdmin\.rpc\("admin_rule_helpr_fault"/.test(fnBody("ruleHelprFaultFirst"))) problems.push(`${file}: ruleHelprFaultFirst does not call admin_rule_helpr_fault as the admin`);
    if (!/await supabaseAdmin\.rpc\("bill_helpr_fault_card_fee"/.test(fnBody("billHelprFaultCardFee"))) problems.push(`${file}: billHelprFaultCardFee does not call bill_helpr_fault_card_fee`);
  }
  if (kind === "keeps-fee" || kind === "both" || kind === "helpr-fault") {
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
    // 8 since Q2399 (2026-10-25): a held card captured for a job that closed with nobody hired (_shared/cardHold.ts).
    expect(REFUND_SITES.filter((e) => e.kind === "own-mistake").length).toBe(8);
  });

  // Boards 66/172 slice 2: posterCancelSplit (the sweep's refund and the poster's quote) is a HELPER above only
  // because its captured split IS refundToPayerCents, keeping the card fee and the poster's kept fee.
  // @mutate supabase/functions/_shared/posterCancelSplit.ts |     customerFeeCents: fullSeriesRefund \|\| i.sellerFault ? 0 : serviceFeeCents, |     customerFeeCents: 0,
  it("posterCancelSplit keeps the card fee through refundToPayerCents", () => {
    const src = blankComments(readFileSync(join(FN, "_shared/posterCancelSplit.ts"), "utf8")).replace(/\s+/g, " ");
    expect(src).toMatch(/from "\.\/refundAmount\.ts"/);
    expect(src).toContain("const split = refundToPayerCents({ capturedCents: c.capturedCents, actualFeeCents: i.sellerFault ? 0 : c.actualFeeCents, customerFeeCents: fullSeriesRefund || i.sellerFault ? 0 : serviceFeeCents, setupFeeCents: setupFeeKeptCents(i.job), otherKeptCents: feesCents, alreadyRefundedCents: c.alreadyRefundedCents, taxCents: c.taxCents, });");
    expect(src).toContain("const serviceFeeCents = posterCancelKeptFeeCents(i.job);");
    expect(src).toContain("backCents: split.refundCents,");
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
  }, 60_000); // it replays every SQL refund policy from the newest migrations: ~10s alone locally, 31s on a loaded CI shard after Shops M3 added its refund sites (PR #3425 shard 4)

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
      ...REFUND_SITES.filter((e) => e.kind === "keeps-fee" || e.kind === "both" || e.kind === "helpr-fault").map((e) => e.key),
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
