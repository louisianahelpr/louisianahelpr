#!/usr/bin/env node
/**
 * PGlite proof for 20261007113957_booked_job_detail_change_request.sql (docs/OPEN.md Q1254;
 * owner decision 2026-10-07): an agreed change to a booked job's place and
 * details. The poster asks; every booked Helpr (a crew's every member) must
 * accept; text fields only; unanswered by the start it expires.
 *
 *   node src/test/pglite/jobDetailChange.pglite.mjs
 *
 * World: seriesWorld.mjs (the real jobs trigger chain from the newest
 * migrations before this one, the Helpr column whitelist included), plus the
 * real poster lock (enforce_poster_jobs_money_lock) and the real contact scan
 * (contact_leak_reason + reject_contact_leak_in_job). The migration then runs
 * verbatim, 3x (replay-safe).
 *
 * OLD STATE (migration left out): the poster cannot change a booked job's
 * address at all (the lock refuses the PATCH) and there is no request flow.
 * "OLD STATE RED".
 *
 *   D1 single Helpr: asked, told, nothing changes until they accept; the
 *      poster and a stranger cannot answer; the accept applies it through the
 *      Helpr's own column whitelist and tells the poster
 *   D2 declined: nothing changes, the poster is told
 *   D3 crew: one accept waits for the other; the second applies it
 *   D4 crew: one decline ends it even after the other accepted
 *   D5 crew: a member booked after the ask is asked too; nothing applies
 *      until they accept
 *   D6 unanswered by the start: expired, nothing changes
 *   D7 refusals: a contact detail, an unknown field, no change, a series, a
 *      stranger, anon; clients cannot write the tables; strangers read nothing
 *   D8 the direct PATCHes stay refused (poster's lock, Helpr's whitelist)
 */
import { PGlite, readMigration, baseSchema, newestFunctionSql, as, checker, refused, USERS } from "./seriesWorld.mjs";

const THIS = "20261007113957_booked_job_detail_change_request.sql";
const MIGRATION = readMigration(THIS);
const { P, A, B, C, X } = USERS;
const { check, failures, fail } = checker();
const J = (n) => `d0000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const server = (db, sql) => as(db, "service_role", null, sql);

const EXTRA = `
  alter table public.jobs add column materials_note text, add column zip_code text, add column scope_video_url text,
    add column category_x text, add column poster_completed_at timestamptz, add column helper_arrived_at timestamptz;
  ${newestFunctionSql("contact_leak_reason", THIS).sql}
  ${newestFunctionSql("reject_contact_leak_in_job", THIS).sql}
  ${newestFunctionSql("enforce_poster_jobs_money_lock", THIS).sql}
  create trigger trg_reject_contact_leak_in_job before insert or update on public.jobs
    for each row execute function public.reject_contact_leak_in_job();
  create trigger trg_poster_jobs_money_lock before update on public.jobs
    for each row execute function public.enforce_poster_jobs_money_lock();
`;

const SEED = `
  insert into public.jobs (id, title, description, location, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at, is_group_job)
  values ('${J(1)}', 'Paint the fence', 'Two coats', '12 Oak St', '${P}', '${A}', 'accepted', current_date + 5, '09:00', now(), false),
         ('${J(2)}', 'Mow', 'Front and back', '7 Elm St', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now(), false),
         ('${J(3)}', 'Move a piano', 'Upright', '3 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(4)}', 'Move a sofa', 'Big', '4 Pine St', '${P}', null, 'open', current_date + 7, '08:00', null, true),
         ('${J(5)}', 'Series parent', 'Weekly', '5 Pine St', '${P}', '${A}', 'accepted', current_date + 6, '10:00', now(), false),
         ('${J(6)}', 'Rake', 'Leaves', '6 Pine St', '${P}', '${A}', 'accepted', current_date + 4, '10:00', now(), false);
  update public.jobs set recurrence_days = '{1}', recurrence_weeks = 2 where id = '${J(5)}';
  insert into public.group_job_helpers (job_id, helper_id) values ('${J(3)}', '${A}'), ('${J(3)}', '${B}'),
                                                                  ('${J(4)}', '${A}'), ('${J(4)}', '${B}');
  update public.jobs set latitude = 30.45, longitude = -91.18;
  insert into public.jobs (id, title, description, location, customer_id, status, date_needed, start_time, latitude, longitude)
  values ('${J(7)}', 'Wash car', 'Outside', '8 Elm St', '${P}', 'open', current_date + 5, '09:00', 30.45, -91.18);
