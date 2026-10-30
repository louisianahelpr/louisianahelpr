#!/usr/bin/env node
/**
 * PGlite proof for 20261030004216_declutter_order_talk.sql (audit 1028 part 2, D2-1): the buyer and seller of a PAID Declutter order
 * message each other until 48 hours after the handover; a problem or a refund request holds the chat open, and it
 * closes 24 hours after that resolves (lead, 2026-10-29). Nobody else reads or writes it.
 *
 *   node src/test/pglite/declutterOrderTalk.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterOrderTalk.pglite.mjs # RED: no such functions
 *   MIGRATION_PATH=<planted copy> node ...                                # RED on a planted defect
 *
 * World: the admin-problems proof's chain (scripts/declutter/slice3Harness.mjs + slice 4, the refund requests and
 * seller delivery), then this migration 3x. pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030004216_declutter_order_talk.sql";
const NAMES_FILE = "20261021131322_member_names_first_and_initial.sql";
const BUNDLE_FILE = "20261027211754_declutter_bundle_discount.sql";
const CHAIN_AFTER = [
  "20261021181118_helpr_delivery_payout_round_down.sql",
  "20261021185418_declutter_delivery_raise_pay.sql",
  "20261021204947_declutter_sales_outlive_a_deleted_party.sql",
];
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
const REFUND_141D_FILE = "20261026155251_declutter_refund_requests.sql";
const SELLER_DELIVERY_FILE = "20261027153244_declutter_seller_delivery.sql";
const REMINDERS_FILE = "20261027205028_declutter_pickup_reminders.sql";
const BEFORE = [
  "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql",
  NO_QR_FILE,
  "20261018184535_declutter_delivery_no_dropoff_code.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql",
  "20261020024605_shipping_s1_data_model.sql",
  "20261020064354_declutter_manage_listing.sql",
];
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2 } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const extra = [{ file: FEE_F1_FILE, times: 1 }, { file: SLICE4_FILE, times: 1 },
  ...[...BEFORE, ...CHAIN_AFTER, SETUP_FEE_FILE, REFUND_141D_FILE].map((file) => ({ file, times: 1 }))];
const stmts = setupStatements({ times: 1, times3b: 1, extra });
// The stubs declutterSellerDelivery.pglite.mjs uses (strike ladder, cron defect log, setup fee world).
stmts.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects_seen (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text, p_ctx jsonb) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects_seen VALUES (p_fn, p_ref, p_msg) $$;`);
stmts.splice(2, 0, `
  CREATE OR REPLACE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
  BEGIN
    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (p_user, p_violation_type, p_description, p_job_id, p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
    RETURN jsonb_build_object('action', p_rungs[least(p_prior_count, array_length(p_rungs, 1) - 1) + 1]);
  END $$;`);
const feeAt = stmts.indexOf(readFileSync(`${MIG_DIR}${SETUP_FEE_FILE}`, "utf8"));
if (feeAt < 0) throw new Error("setup-fee migration not in the chain");
stmts.splice(feeAt, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);
  CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
  CREATE TABLE IF NOT EXISTS public.payout_send_marks (payout_kind text NOT NULL CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop')),
    payout_id uuid NOT NULL, marked_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (payout_kind, payout_id));`);
for (const sql of stmts) await db.exec(sql);
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
await db.exec(CARDS_SQL);
await db.exec(readFileSync(`${MIG_DIR}${SELLER_DELIVERY_FILE}`, "utf8"));

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const run = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
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

await db.exec(`ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS bundle_discount_cents integer NOT NULL DEFAULT 0`);
{
  const names = readFileSync(`${MIG_DIR}${NAMES_FILE}`, "utf8");
  const m = /CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\$fn\$;/.exec(names) ?? /CREATE OR REPLACE FUNCTION public\.member_display_name\([\s\S]*?\$\$;/.exec(names);
  if (!m) throw new Error("member_display_name not found in " + NAMES_FILE);
  await db.exec(m[0]);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
async function paidOrder(tag, buyer, seller, n, title, handover = "pickup_home") {
  await db.exec(liveItemSql({ id: I(n), seller, title, price: 2000, floor: 100 }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', 2000)`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_ot_${tag}', ${o?.total_cents}, now(), 150)`);
  return o?.order_id;
}
const view = (uid, order) => me(uid, `SELECT public.declutter_order_talk_view('${order}') AS v`).then((r) => (Array.isArray(r) ? r[0]?.v : r));
const send = (uid, order, body) => me(uid, `SELECT public.declutter_send_order_message('${order}', '${body.replace(/'/g, "''")}') AS id`);
const until = async (order) => one(await svc(`SELECT public.declutter_order_talk_until('${order}')::text AS u`));
const notes = async (uid) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = 'New message about your order'`)));
const hoursFromNow = async (ts) => Number(one(await svc(`SELECT round(extract(epoch FROM ('${ts}'::timestamptz - now())) / 3600) AS h`)));

const A = await paidOrder("a", BUYER, SELLER, 1, "Brass lamp");
const B = await paidOrder("b", BUYER2, SELLER2, 2, "Blue rug");
ok(!!A && !!B, "setup: two paid orders");

// 1. Paid, not handed over: open with no end yet; both sides talk; nobody else can.
ok((await until(A)) === "infinity", "a paid order's chat is open with no end yet");
const v0 = await view(BUYER, A);
ok(v0?.side === "buyer" && v0.open === true && v0.open_until === null && Array.isArray(v0.messages) && v0.messages.length === 0,
  `the buyer sees an open, empty chat (${JSON.stringify(v0)?.slice(0, 120)})`);
const m1 = await send(BUYER, A, "Is Saturday morning ok?");
ok(Array.isArray(m1) && !!one(m1), `the buyer sends a message${Array.isArray(m1) ? "" : `: ${m1?.error}`}`);
const m2 = await send(SELLER, A, "Yes, any time after 9.");
ok(Array.isArray(m2), `the seller answers${Array.isArray(m2) ? "" : `: ${m2?.error}`}`);
const vs = await view(SELLER, A);
ok(vs?.side === "seller" && vs.messages.length === 2 && vs.messages[0].mine === false && vs.messages[1].mine === true
  && vs.messages[0].body === "Is Saturday morning ok?" && !("sender_id" in vs.messages[0]),
  "the seller sees both, oldest first, as theirs or the buyer's (no ids)");
ok(Number(one(await svc(`SELECT count(*) FROM public.declutter_order_talks WHERE order_id = '${A}'`))) === 1, "one chat per order");
ok(await notes(SELLER) === 1 && await notes(BUYER) === 1, "each side was told once");
await send(BUYER, A, "Great, see you then.");
ok(await notes(SELLER) === 1, "a second message within 15 minutes tells nobody again");
const n = one(await svc(`SELECT message FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'New message about your order'`));
const link = one(await svc(`SELECT link FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'New message about your order'`));
ok(n === 'The buyer sent you a message about "Brass lamp".' && link === `/declutter?tab=selling&order_talk=${A}`,
  `the notice names the item, never the words, and opens the chat on the seller's tab (${n} ${link})`);
ok(refused(await send(BUYER2, A, "hi"), /item_not_found/) && refused(await view(BUYER2, A), /item_not_found/),
  "someone else's order: item_not_found, to read or to send");
ok(refused(await send(BUYER, A, "Call me at 225-555-0100"), /in the message/), "a phone number is refused by the contact-leak filter");
ok(refused(await send(BUYER, A, "   "), /invalid_message/), "an empty message is refused");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_order_talk_messages`), /permission denied/) && refused(await me(BUYER, `SELECT * FROM public.declutter_order_talks`), /permission denied/), "members cannot read the tables directly");
// 1b. Messages -> Declutter: each side lists its own order chats, with no person's id or name and no words.
const list = (uid) => me(uid, `SELECT public.declutter_my_order_talks() AS l`).then((r) => (Array.isArray(r) ? r[0]?.l : r));
const lb = await list(BUYER);
const ls = await list(SELLER);
ok(Array.isArray(lb) && lb.length === 1 && lb[0].order_id === A && lb[0].side === "buyer" && lb[0].title === "Brass lamp"
  && lb[0].last_mine === true && lb[0].open === true && Object.keys(lb[0]).sort().join() === "last_at,last_mine,open,order_id,side,title",
  `the buyer lists the chat: the item, their side, the last message was theirs, open; nothing else (${JSON.stringify(lb)?.slice(0, 160)})`);
ok(Array.isArray(ls) && ls.length === 1 && ls[0].side === "seller" && ls[0].last_mine === false,
  `the seller lists the same chat from their side (${JSON.stringify(ls)?.slice(0, 120)})`);
const l2 = await list(BUYER2);
ok(Array.isArray(l2) && l2.length === 0, `someone with no chat lists nothing, never another order's chat (${JSON.stringify(l2)?.slice(0, 80)})`);
const lAnon = await (async () => { try { await db.exec(`SET ROLE anon`); return (await db.query(`SELECT public.declutter_my_order_talks()`)).rows; } catch (e) { return { error: String(e.message ?? e) }; } finally { await db.exec(`RESET ROLE`); } })();
ok(refused(lAnon, /permission denied/), "anon cannot list order chats");
await svc(`RESET ROLE`);

// 2. Handed over: open until 48 hours after the handover.
await svc(`UPDATE public.declutter_orders SET status = 'handed_over', handed_over_at = now() - interval '1 hour' WHERE id = '${A}'`);
ok(await hoursFromNow(await until(A)) === 47, `handed over an hour ago: open 47 more hours (${await until(A)})`);
const va = await view(BUYER, A);
ok(va?.open === true && typeof va.open_until === "string", "the view gives the end time");
await svc(`UPDATE public.declutter_orders SET handed_over_at = now() - interval '49 hours' WHERE id = '${A}'`);
ok((await view(BUYER, A))?.open === false && refused(await send(BUYER, A, "hello?"), /talk_closed/), "49 hours after the handover: ended, sending refused");
ok((await view(SELLER, A))?.messages?.length === 3, "an ended chat still shows its history");

// 3. A refund request or a problem holds it open; it closes 24 hours after it resolves.
await svc(`INSERT INTO public.declutter_refund_requests (order_id, reason, note, status, answer_by)
             VALUES ('${A}', 'damaged', 'Cracked.', 'open', now() + interval '24 hours')`);
ok((await until(A)) === "infinity" && Array.isArray(await send(BUYER, A, "I asked for a refund.")), "an open refund request reopens it, with no end");
// The table's updated_at trigger stamps now(); the clock is moved back with triggers off (session_replication_role).
await svc(`UPDATE public.declutter_refund_requests SET status = 'withdrawn' WHERE order_id = '${A}'`);
await svc(`SET session_replication_role = replica`);
await svc(`UPDATE public.declutter_refund_requests SET updated_at = now() - interval '2 hours' WHERE order_id = '${A}'`);
await svc(`SET session_replication_role = origin`);
ok(await hoursFromNow(await until(A)) === 22, `resolved 2 hours ago: open 22 more hours (${await until(A)})`);
await svc(`INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note) VALUES ('${A}', '${BUYER}', 'buyer', 'damaged', 'x')`);
ok((await until(A)) === "infinity", "an open problem holds it open");
await svc(`UPDATE public.declutter_problems SET status = 'decided', decision = 'refund_buyer', fault = 'none', decided_at = now() - interval '30 hours' WHERE order_id = '${A}'`);
await svc(`SET session_replication_role = replica`);
await svc(`UPDATE public.declutter_refund_requests SET updated_at = now() - interval '30 hours' WHERE order_id = '${A}'`);
await svc(`SET session_replication_role = origin`);
ok((await view(BUYER, A))?.open === false, "everything resolved more than 24 hours ago (and 48 since the handover): ended");

// 4. An order that ended without a handover: 24 hours after it ended. Never paid: no chat.
await svc(`UPDATE public.declutter_orders SET status = 'refunded', closed_at = now() - interval '1 hour' WHERE id = '${B}'`);
ok(await hoursFromNow(await until(B)) === 23, `refunded an hour ago: open 23 more hours (${await until(B)})`);
await db.exec(liveItemSql({ id: I(9), seller: SELLER3, title: "Unpaid stool", price: 2000, floor: 100 }));
await me(BUYER, `SELECT public.declutter_buy_now('${I(9)}', 2000)`);
const U = (await me(BUYER, `SELECT * FROM public.declutter_start_checkout('${SELLER3}', 'pickup_home')`))[0]?.order_id;
ok(!!U && (await until(U)) == null && refused(await send(BUYER, U, "hi"), /order_not_paid/) && refused(await view(BUYER, U), /order_not_paid/),
  "an unpaid order has no chat (order_not_paid)");

// 5. Blocked, banned, deleted, the switch off.
const C = await paidOrder("c", BUYER2, SELLER, 3, "Green chair");
await svc(`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('${SELLER}', '${BUYER2}')`);
const blockedOk = refused(await send(BUYER2, C, "hello"), /talk_blocked/) && (await view(BUYER2, C))?.open === false;
ok(blockedOk, "blocked either way: no sending, and the chat reads as ended");
await svc(`DELETE FROM public.user_blocks`);
await svc(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'`);
ok(Array.isArray(await send(BUYER2, C, "Still on for Sunday?")), "with the Declutter switch off, a paid order's chat still works (row 62)");
await svc(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'`);
await svc(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${BUYER2}'`);
ok(refused(await send(BUYER2, C, "hi"), /account_restricted/), "a banned member cannot send");
await svc(`UPDATE public.profiles SET is_banned = false WHERE user_id = '${BUYER2}'`);
await svc(`UPDATE public.declutter_orders SET buyer_id = NULL WHERE id = '${C}'`);
ok(refused(await send(SELLER, C, "hi?"), /talk_closed/), "the other side deleted their account: no sending");

// 6. Grants.
const acl = await svc(`SELECT has_function_privilege('anon', 'public.declutter_send_order_message(uuid, text)', 'EXECUTE') AS a1,
                              has_function_privilege('anon', 'public.declutter_order_talk_view(uuid)', 'EXECUTE') AS a2,
                              has_function_privilege('authenticated', 'public.declutter_send_order_message(uuid, text)', 'EXECUTE') AS m1,
                              has_function_privilege('authenticated', 'public.declutter_order_talk_view(uuid)', 'EXECUTE') AS m2,
                              has_function_privilege('authenticated', 'public.declutter_order_talk_until(uuid)', 'EXECUTE') AS m3,
                              has_function_privilege('anon', 'public.declutter_my_order_talks()', 'EXECUTE') AS a4,
                              has_function_privilege('authenticated', 'public.declutter_my_order_talks()', 'EXECUTE') AS m4`);
const g = Array.isArray(acl) ? acl[0] : {};
ok(g.a1 === false && g.a2 === false && g.m1 === true && g.m2 === true && g.m3 === false && g.a4 === false && g.m4 === true,
  `anon reaches none; members reach the three RPCs, not the internal clock (${JSON.stringify(g)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
