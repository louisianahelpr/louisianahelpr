#!/usr/bin/env node
/**
 * PGlite proof for 20261029192457_declutter_returns.sql (Declutter returns: how a full-refund item gets back to the seller; builder 37's
 * design, approved by the lead 2026-10-29; owner: refunds for problems only, and only the two free ways back).
 * On the refund-request chain (20261026155251 + 20261027171453); the new migration is applied 3 times.
 *
 *   node src/test/pglite/declutterReturns.pglite.mjs                     # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReturns.pglite.mjs  # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterReturns.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const REFUND_FILE = "20261026155251_declutter_refund_requests.sql";
const NEW_FILE = "20261029192457_declutter_returns.sql";
const LIVE_FILE = "20261029002010_declutter_handover_photos_live_only.sql";
const SETUP_FEE_FILE = "20261026154738_declutter_setup_fee_once.sql";
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
  // Q2352: the one-time setup fee; it restated declutter_mark_order_paid, which this change restates again.
  SETUP_FEE_FILE,
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
extra.push({ file: REFUND_FILE, times: 1 });
// Money review 2026-10-27: no withdraw once the item is coming back (restates declutter_withdraw_refund).
extra.push({ file: "20261027171453_declutter_withdraw_refund_not_once_returning.sql", times: 1 });
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
// What prod holds that the slice chain lacks and the setup-fee migration reads (the same stubs as
// declutterSetupFeeOnce.pglite.mjs): shipping S1's column, the account fee flag and the platform's live fee (200).
const feeAt = stmts.indexOf(readFileSync(new URL(`../../../supabase/migrations/${SETUP_FEE_FILE}`, import.meta.url), "utf8"));
if (feeAt < 0) throw new Error("setup-fee migration not in the chain");
stmts.splice(feeAt, 0, `
  ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0;
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_fee_paid boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS onboarding_fee_charged_at timestamptz;
  CREATE TABLE IF NOT EXISTS public.platform_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    onboarding_fee_cents integer NOT NULL DEFAULT 200);
  INSERT INTO public.platform_settings (onboarding_fee_cents) VALUES (200);`);
// The live-photo check (20261029002010), verbatim from its migration: storage.objects.created_at is set by the
// storage server at upload (a prod column the harness table lacks).
const liveSql = readFileSync(new URL(`../../../supabase/migrations/${LIVE_FILE}`, import.meta.url), "utf8");
const freshFn = liveSql.slice(liveSql.indexOf("CREATE OR REPLACE FUNCTION public.handover_photo_is_fresh"),
  liveSql.indexOf("-- The Helpr's task photos"));
if (!/handover_photo_is_fresh[\s\S]*GRANT EXECUTE/.test(freshFn)) throw new Error(`handover_photo_is_fresh not found in ${LIVE_FILE}`);
const refundAt = stmts.indexOf(readFileSync(new URL(`../../../supabase/migrations/${REFUND_FILE}`, import.meta.url), "utf8"));
if (refundAt < 0) throw new Error("refund migration not in the chain");
stmts.splice(refundAt, 0, `ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();\n${freshFn}`);
for (const sql of stmts) await db.exec(sql);
// Every member here already paid the one-time setup fee, so each order's total is the sale's own (the last
// section turns one buyer's flag off to show a refund after the handover never returns that fee).
await db.exec(`UPDATE public.profiles SET onboarding_fee_paid = true`);
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

// ---------------------------------------------------------------------------
const today = one(await svc(`SELECT (now() AT TIME ZONE 'America/Chicago')::date::text AS d`));
const dayPlus = async (n) => one(await svc(`SELECT ((now() AT TIME ZONE 'America/Chicago')::date + ${n})::text AS d`));
const acceptRet = (uid, rid, way, day, at) =>
  me(uid, `SELECT public.declutter_accept_refund_with_return('${rid}', ${way === null ? "NULL" : `'${way}'`}, ${day ? `'${day}'::date` : "NULL"}, ${at ? `${at}` : "NULL"}) AS r`);
const dropOff = (uid, rid, path, lat = 30.4513, lng = -91.1544) =>
  me(uid, `SELECT public.declutter_return_dropped_off('${rid}', ${path ? `'${path}'` : "NULL"}, ${lat}, ${lng}) AS r`);
const setAddr = (uid, rid, addr, lat = 30.46, lng = -91.16) =>
  me(uid, `SELECT public.declutter_set_return_address('${rid}', ${addr === null ? "NULL" : `'${addr}'`}, ${lat}, ${lng}) AS r`);
const gotBack = (uid, rid, path) =>
  me(uid, `SELECT public.declutter_refund_item_returned('${rid}'${path === undefined ? "" : `, ${path ? `'${path}'` : "NULL"}`}) AS r`);
const upload = (name, ageMins = 0) =>
  svc(`INSERT INTO storage.objects (bucket_id, name, created_at) VALUES ('declutter-handover', '${name}', now() - interval '${ageMins} minutes')`);
/** A handed-over order with an open refund request. */
async function asked(n, buyer, seller, price = 3000) {
  const o = await paidOrder(n, buyer, seller, price);
  await gotIt(buyer, o.order_id);
  await ask(buyer, o.order_id);
  return { o, r: await req(o.order_id) };
}

