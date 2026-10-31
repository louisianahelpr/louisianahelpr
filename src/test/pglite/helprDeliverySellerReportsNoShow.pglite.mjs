#!/usr/bin/env node
/**
 * PGlite proof for 20261031134217_helpr_delivery_seller_reports_no_show.sql (soldstates-5, owner 10-31): the seller's
 * "The Helpr didn't come" on a Helpr delivery holds the buyer's money, tells the Helpr at once, gives them 24 hours to
 * answer with proof, and no answer is a strike (the task goes back up for another Helpr).
 *
 *   node src/test/pglite/helprDeliverySellerReportsNoShow.pglite.mjs                  # applies the migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprDeliverySellerReportsNoShow.pglite.mjs # RED: no report exists
 *   MUTANT=<name> node src/test/pglite/helprDeliverySellerReportsNoShow.pglite.mjs    # a planted defect: must FAIL
 *
 * World: the columns the functions read. REAL bodies (newest CREATE before this migration): helpr_task_lock,
 * helpr_task_reopen, helpr_task_log (writes helpr_task_events under the restated CHECK). Stubbed, and said so:
 * declutter_notify (records), declutter_order_items_named, declutter_lock_order, declutter_order_side,
 * is_caller_banned, is_test_subject (false), helpr_task_give_job_strike (records), helpr_task_source_event (records),
 * helpr_task_close, log_cron_defect (records), auth.uid() (a setting), storage.objects (a table).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = "20261031134217_helpr_delivery_seller_reports_no_show.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The waiting report no longer holds the money (the 2-hour sweep strikes and reopens under it).
  hold: ["      OR EXISTS (SELECT 1 FROM public.helpr_tasks x", "      OR false AND EXISTS (SELECT 1 FROM public.helpr_tasks x"],
  // No strike when the Helpr doesn't answer.
  strike: ["          PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,\n            'The seller said", "          PERFORM public.helpr_task_log(t.id, 'helpr_no_show', t.helpr_id,\n            'The seller said"],
  // Review #1: the answer files the problem as the seller's (the admin could then "Pay the seller").
  helprside: ["VALUES (o.id, v_uid, 'helpr', 'no_show', btrim(p_note),", "VALUES (o.id, v_uid, 'seller', 'no_show', btrim(p_note),"],
  // Review #3: a reopened task keeps the old Helpr's report.
  stale: ["         seller_no_show_reported_at = NULL, seller_no_show_answer_by = NULL, seller_no_show_answered_at = NULL,\n         seller_no_show_settled_at = NULL", "         releases = releases"],
  // Review #6: the seller can report a Helpr they handed it over to.
  handed: ["IF t.handed_over_at IS NOT NULL AND t.handed_over_to IS NOT DISTINCT FROM t.helpr_id THEN", "IF false THEN"],
  // The Helpr isn't told.
  told: ["PERFORM public.declutter_notify(t.helpr_id, 'declutter_pickups', 'The seller says you didn''t come',", "PERFORM public.declutter_notify(o.seller_id, 'declutter_pickups', 'The seller says you didn''t come',"],
  // The buyer may report it too.
  side: ["IF v_side <> 'seller' THEN\n    RAISE EXCEPTION 'wrong_side'", "IF false THEN\n    RAISE EXCEPTION 'wrong_side'"],
  // An answer after the 24 hours still counts.
  late: ["IF now() >= t.seller_no_show_answer_by THEN", "IF false THEN"],
};
const skip = process.env.NEW_MIGRATION === "skip";
let mig = readFileSync(MIG_DIR + THIS, "utf8");
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replaceAll(m[0], m[1]);
}

/** The newest CREATE FUNCTION text for `name` in migrations strictly before `before` (any dollar tag). */
function newestBefore(name, before) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = `${sql.slice(m.index, end + t[1].length)};`;
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

