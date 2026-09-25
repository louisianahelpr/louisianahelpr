#!/usr/bin/env node
/**
 * PGlite proof for 20260925170555_permanent_ban_ends_recurring_series (owner
 * decision Q407 (9)).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/seriesBanEnds.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain, incl. the cancellation
 * RPC gate and the ban gate). Chain: 20260925052841, 20260925160644,
 * 20260925160645, 20260925165200, then this migration, 3x.
 *
 * OLD STATE (without this migration): permanently banning the poster leaves
 * the series running and its future booked visit live. "OLD STATE RED".
 * NEW STATE: a permanent ban (poster, or a Helpr on the series) ends the
 * series today, cancels every future unstarted visit with the ban reason and
 * no fee, removes future holds and offers, and tells everyone else (never the
 * banned account); a past visit is untouched; a TEMPORARY ban ends nothing;
 * a second ban write is a no-op.
 */
import { PGlite, readMigration, baseSchema, as, checker, USERS } from "./seriesWorld.mjs";

const CHAIN = [
  "20260925052841_recurring_series_end.sql",
  "20260925160644_hired_job_schedule_lock.sql",
  "20260925160645_recurring_split_days.sql",
  "20260925165200_job_schedule_change_requests.sql",
].map(readMigration);
const BAN = readMigration("20260925170555_permanent_ban_ends_recurring_series.sql");
const { P, A, B, C } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `d0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);

async function seed(db) {
  // S1: P posts, A holds every date (one person). A visit in 5 days is booked
  // and funded; a visit 2 days ago happened.
  await db.exec(`
    insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks)
    values ('${J(1)}', 'Weekly clean', '${P}', 'open', current_date - 3, '09:00', '{0,1,2,3,4,5,6}', 3),
           ('${J(2)}', 'Dog walks', '${C}', 'open', current_date + 2, '09:00', '{0,1,2,3,4,5,6}', 2),
           ('${J(3)}', 'Temp series', '${P}', 'open', current_date + 2, '09:00', '{0,1,2,3,4,5,6}', 2);
  `);
  await server(db, `update public.jobs set helper_id = '${A}', status = 'accepted', helper_confirmed_at = now() where id in ('${J(1)}', '${J(3)}')`);
  await server(db, `update public.jobs set helper_id = '${B}', status = 'accepted', helper_confirmed_at = now() where id = '${J(2)}'`);
  await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values ('${J(1)}', current_date - 2, '${A}') on conflict (parent_job_id, visit_date) do update set helper_id = excluded.helper_id`);
  await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${J(10)}', 'Weekly clean', '${P}', '${A}', 'accepted', current_date + 5, '09:00', '${J(1)}', 'escrow')`);
  await db.exec(`insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${J(11)}', 'Weekly clean', '${P}', '${A}', 'completed', current_date - 2, '09:00', '${J(1)}', 'released')`);
}
const row = async (db, id) => (await db.query(`select status::text, series_ended_on::text, cancellation_reason, cancellation_fee, late_cancellation from public.jobs where id='${id}'`)).rows[0];