`;
const coords = async (db, id) => (await db.query(`select latitude::text lat, longitude::text lng from public.jobs where id='${id}'`)).rows[0];
const job = async (db, id) => (await db.query(`select title, description, location, materials_note from public.jobs where id='${id}'`)).rows[0];
const ask = (db, who, id, changes) => as(db, "authenticated", who, `select public.request_job_detail_change('${id}', '${JSON.stringify(changes).replace(/'/g, "''")}'::jsonb) as v`);
const answer = (db, who, req, yes) => as(db, "authenticated", who, `select public.respond_job_detail_change('${req}', ${yes}) as v`);
const notes = async (db, id, title) => (await db.query(`select user_id, message, link from public.notifications where job_id='${id}' and title=$1 order by id`, [title])).rows;

// ── OLD STATE ────────────────────────────────────────────────────────────────
{
  const db = new PGlite();
  await db.exec(baseSchema(THIS));
  await db.exec(EXTRA);
  await db.exec(SEED);
  const patch = await as(db, "authenticated", P, `update public.jobs set location = '14 Oak St' where id='${J(1)}'`);
  const rpc = await ask(db, P, J(1), { location: "14 Oak St" });
  const red = !patch.ok && !rpc.ok;
  console.log(`-- OLD STATE ${red ? "RED" : "NOT RED"}: poster PATCH of a booked job's address ${patch.ok ? "went through" : "refused"}; request flow=${rpc.ok ? "exists" : "absent"}`);
  if (!red) fail();
  await db.close();
}

// ── NEW STATE ────────────────────────────────────────────────────────────────
const db = new PGlite();
await db.exec(baseSchema(THIS));
await db.exec(EXTRA);
let applied = 0;
for (let i = 0; i < 3; i++) {
  try {
    await db.exec(MIGRATION);
    applied++;
  } catch (e) {
    check(`migration applies (run ${i + 1})`, false, e.message);
  }
}
check("the migration applies 3x (replay-safe)", applied === 3);
await db.exec(SEED);

// D1 single Helpr accepts.
let r = await ask(db, P, J(1), { title: "Paint the gate", location: "14 Oak St" });
check("D1 a new address without its map point is refused (no pinless booked job, G1)", refused(r, /detail_change_location_unmapped/), r.err);
r = await ask(db, P, J(1), { title: "Paint the gate", location: "14 Oak St", latitude: 30.46, longitude: -91.19, description: "Two coats" });
check("D1 the poster can ask; an unchanged field is dropped", r.ok && JSON.stringify(r.rows[0].v.fields) === '["title","location"]' && r.rows[0].v.asked === 1, r.err ?? JSON.stringify(r.rows?.[0]?.v));
const req1 = r.rows?.[0]?.v?.request_id;
let n = await notes(db, J(1), "Change to job details requested");
check("D1 the Helpr is told what would change, role-neutrally", n.length === 1 && n[0].user_id === A && /asked to change its title, address\. Nothing changes unless you accept/.test(n[0].message) && n[0].link === `/jobs?job=${J(1)}`, JSON.stringify(n));
check("D1 nothing changes before it is accepted", (await job(db, J(1))).location === "12 Oak St");
r = await answer(db, P, req1, true);
check("D1 the poster cannot answer their own request", refused(r, /not_authorized/), r.err);
r = await answer(db, X, req1, true);
check("D1 a stranger cannot answer it", refused(r, /not_authorized/), r.err);
r = await answer(db, A, req1, true);
let j = await job(db, J(1));
check("D1 the Helpr accepts: the job changes (through their own whitelist)", r.ok && r.rows[0].v.status === "accepted" && j.title === "Paint the gate" && j.location === "14 Oak St" && j.description === "Two coats", r.err ?? JSON.stringify(j));
let c1 = await coords(db, J(1));
check("D1 the agreed new address brings its own map point (Q1499: no stale pin, and no missing pin, for the arrival check)", c1.lat === "30.46" && c1.lng === "-91.19", JSON.stringify(c1));
n = await notes(db, J(1), "Change to job details accepted");
check("D1 the poster and the Helpr are told it applied", n.length === 2 && n.some((x) => x.user_id === P && x.link === `/posts?job=${J(1)}`), JSON.stringify(n));
r = await answer(db, A, req1, false);
check("D1 answering again changes nothing", r.ok && r.rows[0].v.status === "accepted" && (await job(db, J(1))).title === "Paint the gate", r.err);