let failures = 0;
const check = (ok, name, got = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got})`}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), HELPR = U(3), STRANGER = U(4), HELPR2 = U(5);
const O = (n) => `22222222-0000-0000-0000-${String(n).padStart(12, "0")}`;
const T = (n) => `33333333-0000-0000-0000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table storage.objects (bucket_id text, name text);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true), '')::uuid $f$;
  create function public.is_caller_banned() returns boolean language sql stable as $f$ select false $f$;
  create function public.is_test_subject(u uuid) returns boolean language sql stable as $f$ select false $f$;
  create table public.user_roles (user_id uuid, role text);
  create table public.test_accounts (user_id uuid);
  create table public.profiles (user_id uuid, is_seed boolean default false);
  create table public.notes (user_id uuid, kind text, title text, message text, link text, actor uuid);
  create function public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_actor uuid default null)
    returns void language sql as $f$ insert into public.notes values (p_user, p_type, p_title, p_message, p_link, p_actor) $f$;
  create function public.declutter_order_items_named(p uuid) returns text language sql as $f$ select 'the lamp' $f$;
  create table public.declutter_orders (id uuid primary key, buyer_id uuid, seller_id uuid, status text, handover text, is_seed boolean default false);
  create function public.declutter_lock_order(p uuid) returns public.declutter_orders language plpgsql as $f$
    declare o public.declutter_orders; begin select * into o from public.declutter_orders where id = p for update;
    if o.id is null then raise exception 'item_not_found' using errcode = 'P0002'; end if; return o; end $f$;
  create function public.declutter_order_side(b uuid, s uuid, u uuid) returns text language sql immutable as $f$
    select case when u = b then 'buyer' when u = s then 'seller' end $f$;
  create table public.helpr_tasks (id uuid primary key, status text not null, helpr_id uuid, customer_id uuid, pickup_contact_id uuid,
    title text, source_kind text default 'declutter_delivery', source_id uuid, pickup_slot_start timestamptz, accepted_at timestamptz,
    open_until timestamptz default now() + interval '1 day', latest_pickup_at timestamptz default now() + interval '5 days',
    releases integer default 0, wrong_codes integer default 0, picked_up_at timestamptz, delivered_at timestamptz,
    in_hand_nudged_at timestamptz, is_seed boolean default false, updated_at timestamptz, handed_over_at timestamptz, handed_over_to uuid);
  create table public.declutter_order_deliveries (order_id uuid, task_id uuid);
  create table public.declutter_problems (id uuid primary key default gen_random_uuid(), order_id uuid, reporter_id uuid, reporter_side text,
    reason text, note text, photo_paths text[], status text default 'open', other_side_note text, other_side_photo_paths text[], other_side_at timestamptz,
    is_seed boolean default false);
  create table public.helpr_task_events (task_id uuid, task_event text, actor_id uuid, detail text);
  alter table public.helpr_task_events add constraint helpr_task_events_task_event_check check (task_event in ('created', 'accepted', 'released', 'helpr_no_show', 'pickup_moved'));
  create table public.strikes (user_id uuid, type text, task uuid);
  create function public.helpr_task_give_job_strike(p_user uuid, p_type text, p_task uuid, p_description text) returns jsonb language sql as
    $f$ insert into public.strikes values (p_user, p_type, p_task); select '{}'::jsonb $f$;
  create table public.events (task uuid, event text);
  create function public.helpr_task_source_event(p_task uuid, p_event text, p_by text) returns jsonb language sql as
    $f$ insert into public.events values (p_task, p_event); select '{}'::jsonb $f$;
  create function public.helpr_task_close(p uuid, s text, w text) returns void language sql as $f$ update public.helpr_tasks set status = s where id = p $f$;
  create table public.defects (fn text, id text, err text);
  create function public.log_cron_defect(a text, b text, c text) returns void language sql as $f$ insert into public.defects values (a, b, c) $f$;
