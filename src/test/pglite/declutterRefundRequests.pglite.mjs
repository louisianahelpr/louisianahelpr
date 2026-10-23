#!/usr/bin/env node
/**
 * PGlite proof for 20261023142333_declutter_refund_requests (board 141, Declutter side "141d"; docs/OPEN.md
 * Q2272 + Q2151 (a)). Owner rulings: a refund can be asked within 24 hours of pickup and the seller's payout
 * waits until the sale is final (2026-10-21); a part refund is EXACTLY the amount offered (2026-10-21); the
 * buyer always gets the full 24 hours, the seller can say no, no answer in 24 hours goes to Louisiana Helpr,
 * a full refund is everything back except the card fee with the buyer's fee included and the item goes back
 * (2026-10-22 #2, #3); a delivery fee that paid a Helpr for the trip is kept (#5).
 * On top of Declutter slices 1-4, Helpr delivery, the no-code handover, the raise (Q1929) and the former-
 * member migration (Q2307). The new migration is applied 3 times (replay-safety).
 *
 *   node src/test/pglite/declutterRefundRequests.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterRefundRequests.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterRefundRequests.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const NEW_FILE = "20261023142333_declutter_refund_requests.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql",
  "20261018183715_declutter_handover_no_qr_no_code.sql",
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  // The newest declutter_mark_order_paid before this change (manage listing).
  "20261020064354_declutter_manage_listing.sql",
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, BUYER2, BUYER3, OUTSIDER, ADMIN } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 }, ...BEFORE.map((file) => ({ file, times: 1 }))];
if (!skip) extra.push(process.env.MIGRATION_PATH ? { path: process.env.MIGRATION_PATH, times: 3 } : { file: NEW_FILE, times: 3 });
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// Prod-shaped stubs the chain calls (prod has each: read 2026-10-23 from the migrations that define them).
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
  -- 20261019070737: a payout marked for sending before the Stripe call.
  CREATE TABLE public.payout_send_marks (payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
    payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));`);
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
const I = (n) => `14141414-0000-0000-0000-${String(n).padStart(12, "0")}`;
const CARD_FEE = 150;

/** A paid pickup order: one item at `price`, card fee CARD_FEE. */
async function paidOrder(n, buyer, seller, price) {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Refund item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', 'pickup_home')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_rr_${n}', ${o?.total_cents}, now(), ${CARD_FEE})`);
  return o ?? {};
}
/** The buyer's "I got it". */
const gotIt = (buyer, id) => me(buyer, `SELECT public.declutter_confirm_handover('${id}', 'buyer', NULL) AS r`);
/** Time passing: the handover happened `mins` minutes ago. */
const handedAgo = (id, mins) => svc(`UPDATE public.declutter_orders SET handed_over_at = now() - interval '${mins} minutes' WHERE id = '${id}'`);
const payout = async (id) => (await svc(`SELECT * FROM public.declutter_payouts WHERE order_id = '${id}'`))[0];
const due = async (id) => (await svc(`SELECT payout_id FROM public.declutter_payouts_due(100) WHERE order_id = '${id}'`)).length === 1;
const req = async (id) => (await svc(`SELECT * FROM public.declutter_refund_requests WHERE order_id = '${id}'`))[0] ?? {};
const refundRow = async (id) => (await svc(`SELECT * FROM public.declutter_refunds WHERE order_id = '${id}'`))[0];
const ask = (uid, id, reason = "not_as_described", note = "The shade has a big tear that was not in the photos.") =>
  me(uid, `SELECT public.declutter_ask_refund('${id}', '${reason}', '${note}') AS r`);
const answer = (uid, rid, a, cents = "NULL") => me(uid, `SELECT public.declutter_answer_refund('${rid}', '${a}', ${cents}) AS r`);
const takeOffer = (uid, rid, yes) => me(uid, `SELECT public.declutter_answer_refund_offer('${rid}', ${yes}) AS r`);
const view = async (uid, id) => one(await me(uid, `SELECT public.declutter_refund_request_view('${id}') AS v`));

// ---------------------------------------------------------------------------
// A. The hold: a handover pays the seller only once the sale is final (Q2151 (a); owner 10-21, 10-22 #2).
const A = await paidOrder(1, BUYER, SELLER, 1200);
ok(A.total_cents === 1200 + 130, "setup: order A is paid ($12 + F1 buyer fee $1.30)");
ok(one(await gotIt(BUYER, A.order_id))?.result === "handed_over", "the buyer's \"I got it\" completes the handover");
ok((await payout(A.order_id))?.status === "pending", "  one payout row, pending");
// A second delivery of the same checkout event after the handover (a Stripe redelivery).
const replay = one(await svc(`SELECT public.declutter_mark_order_paid('${A.order_id}', 'pi_rr_1', ${A.total_cents}, now(), ${CARD_FEE}) AS r`));
ok(replay?.result === "already_paid" && !(await svc(`SELECT 1 FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_rr_1'`)).length,
  "a replayed payment event for a handed-over sale is 'already_paid', never a full refund");
