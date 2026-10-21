#!/usr/bin/env node
/**
 * PGlite proof for 20261021130506_declutter_delivery_raise_pay (Q1929, spec
 * row 40: "the buyer may raise the pay to attract a Helpr"; owner 2026-10-21:
 * build it). On top of Declutter slices 1-4, slice 5 delivery
 * (20261017055505) and the no-code drop-off (20261018183715,
 * 20261018184535). The new migration is applied 3 times (replay-safety).
 *
 *   node src/test/pglite/declutterDeliveryRaise.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDeliveryRaise.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterDeliveryRaise.pglite.mjs
 *
 * Proves: a PAID raise keeps the task open at the new pay (fee re-priced, stamp
 * written, window not restarted); the Helpr's payout is the raised pay minus the
 * fee and the payout queue names each raise's own charge; an unpaid, replaced
 * or wrong-amount page changes nothing on the task; a replayed webhook is a
 * no-op; a raise on a taken / late task is refused, and one paid after the
 * task was taken is refunded; when nobody takes it every paid amount (the
 * delivery fee AND each raise, card fee included) is refunded exactly once,
 * each on its own charge; the hidden switch refuses an ordinary account.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";
import { raiseCardFeeCents, RAISE_MAX_TOTAL_CENTS, RAISE_MIN_CENTS } from "../../lib/declutter/raiseFee.ts";

const NEW_FILE = "20261021130506_declutter_delivery_raise_pay.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  "20261018183715_declutter_handover_no_qr_no_code.sql",
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER3, OUTSIDER, ADMIN } = USERS;
const HELPR = USERS.BUYER2;   // a payout account, 18+, a tester
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: NEW_FILE, times: 3 });
const stmts = setupStatements({ times: 1, times3b: 1, extra });
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
stmts.splice(2, 0, `
  CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[1]);
    RETURN jsonb_build_object('action', p_rungs[1]);
  END $$;
  REVOKE ALL ON FUNCTION public.apply_consequence_ladder(uuid, text, text, uuid, int, text[], text[], jsonb, boolean, int, boolean, text, text) FROM PUBLIC, anon, authenticated;`);
for (const sql of stmts) await db.exec(sql);
await db.exec(CARDS_SQL);
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT s, d, '00:00', '23:59' FROM unnest(ARRAY['${SELLER}', '${SELLER2}']::uuid[]) s, generate_series(0, 6) d;`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function as(role, uid, sql) {
  try {
    await db.exec(`${uid ? `SET request.jwt.claim.sub = '${uid}';` : ""} SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const me = (uid, sql) => as("authenticated", uid, sql);
const anon = (sql) => as("anon", null, sql);
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `99999999-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PICK = { lat: 30.451234, lng: -91.154321 };
const DROP = { lat: 30.496234, lng: -91.154321 };
const slot = one(await svc(`SELECT (date_trunc('hour', now()) + interval '26 hours')::text`));
const task = async (id) => (await svc(`SELECT * FROM public.helpr_tasks WHERE id = '${id}'`))[0];
const raiseRow = async (id) => (await svc(`SELECT * FROM public.declutter_delivery_raises WHERE id = '${id}'`))[0];
const fee = (pay) => Math.min(pay, Math.round(pay * 0.05) + 70);

async function paidDelivery(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Raise item ${n}`, price, floor: Math.min(price, 100) }));
  await svc(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${I(n)}'`);
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  await svc(`SELECT public.declutter_set_delivery_dropoff('${buyer}', '${seller}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', ${DROP.lat}, ${DROP.lng})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'delivery')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_order_${n}', ${o.total_cents}, now(), 150)`);
  const t = one(await svc(`SELECT task_id FROM public.declutter_order_deliveries WHERE order_id = '${o.order_id}'`));
  return { ...o, task: t };
}
const start = (uid, orderId, cents) => as("authenticated", uid, `SELECT * FROM public.declutter_delivery_raise_start('${orderId}', ${cents})`);
const attach = (id, cs) => svc(`SELECT public.declutter_delivery_raise_attach('${id}', '${cs}')`);
const paid = (id, cs, pi, cents) => svc(`SELECT public.declutter_delivery_raise_paid('${id}', '${cs}', '${pi}', ${cents}, false)`);
/** A raise started, its page attached, and paid in full. */
async function raiseAndPay(uid, orderId, cents, tag) {
  const r = (await start(uid, orderId, cents))[0];
  await attach(r.raise_id, `cs_test_${tag}`);
  const answer = one(await paid(r.raise_id, `cs_test_${tag}`, `pi_raise_${tag}`, r.total_cents));
  return { ...r, answer };
}

