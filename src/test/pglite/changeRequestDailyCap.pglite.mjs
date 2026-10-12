#!/usr/bin/env node
/**
 * PGlite proof for 20261012045427_change_request_daily_cap.sql (Q1501): one
 * requester can file at most 5 change requests of a kind on one job in 24
 * hours. Each detail-change ask notifies every booked Helpr, so before this a
 * poster could spam a crew one notification per call.
 *
 *   node src/test/pglite/changeRequestDailyCap.pglite.mjs
 *
 * World: seriesWorld.mjs plus the real detail-change migration
 * (20261007113957), as in jobDetailChange.pglite.mjs; the schedule-change
 * table is created bare (only its INSERT trigger is under test). The cap
 * migration then runs verbatim, 3x (replay-safe).
 *
 * OLD STATE (cap left out): a sixth ask in a day goes through. "OLD STATE RED".
 *   C1 five asks pass, the sixth is refused, and its refusal rolls back (the
 *      fifth stays the pending one, no sixth notification)
 *   C2 the cap is per job: the same poster on another job is not limited
 *   C3 server context (service role) is exempt
 *   C4 the schedule-change table carries the same cap
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const THIS = "20261012045427_change_request_daily_cap.sql";
const DETAIL = "20261007113957_booked_job_detail_change_request.sql";
const { P, A } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `e0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const EXTRA = `
  alter table public.jobs add column materials_note text, add column zip_code text, add column scope_video_url text,
    add column category_x text, add column poster_completed_at timestamptz, add column helper_arrived_at timestamptz;
  ${newestFunctionSql("contact_leak_reason", DETAIL).sql}
  ${newestFunctionSql("reject_contact_leak_in_job", DETAIL).sql}
  ${newestFunctionSql("enforce_poster_jobs_money_lock", DETAIL).sql}
  create trigger trg_reject_contact_leak_in_job before insert or update on public.jobs
    for each row execute function public.reject_contact_leak_in_job();
  create trigger trg_poster_jobs_money_lock before update on public.jobs
    for each row execute function public.enforce_poster_jobs_money_lock();
  create table public.job_schedule_change_requests (
    id uuid primary key default gen_random_uuid(), job_id uuid not null, requested_by uuid not null,
    responder_id uuid, new_date date, status text not null default 'pending',
    created_at timestamptz not null default now());
  grant insert, select on public.job_schedule_change_requests to authenticated, service_role;
`;
const SEED = `
  insert into public.jobs (id, title, description, location, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job)
  values ('${J(1)}', 'Paint the fence', 'Two coats', '12 Oak St', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), false),
         ('${J(2)}', 'Mow', 'Front and back', '7 Elm St', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now(), false);
`;
const ask = (db, id, title) => as(db, "authenticated", P, `select public.request_job_detail_change('${id}', '{"title": "${title}"}'::jsonb) as v`);
const asked = async (db, id) => (await db.query(`select count(*)::int n from public.notifications where job_id='${id}' and title='Change to job details requested'`)).rows[0].n;
const pendingTitle = async (db, id) => (await db.query(`select new_title from public.job_detail_change_requests where job_id='${id}' and status='pending'`)).rows.map((x) => x.new_title).join(",");
const schedule = (db, role, uid) => as(db, role, uid, `insert into public.job_schedule_change_requests (job_id, requested_by, new_date) values ('${J(1)}', '${P}', current_date + 9)`);

async function world(withCap) {
  const db = new PGlite();
  await db.exec(baseSchema(THIS));
  await db.exec(EXTRA);
  await db.exec(readMigration(DETAIL));
  if (withCap) {
    let applied = 0;
    for (let i = 0; i < 3; i++) {
      try {
        await db.exec(readMigration(THIS));
        applied++;
      } catch (e) {
        check(`migration applies (run ${i + 1})`, false, e.message);
      }
    }
    check("the migration applies 3x (replay-safe)", applied === 3);
  }
  await db.exec(SEED);
  return db;
}

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const db = await world(false);
  let ok = 0;
  for (let i = 1; i <= 6; i++) if ((await ask(db, J(1), `Paint ${i}`)).ok) ok++;
  const red = ok === 6;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: ${ok} of 6 asks in a row went through, ${await asked(db, J(1))} notifications`);
  if (!red) fail();
  await db.close();
}

// ── NEW STATE ────────────────────────────────────────────────────────────────
const db = await world(true);
let passed = 0;
for (let i = 1; i <= 5; i++) {
  const r = await ask(db, J(1), `Paint ${i}`);
  if (r.ok) passed++;
  else check(`C1 ask ${i} passes`, false, r.err);
}
check("C1 five asks in a day pass", passed === 5);
let r = await ask(db, J(1), "Paint 6");
check("C1 the sixth is refused with change_request_rate_limited", refused(r, /change_request_rate_limited/), r.err);
check("C1 the refusal rolls back: the fifth stays pending, no sixth notification", (await pendingTitle(db, J(1))) === "Paint 5" && (await asked(db, J(1))) === 5, `${await pendingTitle(db, J(1))} / ${await asked(db, J(1))}`);
r = await ask(db, J(2), "Mow it all");
check("C2 the cap is per job: the same poster can ask on another job", r.ok, r.err);
r = await as(db, "service_role", null, `insert into public.job_detail_change_requests (job_id, requested_by, changed_fields, status, expires_at) values ('${J(1)}', '${P}', '{title}', 'expired', now() + interval '1 day')`);
check("C3 server context is exempt", r.ok, r.err);
let s = 0;
for (let i = 0; i < 5; i++) if ((await schedule(db, "authenticated", P)).ok) s++;
r = await schedule(db, "authenticated", P);
check("C4 the schedule-change table: five pass, the sixth is refused", s === 5 && refused(r, /change_request_rate_limited/), `${s} passed; ${r.err}`);

await db.close();
console.log(failures() ? `${failures()} FAILED` : "ALL PASS");
process.exit(failures() ? 1 : 0);