ok(!(await due(A.order_id)), "  but NOT offered to the payout run: the buyer has 24 hours (I got it does not end them, #2)");
const notice = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Handover done' ORDER BY created_at DESC LIMIT 1`))[0]?.message ?? "";
ok(/24 hours after the handover/.test(notice) && !/on its way/.test(notice), "  the seller is told the money comes 24 hours after the handover, not that it is on its way");
const bnotice = (await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'Enjoy your item' ORDER BY created_at DESC LIMIT 1`))[0]?.message ?? "";
ok(/within 24 hours/.test(bnotice) && !/final/.test(bnotice), "  the buyer is told about the 24 hours, not that the sale is final");
await handedAgo(A.order_id, 24 * 60 + 5);
ok(!(await due(A.order_id)), "24 h 5 min later: still held (the 10-minute margin)");
await handedAgo(A.order_id, 24 * 60 + 11);
ok(await due(A.order_id), "24 h 11 min later, nothing asked: the payout is offered");
ok(refused(await ask(BUYER, A.order_id), /refund_window_over/), "  and a refund can no longer be asked");
ok(refused(await me(BUYER, `SELECT public.declutter_report_problem('${A.order_id}', 'damaged', 'Broken leg', NULL)`), /sale_final/),
  "  nor a problem reported");

// B. Who may ask, and when.
const B = await paidOrder(2, BUYER2, SELLER, 4000);
ok(refused(await ask(BUYER2, B.order_id), /refund_before_handover/), "before the handover a refund cannot be asked (Report a problem instead)");
await gotIt(BUYER2, B.order_id);
ok(refused(await ask(OUTSIDER, B.order_id), /feature_disabled/), "the hidden switch refuses an ordinary (non-tester) account");
ok(refused(await ask(SELLER, B.order_id), /item_not_found/), "the seller cannot ask on their own sale");
ok(refused(await ask(BUYER3, B.order_id), /item_not_found/), "a stranger cannot ask (not told it exists)");
ok(refused(await ask(BUYER2, B.order_id, "no_show"), /invalid_reason/), "only not as described, damaged or not received");
ok(refused(await ask(BUYER2, B.order_id, "damaged", "   "), /note_required/), "words are needed");
ok(refused(await anon(`SELECT public.declutter_ask_refund('${B.order_id}', 'damaged', 'x')`), /permission denied/), "anon cannot execute it");
for (const fn of ["declutter_refund_after_handover('" + B.order_id + "', 'refund_request_full', NULL)",
                  "declutter_rebook_payout('" + B.order_id + "', 0)",
                  "declutter_refund_request_sweep()",
                  "declutter_sale_final('" + B.order_id + "')"]) {
  ok(refused(await me(BUYER2, `SELECT public.${fn}`), /permission denied/), `a member cannot call ${fn.split("(")[0]}`);
}
const vB0 = await view(BUYER2, B.order_id);
ok(vB0?.can_ask === true && vB0.full_refund_cents === 4000 + 270 - CARD_FEE, "the buyer's view: can ask; a full refund would be $41.20 (price + buyer fee - card fee)");
ok(one(await ask(BUYER2, B.order_id, "damaged", "The leg is cracked."))?.result === "asked", "the buyer asks within the 24 hours");
ok(refused(await ask(BUYER2, B.order_id), /refund_already_asked/), "one request per sale");
const rB = await req(B.order_id);
ok(rB?.status === "open" && rB.answer_by != null, "  the request waits for the seller, with a 24-hour clock");
await handedAgo(B.order_id, 24 * 60 + 30);
ok(!(await due(B.order_id)), "the payout stays held past the 24 hours while the request is open");
ok((await svc(`SELECT 1 FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Refund request'`)).length >= 1, "  the seller was told");

// C. The seller refunds in full (#3): everything back except the card fee; the item goes back; no payout.
ok(refused(await answer(BUYER2, rB.id, "full"), /refund_not_found/), "the buyer cannot answer for the seller");
ok(refused(await answer(SELLER, rB.id, "maybe"), /invalid_answer/), "an unknown answer is refused");
const cFull = one(await answer(SELLER, rB.id, "full"));
ok(cFull?.result === "refunded", "the seller refunds in full");
const rfB = await refundRow(B.order_id);
ok(rfB?.reason === "refund_request_full" && rfB.fee_policy === "keep_card_fee" && rfB.refund_cents === 4000 + 270 - CARD_FEE
   && rfB.card_fee_cents === CARD_FEE && rfB.status === "pending",
  "  one refund row: $41.20 = item + buyer's fee - card fee, keep_card_fee, pending for declutter-money");
const pB = await payout(B.order_id);
ok(pB?.refunded_cents === 4000 && pB.amount_cents === 0 && pB.status === "nothing_due", "  the seller's payout becomes $0 (nothing_due)");
ok((await req(B.order_id))?.status === "agreed", "  the request is agreed");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(2)}'`)) === "withdrawn", "  the item goes back to the seller (listing withdrawn)");
ok(!(await due(B.order_id)), "  and nothing is offered to the payout run");
ok(refused(await answer(SELLER, rB.id, "full"), /refund_already_answered/), "a second answer is refused (one money move)");
ok((await svc(`SELECT count(*)::int AS n FROM public.declutter_refunds WHERE order_id = '${B.order_id}'`))[0]?.n === 1, "  still one refund row");