// 0. The migration is there (RED with NEW_MIGRATION=skip), and 3 applies left one of each object.
ok(one(await svc(`SELECT to_regclass('public.declutter_delivery_raises')::text`)) === "declutter_delivery_raises",
  "declutter_delivery_raises exists");
ok(one(await svc(`SELECT count(*)::int FROM pg_constraint WHERE conname = 'helpr_tasks_raised'`)) === 1
  && one(await svc(`SELECT count(*)::int FROM pg_trigger WHERE tgname = 'trg_declutter_delivery_raises_on_task_close'`)) === 1,
  "applied 3 times: one stamp CHECK, one close trigger (replay-safe)");

// 1. The card fee: SQL and the client mirror agree on every allowed raise, and it covers Stripe's cut of the charge.
const sqlFees = await svc(`SELECT g AS r, public.declutter_delivery_raise_card_fee_cents(g) AS f FROM generate_series(${RAISE_MIN_CENTS}, ${RAISE_MAX_TOTAL_CENTS}, 100) g`);
const mismatched = Array.isArray(sqlFees) ? sqlFees.filter((x) => x.f !== raiseCardFeeCents(x.r)) : [{ r: "error" }];
ok(Array.isArray(sqlFees) && sqlFees.length === 146 && mismatched.length === 0,
  `the SQL card fee equals src/lib/declutter/raiseFee.ts for all ${Array.isArray(sqlFees) ? sqlFees.length : 0} allowed raises`);
const short = Array.isArray(sqlFees) ? sqlFees.filter((x) => Math.round((x.r + x.f) * 0.029) + 30 > x.f) : [1];
ok(short.length === 0, "the card fee always covers Stripe's 2.9% + 30c on the raise's whole charge (the buyer pays the card cost)");
ok(raiseCardFeeCents(1000) === 61 && one(await svc(`SELECT public.declutter_delivery_raise_card_fee_cents(1000)`)) === 61,
  "a $10 raise has a $0.61 card fee ($10.61 charged)");

// 2. Who may start one: the hidden switch first, then only the order's buyer.
const P1 = await paidDelivery(1, BUYER, SELLER, 5000);
const T1 = await task(P1.task);
const D1 = P1.delivery_cents;
ok(T1?.status === "open" && T1.pay_cents === D1 && T1.raised_cents === 0, `a paid delivery opens its task at the delivery fee (${D1})`);
ok(refused(await start(OUTSIDER, P1.order_id, 1000), /feature_disabled/), "an ordinary account (switch off for them) is refused: feature_disabled");
ok(refused(await me(OUTSIDER, `SELECT public.declutter_delivery_raise_status('${P1.order_id}')`), /feature_disabled/),
  "  and cannot read raise status either");
ok(refused(await anon(`SELECT * FROM public.declutter_delivery_raise_start('${P1.order_id}', 1000)`), /permission denied/), "anon cannot start one");
ok(refused(await start(BUYER3, P1.order_id, 1000), /item_not_found/), "another member is told nothing");
ok(refused(await start(SELLER, P1.order_id, 1000), /item_not_found/), "the seller cannot raise the buyer's delivery");
ok(refused(await start(BUYER, P1.order_id, 450), /invalid_raise/) && refused(await start(BUYER, P1.order_id, 550), /invalid_raise/),
  "under $5, or not whole dollars, is refused");
ok(refused(await start(BUYER, P1.order_id, 15100), /raise_limit/), "over $150 in all is refused");