// D2 declined.
r = await ask(db, P, J(2), { materials_note: "Mower and gas" });
const req2 = r.rows?.[0]?.v?.request_id;
check("D2 the poster can ask to add a materials note", r.ok, r.err);
r = await answer(db, A, req2, false);
check("D2 the Helpr declines", r.ok && r.rows[0].v.status === "declined", r.err);
check("D2 declined: nothing changes", (await job(db, J(2))).materials_note === null);
n = await notes(db, J(2), "Change to job details declined");
check("D2 the poster is told, cancellation rules unchanged", n.length === 1 && n[0].user_id === P && /usual cancellation rules apply/.test(n[0].message), JSON.stringify(n));

// D3 crew: every member must accept.
r = await ask(db, P, J(3), { location: "30 Pine St", latitude: 30.47, longitude: -91.2 });
const req3 = r.rows?.[0]?.v?.request_id;
check("D3 a crew's every member is asked", r.ok && r.rows[0].v.asked === 2 && (await notes(db, J(3), "Change to job details requested")).length === 2, r.err);
r = await answer(db, A, req3, true);
check("D3 one accept waits for the other member", r.ok && r.rows[0].v.status === "waiting" && (await job(db, J(3))).location === "3 Pine St", r.err ?? JSON.stringify(r.rows?.[0]?.v));
r = await as(db, "authenticated", A, `select helper_id, answer from public.job_detail_change_answers where request_id='${req3}' order by helper_id`);
check("D3 a crew member sees who else still has to answer", r.ok && r.rows.length === 2, r.err ?? JSON.stringify(r.rows));
r = await answer(db, B, req3, true);
check("D3 the last accept applies it", r.ok && r.rows[0].v.status === "accepted" && (await job(db, J(3))).location === "30 Pine St", r.err);

// D4 crew: one decline ends it.
r = await ask(db, P, J(4), { description: "Big, three seats" });
const req4 = r.rows?.[0]?.v?.request_id;
await answer(db, A, req4, true);
r = await answer(db, B, req4, false);
check("D4 one member declining ends it", r.ok && r.rows[0].v.status === "declined" && (await job(db, J(4))).description === "Big", r.err);
r = await answer(db, A, req4, true);
check("D4 a later accept cannot revive it", r.ok && r.rows[0].v.status === "declined" && (await job(db, J(4))).description === "Big", r.err);
n = await notes(db, J(4), "Change to job details declined");
check("D4 the poster and the other member are told", n.length === 2 && n.some((x) => x.user_id === P) && n.some((x) => x.user_id === A), JSON.stringify(n));

// D5 a member booked after the ask.
r = await ask(db, P, J(4), { description: "Big, four seats" });
const req5 = r.rows?.[0]?.v?.request_id;
await answer(db, A, req5, true);
r = await as(db, "postgres", null, `insert into public.group_job_helpers (job_id, helper_id) values ('${J(4)}', '${C}')`);
check("D5 (setup) a third member is hired after the ask", r.ok, r.err);
r = await answer(db, B, req5, true);
check("D5 a member booked after the ask holds it: not applied yet", r.ok && r.rows[0].v.status === "waiting" && (await job(db, J(4))).description === "Big", r.err ?? JSON.stringify(r.rows?.[0]?.v));
n = await notes(db, J(4), "Change to job details requested");
check("D5 the new member is asked", n.some((x) => x.user_id === C), JSON.stringify(n));
r = await answer(db, C, req5, true);
check("D5 their accept applies it", r.ok && r.rows[0].v.status === "accepted" && (await job(db, J(4))).description === "Big, four seats", r.err);

// D6 expiry at the start.
r = await ask(db, P, J(6), { title: "Rake and bag" });
const req6 = r.rows?.[0]?.v?.request_id;
const exp = (await db.query(`select (expires_at = ((current_date + 4 + time '10:00') at time zone 'America/Chicago')) ok from public.job_detail_change_requests where id='${req6}'`)).rows[0].ok;
check("D6 a request expires at the job's start", exp === true);
await server(db, `update public.job_detail_change_requests set expires_at = now() - interval '1 second' where id='${req6}'`);
r = await answer(db, A, req6, true);
const st6 = (await db.query(`select status from public.job_detail_change_requests where id='${req6}'`)).rows[0].status;
check("D6 unanswered by the start: expired, and the accept changes nothing", r.ok && r.rows[0].v.status === "expired" && st6 === "expired" && (await job(db, J(6))).title === "Rake", r.err ?? st6);

