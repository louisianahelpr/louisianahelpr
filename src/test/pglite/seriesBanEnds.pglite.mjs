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
const { P, A, B, C, X } = USERS;
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
check("the poster is told (refunded less the processing fee, Q407 12), the banned Helpr is not", n.length === 1 && n[0].user_id === C && /refunded, less the card processing fee/.test(n[0].message), JSON.stringify(n));
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

// ── Owner decision Q407 (10): on a SPLIT series a permanent ban of ONE Helpr
// hands back only that Helpr's dates; the others keep theirs; the poster
// offers them again. Banned IN THE HELPR'S OWN REQUEST (the consequence
// ladder bans inside e.g. helper_cancel_booking), so every client lock on
// jobs judges the writes as that Helpr.
{
  const S = J(30), SV = J(31), SW = J(32);
  const E = "66666666-6666-6666-6666-666666666666"; // the Helpr who gets banned
  await db.exec(`insert into auth.users values ('${E}') on conflict do nothing;
    insert into public.profiles (user_id, full_name) values ('${E}', 'User E') on conflict do nothing;
    update public.profiles set ban_status = 'active' where user_id in ('${A}', '${C}');`);
  await db.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks, series_split_ok)
    values ('${S}', 'Split walks', '${C}', 'open', current_date + 2, '09:00', '{0,1,2,3,4,5,6}', 3, true)`);
  await server(db, `update public.jobs set helper_id = '${A}', status = 'accepted', helper_confirmed_at = now() where id = '${S}'`);
  await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values
    ('${S}', current_date + 5, '${A}'), ('${S}', current_date + 8, '${E}'), ('${S}', current_date + 9, '${E}'), ('${S}', current_date + 10, '${A}'),
    ('${S}', current_date + 12, '${X}')`);
  await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status)
    values ('${SV}', 'Split walks', '${C}', '${E}', 'accepted', current_date + 8, '09:00', '${S}', 'escrow'),
           ('${SW}', 'Split walks', '${C}', '${A}', 'accepted', current_date + 5, '09:00', '${S}', 'escrow')`);
  await server(db, `update public.jobs set dayof_confirm_reminder_sent_at = now() where id = '${SV}'`);
  await server(db, `insert into public.applications (job_id, helper_id, status) values ('${SV}', '${E}', 'accepted'), ('${S}', '${B}', 'pending') on conflict do nothing`);
  await db.exec(`update public.profiles set ban_status = 'active' where user_id = '${B}'`);
  const before = (await db.query(`select count(*)::int c from public.notifications where user_id = '${E}'`)).rows[0].c;
  r = await as(db, "postgres", null, `do $$ begin
      perform set_config('request.jwt.claim.sub', '${E}', true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      update public.profiles set ban_status = 'permanently_banned' where user_id = '${E}';
    end $$`);
  check("R10 the ban lands inside the banned Helpr's own request", r.ok, r.err);
  const sp = (await db.query(`select series_ended_on::text e, status::text from public.jobs where id='${S}'`)).rows[0];
  check("R10 a split series does NOT end when one Helpr on it is banned", sp.e === null && sp.status === "accepted", JSON.stringify(sp));
  const v = (await db.query(`select status::text, helper_id, payment_status, dayof_confirm_reminder_sent_at from public.jobs where id='${SV}'`)).rows[0];
  check("R10 that Helpr's booked visit is handed back: vacated, still funded, reminders reset", v.status === "open" && v.helper_id === null && v.payment_status === "escrow" && v.dayof_confirm_reminder_sent_at === null, JSON.stringify(v));
  const h = (await db.query(`select visit_date - current_date as d, helper_id from public.series_visit_holds where parent_job_id='${S}' order by 1`)).rows;
  check("R10 only that Helpr's dates are handed back; the others keep theirs", JSON.stringify(h.map((x) => [x.d, x.helper_id])) === JSON.stringify([[5, A], [10, A], [12, X]]), JSON.stringify(h));
  n = (await db.query(`select count(*)::int c from public.recurring_visit_releases where parent_job_id='${S}'`)).rows[0].c;
  check("R10 handed-back dates are the poster's to offer (not given-up dates the others can pick up)", n === 0, String(n));
  n = (await db.query(`select title, message from public.notifications where user_id='${C}' and job_id='${S}'`)).rows;
  check("R10 the poster is told the dates are open to offer again", n.some((x) => x.title === "Visit dates are open again" && /offer/.test(x.message)), JSON.stringify(n));
  n = (await db.query(`select count(*)::int c from public.notifications where user_id = '${E}'`)).rows[0].c;
  check("R10 the banned Helpr is told nothing", n === before, `${before} -> ${n}`);
  const w = (await db.query(`select status::text, helper_id from public.jobs where id='${SW}'`)).rows[0];
  check("R10 another Helpr's booked visit is untouched", w.status === "accepted" && w.helper_id === A, JSON.stringify(w));
  r = await as(db, "authenticated", X, `select public.claim_series_dates('${S}', array[current_date + 8]) as v`);
  check("R10 another Helpr on the series cannot just pick it up (Q407 15)", r.ok && r.rows[0].v.refused.length === 1, r.err ?? JSON.stringify(r.rows?.[0]));
  r = await as(db, "authenticated", C, `select public.offer_series_dates('${S}', '${B}') as v`);
  check("R10 the poster offers the handed-back dates", r.ok && r.rows[0].v.open_dates >= 2, r.err ?? JSON.stringify(r.rows?.[0]));
  r = await as(db, "authenticated", B, `select public.claim_series_dates('${S}', array[current_date + 8]) as v`);
  const t = (await db.query(`select status::text, helper_id from public.jobs where id='${SV}'`)).rows[0];
  check("R10 the offered Helpr takes the handed-back funded visit", r.ok && r.rows[0].v.claimed.length === 1 && t.status === "accepted" && t.helper_id === B, `${r.err ?? JSON.stringify(r.rows?.[0])} ${JSON.stringify(t)}`);
}

// ── LOW-3: a visit TODAY that has not started is cancelled with the series ──
{
  const S = J(40), SOON = J(41), GONE = J(42);
  await db.exec(`update public.profiles set ban_status = 'active' where user_id in ('${A}', '${B}', '${C}')`);
  await db.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks)
    values ('${S}', 'Today series', '${B}', 'open', current_date - 7, '09:00', '{0,1,2,3,4,5,6}', 3)`);
  await server(db, `update public.jobs set helper_id = '${A}', status = 'completed' where id = '${S}'`);
  await server(db, `insert into public.series_visit_holds (parent_job_id, visit_date, helper_id) values
    ('${S}', (now() at time zone 'America/Chicago' + interval '3 hours')::date, '${A}'),
    ('${S}', (now() at time zone 'America/Chicago' - interval '1 hour')::date, '${A}') on conflict do nothing`);
  r = await server(db, `insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, parent_job_id, payment_status) values
    ('${SOON}', 'Today series', '${B}', '${A}', 'accepted', (now() at time zone 'America/Chicago' + interval '3 hours')::date, (now() at time zone 'America/Chicago' + interval '3 hours')::time, '${S}', 'escrow'),
    ('${GONE}', 'Today series', '${B}', '${A}', 'accepted', (now() at time zone 'America/Chicago' - interval '1 hour')::date, (now() at time zone 'America/Chicago' - interval '1 hour')::time, '${S}', 'escrow')`);
  check("LOW-3 fixtures", r.ok, r.err);
  r = await server(db, `update public.profiles set ban_status = 'permanently_banned' where user_id = '${B}'`);
  const soon = (await db.query(`select status::text, series_ban_cancelled_at is not null m from public.jobs where id='${SOON}'`)).rows[0];
  check("LOW-3 a visit later today (start 3h ahead) is cancelled and marked", r.ok && soon.status === "cancelled" && soon.m === true, `${r.err ?? ""} ${JSON.stringify(soon)}`);
  const gone = (await db.query(`select status::text from public.jobs where id='${GONE}'`)).rows[0];
  check("LOW-3 a visit whose start has passed is left alone (a no-show question, not ours)", gone.status === "accepted", JSON.stringify(gone));
}