// R1. The new columns and RPCs exist only with the migration (RED when it is skipped).
const cols = (await svc(`SELECT column_name FROM information_schema.columns WHERE table_name = 'declutter_refund_requests' AND column_name LIKE 'return%'`)).map((c) => c.column_name);
ok(["return_way", "return_day", "return_at", "return_address", "return_lat", "return_lng", "return_photo_path", "return_dropped_off_at", "returned_photo_path"].every((c) => cols.includes(c)),
  "the request carries the return: way, day, time, collect address, the drop-off photo and the seller's photo");

// R2. Drop-off: the seller agrees in full AND picks the way in one call.
const { o: A, r: rA } = await asked(51, BUYER, SELLER);
ok(refused(await acceptRet(BUYER, rA.id, "drop_off", today), /refund_not_found/), "the buyer cannot answer for the seller");
ok(refused(await acceptRet(BUYER3, rA.id, "drop_off", today), /refund_not_found/), "a stranger cannot answer");
ok(refused(await acceptRet(OUTSIDER, rA.id, "drop_off", today), /feature_disabled/), "the hidden switch refuses an ordinary account");
ok(refused(await anon(`SELECT public.declutter_accept_refund_with_return('${rA.id}', 'drop_off', now()::date, NULL)`), /permission denied/), "anon cannot execute it");
ok(refused(await acceptRet(SELLER, rA.id, "helpr_trip", today), /invalid_return_way/), "no paid Helpr return trip: only drop_off or collect");
ok(refused(await acceptRet(SELLER, rA.id, "drop_off", null), /invalid_return_day/), "a drop-off needs a day");
ok(refused(await acceptRet(SELLER, rA.id, "drop_off", await dayPlus(-1)), /invalid_return_day/), "  not a past day");
ok(refused(await acceptRet(SELLER, rA.id, "drop_off", await dayPlus(8)), /invalid_return_day/), "  not more than 7 days out");
ok(refused(await acceptRet(SELLER, rA.id, "drop_off", today, "now() + interval '1 hour'"), /invalid_return_time/), "  and no collect time");
ok((await req(A.order_id)).status === "open", "  every refusal left the request open (one atomic call)");
const dayA = await dayPlus(1);
const accA = one(await acceptRet(SELLER, rA.id, "drop_off", dayA));
const rA2 = await req(A.order_id);
ok(accA?.result === "returning" && rA2.status === "returning" && rA2.return_way === "drop_off" && rA2.return_at == null
   && rA2.return_by != null && !(await refundRow(A.order_id)),
  "the seller agrees a full refund with a drop-off day: returning, nothing refunded yet");
ok(refused(await acceptRet(SELLER, rA.id, "drop_off", dayA), /refund_already_answered/), "a second answer is refused");
ok(refused(await answer(SELLER, rA.id, "full"), /refund_already_answered/), "  and the old answer cannot add a second one");
ok(/pickup address on .* or after/.test((await svc(`SELECT message FROM public.notifications WHERE user_id = '${BUYER}' AND title = 'The seller agreed to a full refund' ORDER BY created_at DESC LIMIT 1`))[0]?.message ?? ""),
  "  the buyer is told where and from which day");
// The drop-off photo: the buyer's own, in the return folder, live, at the address, on or after the day.
const pathA = `${BUYER}/declutter/return/${A.order_id}/drop.jpg`;
ok(one(await me(BUYER, `SELECT public.declutter_handover_photo_access('${pathA}', true) AS a`)) === true, "the buyer may upload into the order's return folder while it is returning");
ok(one(await me(BUYER, `SELECT public.declutter_handover_photo_access('${BUYER}/declutter/handover/${A.order_id}/x.jpg', true) AS a`)) === false,
  "  but not into the handover folder of a handed-over order");
ok(one(await me(BUYER3, `SELECT public.declutter_handover_photo_access('${BUYER3}/declutter/return/${A.order_id}/x.jpg', true) AS a`)) === false,
  "  a stranger may not upload into it");