// D7 refusals.
r = await ask(db, P, J(2), { description: "Call me at 225-555-1234" });
check("D7 a contact detail in the change is refused up front", refused(r, /Phone number detected/), r.err);
r = await ask(db, P, J(2), { title: "Mow it", latitude: 30.1, longitude: -91.1 });
check("D7 a map point without a new address is refused", refused(r, /detail_change_invalid/), r.err);
r = await ask(db, P, J(2), { location: "70 Elm St", latitude: 300, longitude: -91.1 });
check("D7 an impossible map point is refused", refused(r, /detail_change_location_unmapped/), r.err);
r = await ask(db, P, J(2), { budget: 500 });
check("D7 a field outside the four is refused", refused(r, /detail_change_invalid/), r.err);
r = await ask(db, P, J(2), { photos: ["x.jpg"] });
check("D7 photos are not changed this way", refused(r, /detail_change_invalid/), r.err);
r = await ask(db, P, J(2), { title: "Mow" });
check("D7 a change that changes nothing is refused", refused(r, /detail_change_same/), r.err);
r = await ask(db, P, J(2), { title: "x".repeat(33) });
check("D7 a title over 32 characters is refused", refused(r, /detail_change_title_too_long/), r.err);
r = await ask(db, P, J(5), { title: "Weekly mow" });
check("D7 a series is not changed through this flow", refused(r, /detail_change_not_one_time/), r.err);
r = await ask(db, A, J(2), { title: "Mow it" });
check("D7 the Helpr cannot ask (the poster proposes)", refused(r, /not_authorized/), r.err);
r = await ask(db, X, J(2), { title: "Mow it" });
check("D7 a stranger cannot ask", refused(r, /not_authorized/), r.err);
r = await as(db, "anon", null, `select public.request_job_detail_change('${J(2)}', '{"title":"Mow it"}'::jsonb)`);
check("D7 anon cannot execute the request RPC", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", P, `insert into public.job_detail_change_requests (job_id, requested_by, changed_fields, expires_at) values ('${J(2)}', '${P}', '{title}', now())`);
check("D7 clients cannot write requests directly", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", A, `update public.job_detail_change_answers set answer = 'accepted'`);
check("D7 clients cannot write answers directly", refused(r, /permission denied/), r.err);
r = await as(db, "authenticated", X, `select (select count(*) from public.job_detail_change_requests)::int + (select count(*) from public.job_detail_change_answers)::int c`);
check("D7 a stranger reads no requests or answers", r.ok && r.rows[0].c === 0, r.err);

// D10 (H1) an agreed new address that geocodes to the SAME point keeps the pin.
r = await ask(db, P, J(6), { location: "6 Pine Street", latitude: 30.45, longitude: -91.18 });
const req10 = r.rows?.[0]?.v?.request_id;
r = await answer(db, A, req10, true);
c1 = await coords(db, J(6));
check("D10 a typo fix that keeps the same map point keeps the pin (never pinless)", r.ok && r.rows[0].v.status === "accepted" && c1.lat === "30.45" && c1.lng === "-91.18", r.err ?? JSON.stringify(c1));

// D9 (Q1499) the poster's own edit of an OPEN job's address clears its coordinates;
// a write that sends coordinates with the address keeps them; a title-only change keeps them.
r = await as(db, "authenticated", P, `update public.jobs set location = '9 Elm St' where id='${J(7)}'`);
c1 = await coords(db, J(7));
check("D9 an open job's address edit clears its coordinates (the geocoder refills them)", r.ok && c1.lat === null && c1.lng === null, r.err ?? JSON.stringify(c1));
r = await server(db, `update public.jobs set location = '10 Elm St', latitude = 30.5, longitude = -91.2 where id='${J(7)}'`);
c1 = await coords(db, J(7));
check("D9 a write that sends the new coordinates with the address keeps them", r.ok && c1.lat === "30.5" && c1.lng === "-91.2", r.err ?? JSON.stringify(c1));
r = await as(db, "authenticated", P, `update public.jobs set title = 'Wash the car' where id='${J(7)}'`);
c1 = await coords(db, J(7));
check("D9 a change that leaves the address alone keeps the coordinates", r.ok && c1.lat === "30.5", r.err ?? JSON.stringify(c1));

// D8 the direct writes stay refused.
r = await as(db, "authenticated", P, `update public.jobs set location = '99 Elm St' where id='${J(2)}'`);
check("D8 the poster's direct change of a booked job's address is still refused", refused(r, /may not change jobs\.location/), r.err);
r = await as(db, "authenticated", A, `update public.jobs set title = 'Mine now' where id='${J(2)}'`);
check("D8 the Helpr's direct change of the title is still refused", refused(r, /Helpers may not modify jobs\.title/), r.err);

await db.close();
console.log(failures() ? `\n${failures()} FAILED` : "\nALL PASS");
process.exit(failures() ? 1 : 0);