// 3. An unpaid page changes nothing; a replaced page paid late is refunded, never applied.
const before = JSON.stringify(await task(P1.task));
const r1 = (await start(BUYER, P1.order_id, 1000))[0];
ok(r1?.raise_cents === 1000 && r1.card_fee_cents === 61 && r1.total_cents === 1061, "a $10 raise is a $10.61 page");
await attach(r1.raise_id, "cs_test_r1");
ok(refused(await attach(r1.raise_id, "cs_test_other"), /raise_not_waiting/), "the first page attached wins");
ok(JSON.stringify(await task(P1.task)) === before, "an UNPAID raise page changes nothing on the task");
const r2 = (await start(BUYER, P1.order_id, 2000))[0];
ok(r2?.superseded_session_id === "cs_test_r1" && (await raiseRow(r1.raise_id)).status === "superseded",
  "starting another raise supersedes the open page (the edge expires it)");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_delivery_raises WHERE task_id = '${P1.task}' AND status = 'awaiting_payment'`)) === 1,
  "one open page per task");
await attach(r2.raise_id, "cs_test_r2");
const late1 = one(await paid(r1.raise_id, "cs_test_r1", "pi_raise_r1", 1061));
const R1 = await raiseRow(r1.raise_id);
ok(late1?.result === "refund" && late1.reason === "page_replaced" && R1.status === "refunding" && R1.refund_cents === 1061,
  "the replaced page, paid anyway, is refunded in full ($10.61)");
ok(JSON.stringify(await task(P1.task)) === before, "  and the task is unchanged");
ok(one(await paid(r2.raise_id, "cs_test_WRONG", "pi_raise_r2", 2000 + r2.card_fee_cents))?.result === "session_mismatch"
  && JSON.stringify(await task(P1.task)) === before, "a payment naming another page is not applied");

// 4. A PAID raise keeps the task open at the new pay; the window is not restarted.
const a2 = one(await paid(r2.raise_id, "cs_test_r2", "pi_raise_r2", r2.total_cents));
const T1b = await task(P1.task);
ok(a2?.result === "applied" && T1b.status === "open" && T1b.pay_cents === D1 + 2000 && T1b.fee_cents === fee(D1 + 2000)
  && T1b.raised_cents === 2000,
  `a paid $20 raise: still open, pay ${D1} -> ${T1b.pay_cents}, fee re-priced 5% + 70c -> ${T1b.fee_cents}, stamped raised_cents`);
ok(new Date(T1b.open_until).getTime() === new Date(T1.open_until).getTime(), "the open window is not restarted (refund rule, see the migration header)");
ok((await raiseRow(r2.raise_id)).status === "applied" && (await raiseRow(r2.raise_id)).applied_at !== null, "the raise row is stamped applied");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Delivery pay raised'`)) === 1,
  "the buyer is told");

// 5. A replayed webhook is a no-op.
const T1snap = JSON.stringify(await task(P1.task));
const rep = one(await paid(r2.raise_id, "cs_test_r2", "pi_raise_r2", r2.total_cents));
ok(rep?.result === "already" && rep.status === "applied" && JSON.stringify(await task(P1.task)) === T1snap,
  "the same payment again: 'already', the pay is not raised twice");
ok(one(await paid(r2.raise_id, "cs_test_r2", "pi_raise_other", r2.total_cents))?.result === "other_payment"
  && JSON.stringify(await task(P1.task)) === T1snap, "another payment on the same row is not applied");

// 6. The buyer's status; Helprs see the raised take-home.
const st = one(await me(BUYER, `SELECT public.declutter_delivery_raise_status('${P1.order_id}')`));
ok(st?.can_raise === true && st.raised_cents === 2000 && st.room_cents === 13000 && st.delivery_cents === D1
  && st.raises.length === 2 && st.raises.some((x) => x.status === "applied" && x.raise_cents === 2000),
  "the buyer reads their raises (applied and refunding), what is left to raise, and that they can raise");
ok(refused(await me(BUYER3, `SELECT public.declutter_delivery_raise_status('${P1.order_id}')`), /item_not_found/),
  "another member reads nothing");
ok(one(await me(HELPR, `SELECT take_home_cents FROM public.helpr_tasks_open_near(NULL, NULL, 50) WHERE task_id = '${P1.task}'`)) === D1 + 2000 - fee(D1 + 2000),
  "an eligible Helpr sees the raised take-home pay");

// 7. Taken: no more raises; the payout is the raised pay minus the fee, funded per charge.
ok(one(await me(HELPR, `SELECT public.helpr_task_accept('${P1.task}', '${slot}')`))?.result === "accepted", "a Helpr takes it at the new pay");
ok(refused(await start(BUYER, P1.order_id, 1000), /delivery_not_waiting/), "a taken delivery cannot be raised");
ok(one(await me(BUYER, `SELECT public.declutter_delivery_raise_status('${P1.order_id}')`))?.can_raise === false, "  and the status says so");
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('helpr-tasks', '${HELPR}/task/${P1.task}/p.jpg'), ('helpr-tasks', '${HELPR}/task/${P1.task}/d.jpg')`);
await me(HELPR, `SELECT public.helpr_task_picked_up('${P1.task}', '${HELPR}/task/${P1.task}/p.jpg', ${PICK.lat}, ${PICK.lng})`);
await me(HELPR, `SELECT public.helpr_task_delivered('${P1.task}', '${HELPR}/task/${P1.task}/d.jpg', ${DROP.lat}, ${DROP.lng}, NULL)`);
ok(one(await me(BUYER, `SELECT public.helpr_task_customer_confirm('${P1.task}')`))?.result === "handed_over", "delivered and confirmed");
const hp = (await svc(`SELECT * FROM public.helpr_task_payouts WHERE task_id = '${P1.task}'`))[0];
ok(hp?.pay_cents === D1 + 2000 && hp.fee_cents === fee(D1 + 2000) && hp.amount_cents === D1 + 2000 - fee(D1 + 2000),
  `the Helpr's payout is the raised pay minus the fee: ${D1 + 2000} - ${fee(D1 + 2000)} = ${hp?.amount_cents}`);
