#!/usr/bin/env node
/**
 * PGlite proof for 20261017045215_declutter_seller_out_pays_fee (owner answer 7,
 * 2026-10-17): a buyer who pays just as the SELLER can no longer sell
 * (declutter_seller_out: banned, suspended, 3 strikes, under 18 or flagged
 * business-like) gets every cent back, and the card fee becomes the SELLER's
 * debt, taken from a later payout; the seller is told once.
 *   (a) the sweep closed the checkout because the seller was out, then the buyer paid;
 *   (b) a late, in-time payment (B41) cannot be honoured because the seller is out;
 *   (c) the seller is out when the payment lands on an open checkout.
 *
 *   node src/test/pglite/declutterSellerOutPaysFee.pglite.mjs                       # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterSellerOutPaysFee.pglite.mjs    # RED: the migration absent
 *
 * On top of slices 1-4 (scripts/declutter/slice3Harness.mjs); the migration is
 * applied 3 times (replay-safety). pglite is not a dependency (CLAUDE.md):
 * loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { BUYER, BUYER2, BUYER3, SELLER2, SELLER3 } = USERS;
const NEW_FILE = "20261017045215_declutter_seller_out_pays_fee.sql";
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }];
if (!skip) extra.push({ file: NEW_FILE, times: 3 });
for (const sql of setupStatements({ times: 1, times3b: 1, extra })) await db.exec(sql);
await db.exec(CARDS_SQL);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const FEE = 163;

/** One item at 4000 from `seller`, bought by `buyer` and checked out (awaiting payment). */
async function checkedOut(n, buyer, seller) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Seller out item ${n}`, price: 4000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 4000)`);
  return (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'pickup_home')`))[0] ?? {};
}
const pay = async (o, pi, at = "now()", fee = FEE) =>
  one(await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', '${pi}', ${o.total_cents}, ${at}, ${fee})`));
const flag = (uid, on) => svc(on
  ? `INSERT INTO public.declutter_seller_flags (user_id, business_like) VALUES ('${uid}', true) ON CONFLICT (user_id) DO UPDATE SET business_like = true`
  : `UPDATE public.declutter_seller_flags SET business_like = false WHERE user_id = '${uid}'`);
const debtFor = async (pi) => (await svc(`SELECT d.seller_id, d.amount_cents, d.remaining_cents FROM public.declutter_seller_fee_debts d
  JOIN public.declutter_refunds r ON r.id = d.refund_id WHERE r.stripe_payment_intent_id = '${pi}'`))[0];
const notices = async (uid) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = 'Card fee owed'`));
const owesFee = (res, o) => res?.reason === "seller_out" && res.fee_policy === "full_seller_pays_fee" && res.refund_cents === o.total_cents;

// ---------------------------------------------------------------------------
// (c) The seller is out when the payment lands on an open checkout.
// Every checkout first: a seller who is out cannot be bought from.
const c = await checkedOut(1, BUYER, SELLER2);
const c2 = await checkedOut(2, BUYER2, SELLER2);
const c3 = await checkedOut(3, BUYER3, SELLER2);
await flag(SELLER2, true);
const cRes = await pay(c, "pi_so_c");
ok(owesFee(cRes, c), "(c) seller out at payment: every cent back, reason seller_out, the seller pays the fee");
const cDebt = await debtFor("pi_so_c");
ok(cDebt?.seller_id === SELLER2 && cDebt.amount_cents === FEE && cDebt.remaining_cents === FEE,
  "(c) the card fee is booked to the SELLER as a debt (not absorbed by the platform)");
ok(await notices(SELLER2) === 1, "(c) the seller is told once what they owe");
const cNote = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER2}' AND title = 'Card fee owed'`));
ok(typeof cNote === "string" && cNote.includes("$1.63") && cNote.includes("future Declutter payouts"),
  "(c) the notice names the fee and when it is taken");
const cAgain = await pay(c, "pi_so_c");
ok(cAgain?.reason === "seller_out" && cAgain.refund_id === cRes?.refund_id, "(c) a replayed webhook keeps the same answer");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_seller_fee_debts WHERE seller_id = '${SELLER2}'`))) === 1
   && await notices(SELLER2) === 1, "(c) and books the debt and the notice once");
ok(Number(one(await svc(`SELECT public.declutter_consume_fee_debt('${SELLER2}', 'declutter_order_x', 5000)`))) === FEE,
  "(c) a later payout takes the debt back");

// A buyer who also blocked the seller: the seller being out still decides (the buyer gets every cent).
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER2}', '${SELLER2}')`);
ok(owesFee(await pay(c2, "pi_so_c2"), c2), "(c) a buyer who blocked an out seller is still refunded in full; the seller owes the fee");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${BUYER2}'`);

// A zero card fee: a full refund, no debt and nothing to tell.
const before = await notices(SELLER2);
const c3Res = await pay(c3, "pi_so_c3", "now()", 0);
ok(owesFee(c3Res, c3) && (await debtFor("pi_so_c3")) === undefined && await notices(SELLER2) === before,
  "(c) no card fee kept: full refund, no debt, no notice");
await flag(SELLER2, false);