// D. The seller offers part; the buyer takes it: EXACTLY the amount, out of the seller's payout.
const D = await paidOrder(3, BUYER3, SELLER, 4000);
await gotIt(BUYER3, D.order_id);
await ask(BUYER3, D.order_id);
const rD = await req(D.order_id);
ok(refused(await answer(SELLER, rD.id, "part", 4000), /invalid_amount/), "an offer of the whole item price is refused (that is Refund in full)");
ok(refused(await answer(SELLER, rD.id, "part", 0), /invalid_amount/), "an offer of $0 is refused");
ok(refused(await answer(SELLER, rD.id, "part", "NULL"), /invalid_amount/), "an offer with no amount is refused (templates leave it empty)");
ok(one(await answer(SELLER, rD.id, "part", 1250))?.result === "offered", "the seller offers $12.50");
ok(!(await due(D.order_id)), "  the payout waits for the buyer's answer");
ok(refused(await takeOffer(SELLER, rD.id, true), /refund_not_found/), "the seller cannot take their own offer");
ok(one(await takeOffer(BUYER3, rD.id, true))?.result === "refunded", "the buyer takes it");
const rfD = await refundRow(D.order_id);
ok(rfD?.reason === "refund_request_part" && rfD.fee_policy === "agreed_part" && rfD.refund_cents === 1250 && rfD.card_fee_cents === 0,
  "  one refund row of EXACTLY $12.50 (agreed_part)");
const pD = await payout(D.order_id);
ok(pD?.refunded_cents === 1250 && pD.amount_cents === 2750 && pD.status === "pending", "  the seller's payout is $27.50");
ok(!(await due(D.order_id)), "  the payout waits while the buyer's part refund is not through yet (money review should-fix 1)");
await svc(`UPDATE public.declutter_refunds SET status = 'succeeded', stripe_refund_ref = 're_rr_3', executed_at = now() WHERE order_id = '${D.order_id}'`);
ok(await due(D.order_id), "  then the sale is final at once: the payout is offered inside the 24 hours");
ok(one(await svc(`SELECT status FROM public.declutter_items WHERE id = '${I(3)}'`)) === "completed", "  the buyer keeps the item");