const due = (await svc(`SELECT * FROM public.helpr_task_payouts_due(10) WHERE task_id = '${P1.task}'`))[0];
const parts = due?.raise_parts ?? [];
ok(due?.payment_intent_id === "pi_order_1" && due.raised_cents === 2000 && parts.length === 1
  && parts[0].payment_intent_id === "pi_raise_r2" && parts[0].cents === 2000 && due.amount_cents - 2000 > 0,
  "the payout queue names the order's charge AND the raise's own charge (2000), and the order part stays positive");
ok((await raiseRow(r2.raise_id)).status === "applied"
  && one(await svc(`SELECT count(*)::int FROM public.declutter_delivery_raise_refunds_due(50) WHERE raise_id = '${r2.raise_id}'`)) === 0,
  "a raise the Helpr earned is never refunded");

// 8. A raise paid after a Helpr took the task: refunded, the pay unchanged.
const P2 = await paidDelivery(2, BUYER, SELLER2, 4000);
const r3 = (await start(BUYER, P2.order_id, 1500))[0];
await attach(r3.raise_id, "cs_test_r3");
await me(HELPR, `SELECT public.helpr_task_accept('${P2.task}', '${slot}')`);
const T2 = await task(P2.task);
const a3 = one(await paid(r3.raise_id, "cs_test_r3", "pi_raise_r3", r3.total_cents));
ok(T2.status === "accepted" && a3?.result === "refund" && a3.reason === "not_waiting" && (await task(P2.task)).pay_cents === P2.delivery_cents,
  "paid after a Helpr took it: refunded in full, the pay unchanged");

// 9. Too late to raise, and a wrong amount.
const P3 = await paidDelivery(3, BUYER3, SELLER, 3000);
await svc(`UPDATE public.helpr_tasks SET open_until = now() + interval '30 minutes' WHERE id = '${P3.task}'`);
ok(refused(await start(BUYER3, P3.order_id, 1000), /raise_too_late/), "under an hour of the window left: refused");
await svc(`UPDATE public.helpr_tasks SET open_until = now() + interval '20 hours' WHERE id = '${P3.task}'`);
const r4 = (await start(BUYER3, P3.order_id, 1000))[0];
await attach(r4.raise_id, "cs_test_r4");
const a4 = one(await paid(r4.raise_id, "cs_test_r4", "pi_raise_r4", 999));
ok(a4?.result === "refund" && a4.reason === "amount_mismatch" && (await raiseRow(r4.raise_id)).refund_cents === 999
  && (await task(P3.task)).pay_cents === P3.delivery_cents, "a payment of the wrong amount: what was paid goes back, nothing applied");

// 10. Nobody takes it: every paid amount is refunded exactly once, each on its own charge.
const P4 = await paidDelivery(4, BUYER3, SELLER2, 6000);
const x1 = await raiseAndPay(BUYER3, P4.order_id, 1000, "x1");
const x2 = await raiseAndPay(BUYER3, P4.order_id, 500, "x2");
const T4 = await task(P4.task);
ok(x1.answer?.result === "applied" && x2.answer?.result === "applied" && T4.pay_cents === P4.delivery_cents + 1500 && T4.raised_cents === 1500,
  "two paid raises add up ($10 + $5)");
await svc(`UPDATE public.helpr_tasks SET open_until = now() - interval '1 minute' WHERE id = '${P4.task}'`);
await svc(`SELECT public.helpr_task_sweep()`);
await svc(`SELECT public.helpr_task_sweep()`);
const deliveryRefunds = await svc(`SELECT * FROM public.declutter_delivery_refunds WHERE order_id = '${P4.order_id}'`);
const raiseRefunds = await svc(`SELECT * FROM public.declutter_delivery_raises WHERE order_id = '${P4.order_id}' AND status = 'refunding'`);
ok((await task(P4.task)).status === "unfilled" && deliveryRefunds.length === 1 && deliveryRefunds[0].refund_cents === P4.delivery_cents
  && deliveryRefunds[0].stripe_payment_intent_id === "pi_order_4",
  "the delivery fee: one refund, the original fee, on the order's charge (swept twice)");