// ---------------------------------------------------------------------------
// (a) The sweep closed the checkout because the seller was out; the buyer paid on the open page.
const a = await checkedOut(4, BUYER, SELLER3);
await flag(SELLER3, true);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${a.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
ok(one(await svc(`SELECT close_reason FROM public.declutter_orders WHERE id = '${a.order_id}'`)) === "seller_out",
  "(a) the sweep closed the checkout as seller_out");
const aRes = await pay(a, "pi_so_a", "now() - interval '2 hours'");
ok(owesFee(aRes, a) && (await debtFor("pi_so_a"))?.seller_id === SELLER3 && await notices(SELLER3) === 1,
  "(a) paid on the closed page: every cent back, the seller owes the fee and is told");
await flag(SELLER3, false);

// ---------------------------------------------------------------------------
// (b) A late, in-time payment (B41) that cannot be honoured because the seller is now out.
const b = await checkedOut(5, BUYER3, SELLER3);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${b.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${SELLER3}'`);
const bRes = await pay(b, "pi_so_b", "now() - interval '2 hours' + interval '30 minutes'");
ok(owesFee(bRes, b) && (await debtFor("pi_so_b"))?.amount_cents === FEE,
  "(b) paid in time but the seller was banned meanwhile: every cent back, the seller owes the fee (not sold_elsewhere)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_strikes WHERE user_id = '${BUYER3}' AND reason = 'missed_checkout' AND removed_at IS NULL`))) === 0,
  "(b) and the buyer's missed-checkout strike is still removed");
await svc(`UPDATE public.profiles SET ban_status = 'active' WHERE user_id = '${SELLER3}'`);

// (b) review #3: the item went to another buyer AND the seller is out: the item going elsewhere
// stopped the sale whatever the seller's status, so that refund stays ours (no seller debt).
const gone = await checkedOut(7, BUYER2, SELLER3);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${gone.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(7)}', 4000)`);
await flag(SELLER3, true);
const goneRes = await pay(gone, "pi_so_gone", "now() - interval '2 hours'");
ok(goneRes?.reason === "sold_elsewhere" && goneRes.fee_policy === "full_platform_absorbs" && (await debtFor("pi_so_gone")) === undefined,
  "(b) item gone elsewhere and the seller out: sold_elsewhere, no seller debt (the seller did not cause it)");
await flag(SELLER3, false);

// (c) review #3: an item no longer reserved AND the seller out: our mistake, not the seller's.
const unres = await checkedOut(8, BUYER3, SELLER3);
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(8)}'`);
await flag(SELLER3, true);
const unresRes = await pay(unres, "pi_so_unres");
ok(unresRes?.reason === "order_closed" && (await debtFor("pi_so_unres")) === undefined,
  "(c) item no longer reserved and the seller out: order_closed, no seller debt");
// ...and the buyer had also blocked the seller: the buyer's own block decides (card fee kept), not seller_out.
const unres2 = await checkedOut(10, BUYER2, SELLER2);
await svc(`UPDATE public.declutter_items SET status = 'live' WHERE id = '${I(10)}'`);
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${BUYER2}', '${SELLER2}')`);
await flag(SELLER2, true);
const unres2Res = await pay(unres2, "pi_so_unres2");
ok(unres2Res?.reason === "buyer_cancelled" && unres2Res.fee_policy === "keep_card_fee" && (await debtFor("pi_so_unres2")) === undefined,
  "(c) item no longer reserved, the buyer blocked the seller, the seller out: buyer_cancelled (the card fee is kept), no seller debt");
await svc(`DELETE FROM public.user_blocks WHERE blocker_id = '${BUYER2}'`);
await flag(SELLER2, false);
await flag(SELLER3, false);

// An under-18 birthday saved after the listing (owner 2026-10-17: everyone ticked 18+ to sign up): billed like any seller who is out.
const minor = await checkedOut(9, BUYER, SELLER3);
await svc(`UPDATE public.profiles SET date_of_birth = (now() - interval '15 years')::date WHERE user_id = '${SELLER3}'`);
ok(owesFee(await pay(minor, "pi_so_minor"), minor) && (await debtFor("pi_so_minor"))?.seller_id === SELLER3,
  "an under-18 birthday: every cent back, the seller owes the fee");
await svc(`UPDATE public.profiles SET date_of_birth = '1987-01-01' WHERE user_id = '${SELLER3}'`);

// Control: a seller who CAN sell, item taken meanwhile -> still our mistake (sold_elsewhere, platform pays).
const ctl = await checkedOut(6, BUYER2, SELLER3);
await svc(`UPDATE public.declutter_cart_items SET checkout_by = now() - interval '2 hours' WHERE order_id = '${ctl.order_id}'`);
await svc(`SELECT public.declutter_deadline_sweep()`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(6)}', 4000)`);
const ctlRes = await pay(ctl, "pi_so_ctl", "now() - interval '2 hours'");
ok(ctlRes?.reason === "sold_elsewhere" && ctlRes.fee_policy === "full_platform_absorbs" && (await debtFor("pi_so_ctl")) === undefined,
  "control: the seller can sell and the item went elsewhere -> sold_elsewhere, no seller debt");

// ---------------------------------------------------------------------------
// The table rules and grants.
ok(Array.isArray(await svc(`SELECT 1 FROM public.declutter_refunds WHERE reason = 'seller_out' AND fee_policy = 'full_seller_pays_fee'`)),
  "the reason CHECK accepts seller_out");
const badPolicy = await svc(`UPDATE public.declutter_refunds SET fee_policy = 'full_platform_absorbs' WHERE stripe_payment_intent_id = 'pi_so_c'`);
ok(!Array.isArray(badPolicy) && /declutter_refunds_policy|violates/.test(badPolicy.error),
  "the policy CHECK refuses seller_out with the platform absorbing the fee");
const anonCall = await me(BUYER, `SELECT public.declutter_seller_out_fee_notice('${cRes?.refund_id}')`);
ok(!Array.isArray(anonCall) && /permission denied/.test(anonCall.error), "a member cannot call declutter_seller_out_fee_notice");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
