#!/usr/bin/env node
/**
 * PGlite proof for 20261012044739_change_request_daily_cap.sql (Q1501).
 *
 *   node src/test/pglite/changeRequestDailyCap.pglite.mjs
 *
 * Two worlds, each the one its own proof already uses:
 *   S  the date/time ask: seriesWorld + the schedule-change chain up to
 *      20261008183640 (as scheduleChangeLeadAndExpiry.pglite.mjs builds it)
 *   D  the detail ask: seriesWorld + the poster lock and contact scan +
 *      20261007113957 (as jobDetailChange.pglite.mjs builds it)
 *
 * OLD STATE (cap migration left out): six asks in a row on one job all go
 * through and each one notifies. "OLD STATE RED".
 * NEW STATE (cap migration 3x on top): five go through, the sixth is refused
 * with *_rate_limited and writes and sends nothing; another job is unaffected;
 * asks older than 24 hours do not count; the other party's own asks are
 * counted separately.
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const CAP = readMigration("20261012044739_change_request_daily_cap.sql");
const { P, A, B } = USERS;
const { check, failures, fail } = checker();
const server = (db, sql) => as(db, "service_role", null, sql);

// ── World S ──────────────────────────────────────────────────────────────────
const S_CHAIN = [
  "20260927012804_recurring_series_end.sql",
  "20260927012805_hired_job_schedule_lock.sql",
  "20260927012806_recurring_split_days.sql",
  "20260927012807_job_schedule_change_requests.sql",
  "20261002060514_schedule_change_refuses_helpr_clash.sql",
  "20261004004707_schedule_change_accept_rechecks_clash.sql",
  "20261005064336_schedule_clash_declines_with_notice.sql",
  "20261008183640_schedule_change_lead_time_and_expiry_notice.sql",
].map(readMigration);
const SJ = (n) => `c0000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const S_SEED = `
  insert into public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at)
  values ('${SJ(1)}', 'Paint', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now()),
         ('${SJ(2)}', 'Mow', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now());
`;
const sAsk = (db, who, job, n) =>
  as(db, "authenticated", who, `select public.request_job_schedule_change('${job}', current_date + 8, '${String(8 + n).padStart(2, "0")}:00') as v`);
const sNotes = async (db, job, user) =>
  (await db.query(`select count(*)::int n from public.notifications where job_id='${job}' and user_id='${user}' and title='New date or time requested'`)).rows[0].n;

async function worldS(withCap) {
  const db = new PGlite();
  await db.exec(baseSchema("20260927012804"));
  for (const m of S_CHAIN) await db.exec(m);
  if (withCap) for (let i = 0; i < 3; i++) await db.exec(CAP);
  await db.exec(S_SEED);
  return db;
}

// ── World D ──────────────────────────────────────────────────────────────────
const D_MIG = "20261007113957_booked_job_detail_change_request.sql";
const DJ = (n) => `d0000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
const D_EXTRA = `
  alter table public.jobs add column materials_note text, add column zip_code text, add column scope_video_url text,
    add column category_x text, add column poster_completed_at timestamptz, add column helper_arrived_at timestamptz;
  ${newestFunctionSql("contact_leak_reason", D_MIG).sql}
  ${newestFunctionSql("reject_contact_leak_in_job", D_MIG).sql}
  ${newestFunctionSql("enforce_poster_jobs_money_lock", D_MIG).sql}
  create trigger trg_reject_contact_leak_in_job before insert or update on public.jobs
    for each row execute function public.reject_contact_leak_in_job();
  create trigger trg_poster_jobs_money_lock before update on public.jobs
    for each row execute function public.enforce_poster_jobs_money_lock();
`;
const D_SEED = `
  insert into public.jobs (id, title, description, location, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job)
  values ('${DJ(1)}', 'Move a piano', 'Upright', '3 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${DJ(2)}', 'Rake', 'Leaves', '6 Pine St', '${P}', '${A}', 'accepted', current_date + 4, '10:00', now(), false);
  insert into public.group_job_helpers (job_id, helper_id) values ('${DJ(1)}', '${A}'), ('${DJ(1)}', '${B}');
`;
const dAsk = (db, job, n) =>
  as(db, "authenticated", P, `select public.request_job_detail_change('${job}', '{"description": "Upright, take ${n}"}'::jsonb) as v`);
const dNotes = async (db, job) =>
  (await db.query(`select count(*)::int n from public.notifications where job_id='${job}' and title='Change to job details requested'`)).rows[0].n;

async function worldD(withCap) {
  const db = new PGlite();
  await db.exec(baseSchema(D_MIG));
  await db.exec(D_EXTRA);
  await db.exec(readMigration(D_MIG));
  if (withCap) for (let i = 0; i < 3; i++) await db.exec(CAP);
  await db.exec(D_SEED);
  return db;
}

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const s = await worldS(false);
  let ok = 0;
  for (let i = 1; i <= 6; i++) if ((await sAsk(s, P, SJ(1), i)).ok) ok++;
  const sn = await sNotes(s, SJ(1), A);
  await s.close();
  const d = await worldD(false);
  let dok = 0;
  for (let i = 1; i <= 6; i++) if ((await dAsk(d, DJ(1), i)).ok) dok++;
  const dn = await dNotes(d, DJ(1));
  await d.close();
  const red = ok === 6 && sn === 6 && dok === 6 && dn === 12;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: 6 date/time asks -> ${ok} taken, ${sn} notices; 6 detail asks on a crew of 2 -> ${dok} taken, ${dn} notices`);
  if (!red) fail();
}

// ── NEW STATE: date/time ─────────────────────────────────────────────────────
{
  const s = await worldS(true);
  check("cap migration applies 3x on the schedule chain (replay-safe)", true);
  let ok = 0;
  for (let i = 1; i <= 5; i++) if ((await sAsk(s, P, SJ(1), i)).ok) ok++;
  check("five date/time asks in a day go through", ok === 5, `${ok}`);
  const before = (await s.query(`select count(*)::int n from public.job_schedule_change_requests where job_id='${SJ(1)}'`)).rows[0].n;
  const sixth = await sAsk(s, P, SJ(1), 6);
  const after = (await s.query(`select count(*)::int n from public.job_schedule_change_requests where job_id='${SJ(1)}'`)).rows[0].n;
  check("the sixth is refused with schedule_change_rate_limited", !sixth.ok && /schedule_change_rate_limited/.test(sixth.err), sixth.err);
  check("the refused ask writes and sends nothing", after === before && (await sNotes(s, SJ(1), A)) === 5, `${before}->${after}`);
  const pending = (await s.query(`select count(*)::int n from public.job_schedule_change_requests where job_id='${SJ(1)}' and status='pending'`)).rows[0].n;
  check("the fifth ask is still the pending one", pending === 1);
  check("another job is unaffected", (await sAsk(s, P, SJ(2), 1)).ok);
  const helpr = await sAsk(s, A, SJ(1), 7);
  check("the other party's own asks are counted on their own", helpr.ok, helpr.err);
  await server(s, `update public.job_schedule_change_requests set created_at = now() - interval '25 hours' where job_id='${SJ(1)}' and requested_by='${P}'`);
  const later = await sAsk(s, P, SJ(1), 8);
  check("asks older than 24 hours no longer count", later.ok, later.err);
  await s.close();
}

// ── NEW STATE: details ───────────────────────────────────────────────────────
{
  const d = await worldD(true);
  check("cap migration applies 3x on the detail-change world (replay-safe)", true);
  let ok = 0;
  for (let i = 1; i <= 5; i++) if ((await dAsk(d, DJ(1), i)).ok) ok++;
  check("five detail asks in a day go through", ok === 5, `${ok}`);
  const sixth = await dAsk(d, DJ(1), 6);
  check("the sixth is refused with detail_change_rate_limited", !sixth.ok && /detail_change_rate_limited/.test(sixth.err), sixth.err);
  check("the crew got 5 asks each, not 6", (await dNotes(d, DJ(1))) === 10, `${await dNotes(d, DJ(1))}`);
  check("another job is unaffected", (await dAsk(d, DJ(2), 1)).ok);
  await server(d, `update public.job_detail_change_requests set created_at = now() - interval '25 hours' where job_id='${DJ(1)}'`);
  const later = await dAsk(d, DJ(1), 7);
  check("asks older than 24 hours no longer count", later.ok, later.err);
  await d.close();
}

console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
