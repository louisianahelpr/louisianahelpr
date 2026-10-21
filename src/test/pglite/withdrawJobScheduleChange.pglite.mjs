#!/usr/bin/env node
/**
 * PGlite proof for 20261021110847_withdraw_job_schedule_change.sql (board 66/172 slice 3).
 *
 *   node src/test/pglite/withdrawJobScheduleChange.pglite.mjs                    # AFTER: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/withdrawJobScheduleChange.pglite.mjs # RED: without it
 *
 * Whoever asked takes a pending request back (either side); the other person is told; a stranger, the person
 * asked, and an already-answered request cannot be withdrawn; the job never moves.
 */
import { PGlite, readMigration, baseSchema, as, checker, refused, USERS } from "./seriesWorld.mjs";

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
const FIX = readMigration("20261021110847_withdraw_job_schedule_change.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: no withdraw (expect FAILs)`);
const { P, A, X } = USERS;
const { check, failures } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000004${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (const m of PRIOR) await db.exec(m);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
await db.exec(`
  alter table public.group_job_helpers add column if not exists helper_completed_at timestamptz;
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${J(1)}', 'Mow two lawns', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now()),
         ('${J(2)}', 'Paint', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now());
`);
const ask = async (uid, job, days) =>
  (await as(db, "authenticated", uid, `select public.request_job_schedule_change('${job}', current_date + ${days}, '14:00') as v`)).rows?.[0]?.v?.request_id;
const withdraw = (uid, req) => as(db, "authenticated", uid, `select public.withdraw_job_schedule_change('${req}') as v`);
const statusOf = async (req) => (await db.query(`select status from public.job_schedule_change_requests where id='${req}'`)).rows[0]?.status;

// The Helpr asks, then takes it back.
let req = await ask(A, J(1), 8);
let r = await withdraw(X, req);
check("a stranger cannot withdraw it", refused(r, /not_authorized/), r.err);
r = await withdraw(P, req);
check("the person asked cannot withdraw it (they answer it)", refused(r, /not_authorized/), r.err);
r = await withdraw(A, req);
check("the Helpr who asked withdraws it", r.ok && r.rows[0].v.status === "withdrawn", r.err ?? JSON.stringify(r.rows?.[0]));
check("it reads withdrawn", (await statusOf(req)) === "withdrawn");
const told = (await db.query(`select user_id, title, message from public.notifications where job_id='${J(1)}' and title='Date or time request withdrawn'`)).rows;
check("the poster is told, role-neutrally, and the job keeps its date", told.length === 1 && told[0].user_id === P && /The Helpr doing it took back their request/.test(told[0].message), JSON.stringify(told));
check("the job did not move", (await db.query(`select date_needed - current_date as d from public.jobs where id='${J(1)}'`)).rows[0].d === 5);
r = await withdraw(A, req);
check("withdrawing twice changes nothing", r.ok && r.rows[0].v.status === "withdrawn", r.err);

// The poster asks; it is answered first; withdrawing then is a no-op.
req = await ask(P, J(2), 9);
await as(db, "authenticated", A, `select public.respond_job_schedule_change('${req}', false)`);
r = await withdraw(P, req);
check("an answered request cannot be withdrawn (status reported, nothing changes)", r.ok && r.rows[0].v.status === "declined", r.err ?? JSON.stringify(r.rows?.[0]));
// Review M1: a request on a job that was cancelled while it was pending closes as expired and tells nobody.
await db.exec(`insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${J(3)}', 'Rake', '${P}', '${A}', 'accepted', current_date + 7, '09:00', now())`);
req = await ask(P, J(3), 10);
await db.exec(`update public.jobs set status = 'cancelled', helper_id = null where id = '${J(3)}'`);
const before = (await db.query(`select count(*)::int as n from public.notifications where job_id='${J(3)}'`)).rows[0].n;
r = await withdraw(P, req);
check("a request on a cancelled job closes as expired", r.ok && r.rows[0].v.status === "expired", r.err ?? JSON.stringify(r.rows?.[0]));
check("and nobody is told", (await db.query(`select count(*)::int as n from public.notifications where job_id='${J(3)}'`)).rows[0].n === before);
check("it reads expired", (await statusOf(req)) === "expired");
check("anon cannot call it", refused(await as(db, "anon", null, `select public.withdraw_job_schedule_change('${req}')`), /permission denied|not_authenticated/));

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