{
  const db = new PGlite();
  await db.exec(baseSchema("20260925052841"));
  for (const m of CHAIN) await db.exec(m);
  await seed(db);
  await server(db, `update public.profiles set ban_status = 'permanently_banned' where user_id = '${P}'`);
  const s = await row(db, J(1)), v = await row(db, J(10));
  const red = s.series_ended_on === null && v.status === "accepted";
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: after a permanent ban of the poster the series ended_on=${s.series_ended_on}, next visit ${v.status}`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(baseSchema("20260925052841"));
for (let i = 0; i < 3; i++) {
  for (const m of CHAIN) await db.exec(m);
  await db.exec(BAN);
}
await seed(db);
check("migration applies 3x (replay-safe)", true);

const today = (await db.query(`select (now() at time zone 'America/Chicago')::date::text t`)).rows[0].t;

let r = await server(db, `update public.profiles set ban_status = 'temp_banned', auto_suspended_until = now() + interval '7 days' where user_id = '${P}'`);
check("a TEMPORARY ban ends nothing (the cron pauses it instead)", r.ok && (await row(db, J(3))).series_ended_on === null && (await row(db, J(10))).status === "accepted", r.err);
await server(db, `update public.profiles set ban_status = 'active', auto_suspended_until = null where user_id = '${P}'`);

r = await server(db, `update public.profiles set ban_status = 'permanently_banned' where user_id = '${P}'`);
check("a permanent ban write goes through", r.ok, r.err);
let s = await row(db, J(1));
check("the poster's series ends today", s.series_ended_on === today, JSON.stringify(s));
const v = await row(db, J(10));
check("the future booked visit is cancelled, with the ban reason, no fee, not late",
  v.status === "cancelled" && v.cancellation_reason === "series_ended_account_banned" && Number(v.cancellation_fee) === 0 && v.late_cancellation === false, JSON.stringify(v));
check("a visit that already happened is untouched", (await row(db, J(11))).status === "completed");
check("every series the poster posted ends", (await row(db, J(3))).series_ended_on === today);
check("visit one still ahead is cancelled too", (await row(db, J(3))).status === "cancelled");
let n = (await db.query(`select count(*)::int c from public.series_visit_holds where parent_job_id='${J(1)}' and visit_date > current_date`)).rows[0].c;
check("future holds are removed", n === 0, String(n));
n = (await db.query(`select distinct user_id from public.notifications where title='Recurring series ended' and job_id in ('${J(1)}', '${J(3)}')`)).rows.map((x) => x.user_id);
check("the Helpr is told; the banned poster is not", n.includes(A) && !n.includes(P), JSON.stringify(n));
const before = (await db.query(`select count(*)::int c from public.notifications`)).rows[0].c;
r = await server(db, `update public.profiles set ban_status = 'banned' where user_id = '${P}'`);
const after = (await db.query(`select count(*)::int c from public.notifications`)).rows[0].c;
check("a second ban write changes nothing (the series are already ended)", r.ok && before === after, `${before} -> ${after}`);

// A Helpr on the series is banned: the series ends, the poster is told.
r = await server(db, `update public.profiles set ban_status = 'permanently_banned' where user_id = '${B}'`);
s = await row(db, J(2));
check("banning the Helpr on a series ends it", r.ok && s.series_ended_on === today, JSON.stringify(s));
n = (await db.query(`select user_id, message from public.notifications where title='Recurring series ended' and job_id='${J(2)}'`)).rows;
check("the poster is told (\"won't be charged\"), the banned Helpr is not", n.length === 1 && n[0].user_id === C && /won't be charged/.test(n[0].message), JSON.stringify(n));
r = await server(db, `insert into public.jobs (title, customer_id, helper_id, status, date_needed, parent_job_id) values ('v', '${C}', '${B}', 'accepted', current_date + 3, '${J(2)}')`);
check("no new visit can be created on the ended series", !r.ok && /series_ended/.test(r.err), r.err);

// HIGH-1 (money review 2026-09-25): the refund reads a SERVER-OWNED marker,
// and the ban reason is reserved.
r = await as(db, "postgres", null, `select series_ban_cancelled_at is not null as m from public.jobs where id='${J(10)}'`);
check("the ban path stamps the server-owned marker on the visit it cancels", r.ok && r.rows[0].m === true, r.err ?? JSON.stringify(r.rows));
await db.exec(`insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time) values ('${J(20)}', 'one-off', '${C}', '${A}', 'accepted', current_date + 1, '09:00')`);
r = await as(db, "authenticated", C, `do $$ begin perform set_config('app.sanctioned_cancel', 'on', true);
  update public.jobs set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'series_ended_account_banned' where id = '${J(20)}'; end $$`);
check("a poster's cancel (the RPC's sanctioned path) cannot use the reserved ban reason", !r.ok && /reserved_cancellation_reason/.test(r.err), r.err);
r = await as(db, "authenticated", C, `do $$ begin perform set_config('app.sanctioned_cancel', 'on', true);
  update public.jobs set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'plans changed' where id = '${J(20)}'; end $$`);
check("... any other reason still cancels", r.ok, r.err);
r = await as(db, "authenticated", C, `update public.jobs set series_ban_cancelled_at = now() where id = '${J(20)}'`);
check("a client cannot write the marker", !r.ok && /series_ban_cancelled_at/.test(r.err), r.err);
r = await as(db, "authenticated", C, `insert into public.jobs (title, customer_id, status, date_needed, series_ban_cancelled_at) values ('x', '${C}', 'open', current_date + 4, now())`);
check("... nor insert a job carrying it", !r.ok && /series_ban_cancelled_at/.test(r.err), r.err);

r = await as(db, "authenticated", A, `select has_function_privilege('authenticated', 'public.end_series_for_banned_account(uuid)', 'execute') as x`);
check("clients cannot call end_series_for_banned_account", r.ok && r.rows[0].x === false, r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
