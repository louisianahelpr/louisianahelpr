#!/usr/bin/env node
/**
 * PGlite proof for 20261021074803_schedule_change_clears_confirms (owner,
 * 2026-10-21: after a booked job's date or time changes, BOTH sides confirm the
 * new slot).
 *
 *   node src/test/pglite/scheduleChangeClearsConfirms.pglite.mjs                    # AFTER: fix applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/scheduleChangeClearsConfirms.pglite.mjs # RED: the chain on main
 *
 * World: seriesWorld.mjs (the real jobs trigger chain), the schedule-change
 * chain up to 20261015015604, then the two column locks at their newest
 * definitions before this fix (enforce_poster_jobs_money_lock 20261007032429,
 * enforce_helper_jobs_column_whitelist 20261007113957; md5(prosrc) = live prod,
 * measured 2026-10-21), as on prod.
 *
 * OLD (RED): a change the poster accepts leaves the poster's old-slot
 * confirmation and the Helpr's day-of confirmation set (the 7c6deb77 shape).
 * NEW: an accept by EITHER side clears both (the zz_ trigger runs after both
 * column locks, which still judge the caller's own write); a decline keeps
 * them; neither side can clear the other's confirmation by hand; the one-time
 * fix clears only confirmations older than the latest accepted change on a
 * job still ahead.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const FIX_FILE = "20261021074803_schedule_change_clears_confirms.sql";
const PRIOR = [
  "20260927012804_recurring_series_end.sql",
  "20260927012805_hired_job_schedule_lock.sql",
  "20260927012806_recurring_split_days.sql",
  "20260927012807_job_schedule_change_requests.sql",
  "20261002060514_schedule_change_refuses_helpr_clash.sql",
  "20261004004707_schedule_change_accept_rechecks_clash.sql",
  "20261005064336_schedule_clash_declines_with_notice.sql",
  "20261008183640_schedule_change_lead_time_and_expiry_notice.sql",
  "20261015015604_schedule_change_uses_booking_rule.sql",
].map(readMigration);
const LOCKS = [
  newestFunctionSql("enforce_poster_jobs_money_lock", FIX_FILE.slice(0, 14)).sql,
  newestFunctionSql("enforce_helper_jobs_column_whitelist", FIX_FILE.slice(0, 14)).sql,
];
const FIX = readMigration(FIX_FILE);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the chain on main (expect FAILs)`);
const { P, A } = USERS;
const { check, failures } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "postgres", null, sql);
const stamps = async (db, id) =>
  (await db.query(`select poster_confirmed_at is not null as poster, helper_dayof_confirmed_at is not null as helpr,
                          date_needed - current_date as d from public.jobs where id='${id}'`)).rows[0];

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
await db.exec(`
  alter table public.jobs add column if not exists poster_confirmed_at timestamptz;
  alter table public.jobs add column if not exists helper_on_the_way_at timestamptz;
  alter table public.group_job_helpers add column if not exists helper_completed_at timestamptz;
`);
for (const m of PRIOR) await db.exec(m);
for (const l of LOCKS) await db.exec(l);
await db.exec(`create trigger trg_poster_jobs_money_lock before update on public.jobs
  for each row execute function public.enforce_poster_jobs_money_lock();`);

// Seed BEFORE the fix runs, so the one-time data fix sees them.
//  1: Helpr asked, poster will accept (the 7c6deb77 shape, live)
//  2: poster asked, Helpr will accept
//  3: a request that gets declined
//  4: stale poster stamp from BEFORE an accepted change (backfill clears it)
//  5: Helpr stamp AFTER the accepted change (backfill keeps it), poster stamp before (cleared)
//  6: a job whose start has passed (backfill leaves it alone)
//  7: a job already under way (backfill leaves it alone)
//  8: direct-PATCH probes
await db.exec(`
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at,
                           poster_confirmed_at, helper_dayof_confirmed_at)
  values ('${J(1)}', 'Mow two lawns', '${P}', '${A}', 'accepted', current_date + 3, '12:00', now(), now(), now()),
         ('${J(2)}', 'Paint',         '${P}', '${A}', 'accepted', current_date + 4, '10:00', now(), now(), now()),
         ('${J(3)}', 'Rake',          '${P}', '${A}', 'accepted', current_date + 5, '10:00', now(), now(), now()),
         ('${J(4)}', 'Old stamp',     '${P}', '${A}', 'accepted', current_date + 6, '09:00', now(), now() - interval '2 hours', NULL),
         ('${J(5)}', 'Mixed',         '${P}', '${A}', 'accepted', current_date + 7, '09:00', now(), now() - interval '2 hours', now()),
         ('${J(6)}', 'Past start',    '${P}', '${A}', 'accepted', current_date - 1, '09:00', now(), now() - interval '2 hours', NULL),
         ('${J(7)}', 'Under way',     '${P}', '${A}', 'accepted', current_date + 8, '09:00', now(), now() - interval '2 hours', NULL),
         ('${J(8)}', 'Probe',         '${P}', '${A}', 'accepted', current_date + 9, '09:00', now(), now(), now()),
         ('${J(9)}', 'Push an hour',  '${P}', '${A}', 'accepted', current_date + 10, '09:00', now(), now(), now());
  update public.jobs set helper_on_the_way_at = now() where id = '${J(7)}';
  insert into public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at, status, decided_at)
  select id, '${A}', '${P}', date_needed - 1, '12:00', date_needed, start_time, now() + interval '1 day', 'accepted', now() - interval '1 hour'
    from public.jobs where id in ('${J(4)}', '${J(5)}', '${J(6)}', '${J(7)}');
`);

if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
check(MODE === "skip" ? "the chain on main applies" : "the fix applies 3x on top of the chain (replay-safe)", true);

// One-time data fix.
let s = await stamps(db, J(4));
check("B1: a poster confirmation older than the accepted change is cleared", !s.poster, JSON.stringify(s));
s = await stamps(db, J(5));
check("B2: only the stale one is cleared (poster cleared, Helpr's newer stamp kept)", !s.poster && s.helpr, JSON.stringify(s));
s = await stamps(db, J(6));
check("B3: a job whose start has passed is left alone", s.poster, JSON.stringify(s));
s = await stamps(db, J(7));
check("B4: a job already under way is left alone", s.poster, JSON.stringify(s));
s = await stamps(db, J(1));
check("B5: a job with no accepted change keeps its confirmations", s.poster && s.helpr, JSON.stringify(s));

const ask = (uid, id, plusDays, time) =>
  as(db, "authenticated", uid, `select public.request_job_schedule_change('${id}', current_date + ${plusDays}, '${time}') as v`);
const answer = (uid, req, yes) => as(db, "authenticated", uid, `select public.respond_job_schedule_change('${req}', ${yes}) as v`);

// A1: the Helpr asks, the poster accepts.
let r = await ask(A, J(1), 4, "09:00");
check("setup: the Helpr asks to move job 1", r.ok, r.err);
r = await answer(P, r.rows?.[0]?.v?.request_id, true);
check("A1: the poster's accept goes through", r.ok && r.rows[0].v.status === "accepted", r.err ?? JSON.stringify(r.rows?.[0]));
s = await stamps(db, J(1));
check("A1: the job moved and BOTH confirmations are cleared (poster accepted)", s.d === 4 && !s.poster && !s.helpr, JSON.stringify(s));

// A2: the poster asks, the Helpr accepts.
r = await ask(P, J(2), 6, "11:00");
check("setup: the poster asks to move job 2", r.ok, r.err);
r = await answer(A, r.rows?.[0]?.v?.request_id, true);
check("A2: the Helpr's accept goes through", r.ok && r.rows[0].v.status === "accepted", r.err ?? JSON.stringify(r.rows?.[0]));
s = await stamps(db, J(2));
check("A2: the job moved and BOTH confirmations are cleared (Helpr accepted)", s.d === 6 && !s.poster && !s.helpr, JSON.stringify(s));

// A3: a decline keeps both.
r = await ask(A, J(3), 12, "09:00");
r = await answer(P, r.rows?.[0]?.v?.request_id, false);
check("A3: a decline goes through", r.ok && r.rows[0].v.status === "declined", r.err ?? JSON.stringify(r.rows?.[0]));
s = await stamps(db, J(3));
check("A3: a declined change keeps both confirmations", s.d === 5 && s.poster && s.helpr, JSON.stringify(s));

// A3b (review M1): a move to a start under 2h15m away keeps the Helpr's day-of
// confirm (the 5-min repost sweep would otherwise hand the job back at once);
// the poster's is still cleared. Written as the server so the RPC's 1-hour
// floor and the clock do not matter; the trigger fires the same for any mover.
await server(db, `update public.jobs set date_needed = (now() at time zone 'America/Chicago' + interval '90 minutes')::date,
  start_time = (now() at time zone 'America/Chicago' + interval '90 minutes')::time where id='${J(9)}'`);
s = await stamps(db, J(9));
check("A3b: a move to 90 minutes ahead keeps the Helpr's day-of confirm, clears the poster's", !s.poster && s.helpr, JSON.stringify(s));

// A4/A5: the carve-outs are the RPC's alone.
r = await as(db, "authenticated", P, `update public.jobs set helper_dayof_confirmed_at = null where id='${J(8)}'`);
check("A4: the poster cannot clear the Helpr's confirmation by hand", refused(r, /Posters may not modify jobs.helper_dayof_confirmed_at/), r.ok ? `rows=${r.affected}` : r.err);
r = await as(db, "authenticated", A, `update public.jobs set poster_confirmed_at = null where id='${J(8)}'`);
check("A5: the Helpr cannot clear the poster's confirmation by hand", refused(r, /Helpers may not modify jobs.poster_confirmed_at/), r.ok ? `rows=${r.affected}` : r.err);
s = await stamps(db, J(8));
check("A6: the probe job's confirmations are intact", s.poster && s.helpr, JSON.stringify(s));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