// ── A failure inside one series never blocks the ban; it is logged ────────
{
  const S = J(50);
  await db.exec(`update public.profiles set ban_status = 'active' where user_id = '${A}'`);
  await db.exec(`insert into public.jobs (id, title, customer_id, status, date_needed, start_time, recurrence_days, recurrence_weeks)
    values ('${S}', 'Boom series', '${A}', 'open', current_date + 3, '09:00', '{1}', 2)`);
  await db.exec(`create function public.boom() returns trigger language plpgsql as $f$ begin
      if NEW.id = '${S}' and NEW.series_ended_on is not null then raise exception 'boom'; end if; return NEW; end $f$;
    create trigger trg_zz_boom before update on public.jobs for each row execute function public.boom();`);
  r = await server(db, `update public.profiles set ban_status = 'permanently_banned' where user_id = '${A}'`);
  const logs = (await db.query(`select severity, message from public.error_logs where message like '%${S}%'`)).rows;
  check("a series the ban cannot end does not undo the ban, and is logged fatal", r.ok && logs.length === 1 && logs[0].severity === "fatal", `${r.err ?? ""} ${JSON.stringify(logs)}`);
  await db.exec(`drop trigger trg_zz_boom on public.jobs; drop function public.boom();`);
}

r = await as(db, "authenticated", A, `select has_function_privilege('authenticated', 'public.end_series_for_banned_account(uuid)', 'execute') as x`);
check("clients cannot call end_series_for_banned_account", r.ok && r.rows[0].x === false, r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