`);
for (const fn of ["helpr_task_log", "helpr_task_lock", "helpr_task_reopen", "helpr_task_source_held"]) {
  await db.exec(newestBefore(fn, THIS));
}

async function as(uid, sql, params = []) {
  await db.query(`select set_config('test.uid', $1, false)`, [uid ?? ""]);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; }
}
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
// Orders 1-3: Helpr deliveries, the Helpr booked for 20 minutes ago. 4: booked in an hour. 5: already picked up.
async function reset() {
  await db.exec(`truncate public.declutter_orders, public.helpr_tasks, public.declutter_order_deliveries, public.declutter_problems,
    public.helpr_task_events, public.strikes, public.events, public.notes, public.defects, storage.objects;`);
  for (let n = 1; n <= 7; n++) {
    await db.query(`insert into public.declutter_orders values ($1, $2, $3, 'paid', 'delivery', false)`, [O(n), BUYER, SELLER]);
    await db.query(`insert into public.helpr_tasks (id, status, helpr_id, customer_id, title, source_id, pickup_slot_start, accepted_at)
      values ($1, $2, $3, $4, 'Brass lamp', $5, now() + $6::interval, now() - interval '1 day')`,
      [T(n), n === 5 ? "picked_up" : "accepted", HELPR, BUYER, O(n), n === 4 ? "1 hour" : "-20 minutes"]);
    await db.query(`insert into public.declutter_order_deliveries values ($1, $2)`, [O(n), T(n)]);
  }
  await db.exec(`insert into storage.objects values ('helpr-tasks', '${HELPR}/task/${T(2)}/proof.jpg');
    update public.helpr_tasks set handed_over_at = now(), handed_over_to = '${HELPR}' where id = '${T(6)}';`);
}
const report = (uid, n) => as(uid, `select public.declutter_report_helpr_no_show($1) r`, [O(n)]);
const answer = (uid, n, note, photo = null) => as(uid, `select public.declutter_helpr_answer_no_show($1, $2, $3) r`, [T(n), note, photo]);
const held = async (n) => (await one(`select public.helpr_task_source_held('declutter_delivery', $1) h`, [O(n)])).h;
const sweep = () => as(null, `select public.helpr_task_sweep() s`);

if (skip) {
  await reset();
  const r = await report(SELLER, 1);
  check(r.rows?.[0]?.r?.result === "helpr_told", "[skip] the seller can report the Helpr didn't come", r.error);
} else {
  for (let pass = 1; pass <= 3; pass++) {
    await db.exec(mig);
    await reset();
    const P = `[apply ${pass}]`;
    check(/wrong_side/.test((await report(BUYER, 1)).error ?? ""), `${P} the buyer can't file the seller's report`);
    check(/item_not_found/.test((await report(STRANGER, 1)).error ?? ""), `${P} a stranger learns nothing`);
    check(/too_early/.test((await report(SELLER, 4)).error ?? ""), `${P} before 15 minutes past the pickup time: refused`);
    check(/no_helpr_booked/.test((await report(SELLER, 5)).error ?? ""), `${P} already picked up: refused (that is a problem report)`);
    check(/already_handed_over/.test((await report(SELLER, 6)).error ?? ""), `${P} handed over to this Helpr: refused (review #6)`);
    check(!(await held(1)), `${P} nothing held before the report`);

    const r1 = await report(SELLER, 1);
    check(r1.rows?.[0]?.r?.result === "helpr_told", `${P} the seller's report goes through`, JSON.stringify(r1));
    const t1 = await one(`select extract(epoch from seller_no_show_answer_by - seller_no_show_reported_at)::int / 3600 h, status from public.helpr_tasks where id = $1`, [T(1)]);
    check(t1.h === 24 && t1.status === "accepted", `${P} 24 hours to answer; the task stays booked`, JSON.stringify(t1));
    const hn = await one(`select title, link from public.notes where user_id = $1`, [HELPR]);
    check(hn?.title === "The seller says you didn't come" && hn?.link === "/declutter?tab=deliver", `${P} the Helpr is told at once`, JSON.stringify(hn));
    const bn = await one(`select message from public.notes where user_id = $1`, [BUYER]);
    check(/Your money stays held/.test(bn?.message ?? ""), `${P} the buyer is told the money stays held`, JSON.stringify(bn));
    check(await held(1), `${P} the report holds the money`);
    check((await report(SELLER, 1)).rows?.[0]?.r?.result === "helpr_told", `${P} a second tap answers the same`);
    check((await db.query(`select count(*)::int n from public.notes where user_id = $1`, [HELPR])).rows[0].n === 1, `${P} a second tap tells no one twice`);

    // The 2-hour sweep doesn't strike or reopen under a waiting report.
    await db.query(`update public.helpr_tasks set pickup_slot_start = now() - interval '3 hours' where id = $1`, [T(1)]);
    await sweep();
    const t1b = await one(`select status, helpr_id from public.helpr_tasks where id = $1`, [T(1)]);
    check(t1b.status === "accepted" && (await db.query(`select count(*)::int n from public.strikes`)).rows[0].n === 0,
      `${P} while the Helpr may answer: no strike, no reopen`, JSON.stringify(t1b));

    // The Helpr's answer, on order 2.
    await report(SELLER, 2);
    check(/task_not_found/.test((await answer(HELPR2, 2, "I was there")).error ?? ""), `${P} another Helpr can't answer`);
    check(/note_required/.test((await answer(HELPR, 2, "  ")).error ?? ""), `${P} an empty answer: refused`);
    check(/photo_not_uploaded/.test((await answer(HELPR, 2, "I was there", `${HELPR}/task/${T(1)}/proof.jpg`)).error ?? ""), `${P} a photo not in this task's folder: refused`);
    const a2 = await answer(HELPR, 2, "I was there at 2, nobody came to the door", `${HELPR}/task/${T(2)}/proof.jpg`);
    check(!!a2.rows?.[0]?.r, `${P} the Helpr answers with a photo`, JSON.stringify(a2));
    const pr = await one(`select reporter_id, reporter_side, reason, status, note, photo_paths, other_side_note from public.declutter_problems where order_id = $1`, [O(2)]);
    check(pr?.reporter_id === HELPR && pr?.reporter_side === "helpr" && pr?.status === "open" && pr?.note?.startsWith("I was there")
      && pr?.photo_paths?.length === 1 && /^The seller says the Helpr didn't come/.test(pr?.other_side_note ?? ""),
      `${P} it becomes the Helpr's problem (no "Pay the seller"), the seller's report the other side`, JSON.stringify(pr));
    check(await held(2), `${P} answered: still held (the problem)`);
    check((await answer(HELPR, 2, "I was there at 2, nobody came to the door")).rows?.[0]?.r === a2.rows?.[0]?.r, `${P} the same answer again answers the same`);

    // Order 7: a problem opened after the report (review #4): the answer is recorded, no second problem.
    await report(SELLER, 7);
    await db.query(`insert into public.declutter_problems (order_id, reporter_id, reporter_side, reason, note) values ($1, $2, 'buyer', 'other', 'x')`, [O(7), BUYER]);
    const a7 = await answer(HELPR, 7, "I was there");
    check(!!a7.rows?.[0]?.r && (await db.query(`select count(*)::int n from public.declutter_problems where order_id = $1`, [O(7)])).rows[0].n === 1,
      `${P} a problem already open: the answer is recorded on the task, no second problem`, JSON.stringify(a7));
    await db.query(`update public.declutter_problems set status = 'decided' where order_id = $1`, [O(7)]);
    await db.query(`update public.helpr_tasks set seller_no_show_answer_by = now() - interval '1 minute' where id = $1`, [T(7)]);
    // Order 3: reported, then the Helpr is too late.
    await report(SELLER, 3);
    await db.query(`update public.helpr_tasks set seller_no_show_answer_by = now() - interval '1 minute', seller_no_show_reported_at = now() - interval '25 hours' where id in ($1, $2)`, [T(2), T(3)]);
    check(/no_show_answer_late/.test((await answer(HELPR, 3, "I was there")).error ?? ""), `${P} an answer after 24 hours: refused`);
    await db.query(`update public.helpr_tasks set seller_no_show_answer_by = now() - interval '1 minute' where id = $1`, [T(1)]);
    await sweep();
    const strikes = (await db.query(`select task, type from public.strikes order by task`)).rows;
    check(strikes.length === 2 && strikes.every((s) => s.type === "delivery_no_show") && strikes.map((s) => s.task).join() === [T(1), T(3)].join(),
      `${P} no answer in 24 hours: a strike (orders 1 and 3); the answered one: none`, JSON.stringify(strikes));
    const t3 = await one(`select status, helpr_id, seller_no_show_reported_at r, seller_no_show_settled_at s from public.helpr_tasks where id = $1`, [T(3)]);
    check(t3.status === "open" && t3.helpr_id === null && t3.r === null && t3.s === null,
      `${P} the delivery goes back up for another Helpr, with no old report (review #3)`, JSON.stringify(t3));
    check((await db.query(`select count(*)::int n from public.events where task = $1 and event = 'released'`, [T(3)])).rows[0].n === 1, `${P} the buyer and seller are told (released)`);
    check(!(await held(3)), `${P} settled: no longer held`);
    check((await db.query(`select status from public.declutter_orders where id = $1`, [O(3)])).rows[0].status === "paid", `${P} the buyer's money is not refunded: the order stays paid`);
    await sweep();
    check((await db.query(`select count(*)::int n from public.strikes`)).rows[0].n === 2, `${P} a second sweep strikes no one twice`);
    check((await db.query(`select count(*)::int n from public.defects`)).rows[0].n === 0, `${P} no sweep defect`, JSON.stringify((await db.query(`select * from public.defects`)).rows));

    const rd = async (uid, n) => (await as(uid, `select public.helpr_task_no_show_report($1) r`, [T(n)])).rows?.[0]?.r;
    check(!!(await rd(HELPR, 2))?.answered_at && !!(await rd(SELLER, 2))?.answer_by, `${P} the Helpr and the seller read the clock`);
    check((await rd(BUYER, 2)) == null && (await rd(STRANGER, 2)) == null, `${P} nobody else reads it`);
    check((await db.query(`select count(*)::int n from public.helpr_task_events where task_event like 'seller_no_show%'`)).rows[0].n >= 3, `${P} the log takes the new events`);
  }
}
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