ok(raiseRefunds.length === 2 && raiseRefunds.every((r) => r.refund_reason === "no_helpr" && r.refund_cents === r.paid_cents)
  && raiseRefunds.map((r) => r.stripe_payment_intent_id).sort().join() === "pi_raise_x1,pi_raise_x2",
  "each raise: one refund of everything paid (card fee included), on its own charge");
const refundedTotal = deliveryRefunds[0].refund_cents + raiseRefunds.reduce((s, r) => s + r.refund_cents, 0);
ok(refundedTotal === P4.delivery_cents + x1.total_cents + x2.total_cents,
  `every paid amount comes back once: ${P4.delivery_cents} + ${x1.total_cents} + ${x2.total_cents} = ${refundedTotal}`);
const dueRaise = await svc(`SELECT * FROM public.declutter_delivery_raise_refunds_due(50) WHERE order_id = '${P4.order_id}'`);
ok(dueRaise.length === 2 && dueRaise.every((d) => d.buyer_id === BUYER3 && d.checkout_session_id?.startsWith("cs_test_")),
  "both are in the raise-refund queue with the buyer and the page (its Stripe mode)");
ok(one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${BUYER3}' AND title = 'Your raise is coming back'`)) >= 1,
  "the buyer is told the raise comes back");
ok(one(await svc(`SELECT public.declutter_delivery_raise_refund_executed('${x1.raise_id}', 're_x1', true, NULL)`)) === "refunded"
  && one(await svc(`SELECT public.declutter_delivery_raise_refund_executed('${x1.raise_id}', 're_x1b', true, NULL)`)) === "refunded"
  && (await raiseRow(x1.raise_id)).stripe_refund_ref === "re_x1",
  "a refunded raise is final: a second report changes nothing");
ok(one(await svc(`SELECT public.declutter_delivery_raise_refund_executed('${x2.raise_id}', NULL, false, 'card_declined')`)) === "refunding"
  && (await raiseRow(x2.raise_id)).refund_attempts === 1, "a failed raise refund backs off and is retried");
ok(one(await svc(`SELECT count(*)::int FROM public.declutter_delivery_raise_refunds_due(50) WHERE order_id = '${P4.order_id}'`)) === 0,
  "  (out of the queue until its back-off ends)");
ok(one(await svc(`SELECT public.declutter_delivery_raise_refund_reversed('${x1.raise_id}', 're_other', 'failed')`)) === "unchanged"
  && one(await svc(`SELECT public.declutter_delivery_raise_refund_reversed('${x1.raise_id}', 're_x1', 'failed')`)) === "reopened"
  && (await raiseRow(x1.raise_id)).status === "refunding", "only the recorded refund's failure reopens it");
ok(refused(await start(BUYER3, P4.order_id, 1000), /delivery_not_waiting/), "an unfilled delivery cannot be raised");

// 11. A cancelled sale (the task cancelled while open) refunds the raise too.
const P5 = await paidDelivery(5, BUYER, SELLER, 2500);
const y1 = await raiseAndPay(BUYER, P5.order_id, 800, "y1");
ok(y1.answer?.result === "applied", "a raise is applied");
const closed = await svc(`SELECT public.declutter_close_paid_order('${P5.order_id}', 'seller_backed_out', NULL, NULL, NULL)`);
const Y1 = await raiseRow(y1.raise_id);
ok(Array.isArray(closed) && (await task(P5.task)).status === "cancelled" && Y1.status === "refunding"
  && Y1.refund_reason === "delivery_cancelled" && Y1.refund_cents === y1.total_cents, "the sale cancelled: the raise is refunded in full");

// 12. Service-only functions.
for (const fn of [
  `declutter_delivery_raise_paid('${r2.raise_id}', 'cs_test_r2', 'pi_x', 100, false)`, `declutter_delivery_raise_attach('${r2.raise_id}', 'cs_test_x')`,
  "declutter_delivery_raise_refunds_due(1)", `declutter_delivery_raise_refund_executed('${r2.raise_id}', 're_x', true, NULL)`,
  `declutter_delivery_raise_refund_defer('${r2.raise_id}', 5)`, `declutter_delivery_raise_refund_reversed('${r2.raise_id}', 're_x', 'x')`,
  "helpr_task_payouts_due(1)",
]) ok(refused(await me(BUYER, `SELECT public.${fn}`), /permission denied/), `a member cannot call ${fn.split("(")[0]}`);
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_delivery_raises`), /permission denied/), "members have no privilege on the raises table");
ok(refused(await anon(`SELECT public.declutter_delivery_raise_status('${P1.order_id}')`), /permission denied/), "anon cannot read status");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
