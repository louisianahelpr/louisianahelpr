#!/usr/bin/env node
/**
 * PGlite proof for 20261012053253_detail_change_settles_after_crew_departure
 * (Q1500).
 *
 *   node src/test/pglite/detailChangeAfterDeparture.pglite.mjs
 *
 * World: as jobDetailChange.pglite.mjs builds it (seriesWorld's real jobs
 * trigger chain, the poster lock, the contact scan, 20261007113957) and the
 * roster's real AFTER DELETE trigger (sync_job_after_roster_departure), plus the
 * Q1501 cap (20261012044739, the newest request_job_detail_change), then this
 * migration 3x.
 *
 * OLD STATE (this migration left out): A accepts, B leaves the crew, and the
 * request stays pending with the job unchanged. "OLD STATE RED".
 * NEW STATE: that departure applies the change and tells the poster; a
 * departure before anyone accepted leaves it waiting; the last member leaving
 * expires it; the respond paths still work (single accept, crew accept,
 * decline, a member booked after the ask).
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, USERS } from "./seriesWorld.mjs";

const D_MIG = "20261007113957_booked_job_detail_change_request.sql";
const CAP = "20261012044739_change_request_daily_cap.sql";
const FIX = readMigration("20261012053253_detail_change_settles_after_crew_departure.sql");
const { P, A, B, C } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `d0000000-0000-0000-0000-0000000003${String(n).padStart(2, "0")}`;
const EXTRA = `
  alter table public.error_logs add column url text;
  alter table public.jobs add column materials_note text, add column zip_code text, add column scope_video_url text,
    add column category_x text, add column poster_completed_at timestamptz, add column helper_arrived_at timestamptz;
  ${newestFunctionSql("contact_leak_reason", D_MIG).sql}
  ${newestFunctionSql("reject_contact_leak_in_job", D_MIG).sql}
  ${newestFunctionSql("enforce_poster_jobs_money_lock", D_MIG).sql}
  create trigger trg_reject_contact_leak_in_job before insert or update on public.jobs
    for each row execute function public.reject_contact_leak_in_job();
  create trigger trg_poster_jobs_money_lock before update on public.jobs
    for each row execute function public.enforce_poster_jobs_money_lock();
  ${newestFunctionSql("sync_job_after_roster_departure", D_MIG).sql}
  create trigger trg_sync_job_after_roster_departure after delete on public.group_job_helpers
    for each row execute function public.sync_job_after_roster_departure();
`;
const SEED = `
  insert into public.jobs (id, title, description, location, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job)
  values ('${J(1)}', 'Move a piano', 'Upright', '3 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(2)}', 'Move a sofa', 'Big', '4 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(3)}', 'Move a desk', 'Oak', '5 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(4)}', 'Rake', 'Leaves', '6 Pine St', '${P}', '${A}', 'accepted', current_date + 4, '10:00', now(), false),
         ('${J(5)}', 'Move a bed', 'King', '7 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(6)}', 'Move a crib', 'Small', '8 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true);
  insert into public.group_job_helpers (job_id, helper_id) values
    ('${J(1)}', '${A}'), ('${J(1)}', '${B}'), ('${J(2)}', '${A}'), ('${J(2)}', '${B}'),
    ('${J(3)}', '${A}'), ('${J(3)}', '${B}'), ('${J(5)}', '${A}'), ('${J(5)}', '${B}'),
    ('${J(6)}', '${A}'), ('${J(6)}', '${B}');
  update public.jobs set latitude = 30.45, longitude = -91.18;
`;
const ask = (db, id, changes) => as(db, "authenticated", P, `select public.request_job_detail_change('${id}', '${JSON.stringify(changes)}'::jsonb) as v`);
const answer = (db, who, req, yes) => as(db, "authenticated", who, `select public.respond_job_detail_change('${req}', ${yes}) as v`);
// A departure runs inside the leaving Helpr's own definer RPC: their uid, no SET ROLE.
const leave = (db, who, id) => as(db, "postgres", who, `delete from public.group_job_helpers where job_id='${id}' and helper_id='${who}'`);
const desc = async (db, id) => (await db.query(`select description from public.jobs where id='${id}'`)).rows[0].description;
const status = async (db, req) => (await db.query(`select status from public.job_detail_change_requests where id='${req}'`)).rows[0].status;
const told = async (db, id) => (await db.query(`select user_id from public.notifications where job_id='${id}' and title='Change to job details accepted'`)).rows.map((x) => x.user_id);

async function world(withFix) {
  const db = new PGlite();
  await db.exec(baseSchema(D_MIG));
  await db.exec(EXTRA);
  await db.exec(readMigration(D_MIG));
  await db.exec(readMigration(CAP));
  if (withFix) for (let i = 0; i < 3; i++) await db.exec(FIX);
  await db.exec(SEED);
  return db;
}

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const db = await world(false);
  const req = (await ask(db, J(1), { description: "Upright, two flights" })).rows?.[0]?.v?.request_id;
  await answer(db, A, req, true);
  const l = await leave(db, B, J(1));
  const st = await status(db, req);
  const red = l.ok && st === "pending" && (await desc(db, J(1))) === "Upright";
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: A accepted, B left (${l.ok ? "ok" : l.err}); request ${st}, job unchanged`);
  if (!red) fail();
  await db.close();
}

// ── NEW STATE ────────────────────────────────────────────────────────────────
const db = await world(true);
check("migration applies 3x (replay-safe)", true);

let req = (await ask(db, J(1), { description: "Upright, two flights" })).rows?.[0]?.v?.request_id;
let r = await answer(db, A, req, true);
check("one accept still waits for the other member", r.ok && r.rows[0].v.status === "waiting", r.err ?? JSON.stringify(r.rows?.[0]?.v));
r = await leave(db, B, J(1));
check("the other member leaving applies what everyone left agreed to", r.ok && (await status(db, req)) === "accepted" && (await desc(db, J(1))) === "Upright, two flights", r.err ?? (await status(db, req)));
const t = await told(db, J(1));
check("the poster and the remaining member are told it applied", t.includes(P) && t.includes(A) && !t.includes(B), JSON.stringify(t));

req = (await ask(db, J(2), { description: "Big, three seats" })).rows?.[0]?.v?.request_id;
r = await leave(db, B, J(2));
check("a departure before anyone accepted leaves it waiting", r.ok && (await status(db, req)) === "pending" && (await desc(db, J(2))) === "Big", r.err);
r = await answer(db, A, req, true);
check("then the last member left accepting applies it", r.ok && r.rows[0].v.status === "accepted" && (await desc(db, J(2))) === "Big, three seats", r.err ?? JSON.stringify(r.rows?.[0]?.v));

req = (await ask(db, J(3), { description: "Oak, heavy" })).rows?.[0]?.v?.request_id;
await leave(db, A, J(3));
r = await leave(db, B, J(3));
check("the last member leaving expires it, nothing changes", r.ok && (await status(db, req)) === "expired" && (await desc(db, J(3))) === "Oak", r.err ?? (await status(db, req)));

req = (await ask(db, J(4), { description: "Leaves and bag them" })).rows?.[0]?.v?.request_id;
r = await answer(db, A, req, true);
check("a single Helpr's accept still applies it", r.ok && r.rows[0].v.status === "accepted" && (await desc(db, J(4))) === "Leaves and bag them", r.err ?? JSON.stringify(r.rows?.[0]?.v));

req = (await ask(db, J(5), { description: "King, frame too" })).rows?.[0]?.v?.request_id;
await answer(db, A, req, true);
await as(db, "postgres", null, `insert into public.group_job_helpers (job_id, helper_id) values ('${J(5)}', '${C}')`);
r = await answer(db, B, req, true);
check("a member booked after the ask still holds it", r.ok && r.rows[0].v.status === "waiting" && (await desc(db, J(5))) === "King", r.err ?? JSON.stringify(r.rows?.[0]?.v));
r = await leave(db, C, J(5));
check("...and their leaving without answering applies it", r.ok && (await status(db, req)) === "accepted" && (await desc(db, J(5))) === "King, frame too", r.err ?? (await status(db, req)));

// A settle that fails (here: a planted jobs trigger refusing the write) never blocks the departure.
req = (await ask(db, J(6), { description: "BOOM" })).rows?.[0]?.v?.request_id;
await answer(db, A, req, true);
await db.exec(`create function public.boom() returns trigger language plpgsql as $f$ begin if new.description = 'BOOM' then raise exception 'boom'; end if; return new; end $f$;
  create trigger zz_boom before update on public.jobs for each row execute function public.boom();`);
r = await leave(db, B, J(6));
const logged = (await db.query(`select count(*)::int n from public.error_logs where message = 'Detail change not settled after a crew member left'`)).rows[0].n;
check("a settle that fails never blocks the departure: left, request still pending, logged", r.ok && (await status(db, req)) === "pending" && logged === 1, r.err ?? `${await status(db, req)} logged=${logged}`);
await db.exec(`drop trigger zz_boom on public.jobs;`);

const req6 = (await ask(db, J(4), { description: "Rake only" })).rows?.[0]?.v?.request_id;
r = await answer(db, A, req6, false);
check("a decline still ends it", r.ok && r.rows[0].v.status === "declined" && (await desc(db, J(4))) === "Leaves and bag them", r.err);

r = await as(db, "authenticated", A, `select public.settle_job_detail_change('${req6}')`);
check("a client cannot call the settle step", !r.ok && /permission denied/.test(r.err), r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