// E. The buyer says no to an offer: Louisiana Helpr decides; "Pay the seller" ends the hold.
const E = await paidOrder(4, BUYER, SELLER2, 3000);
await gotIt(BUYER, E.order_id);
await ask(BUYER, E.order_id, "not_received", "The porch was empty when I got there.");
const rE = await req(E.order_id);
await answer(SELLER2, rE.id, "part", 500);
ok(one(await takeOffer(BUYER, rE.id, false))?.result === "to_admin", "the buyer asks Louisiana Helpr to decide");
const rE2 = await req(E.order_id);
const probE = (await svc(`SELECT * FROM public.declutter_problems WHERE id = '${rE2.problem_id}'`))[0] ?? {};
ok(rE2.status === "to_admin" && probE?.status === "open" && probE.reporter_side === "buyer" && probE.reason === "not_received"
   && /offered \$5\.00/.test(probE.note), "  an open problem carries the buyer's words and the offer");
await handedAgo(E.order_id, 3 * 24 * 60);
ok(!(await due(E.order_id)), "  the payout is held while it is open, however long");
const decE = one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probE.id}', 'pay_seller', 'buyer', false, 'Photos show it delivered') AS r`));
ok(decE?.result === "seller_keeps", "the admin decides: the seller keeps the payment");
ok(await due(E.order_id) && (await payout(E.order_id))?.amount_cents === 3000, "  the full payout is offered");
ok(!(await refundRow(E.order_id)), "  and nothing is refunded");

// F. The seller says no; the buyer reports a problem in the 24 hours after the "no"; the admin refunds.
const F = await paidOrder(5, BUYER2, SELLER2, 2000);
await gotIt(BUYER2, F.order_id);
await ask(BUYER2, F.order_id);
const rF = await req(F.order_id);
ok(one(await answer(SELLER2, rF.id, "decline"))?.result === "declined", "the seller says no (#3)");
await handedAgo(F.order_id, 24 * 60 + 20);
await svc(`UPDATE public.declutter_refund_requests SET declined_at = now() - interval '23 hours' WHERE id = '${rF.id}'`);
ok(!(await due(F.order_id)), "the payout waits for 24 hours after the \"no\" too");
const vF = await view(BUYER2, F.order_id);
ok(vF?.can_report === true && vF.can_ask === false, "  the buyer's view offers Report a problem");
ok(refused(await me(SELLER2, `SELECT public.declutter_report_problem('${F.order_id}', 'other', 'Buyer is lying', NULL)`), /sale_final/),
  "the seller cannot report a problem on a handed-over sale");
const probF = one(await me(BUYER2, `SELECT public.declutter_report_problem('${F.order_id}', 'not_as_described', 'It is the wrong colour.', NULL) AS id`));
ok(typeof probF === "string", "the buyer reports a problem after the seller's \"no\"");
ok((await req(F.order_id))?.status === "to_admin", "  the request goes with it to the admin");
ok(refused(await me(SELLER2, `SELECT public.declutter_admin_decide_problem('${probF}', 'refund_buyer', 'seller', false, 'x')`), /not_authorized/),
  "only an admin decides");
const decF = one(await me(ADMIN, `SELECT public.declutter_admin_decide_problem('${probF}', 'refund_buyer', 'seller', true, 'Not as described') AS r`));
const rfF = await refundRow(F.order_id);
ok(decF?.result === "refund" && rfF?.reason === "not_as_described" && rfF.fee_policy === "full_seller_pays_fee" && rfF.refund_cents === 2000 + 170,
  "the admin refunds the buyer in full (seller at fault: every cent, $21.70)");