await upload(pathA);
ok(refused(await dropOff(BUYER, rA.id, pathA), /before_return_day/), "a drop-off before the seller's day is refused");
await svc(`UPDATE public.declutter_refund_requests SET return_day = (now() AT TIME ZONE 'America/Chicago')::date WHERE id = '${rA.id}'`);
ok(refused(await dropOff(SELLER, rA.id, pathA), /refund_not_found/), "the seller cannot mark the buyer's drop-off");
ok(refused(await dropOff(OUTSIDER, rA.id, pathA), /feature_disabled/), "  the hidden switch refuses an ordinary account");
ok(refused(await dropOff(BUYER, rA.id, `${BUYER}/declutter/return/${A.order_id}/missing.jpg`), /photo_not_uploaded/), "  a photo that was never uploaded is refused");
const oldA = `${BUYER}/declutter/return/${A.order_id}/old.jpg`;
await upload(oldA, 30);
ok(refused(await dropOff(BUYER, rA.id, oldA), /photo_too_old/), "  an old photo is refused (live camera only)");
ok(refused(await dropOff(BUYER, rA.id, pathA, 30.5, -91.2), /not_at_pickup/), "  a photo away from the pickup address is refused");
ok(refused(await dropOff(BUYER, rA.id, pathA, "NULL", "NULL"), /location_required/), "  a photo with no location is refused");
ok(one(await dropOff(BUYER, rA.id, pathA))?.result === "dropped_off", "the buyer drops it off with a live photo at the address");
const rA3 = await req(A.order_id);
ok(rA3.return_photo_path === pathA && rA3.return_dropped_off_at != null && rA3.status === "returning" && !(await refundRow(A.order_id)),
  "  the photo is kept; it moves no money (the seller's I got it back is the only money path)");
ok(one(await dropOff(BUYER, rA.id, pathA))?.result === "already_dropped_off", "  a second drop-off is a no-op");
ok((await view(SELLER, A.order_id))?.request?.return_dropped_off_at != null, "  the seller's view shows it was dropped off");
// The seller's optional photo with I got it back.
const sPath = `${SELLER}/declutter/return/${A.order_id}/back.jpg`;
ok(refused(await gotBack(SELLER, rA.id, pathA), /photo_not_uploaded/), "the seller cannot use the buyer's photo as their own");
await upload(sPath);
ok(refused(await gotBack(BUYER, rA.id, sPath), /refund_not_found/), "the buyer cannot say I got it back");
const backA = one(await gotBack(SELLER, rA.id, sPath));
const rfA = await refundRow(A.order_id);
ok(backA?.result === "refunded" && rfA?.reason === "refund_request_full" && rfA.fee_policy === "keep_card_fee"
   && rfA.refund_cents === accA.full_refund_cents && rfA.refund_cents === A.total_cents - CARD_FEE,
  "the seller's I got it back (with a photo) sends the same full refund as before");
ok((await req(A.order_id)).returned_photo_path === sPath, "  the seller's photo is kept");

// R3. Collect: the buyer types the address; the seller sees it only while returning + collect.
const { o: C, r: rC } = await asked(52, BUYER2, SELLER);
ok(refused(await acceptRet(SELLER, rC.id, "collect", null, "now() - interval '1 hour'"), /invalid_return_time/), "a collect time in the past is refused");
ok(refused(await acceptRet(SELLER, rC.id, "collect", null, null), /invalid_return_time/), "  a collect needs a time");
ok(refused(await acceptRet(SELLER, rC.id, "collect", null, "now() + interval '9 days'"), /invalid_return_day/), "  not more than 7 days out");
ok(one(await acceptRet(SELLER, rC.id, "collect", null, "now() + interval '2 hours'"))?.result === "returning", "the seller agrees and will collect");
ok(refused(await dropOff(BUYER2, rC.id, `${BUYER2}/declutter/return/${C.order_id}/x.jpg`), /not_a_drop_off/), "a collect has no drop-off");
ok(refused(await setAddr(SELLER, rC.id, "1 Seller Way"), /refund_not_found/), "the seller cannot set the buyer's address");
ok(refused(await setAddr(BUYER3, rC.id, "1 Stranger Way"), /refund_not_found/), "  nor a stranger");
ok(refused(await setAddr(OUTSIDER, rC.id, "1 Outsider Way"), /feature_disabled/), "  the hidden switch refuses an ordinary account");
ok(refused(await setAddr(BUYER2, rC.id, "   "), /address_required/), "an empty address is refused");
ok(refused(await setAddr(BUYER2, rC.id, "9 Main St", "NULL", "NULL"), /address_not_found/), "  an address with no location is refused");
ok(one(await setAddr(BUYER2, rC.id, "77 Return Rd, Baton Rouge"))?.result === "address_set", "the buyer types where to collect it");
const vCs = await view(SELLER, C.order_id);
ok(vCs?.request?.return_address === "77 Return Rd, Baton Rouge" && vCs.request.return_lat != null, "the seller sees the address while it is coming back");
ok(refused(await me(BUYER3, `SELECT public.declutter_refund_request_view('${C.order_id}')`), /item_not_found/), "  a stranger sees nothing (item_not_found)");
ok(refused(await me(SELLER, `SELECT return_address FROM public.declutter_refund_requests`), /permission denied/), "  no member reads the table directly");
// Backstop: counts from the later of return_by and the collect time + 24 hours.
await svc(`UPDATE public.declutter_refund_requests SET return_by = now() - interval '1 minute', return_at = now() - interval '23 hours',
  return_day = ((now() - interval '23 hours') AT TIME ZONE 'America/Chicago')::date WHERE id = '${rC.id}'`);
