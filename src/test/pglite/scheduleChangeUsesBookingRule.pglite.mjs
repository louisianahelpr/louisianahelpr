#!/usr/bin/env node
/**
 * PGlite proof for 20261015015604_schedule_change_uses_booking_rule (docs/OPEN.md Q1676).
 *
 *   node src/test/pglite/scheduleChangeUsesBookingRule.pglite.mjs                    # AFTER: fix applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/scheduleChangeUsesBookingRule.pglite.mjs # RED: the chain on main
 *
 * The chain on main ends at 20261008183640 (its two function bodies' md5 =
 * live prod's, measured 2026-10-15). Helpr A holds:
 *   - a crew seat on an OPEN crew job X (still filling: jobs.helper_id NULL),
 *     day +5 at 10:00;
 *   - a crew seat on an accepted crew job Y that A already marked done on
 *     their own group_job_helpers row, day +6 at 10:00.
 * OLD: moving A's own hire onto X's time is TAKEN (the 'open' crew job is not
 * counted), and moving it onto Y's time is REFUSED (the finished seat still
 * counts). NEW: the reverse, the rule helpr_booking_clashes uses; the
 * poster's accept of a pending request onto X's time is declined too.
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
].map(readMigration);
const FIX = readMigration("20261015015604_schedule_change_uses_booking_rule.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running the chain on main (expect FAILs)`);
const { P, A } = USERS;
const { check, failures } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (const m of PRIOR) await db.exec(m);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(FIX);
await db.exec(`
  alter table public.group_job_helpers add column if not exists helper_completed_at timestamptz;
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job, helpers_needed)
  values ('${J(1)}', 'clean my house', '${P}', '${A}', 'accepted', current_date + 8, '14:00', now(), false, 1),
         ('${J(2)}', 'crew still filling', '${P}', NULL, 'open', current_date + 5, '10:00', NULL, true, 3),
         ('${J(3)}', 'crew already done',  '${P}', NULL, 'accepted', current_date + 6, '10:00', NULL, true, 2);
  insert into public.group_job_helpers (job_id, helper_id, status, helper_completed_at)
  values ('${J(2)}', '${A}', 'accepted', NULL),
         ('${J(3)}', '${A}', 'accepted', now());
`);
check(MODE === "skip" ? "the chain on main applies" : "the fix applies 3x on top of the chain (replay-safe)", true);

const ask = (date, time) => as(db, "authenticated", A, `select public.request_job_schedule_change('${J(1)}', current_date + ${date}, '${time}') as v`);

let r = await ask(5, "10:30");
check("R-filling: a change onto a crew seat the Helpr holds while the crew is still filling is refused", refused(r, /schedule_change_clash/), r.ok ? "taken" : r.err);
await server(db, `delete from public.job_schedule_change_requests where job_id='${J(1)}'`);

r = await ask(6, "10:30");
check("R-done: a change onto a crew seat the Helpr already finished is taken", r.ok, r.err);
await server(db, `delete from public.job_schedule_change_requests where job_id='${J(1)}'`);

r = await ask(7, "10:30");
check("R-free: a change onto a free time is taken (control)", r.ok, r.err);
await server(db, `delete from public.job_schedule_change_requests where job_id='${J(1)}'`);

// A pending request onto the still-filling crew seat's time (made before the
// seat existed), then the poster accepts: declined, the job does not move.
const pending = (await server(db, `insert into public.job_schedule_change_requests
  (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  values ('${J(1)}', '${A}', '${P}', current_date + 8, '14:00', current_date + 5, '10:30', now() + interval '2 days') returning id`)).rows?.[0]?.id;
r = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${pending}', true) as v`);
check("A-filling: the poster's accept onto the still-filling crew seat's time is declined as a clash",
  r.ok && r.rows[0].v.status === "declined" && r.rows[0].v.reason === "schedule_change_clash", r.err ?? JSON.stringify(r.rows?.[0]));
check("A-filling: the job did not move", (await db.query(`select date_needed - current_date as d from public.jobs where id='${J(1)}'`)).rows[0].d === 8);

await db.close();
if (failures()) { console.log(`\n${failures()} FAILED`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
