#!/usr/bin/env node
/**
 * PGlite proof for 20261008183640_schedule_change_lead_time_and_expiry_notice
 * (owner, 2026-10-08: "the poster accepted the Helpr's change request but that
 * does not reflect anywhere"; request 1f6349c9 asked for 1:30 PM today, was
 * accepted at 1:30:19 PM and expired with nobody told).
 *
 *   PGLITE_DIR=~/.lh-pglite-probe node src/test/pglite/scheduleChangeLeadAndExpiry.pglite.mjs
 *
 * OLD STATE (chain before 20261008183640): a request 30 minutes out is taken,
 * and an accept after the new time passed returns 'expired' with no reason and
 * no notice to the person who asked. "OLD STATE RED".
 * NEW STATE: under an hour out is refused (schedule_change_too_soon); every
 * expiry at answer time returns its reason and tells the asker why; applied 3x.
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
].map(readMigration);
const FIX = readMigration("20261008183640_schedule_change_lead_time_and_expiry_notice.sql");
const { P, A } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `c0000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);
const SEED = `
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${J(1)}', 'clean my house', '${P}', '${A}', 'accepted', current_date + 5, '14:00', now()),
         ('${J(2)}', 'Mow', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now());
`;
// "Local" Chicago clock, the zone the RPCs read a start in.
const AT = (offset) => `((now() at time zone 'America/Chicago') + interval '${offset}')`;
const askAt = (job, offset) => `select public.request_job_schedule_change('${job}', (${AT(offset)})::date, date_trunc('minute', ${AT(offset)})::time) as v`;
// A request already sitting there whose NEW time passed a minute ago (the prod case).
const stalePending = (job) => `insert into public.job_schedule_change_requests
  (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  select '${job}', '${A}', '${P}', j.date_needed, j.start_time, (${AT("-1 minute")})::date, date_trunc('minute', ${AT("-1 minute")})::time, now() + interval '2 days'
    from public.jobs j where j.id = '${job}' returning id`;
const notices = async (db, job) =>
  (await db.query(`select user_id, message from public.notifications where job_id='${job}' and title='New date or time not applied'`)).rows;

{
  const db = new PGlite();
  await db.exec(baseSchema("20260927012804"));
  for (const m of PRIOR) await db.exec(m);
  await db.exec(SEED);
  const soon = await as(db, "authenticated", A, askAt(J(1), "30 minutes"));
  const id = (await server(db, stalePending(J(2)))).rows?.[0]?.id;
  const ans = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${id}', true) as v`);
  const told = (await notices(db, J(2))).length;
  const red = soon.ok && ans.ok && ans.rows[0].v.status === "expired" && !ans.rows[0].v.reason && told === 0;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: 30 min out ${soon.ok ? "taken" : "refused"}; late accept -> ${JSON.stringify(ans.rows?.[0]?.v)}; asker told ${told}x`);
  if (!red) fail();
  await db.close();
}

const db = new PGlite();
await db.exec(baseSchema("20260927012804"));
for (const m of PRIOR) await db.exec(m);
for (let i = 0; i < 3; i++) await db.exec(FIX);
await db.exec(SEED);
check("the fix applies 3x on top of the chain (replay-safe)", true);

let r = await as(db, "authenticated", A, askAt(J(1), "30 minutes"));
check("a new start 30 minutes out is refused: schedule_change_too_soon", refused(r, /schedule_change_too_soon/), r.err);
r = await as(db, "authenticated", A, askAt(J(1), "2 hours"));
check("a new start 2 hours out is taken", r.ok, r.err);

const stale = (await server(db, stalePending(J(2)))).rows?.[0]?.id;
r = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${stale}', true) as v`);
check("accepting after the new time passed returns expired WITH its reason", r.ok && r.rows[0].v.status === "expired" && r.rows[0].v.reason === "new_time_passed", r.err ?? JSON.stringify(r.rows?.[0]));
let n = await notices(db, J(2));
check("the Helpr who asked is told why, once", n.length === 1 && n[0].user_id === A && /had already started when it was answered/.test(n[0].message), JSON.stringify(n));
check("the job did not move", (await db.query(`select start_time::text t from public.jobs where id='${J(2)}'`)).rows[0].t === "10:00:00");

// Original start reached before an answer.
await server(db, `delete from public.job_schedule_change_requests where job_id='${J(2)}'`);
const late = (await server(db, stalePending(J(2)))).rows?.[0]?.id;
await server(db, `update public.job_schedule_change_requests set new_date = current_date + 9, expires_at = now() - interval '1 second' where id='${late}'`);
r = await as(db, "authenticated", P, `select public.respond_job_schedule_change('${late}', true) as v`);
check("an answer after the original start returns expired: job_started", r.ok && r.rows[0].v.reason === "job_started", r.err ?? JSON.stringify(r.rows?.[0]));
n = await notices(db, J(2));
check("and the asker is told that too", n.length === 2 && /original start arrived/.test(n[1].message), JSON.stringify(n));

r = await as(db, "authenticated", P, `select public.notify_schedule_change_expired('${late}', 'job_started')`);
check("the notice helper is not callable by users", refused(r, /permission denied/), r.err);
r = await as(db, "anon", null, `select public.respond_job_schedule_change('${late}', true)`);
check("anon still cannot answer", refused(r, /permission denied/), r.err);

await db.close();
if (failures()) process.exit(1);
console.log("ALL CHECKS PASSED");