const debtF = (await svc(`SELECT amount_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${rfF?.id}'`))[0];
ok(debtF?.amount_cents === CARD_FEE, "  the card fee is the seller's debt");
ok((await payout(F.order_id))?.amount_cents === 0 && (await payout(F.order_id))?.status === "nothing_due", "  the seller's payout is $0");
ok((await svc(`SELECT count(*)::int AS n FROM public.declutter_strikes WHERE user_id = '${SELLER2}' AND removed_at IS NULL`))[0]?.n >= 1, "  and the seller has a strike");
ok((await svc(`SELECT 1 FROM public.admin_audit_log WHERE target_id = '${probF}'`)).length === 1, "  the decision is in the audit log");

// G. After the "no" window: a report is refused and the payout goes.
const G = await paidOrder(6, BUYER3, SELLER, 1500);
await gotIt(BUYER3, G.order_id);
await ask(BUYER3, G.order_id);
const rG = await req(G.order_id);
await answer(SELLER, rG.id, "decline");
await handedAgo(G.order_id, 48 * 60);
await svc(`UPDATE public.declutter_refund_requests SET declined_at = now() - interval '24 hours 11 minutes' WHERE id = '${rG.id}'`);
ok(refused(await me(BUYER3, `SELECT public.declutter_report_problem('${G.order_id}', 'damaged', 'Late report', NULL)`), /sale_final/),
  "24 hours after the \"no\" the buyer can no longer report a problem");
ok(await due(G.order_id), "  and the payout is offered");

// H. The clock: no seller answer in 24 hours, or no buyer answer to an offer, goes to an admin.
const H1 = await paidOrder(7, BUYER, SELLER, 1000);
await gotIt(BUYER, H1.order_id);
await ask(BUYER, H1.order_id);
const H2 = await paidOrder(8, BUYER2, SELLER, 1000);
await gotIt(BUYER2, H2.order_id);
await ask(BUYER2, H2.order_id);
const rH2 = await req(H2.order_id);
await answer(SELLER, rH2.id, "part", 300);
ok((await svc(`SELECT public.declutter_refund_request_sweep() AS s`))[0]?.s?.to_admin === 0, "the sweep leaves requests still inside their clocks");
await svc(`UPDATE public.declutter_refund_requests SET answer_by = now() - interval '1 minute' WHERE order_id = '${H1.order_id}'`);
await svc(`UPDATE public.declutter_refund_requests SET offer_answer_by = now() - interval '1 minute' WHERE id = '${rH2.id}'`);
ok((await svc(`SELECT public.declutter_refund_request_sweep() AS s`))[0]?.s?.to_admin === 2, "the sweep sends both late ones to an admin");
const rH1 = await req(H1.order_id);
ok(rH1.status === "to_admin" && (await svc(`SELECT status FROM public.declutter_problems WHERE id = '${rH1.problem_id}'`))[0]?.status === "open",
  "  the unanswered request is an open problem");
ok(refused(await answer(SELLER, rH1.id, "full"), /refund_already_answered/), "  and the seller can no longer answer it");
ok((await req(H2.order_id))?.status === "to_admin", "  the unanswered offer too");
ok((await svc(`SELECT public.declutter_refund_request_sweep() AS s`))[0]?.s?.to_admin === 0, "a second sweep changes nothing");
const H3 = await paidOrder(9, BUYER3, SELLER2, 1000);
await gotIt(BUYER3, H3.order_id);
await ask(BUYER3, H3.order_id);
const rH3 = await req(H3.order_id);
await svc(`UPDATE public.declutter_refund_requests SET answer_by = now() - interval '1 second' WHERE id = '${rH3.id}'`);
ok(refused(await answer(SELLER2, rH3.id, "full"), /refund_answer_late/), "a seller answering after the 24 hours is refused (an admin decides)");
// One bad request never stops the sweep: an order row gone missing is logged, the next request still goes to an admin.
const H4 = await paidOrder(16, BUYER, SELLER2, 1000);
await gotIt(BUYER, H4.order_id);
await ask(BUYER, H4.order_id);
await svc(`UPDATE public.declutter_refund_requests SET answer_by = now() - interval '1 minute' WHERE order_id IN ('${H3.order_id}', '${H4.order_id}')`);
await db.exec(`CREATE OR REPLACE FUNCTION public.zz_break_refund_rr() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.order_id = '${H3.order_id}' THEN RAISE EXCEPTION 'planted failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER zz_break BEFORE INSERT ON public.declutter_problems FOR EACH ROW EXECUTE FUNCTION public.zz_break_refund_rr();`);
const swH = await svc(`SELECT public.declutter_refund_request_sweep() AS s`);
ok(swH[0]?.s?.to_admin === 1
   && (await req(H4.order_id)).status === "to_admin" && (await req(H3.order_id)).status === "open"
   && (await svc(`SELECT 1 FROM public.cron_defects_seen WHERE fn = 'declutter_refund_request_sweep'`)).length === 1,
  "a request that fails is logged and left for the next run; the others still go to an admin");
