#!/usr/bin/env node
/**
 * PGlite proof for 20261028225038_declutter_porch_pick_a_day (owner 2026-10-28: "make porch just pick a
 * day but they also need to know once it's on the porch so they don't show up and it's not there").
 *
 *   node src/test/pglite/declutterPorchPickADay.pglite.mjs                    # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/declutterPorchPickADay.pglite.mjs # RED: the chain without it
 *
 * The world is the seller-delivery proof's chain (declutterSellerDelivery.pglite.mjs: slices 1-4, every
 * later Declutter money migration, seller delivery) plus the pickup reminders, then this migration 3x.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE, NO_QR_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261028225038_declutter_porch_pick_a_day.sql";
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
const { SELLER, SELLER2, BUYER, BUYER2, OUTSIDER } = USERS;
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
// Seller delivery, then the pickup reminders (their email call and its error log stubbed, as their own proof).
await db.exec(readFileSync(`${MIG_DIR}${SELLER_DELIVERY_FILE}`, "utf8"));
await db.exec(`CREATE SCHEMA IF NOT EXISTS net; CREATE SCHEMA IF NOT EXISTS vault;
  CREATE TABLE IF NOT EXISTS net.calls (id serial PRIMARY KEY, url text, body jsonb);
  CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id::bigint $$;
  CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (name text, decrypted_secret text);
  CREATE TABLE IF NOT EXISTS public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL DEFAULT 'error',
    message text NOT NULL, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');`);
await db.exec(readFileSync(`${MIG_DIR}${REMINDERS_FILE}`, "utf8"));

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
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    const r = await run(sql);
    ok(!r?.error, `the migration applies (run ${i + 1} of 3)${r?.error ? `: ${r.error}` : ""}`);
  }
}

// Pickup windows: every weekday but Sunday for SELLER, 09:00-18:00 Louisiana; SELLER2 every day.
await db.exec(`INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER}'::uuid, d, '09:00', '18:00' FROM generate_series(1, 6) d ON CONFLICT DO NOTHING;
  INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
  SELECT '${SELLER2}'::uuid, d, '09:00', '18:00' FROM generate_series(0, 6) d ON CONFLICT DO NOTHING;`);
const TODAY = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text`));
const dayOf = async (n) => one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + ${n})::text`));
const dowOf = async (d) => Number(one(await svc(`SELECT extract(dow FROM '${d}'::date)::int`)));

const I = (n) => `88888888-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function paidOrder(n, buyer, seller, price, handover = "porch") {
  await db.exec(liveItemSql({ id: I(n), seller, title: `Porch day item ${n}`, price, floor: Math.min(price, 100) }));
  await me(buyer, `SELECT public.declutter_buy_now('${I(n)}', ${price})`);
  const o = (await me(buyer, `SELECT * FROM public.declutter_start_checkout('${seller}', '${handover}')`))[0];
  await svc(`SELECT public.declutter_mark_order_paid('${o?.order_id}', 'pi_pd_${n}', ${o?.total_cents}, now(), 150)`);
  return o ?? {};
}
const bookDay = (uid, id, d) => me(uid, `SELECT public.declutter_book_porch_day('${id}', '${d}'::date) AS r`);
const booking = async (id) => (await svc(`SELECT *, pickup_day::text AS day_text, (slot_start AT TIME ZONE 'America/Chicago')::text AS local_start
                                            FROM public.declutter_bookings WHERE order_id = '${id}'`))?.[0];
const status = async (id) => one(await svc(`SELECT status FROM public.declutter_orders WHERE id = '${id}'`));
const notes = async (uid, title) => Number(one(await svc(`SELECT count(*) FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`)));

// ---------------------------------------------------------------------------
// A. The days the buyer may pick.
const A = await paidOrder(1, BUYER, SELLER, 2000);
ok(await status(A.order_id) === "paid", "setup: porch order A is paid");
// #26's next step (declutter_paid_next_step): a paid porch order with no day yet is told to choose a DAY.
const nextStep = one(await svc(`SELECT public.declutter_paid_next_step('${A.order_id}')`));
ok(nextStep === "Next: choose your pickup day in Buying.", `the paid notice's next step for a porch order says a day (${nextStep})`);
const days = await me(BUYER, `SELECT d::text FROM public.declutter_porch_days('${A.order_id}') d`);
const dayList = Array.isArray(days) ? days.map((r) => r.d) : [];
ok(dayList.length >= 5 && dayList.length <= 8, `the buyer is offered the seller's days until the deadline (${dayList.length})`);
let noSunday = true;
for (const d of dayList) if ((await dowOf(d)) === 0) noSunday = false;
ok(dayList.length > 0 && noSunday, "never a day the seller has no pickup window (Sunday here)");
ok(dayList.every((d) => d >= TODAY), "never a day in the past");
ok(refused(await me(OUTSIDER, `SELECT * FROM public.declutter_porch_days('${A.order_id}')`), /item_not_found/), "a stranger cannot read the days");

// B. Booking a day.
let sunday = null;
let weekday = null;
for (let n = 1; n <= 6; n++) {
  const d = await dayOf(n);
  if ((await dowOf(d)) === 0) sunday ??= d; else weekday ??= d;
}
ok(refused(await bookDay(OUTSIDER, A.order_id, weekday), /item_not_found/), "a stranger cannot book it");
ok(refused(await bookDay(SELLER, A.order_id, weekday), /not_booked_yet/), "the seller cannot pick first: the buyer does");
ok(refused(await bookDay(BUYER, A.order_id, sunday), /invalid_day/), "a day with no seller pickup window is refused");
ok(refused(await bookDay(BUYER, A.order_id, await dayOf(-1)), /invalid_day/), "a past day is refused");
ok(refused(await bookDay(BUYER, A.order_id, await dayOf(9)), /invalid_day/), "a day after the 7-day pickup deadline is refused");
const H = await paidOrder(2, BUYER2, SELLER2, 1500, "pickup_home");
ok(refused(await bookDay(BUYER2, H.order_id, weekday), /not_a_porch_pickup/), "a door pickup books a time, not a day");
ok(one(await bookDay(BUYER, A.order_id, weekday))?.result === "booked", `the buyer picks ${weekday}`);
const b1 = await booking(A.order_id);
ok(b1?.day_text === weekday && /00:00:00$/.test(b1?.local_start ?? "") && b1?.porch_mode === "all_day" && b1?.porch_until === null,
  "  stored as that day: 00:00 Louisiana, out all day, no 'out until'");
ok(b1?.reminded_slot_start && new Date(b1.reminded_slot_start).getTime() === new Date(b1.slot_start).getTime(),
  "  marked reminded: no 'Porch pickup in 1 hour' at 11 PM the night before");
ok(await notes(SELLER, "Porch pickup day booked") === 1, "  the seller is told the day");
ok(one(await svc(`SELECT link FROM public.notifications WHERE user_id = '${SELLER}' AND title = 'Porch pickup day booked'`)) === "/declutter?tab=selling",
  "  and the notice opens Selling (never the retired view=sales)");
const other = dayList.find((d) => d !== weekday && d > TODAY);
ok(one(await bookDay(BUYER, A.order_id, other))?.result === "rescheduled", "the buyer may move the day once");
ok(refused(await bookDay(BUYER, A.order_id, weekday), /reschedule_used/), "but not twice");

// B2. The seller may move the day once too, to one of their own pickup days; the buyer is told.
const third = dayList.find((d) => d !== weekday && d !== other && d > TODAY);
ok(refused(await bookDay(SELLER, A.order_id, sunday), /invalid_day/), "the seller cannot move it to a day with no pickup window");
ok(refused(await bookDay(SELLER, A.order_id, await dayOf(9)), /invalid_day/), "nor past the buyer's 7-day pickup deadline");
ok(one(await bookDay(SELLER, A.order_id, third))?.result === "seller_rescheduled", `the seller moves the day to ${third}`);
const b2 = await booking(A.order_id);
ok(b2?.day_text === third && /00:00:00$/.test(b2?.local_start ?? "") && b2?.porch_mode === "all_day"
  && b2?.seller_reschedules === 1 && b2?.buyer_reschedules === 1,
  "  stored as the new day (00:00 Louisiana, out all day); one seller move and one buyer move counted");
ok(b2?.reminded_slot_start && new Date(b2.reminded_slot_start).getTime() === new Date(b2.slot_start).getTime(),
  "  the new day is marked reminded too");
const moveNote = (await svc(`SELECT type, message, link FROM public.notifications
                               WHERE user_id = '${BUYER}' AND title = 'Porch pickup day changed'`))?.[0];
ok(moveNote?.link === "/declutter?tab=buying" && moveNote?.message?.includes("We'll tell you when it's out"),
  "  the buyer is told the new day, linked to Buying");
ok(moveNote?.type === "declutter_pickups", `  under the Declutter Pickups switch (type ${moveNote?.type})`);
ok(refused(await bookDay(SELLER, A.order_id, weekday), /reschedule_used/), "  but the seller cannot move it a second time");
ok(refused(await bookDay(OUTSIDER, A.order_id, weekday), /item_not_found/), "  and a stranger still cannot move it");

// C. An installed app build still moves a porch pickup by TIME: the day goes with the old slot.
const C = await paidOrder(3, BUYER2, SELLER2, 1200);
await bookDay(BUYER2, C.order_id, await dayOf(1));
const tomorrowNoon = `(((now() AT TIME ZONE 'America/Chicago')::date + 1 + time '12:00') AT TIME ZONE 'America/Chicago')`;
const moved = await me(BUYER2, `SELECT public.declutter_book_pickup('${C.order_id}', ${tomorrowNoon}) AS r`);
const c1 = await booking(C.order_id);
ok(Array.isArray(moved) && c1?.pickup_day === null && /12:00:00$/.test(c1?.local_start ?? ""), "a time booked over a day clears the day (the slot is a time again)");

// D. The buyer's "the seller never put it out" waits for the END of the day.
const D = await paidOrder(4, BUYER, SELLER2, 1800);
ok(one(await bookDay(BUYER, D.order_id, TODAY))?.result === "booked", "the buyer picks today");
ok(refused(await me(BUYER, `SELECT public.declutter_report_no_show('${D.order_id}')`), /too_early/),
  "  at today's 00:15+ the day is not over: the buyer cannot report the seller yet");
// The day passes (yesterday's day, booked as such).
await svc(`UPDATE public.declutter_bookings SET pickup_day = '${await dayOf(-1)}'::date,
  slot_start = ('${await dayOf(-1)}'::date::timestamp AT TIME ZONE 'America/Chicago'),
  slot_end = ('${await dayOf(-1)}'::date::timestamp AT TIME ZONE 'America/Chicago') + interval '30 minutes' WHERE order_id = '${D.order_id}'`);
ok((await booking(D.order_id))?.day_text === await dayOf(-1), "  (time passes: the day is yesterday)");
const ns = await me(BUYER, `SELECT public.declutter_report_no_show('${D.order_id}') AS r`);
ok(Array.isArray(ns) && await status(D.order_id) !== "paid", "  once the day is over and nothing was put out, the buyer's report closes the sale");

// E. The auto-pay (row 99): 24 h after the DAY ends, only with the porch photo in.
const E = await paidOrder(5, BUYER2, SELLER2, 2500);
await bookDay(BUYER2, E.order_id, TODAY);
await svc(`UPDATE public.declutter_handovers SET set_out_photo_path = '${SELLER2}/declutter/handover/${E.order_id}/out.jpg', set_out_at = now()
            WHERE order_id = '${E.order_id}'`);
ok(refused(await bookDay(BUYER2, E.order_id, await dayOf(1)), /seller_set_out/), "the day cannot move once the item is out");
const backdate = (id, n) => svc(`UPDATE public.declutter_bookings SET pickup_day = '${n}'::date,
  slot_start = ('${n}'::date::timestamp AT TIME ZONE 'America/Chicago'),
  slot_end = ('${n}'::date::timestamp AT TIME ZONE 'America/Chicago') + interval '30 minutes' WHERE order_id = '${id}'`);
await backdate(E.order_id, await dayOf(-1));
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(E.order_id) === "paid", "the day ended at midnight, less than 24 h ago: NOT paid yet (a slot-start rule would have paid it)");
await backdate(E.order_id, await dayOf(-2));
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(E.order_id) === "handed_over", "24 h after the day ended, with the porch photo in: auto-paid");
const F = await paidOrder(6, BUYER, SELLER2, 900);
await bookDay(BUYER, F.order_id, TODAY);
await backdate(F.order_id, await dayOf(-3));
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(F.order_id) === "paid", "no porch photo: never auto-paid (unchanged)");

// F. A booked TIME is unchanged: auto-paid 24 h after its start.
const G = await paidOrder(7, BUYER, SELLER2, 1100, "pickup_home");
await me(BUYER, `SELECT public.declutter_book_pickup('${G.order_id}', ${tomorrowNoon})`);
await svc(`UPDATE public.declutter_bookings SET slot_start = now() - interval '25 hours', slot_end = now() - interval '25 hours' + interval '30 minutes'
            WHERE order_id = '${G.order_id}'`);
await svc(`SELECT public.declutter_handover_sweep()`);
ok(await status(G.order_id) === "handed_over", "a door pickup booked for a time still auto-pays 24 h after it (unchanged)");

// F2. The porch photo is the buyer's signal to go: its notice says so, under Pickups, and opens Buying.
const K = await paidOrder(8, BUYER2, SELLER2, 1300);
await bookDay(BUYER2, K.order_id, TODAY);
const outPath = `${SELLER2}/declutter/handover/${K.order_id}/out.jpg`;
await svc(`INSERT INTO storage.objects (bucket_id, name) VALUES ('declutter-handover', '${outPath}')`);
const setOut = await me(SELLER2, `SELECT public.declutter_porch_photo('${K.order_id}', '${outPath}', NULL, NULL) AS r`);
ok(one(setOut)?.result === "set_out", `the seller posts the porch photo${Array.isArray(setOut) ? "" : `: ${setOut?.error}`}`);
const outNote = (await svc(`SELECT type, title, message, link FROM public.notifications
                             WHERE user_id = '${BUYER2}' AND title LIKE 'It''s on the porch%'`))?.[0];
ok(outNote?.title === "It's on the porch: pick it up today", `  the buyer is told "It's on the porch: pick it up today" (${outNote?.title})`);
ok(outNote?.type === "declutter_pickups" && outNote?.link === "/declutter?tab=buying",
  `  under the Pickups switch, opening Buying (${outNote?.type} ${outNote?.link})`);
ok(await notes(BUYER2, "Your item is on the porch") === 0, "  and never the old 'Your item is on the porch' notice");
ok(refused(await me(BUYER, `SELECT public.declutter_porch_photo('${K.order_id}', '${outPath}', NULL, NULL)`), /item_not_found/),
  "  a stranger cannot post it (unchanged)");

// G. Grants.
const acl = async (fn) => one(await svc(`SELECT has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`));
ok(await acl("declutter_book_porch_day(uuid, date)") === false && await acl("declutter_porch_days(uuid)") === false,
  "anon cannot call the new RPCs (REVOKE FROM PUBLIC, anon)");
ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_pickup_anchor(timestamptz, date)', 'EXECUTE')`)) === false,
  "members cannot call the anchor helper directly");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
