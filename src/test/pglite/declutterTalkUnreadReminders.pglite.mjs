#!/usr/bin/env node
/**
 * PGlite proof for 20261101200929_declutter_talk_unread_reminders.sql (B110 leftover 4, lead 11-01): a Declutter order
 * chat or handover chat message still unread at 15 minutes reminds its recipient once, at 2 hours once more, at most
 * 2 a day per chat, never 9 PM-8 AM; reading the chat (declutter_mark_talk_read) or replying stops it.
 *
 *   node src/test/pglite/declutterTalkUnreadReminders.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterTalkUnreadReminders.pglite.mjs # RED: no read state, no sweep
 *   MIGRATION_PATH=<planted copy> node ...                                          # RED on a planted defect
 *
 * World: declutterOrderTalk.pglite.mjs's chain, plus the order chat and the handover chat migrations. pglite is
 * loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261030004216_declutter_order_talk.sql";
const HANDOVER_TALK_FILE = "20261028235249_declutter_handover_talk.sql";
const JOB_CHAT_FILE = "20261101183017_unread_message_reminders.sql";
const REMIND_FILE = "20261101200929_declutter_talk_unread_reminders.sql";
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
const { SELLER, SELLER2, SELLER3, BUYER, BUYER2, BUYER3 } = USERS;
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
// Bases: the order chat, the handover chat, and the job-chat reminders' quiet-hours rule.
// The handover chat's own function reads declutter_items.handovers (20261028235247, whose chain this world lacks).
await db.exec(`ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS handovers text[]`);
for (const f of [NEW_FILE, HANDOVER_TALK_FILE]) {
  const r = await run(readFileSync(`${MIG_DIR}${f}`, "utf8"));
  ok(!r?.error, `base ${f} applies${r?.error ? `: ${r.error}` : ""}`);
}
{
  const jobChat = readFileSync(`${MIG_DIR}${JOB_CHAT_FILE}`, "utf8");
  const m = /CREATE OR REPLACE FUNCTION public\.unread_reminder_quiet\([\s\S]*?\$fn\$;/.exec(jobChat);
  if (!m) throw new Error("unread_reminder_quiet not found in " + JOB_CHAT_FILE);
  await db.exec(m[0]);
}
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${REMIND_FILE}`, "utf8");
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
// Noon tomorrow in Louisiana: never in the quiet hours, whatever the clock says when this runs.
const NOW = one(await svc(`SELECT (((now() AT TIME ZONE 'America/Chicago')::date + 1 + time '12:00') AT TIME ZONE 'America/Chicago')::text AS t`));
const at = (mins) => `('${NOW}'::timestamptz + interval '${mins} minutes')`;
const sweep = async (mins = 0) => Number(one(await svc(`SELECT public.sweep_declutter_talk_reminders(${at(mins)}) AS n`)));
const talkOf = async (order) => {
  await svc(`INSERT INTO public.declutter_order_talks (order_id) VALUES ('${order}') ON CONFLICT (order_id) DO NOTHING`);
  return one(await svc(`SELECT id FROM public.declutter_order_talks WHERE order_id = '${order}'`));
};
const say = async (talk, uid, side, mins) => one(await svc(`INSERT INTO public.declutter_order_talk_messages (talk_id, sender_id, sender_side, body, created_at)
  VALUES ('${talk}', '${uid}', '${side}', 'Is Saturday ok?', ${at(mins)}) RETURNING id`));
const reminders = async (uid) => (await svc(`SELECT message, link FROM public.notifications WHERE user_id = '${uid}' AND title = 'Unread message' ORDER BY created_at`)) ?? [];

// 1. A buyer's message unread 20 minutes: one reminder to the seller, with the chat's own link; never twice.
const tA = await talkOf(A);
await say(tA, BUYER, "buyer", -20);
ok(await sweep() === 1, "a message unread 20 minutes: one reminder");
let rs = await reminders(SELLER);
ok(Array.isArray(rs) && rs.length === 1 && rs[0].message === "The buyer is waiting on your reply about your order. Next: open the message and reply."
  && rs[0].link === `/declutter?tab=selling&order_talk=${A}`, `it says who waits and opens the chat on the seller's tab (${JSON.stringify(rs)})`);
ok(await sweep(1) === 0, "the next run sends nothing more");
ok((await reminders(BUYER)).length === 0, "the sender is never reminded of their own message");
// 2. At 2 hours: the second reminder; then nothing more that day.
ok(await sweep(120) === 1, "still unread at 2 hours: the second reminder");
rs = await reminders(SELLER);
ok(rs.length === 2 && /is still waiting on your reply/.test(rs[1].message), "the second says 'still waiting'");
// The seller reads it at 2:04; a NEW message at 2:05 is the chat's third reminder today: held to 2 a day.
await svc(`UPDATE public.declutter_order_talks SET seller_read_at = ${at(124)} WHERE id = '${tA}'`);
await say(tA, BUYER, "buyer", 125);
ok(await sweep(150) === 0, "at most 2 a day per chat (a newer message waits for tomorrow)");
ok(await sweep(60 * 21) === 1, "the next day it is reminded");

// 3. Read: declutter_mark_talk_read marks only the caller's side; a read chat sends nothing.
const tB = await talkOf(B);
await say(tB, BUYER2, "buyer", -20);
const mr = await me(SELLER2, `SELECT public.declutter_mark_talk_read('order', '${B}')`);
ok(Array.isArray(mr), `the seller marks the chat read${Array.isArray(mr) ? "" : `: ${mr?.error}`}`);
const rd = (await svc(`SELECT buyer_read_at, seller_read_at FROM public.declutter_order_talks WHERE id = '${tB}'`))[0];
ok(rd && rd.seller_read_at !== null && rd.buyer_read_at === null, `only the caller's side is marked (${JSON.stringify(rd)})`);
await svc(`UPDATE public.declutter_order_talks SET seller_read_at = ${at(-1)} WHERE id = '${tB}'`);
ok(await sweep(1) === 0 && (await reminders(SELLER2)).length === 0, "a chat read after the message sends nothing");
ok(refused(await me(BUYER3, `SELECT public.declutter_mark_talk_read('order', '${B}')`), /item_not_found/), "someone else's order: item_not_found");

// 4. A reply reads it.
const C = await paidOrder("c", BUYER3, SELLER3, 3, "Desk lamp");
const tC = await talkOf(C);
await say(tC, SELLER3, "seller", -40);
await say(tC, BUYER3, "buyer", -30);
ok(await sweep(-10) === 1 && (await reminders(BUYER3)).length === 0, "the buyer replied: no reminder to them (only the seller's for the reply)");

// 5. The handover chat: the same rule, its own link.
const H = one(await svc(`INSERT INTO public.declutter_handover_talks (buyer_id, seller_id, opened_by, expires_at)
  VALUES ('${BUYER2}', '${SELLER}', '${SELLER}', ${at(60 * 24)}) RETURNING id`));
await svc(`INSERT INTO public.declutter_handover_talk_messages (talk_id, sender_id, body, created_at) VALUES ('${H}', '${SELLER}', 'Porch ok?', ${at(-20)})`);
ok(await sweep(0) >= 1, "an unread handover message: a reminder");
rs = await reminders(BUYER2);
ok(rs.some((x) => x.link === `/declutter?tab=buying&talk=${H}` && /The seller is waiting on your reply about the handover\./.test(x.message)),
  `the handover reminder opens that chat on the buyer's tab (${JSON.stringify(rs)})`);
ok(Array.isArray(await me(BUYER2, `SELECT public.declutter_mark_talk_read('handover', '${H}')`)), "the buyer marks the handover chat read");

// 6. Quiet hours: 10 PM sends nothing.
const late = Number(one(await svc(`SELECT public.sweep_declutter_talk_reminders(((('${NOW}'::timestamptz AT TIME ZONE 'America/Chicago')::date + time '22:00') AT TIME ZONE 'America/Chicago')) AS n`)));
ok(late === 0, "10 PM: nothing is sent");

// 7. Grants: members cannot run the sweep or read the sends.
ok(refused(await me(BUYER, `SELECT public.sweep_declutter_talk_reminders()`), /permission denied/), "members cannot run the sweep");
ok(refused(await me(BUYER, `SELECT * FROM public.declutter_talk_reminder_sends`), /permission denied/), "members cannot read the sends");

// 8. FIXED CLOCK (Q1357): the cron job calls "sweep_chat_unread_reminders" with no time, so it and
// "sweep_declutter_talk_reminders" read now() (their DEFAULT). Both newest bodies reloaded with now() fixed, either
// side of 15 minutes. The job-chat half is stubbed when absent (its own probe: unreadMessageReminders.pglite.mjs).
await installClock(db);
if (!one(await svc(`SELECT to_regprocedure('public.sweep_unread_message_reminders(timestamptz)') IS NOT NULL AS x`)))
  await db.exec(`CREATE FUNCTION public.sweep_unread_message_reminders(p timestamptz) RETURNS integer LANGUAGE sql AS $s$ SELECT 0 $s$;`);
if (!one(await svc(`SELECT to_regprocedure('public.log_cron_defect(text, text, text, jsonb)') IS NOT NULL AS x`)))
  await db.exec(`CREATE FUNCTION public.log_cron_defect(a text, b text, c text, d jsonb) RETURNS void LANGUAGE sql AS $s$ SELECT NULL::void $s$;`);
await db.exec(onFixedClock(newestFunction("sweep_declutter_talk_reminders").stmt));
await db.exec(onFixedClock(newestFunction("sweep_chat_unread_reminders").stmt));
// Only this section's message is unread: the earlier sections' messages would also be due a day later.
await db.exec(`DELETE FROM public.declutter_order_talk_messages; DELETE FROM public.declutter_handover_talk_messages;`);
const D = await paidOrder("d", BUYER, SELLER3, 4, "Floor lamp");
const tD = await talkOf(D);
await say(tD, BUYER, "buyer", 60 * 26);
const fixedAt = async (mins) => setClock(db, one(await svc(`SELECT (${at(60 * 26 + mins)})::text AS t`)));
await fixedAt(14);
const w1 = (await svc(`SELECT public.sweep_chat_unread_reminders() AS j`))[0]?.j;
ok(w1 && Number(w1.declutter_chats) === 0, `fixed clock: 14 minutes, the no-argument wrapper sends nothing (${JSON.stringify(w1)})`);
await fixedAt(15);
const w2 = (await svc(`SELECT public.sweep_chat_unread_reminders() AS j`))[0]?.j;
ok(w2 && Number(w2.declutter_chats) === 1 && !w2.failed, `fixed clock: at 15 minutes, one reminder through the wrapper (${JSON.stringify(w2)})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
