#!/usr/bin/env node
/**
 * PGlite proof for F272 (owner 11-11 ~2:50 PM): a no-show job's refund is FULL.
 *
 *   node src/test/pglite/noShowRefundKey.pglite.mjs                 # GREEN
 *   MUTANT=<name> node src/test/pglite/noShowRefundKey.pglite.mjs   # a planted defect: must FAIL
 *
 * void-cancelled-payments refunds a cancelled job in full when the job carries a recorded no-show and no confirmed
 * Helpr now (noShowFullRefund: the server-owned marker jobs.no_show_reported_at, jobs.helper_confirmed_at IS NULL,
 * not a crew; 20261111213317, F272 review note 1); create-payment cancel_quote reads the same key. The WHOLE marker
 * migration is applied 3x (column, backfill, write lock, report_helper_no_show). The sweep is an edge function (its arithmetic is proved
 * in src/test/edge/void-cancelled-payments.noShowFullRefund.test.ts); this proves the DATABASE half: that the REAL
 * report_helper_no_show (the newest migration body) and the REAL apply_consequence_ladder leave exactly that key
 * behind, and that nothing else does.
 *   K1 after a poster's no-show report the key reads TRUE (a 'no_show' row on the job, helper_confirmed_at cleared)
 *   K2 a job reopened any other way (an unanswered offer expiry, a Helpr's own cancel) reads FALSE
 *   K3 a no-show job that later hires and confirms a new Helpr reads FALSE (today's rule applies)
 *   K4 another job of the same Helpr's no-show does not leak: the key is per job
 *   K5 the struck Helpr's violation row deleted (account deletion / admin reversal): the key stays TRUE
 *   K6 a poster cannot set or clear the marker by a direct write (trg_no_show_marker_server_owned)
 *   K7 the backfill: a job reported before the migration gets the violation's first instant
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MUTANT = process.env.MUTANT ?? "";
// Each plants a defect in the report body (the DB half of the key) or in the key itself.
const MUTANTS = {
  // The reopen keeps the departed Helpr's confirmation.
  keepsConfirm: ["         helper_confirmed_at = NULL,\n", ""],
  // The report never stamps the marker.
  noStamp: ["         no_show_reported_at = COALESCE(no_show_reported_at, now()),\n", ""],
  // The write lock lets a client through.
  lockOpen: ["  IF public.is_server_context()\n     OR current_setting('app.no_show_report_rpc', true) = '1' THEN", "  IF true THEN"],
  // No backfill of jobs reported before the migration.
  noBackfill: ["   AND j.no_show_reported_at IS NULL\n   AND j.is_group_job IS NOT TRUE;", "   AND false;"],
};
const KEY_MUTANTS = ["keyIgnoresConfirm", "keyOnViolation"];
if (MUTANT && !MUTANTS[MUTANT] && !KEY_MUTANTS.includes(MUTANT)) throw new Error(`unknown MUTANT ${MUTANT}`);

const P = "00000000-0000-0000-0000-00000000000a", A = "00000000-0000-0000-0000-00000000000b", B = "00000000-0000-0000-0000-00000000000c";
const J = "00000000-0000-0000-0000-0000000000f1", J2 = "00000000-0000-0000-0000-0000000000f2", J0 = "00000000-0000-0000-0000-0000000000f0";

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
-- A signed-in request is never a server context (the real one also reads the JWT role).
create function public.is_server_context() returns boolean language sql as $$ select auth.uid() is null $$;
create table public.jobs (id uuid primary key, customer_id uuid, helper_id uuid, title text, payment_status text, date_needed date, start_time time,
  helper_arrived_at timestamptz, helper_completed_at timestamptz, helper_arrival_near_miss_at timestamptz, helper_confirmed_at timestamptz, status text,
  response_deadline timestamptz, helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
  dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz, parent_job_id uuid, is_group_job boolean default false);
create table public.applications (id serial primary key, job_id uuid, helper_id uuid, status text, closed_reason text);
create table public.user_violations (id serial primary key, user_id uuid, violation_type text, description text, job_id uuid, action_taken text,
  reported_by uuid, created_at timestamptz default now());
create table public.profiles (user_id uuid primary key, full_name text, email text, ban_status text, auto_suspended_until timestamptz);
insert into public.profiles (user_id, full_name) values ('${A}', 'Eli Robichaux'), ('${B}', 'Bea Thibodeaux');
create table public.user_bans (user_id uuid, ban_type text, reason text, banned_by uuid);
create table public.user_roles (user_id uuid, role text);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text not null, message text not null, type text, link text,
  job_id uuid, read boolean default false, created_at timestamptz not null default now());
create function public.series_release_dates(p_parent uuid, p_helper uuid, p_dates date[], p_reason text, p_title text, p_customer uuid)
 returns date[] language sql as $$ select array[]::date[] $$;
`);
await installClock(db);
await db.exec(newestFunction("apply_consequence_ladder").stmt);
// K7 setup: a job reported BEFORE the migration (its violation row exists, no marker column yet).
await db.exec(`
  insert into public.jobs (id, customer_id, helper_id, title, payment_status, status) values ('${J0}','${P}',null,'Old no-show','escrow','open');
  insert into public.user_violations (user_id, violation_type, job_id, created_at) values ('${A}','no_show','${J0}','2026-11-01T15:00:00Z');`);
const MIGRATION = "20261111213317_no_show_reported_at_marker.sql";
let body = readFileSync(new URL(`../../../supabase/migrations/${MIGRATION}`, import.meta.url), "utf8");
const newest = newestFunction("report_helper_no_show");
if (newest.file !== MIGRATION) throw new Error(`report_helper_no_show's newest definition is ${newest.file}, not ${MIGRATION}`);
if (MUTANTS[MUTANT]) {
  const [find, repl] = MUTANTS[MUTANT];
  if (!body.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
  body = body.split(find).join(repl);
}
for (let i = 0; i < 3; i++) await db.exec(onFixedClock(body));
console.log(`${MIGRATION} applied 3x (report_helper_no_show, marker lock, backfill), the real apply_consequence_ladder`);

// THE key, exactly as void-cancelled-payments and create-payment cancel_quote read it.
const keySql = MUTANT === "keyIgnoresConfirm"
  ? `select (j.no_show_reported_at is not null) as k from public.jobs j where j.id = $1`
  : MUTANT === "keyOnViolation" // the old key (F272 before review note 1)
  ? `select (j.is_group_job is not true and j.helper_confirmed_at is null
            and exists (select 1 from public.user_violations v where v.job_id = j.id and v.violation_type = 'no_show')) as k
       from public.jobs j where j.id = $1`
  : `select (j.is_group_job is not true and j.helper_confirmed_at is null and j.no_show_reported_at is not null) as k
       from public.jobs j where j.id = $1`;
const key = async (id) => (await db.query(keySql, [id])).rows[0].k;

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const seed = (id, helper) => db.exec(`
  insert into public.jobs (id, customer_id, helper_id, title, payment_status, date_needed, start_time, helper_confirmed_at, status)
    values ('${id}','${P}','${helper}','Mow and Weed Eat','escrow','2026-11-12','09:00', '2026-11-01T00:00:00Z','in_progress');
  insert into public.applications (job_id, helper_id, status) values ('${id}','${helper}','accepted');`);

const k0 = (await db.query(`select no_show_reported_at as t from public.jobs where id = '${J0}'`)).rows[0].t;
ok("K7 a job reported before the migration is backfilled with the violation's first instant", k0 != null && new Date(k0).toISOString() === "2026-11-01T15:00:00.000Z", String(k0));

await setClock(db, "2026-11-12T16:00:00Z"); // 10:00 AM Central, past 9:30
await seed(J, A);
await seed(J2, A);
ok("K2 a booked job before any report: key FALSE", (await key(J)) === false);

await db.exec(`select set_config('test.uid','${P}',false)`);
let err = "";
try { await db.query(`select public.report_helper_no_show('${J}')`); } catch (e) { err = e.message; }
ok("K1 the report succeeds", err === "", err);
ok("K1 after the report the key reads TRUE (full refund on cancel)", (await key(J)) === true);
ok("K4 the same Helpr's other job does not read the key", (await key(J2)) === false);

// K5: the struck Helpr deletes their account (delete_my_account removes their user_violations rows), or an admin
// reverses the strike. The marker is the job's own and stays.
await db.exec(`select set_config('test.uid','',false)`);
await db.exec(`delete from public.user_violations where job_id = '${J}'`);
ok("K5 the violation row deleted: the key still reads TRUE (full refund)", (await key(J)) === true);

// K6: the poster (a signed-in request, no RPC flag) writes the marker directly.
await db.exec(`select set_config('test.uid','${P}',false)`);
for (const [name, sql] of [
  ["sets it on another job", `update public.jobs set no_show_reported_at = now() where id = '${J2}'`],
  ["clears it", `update public.jobs set no_show_reported_at = null where id = '${J}'`],
  ["inserts a job with it", `insert into public.jobs (id, customer_id, status, no_show_reported_at) values (gen_random_uuid(), '${P}', 'open', now())`],
]) {
  let e = "";
  try { await db.query(sql); } catch (x) { e = x.message; }
  ok(`K6 a poster's direct write ${name}: refused`, /no_show_marker_locked/.test(e), e || "no error");
}
await db.exec(`select set_config('test.uid','',false)`);

// K2: a reopen with no report (the shape auto-expire-jobs' step 1 / an offer expiry leaves).
await db.exec(`update public.jobs set status = 'open', helper_id = null, helper_confirmed_at = null where id = '${J2}'`);
ok("K2 a job reopened with no no-show report: key FALSE (today's rule)", (await key(J2)) === false);

// K3: the poster picks a new date and a new Helpr confirms.
await db.exec(`update public.jobs set status = 'accepted', helper_id = '${B}', helper_confirmed_at = '2026-11-12T17:00:00Z' where id = '${J}'`);
ok("K3 a new Helpr confirmed on the no-show job: key FALSE (today's rule)", (await key(J)) === false);
const stamp = (await db.query(`select no_show_reported_at as t from public.jobs where id = '${J}'`)).rows[0].t;
ok("K3 the marker itself is never cleared by the new booking", stamp != null && new Date(stamp).toISOString() === "2026-11-12T16:00:00.000Z", String(stamp));

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
process.exit(failed ? 1 : 0);