await svc(`SELECT public.declutter_refund_request_sweep()`);
ok((await req(C.order_id)).status === "returning", "the backstop waits 24 hours after the collect time, even past return_by");
await svc(`UPDATE public.declutter_refund_requests SET return_at = now() - interval '25 hours',
  return_day = ((now() - interval '25 hours') AT TIME ZONE 'America/Chicago')::date WHERE id = '${rC.id}'`);
await svc(`SELECT public.declutter_refund_request_sweep()`);
const rC2 = await req(C.order_id);
ok(rC2.status === "to_admin" && rC2.problem_id != null, "  then it goes to an admin");
const vCs2 = await view(SELLER, C.order_id);
ok(vCs2?.request?.return_address == null && vCs2?.request?.return_lat == null, "  and the seller no longer sees the address");
ok(refused(await gotBack(SELLER, rC.id), /refund_already_answered/), "  nor can say I got it back after that");

// R4. The CHECK ties each way to its fields.
ok(refused(await svc(`UPDATE public.declutter_refund_requests SET return_address = 'x', return_lat = 1, return_lng = 1 WHERE id = '${rA.id}'`), /declutter_refund_requests_return_way/),
  "a drop-off never carries a buyer address");
ok(refused(await svc(`UPDATE public.declutter_refund_requests SET return_photo_path = 'x' WHERE id = '${rC.id}'`), /declutter_refund_requests_return_way/),
  "a collect never carries a drop-off photo");
ok(refused(await svc(`UPDATE public.declutter_refund_requests SET return_way = 'helpr_trip' WHERE id = '${rC.id}'`), /declutter_refund_requests_return_way/),
  "no third way");

// R5. The drop-off backstop: the end of the drop-off day + 24 hours, when that is later than return_by.
const { o: D, r: rD } = await asked(53, BUYER3, SELLER2);
await acceptRet(SELLER2, rD.id, "drop_off", today);
ok(refused(await setAddr(BUYER3, rD.id, "5 Drop St"), /not_a_collect/), "a drop-off takes no collect address");
await svc(`UPDATE public.declutter_refund_requests SET return_by = now() - interval '1 minute' WHERE id = '${rD.id}'`);
await svc(`SELECT public.declutter_refund_request_sweep()`);
ok((await req(D.order_id)).status === "returning", "a drop-off today is not sent to an admin before the end of tomorrow");
await svc(`UPDATE public.declutter_refund_requests SET return_day = (now() AT TIME ZONE 'America/Chicago')::date - 3 WHERE id = '${rD.id}'`);
await svc(`SELECT public.declutter_refund_request_sweep()`);
ok((await req(D.order_id)).status === "to_admin", "  a drop-off day long past: an admin decides");

// R6. A full answer through the old call (no way) still works as before; every return field stays empty.
const { o: E, r: rE } = await asked(54, BUYER, SELLER2);
ok(one(await answer(SELLER2, rE.id, "full"))?.result === "returning", "the old full answer still works");
const rE2 = await req(E.order_id);
ok(rE2.return_way == null && rE2.return_day == null && rE2.return_address == null, "  with no way and no return fields");
ok(one(await gotBack(SELLER2, rE.id))?.result === "refunded", "  and I got it back with one argument still refunds");

// R7. Grants by role: the new internal helpers are not for members.
for (const fn of [`declutter_return_photo_ok('${A.order_id}', '${BUYER}', '${pathA}')`, `declutter_return_backstop_at(NULL::public.declutter_refund_requests)`]) {
  ok(refused(await me(BUYER, `SELECT public.${fn}`), /permission denied/), `a member cannot call ${fn.split("(")[0]}`);
}
ok(refused(await anon(`SELECT public.declutter_refund_item_returned('${rA.id}', NULL)`), /permission denied/), "anon cannot execute the new I got it back");
ok(refused(await anon(`SELECT public.declutter_return_dropped_off('${rA.id}', NULL, 0, 0)`), /permission denied/), "anon cannot execute the drop-off");
ok(refused(await anon(`SELECT public.declutter_set_return_address('${rA.id}', 'x', 0, 0)`), /permission denied/), "anon cannot execute the address");

console.log(`\n${pass} passed, ${fail} failed${skip ? " (NEW_MIGRATION=skip: expected RED)" : ""}`);
process.exit(fail ? 1 : 0);