await db.exec(`DROP TRIGGER zz_break ON public.declutter_problems; DROP FUNCTION public.zz_break_refund_rr();`);

// I. The seller's card-fee debt: put back and taken again from what is left.
const I1 = await paidOrder(10, BUYER, SELLER2, 1000);
// A $3.00 debt the seller already owes (an earlier seller-fault refund).
await svc(`INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents)
  VALUES (NULL, 'pi_rr_debt', 'seller_backed_out', 'full_seller_pays_fee', 300, 300, 300)`);
await svc(`INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
  SELECT '${SELLER2}', id, 300, 300 FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_rr_debt'`);
await gotIt(BUYER, I1.order_id);
const pI0 = await payout(I1.order_id);
ok(pI0?.debt_cents === 300 && pI0.amount_cents === 700, "setup: the handover took the $3.00 debt: payout $7.00");
await ask(BUYER, I1.order_id);
const rI = await req(I1.order_id);
await answer(SELLER2, rI.id, "part", 900);
await takeOffer(BUYER, rI.id, true);
const pI = await payout(I1.order_id);
const debtLeft = one(await svc(`SELECT remaining_cents FROM public.declutter_seller_fee_debts WHERE refund_id = (SELECT id FROM public.declutter_refunds WHERE stripe_payment_intent_id = 'pi_rr_debt')`));
ok(pI?.refunded_cents === 900 && pI.debt_cents === 100 && pI.amount_cents === 0 && pI.status === "nothing_due",
  "a $9.00 part refund leaves $1.00 of the sale: it pays $1.00 of the debt, payout $0");
ok(debtLeft === 200, "  the other $2.00 of the debt is owed again (not lost)");

// J. A payout already touched is never rebooked: the refund fails closed.
const J = await paidOrder(11, BUYER2, SELLER, 2000);
await gotIt(BUYER2, J.order_id);
await ask(BUYER2, J.order_id);
const rJ = await req(J.order_id);
await svc(`INSERT INTO public.payout_send_marks (payout_kind, payout_id) SELECT 'declutter', id FROM public.declutter_payouts WHERE order_id = '${J.order_id}'`);
ok(refused(await answer(SELLER, rJ.id, "full"), /payout_already_sent/), "a payout marked for sending refuses the refund (fails closed)");
ok(!(await refundRow(J.order_id)) && (await payout(J.order_id))?.amount_cents === 2000, "  nothing was written");
const J2 = await paidOrder(12, BUYER3, SELLER, 2000);
await gotIt(BUYER3, J2.order_id);
await svc(`UPDATE public.declutter_payouts SET attempts = 1, status = 'failed' WHERE order_id = '${J2.order_id}'`);
ok(refused(await ask(BUYER3, J2.order_id), /refund_window_over/), "a payout already tried: no refund can be asked");

