#!/usr/bin/env node
/**
 * PGlite proof for 20261004193450_hire_moment_is_the_accept (Q706).
 *
 *   node src/test/pglite/hireMomentIsTheAccept.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * PREVIOUS helper_cancel_booking verbatim from 20261002055930 and the previous
 * crew_fee_pays_unconfirmed from 20260925154606, and prints "OLD STATE RED"
 * when (R1) a Helpr who was only OFFERED a job (helper_confirmed_at NULL) is
 * struck for "cancelling after committing" inside 24h, (R2) a crew member who
 * never confirmed their spot is struck for leaving inside 24h, and (R3) the
 * crew rule counts an unconfirmed member. Then applies the new migration 3x
 * (replay-safe) and exits 1 unless: an unaccepted offer is refused
 * (offer_not_accepted) with no strike and the job untouched; an ACCEPTED
 * booking inside 24h is still struck and reopened; an unconfirmed crew member
 * leaves with no strike (spot_never_confirmed); a CONFIRMED crew member inside
 * 24h is still struck; a confirmed booking more than 24h out is not struck;
 * crew_fee_pays_unconfirmed() is false; the ACLs match prod.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261004193450_hire_moment_is_the_accept.sql");
const fnText = (file, name) =>
  new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n?\\$(\\w*)\\$[\\s\\S]*?\\$\\1\\$;`).exec(mig(file))[0];
const OLD_HCB = fnText("20261002055930_series_cancel_locks_parent_first.sql", "helper_cancel_booking");
const OLD_RULE = fnText("20260925154606_group_crew_has_no_lead.sql", "crew_fee_pays_unconfirmed");
const LATE = fnText("20260830010000_late_cancellation_includes_post_start.sql", "is_late_cancellation");

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.jobs(
    id uuid primary key, title text, customer_id uuid, helper_id uuid, status text,
    date_needed date, start_time time, helper_completed_at timestamptz, helper_confirmed_at timestamptz,
    is_group_job boolean default false, helpers_needed int default 1, parent_job_id uuid, recurrence_days int[],
    response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
    dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz);
  create table public.group_job_helpers(id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    helper_completed_at timestamptz, helper_confirmed_at timestamptz);
  create table public.applications(job_id uuid, helper_id uuid, status text);
  create table public.notifications(user_id uuid, title text, message text, type text, link text, job_id uuid);
  create table public.strikes(helper_id uuid, job_id uuid, description text);
  create function public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_desc text) returns jsonb
    language plpgsql as $$ begin insert into public.strikes values (p_helper, p_job, p_desc);
    return jsonb_build_object('action', 'warning'); end $$;
  create function public.series_release_dates(uuid, uuid, date[], text, text, uuid) returns date[]
    language sql as $$ select array[]::date[] $$;
`);
await db.exec(LATE);

const P = "00000000-0000-4000-8000-0000000000a1"; // poster
const H = "00000000-0000-4000-8000-0000000000b1"; // single Helpr
const M1 = "00000000-0000-4000-8000-0000000000c1"; // crew member, never confirmed
const M2 = "00000000-0000-4000-8000-0000000000c2"; // crew member, confirmed
const J = (n) => `00000000-0000-4000-8000-00000000001${n}`;
// Tomorrow's date at a start ~12h from now in Chicago keeps every job "inside 24h".
const soon = `(now() at time zone 'America/Chicago' + interval '12 hours')`;
const far = `(now() at time zone 'America/Chicago' + interval '5 days')`;
async function reset() {
  await db.exec(`
    delete from public.jobs; delete from public.group_job_helpers; delete from public.applications;
    delete from public.notifications; delete from public.strikes;
    insert into public.jobs(id, title, customer_id, helper_id, status, date_needed, start_time, helper_confirmed_at) values
      ('${J(1)}', 'offered only', '${P}', '${H}', 'accepted', (${soon})::date, (${soon})::time, null),
      ('${J(2)}', 'accepted',     '${P}', '${H}', 'accepted', (${soon})::date, (${soon})::time, now() - interval '1 day'),
      ('${J(4)}', 'accepted far', '${P}', '${H}', 'accepted', (${far})::date,  (${far})::time,  now() - interval '1 day');
    insert into public.jobs(id, title, customer_id, helper_id, status, date_needed, start_time, is_group_job, helpers_needed) values
      ('${J(3)}', 'crew', '${P}', null, 'accepted', (${soon})::date, (${soon})::time, true, 2);
    insert into public.group_job_helpers(job_id, helper_id, helper_confirmed_at) values
      ('${J(3)}', '${M1}', null), ('${J(3)}', '${M2}', now() - interval '1 day');
    insert into public.applications values ('${J(1)}', '${H}', 'accepted'), ('${J(2)}', '${H}', 'accepted');
  `);
}
async function cancelAs(uid, job) {
  await db.exec(`select set_config('test.uid', '${uid}', false)`);
  try {
    const r = await db.query(`select public.helper_cancel_booking('${job}') as r`);
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
const strikes = async (uid, job) =>
  Number((await db.query(`select count(*) n from public.strikes where helper_id = '${uid}' and job_id = '${job}'`)).rows[0].n);
const jobRow = async (job) => (await db.query(`select status, helper_id from public.jobs where id = '${job}'`)).rows[0];
const rule = async () => (await db.query(`select public.crew_fee_pays_unconfirmed() as v`)).rows[0].v;

// ── OLD ──
await db.exec(OLD_HCB);
await db.exec(OLD_RULE);
await reset();
await cancelAs(H, J(1));
const r1 = await strikes(H, J(1));
await cancelAs(M1, J(3));
const r2 = await strikes(M1, J(3));
const r3 = await rule();
if (r1 === 1 && r2 === 1 && r3 === true) {
  console.log("OLD STATE RED: offered-only Helpr struck =", r1, "; unconfirmed crew member struck =", r2, "; crew rule counts unconfirmed =", r3);
} else {
  console.error("unexpected old state", { r1, r2, r3 });
  process.exit(1);
}

// ── NEW ──
for (let i = 0; i < 3; i++) await db.exec(NEW);
await reset();
const fails = [];

const g1 = await cancelAs(H, J(1));
if (g1.ok || !/offer_not_accepted/.test(g1.message)) fails.push(`an unaccepted offer was not refused: ${JSON.stringify(g1)}`);
if ((await strikes(H, J(1))) !== 0) fails.push("an unaccepted offer was struck");
const j1 = await jobRow(J(1));
if (j1.status !== "accepted" || j1.helper_id !== H) fails.push(`the refused cancel changed the job: ${JSON.stringify(j1)}`);

const g2 = await cancelAs(H, J(2));
if (!g2.ok) fails.push(`an accepted booking could not be cancelled: ${g2.message}`);
if ((await strikes(H, J(2))) !== 1) fails.push("an accepted booking inside 24h was not struck");
if ((await jobRow(J(2))).status !== "open") fails.push("an accepted booking was not reopened");

const g4 = await cancelAs(H, J(4));
if (!g4.ok || (await strikes(H, J(4))) !== 0) fails.push(`an accepted booking 5 days out: ${JSON.stringify(g4)}`);

const g3 = await cancelAs(M1, J(3));
if (!g3.ok || g3.r.reason !== "spot_never_confirmed") fails.push(`unconfirmed crew member: ${JSON.stringify(g3)}`);
if ((await strikes(M1, J(3))) !== 0) fails.push("an unconfirmed crew member was struck");
const left = Number((await db.query(`select count(*) n from public.group_job_helpers where job_id = '${J(3)}' and helper_id = '${M1}'`)).rows[0].n);
if (left !== 0) fails.push("the unconfirmed crew member's slot was not released");

const g5 = await cancelAs(M2, J(3));
if (!g5.ok || (await strikes(M2, J(3))) !== 1) fails.push(`a confirmed crew member inside 24h was not struck: ${JSON.stringify(g5)}`);

if ((await rule()) !== false) fails.push("crew_fee_pays_unconfirmed() is not false");

const acl = Object.fromEntries((await db.query(
  `select proname, proacl::text a from pg_proc where proname in ('helper_cancel_booking', 'crew_fee_pays_unconfirmed')`,
)).rows.map((r) => [r.proname, r.a]));
for (const [fn, a] of Object.entries(acl)) {
  if (/anon=/.test(a) || /(^|[{,])=X/.test(a)) fails.push(`${fn} ACL grants anon or PUBLIC: ${a}`);
  if (!/authenticated=X/.test(a)) fails.push(`${fn} ACL lost authenticated: ${a}`);
}

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): offers refused unstruck, accepted bookings and confirmed crew still struck inside 24h, unconfirmed crew leave free, crew rule false; ACL", JSON.stringify(acl));