// K. A Helpr delivery: the delivery fee paid the Helpr for the trip and is kept (#5).
await db.exec(liveItemSql({ id: I(13), seller: SELLER, title: "Refund item 13", price: 2500, floor: 100 }));
await svc(`UPDATE public.declutter_items SET delivery_size = 'small' WHERE id = '${I(13)}'`);
await me(BUYER, `SELECT public.declutter_buy_now('${I(13)}', 2500)`);
await svc(`SELECT public.declutter_set_delivery_dropoff('${BUYER}', '${SELLER}', '500 Drop Rd, Baton Rouge, LA 70805', 'North Baton Rouge', 30.496234, -91.154321)`);
const K = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER}', 'delivery')`))[0] ?? {};
await svc(`SELECT public.declutter_mark_order_paid('${K.order_id}', 'pi_rr_13', ${K.total_cents}, now(), ${CARD_FEE})`);
const kTotal = K.total_cents;
// The Helpr's own steps (take, pick up, drop off, confirm) are proven in declutterDelivery.pglite.mjs; here the
// task is simply done, and the sale handed over as the buyer's "I got it" would.
await svc(`UPDATE public.helpr_tasks SET status = 'confirmed', confirmed_at = now(), confirmed_by = 'customer' WHERE id = (SELECT task_id FROM public.declutter_order_deliveries WHERE order_id = '${K.order_id}')`);
await svc(`SELECT public.declutter_complete_handover('${K.order_id}', 'buyer')`);
const vK = await view(BUYER, K.order_id);
await ask(BUYER, K.order_id);
await answer(SELLER, (await req(K.order_id)).id, "full");
const rfK = await refundRow(K.order_id);
const reservedK = one(await svc(`SELECT public.declutter_delivery_reserved_cents('${K.order_id}')`));
ok(rfK && reservedK > 0 && rfK.paid_cents === kTotal - reservedK && rfK.refund_cents === kTotal - reservedK - CARD_FEE
   && vK?.delivery_kept_cents === reservedK,
  "a full refund after a delivery keeps the delivery fee (the Helpr made the trip) and the card fee");

// L. The buyer withdraws; the 24 hours then run as usual.
const L = await paidOrder(14, BUYER2, SELLER2, 1000);
await gotIt(BUYER2, L.order_id);
await ask(BUYER2, L.order_id);
const rL = await req(L.order_id);
ok(refused(await me(SELLER2, `SELECT public.declutter_withdraw_refund('${rL.id}')`), /refund_not_found/), "only the buyer withdraws");
ok(one(await me(BUYER2, `SELECT public.declutter_withdraw_refund('${rL.id}') AS r`))?.result === "withdrawn", "the buyer withdraws the request");
ok(!(await due(L.order_id)), "  the payout still waits for the 24 hours");
await handedAgo(L.order_id, 24 * 60 + 11);
ok(await due(L.order_id), "  then goes");

// M. An admin's handover is final at once (no window after a decision).
const M = await paidOrder(15, BUYER3, SELLER2, 1000);
await svc(`SELECT public.declutter_complete_handover('${M.order_id}', 'admin')`);
ok(await due(M.order_id), "a handover an admin decided is final at once");
ok(refused(await ask(BUYER3, M.order_id), /refund_window_over/), "  and no refund can be asked on it");

// N. The view never shows a sale to anyone outside it.
ok(refused(await me(BUYER3, `SELECT public.declutter_refund_request_view('${B.order_id}')`), /item_not_found/), "a stranger's view is refused");
const vBs = await view(SELLER, B.order_id);
ok(vBs?.side === "seller" && vBs.request?.status === "agreed" && vBs.request.refund_cents === 4000 + 270 - CARD_FEE, "the seller's view shows the settled refund");

// O. Replay: three applications leave one switch, one cron expectation shape and the CHECKs intact.
ok(one(await svc(`SELECT count(*)::int FROM public.feature_switches WHERE key = 'declutter_refund_requests' AND audience = 'testers'`)) === 1,
  "the switch exists once, at testers");
ok(refused(await svc(`INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents, refund_cents)
  VALUES (NULL, 'pi_rr_bad', 'refund_request_part', 'agreed_part', 1000, 0, 1000)`), /check constraint/),
  "a part refund equal to what was paid violates the amount CHECK");
ok(refused(await svc(`UPDATE public.declutter_payouts SET refunded_cents = items_cents + 1 WHERE order_id = '${D.order_id}'`), /check constraint/),
  "a payout cannot be refunded beyond its item price");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
