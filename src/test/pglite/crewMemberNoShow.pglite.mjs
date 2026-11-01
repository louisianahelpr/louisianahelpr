#!/usr/bin/env node
/**
 * PGlite proof for 20261101031804_crew_member_no_show (JOBS-3, owner
 * 2026-10-31: crew members are paid individually once the poster confirms
 * they worked; a no-show member gets nothing + a strike; the others are never
 * held up).
 *
 *   npx tsx src/test/pglite/crewMemberNoShow.pglite.mjs [--replay] [--before]
 *
 * Harness of crewCompletionRace.pglite.mjs: the EFFECTIVE definitions before
 * this migration, the REAL member lifecycle, completion and roster-departure
 * triggers and the REAL seed boundary on notifications; every member step
 * goes through its RPC. apply_consequence_ladder and is_test_subject are
 * stubs (the ladder writes the user_violations row it is asked for; nothing
 * here is about its rungs). --before leaves the migration out and the RED
 * checks must FAIL (count asserted); without it the migration is applied (3x
 * with --replay).
 *
 * A booked, funded crew of three that started 3 hours ago, all confirmed.
 * M1 and M2 come and work; N never comes.
 *   N1 M1 and M2 finish while N is still on the roster: the crew does not
 *      complete (N blocks it; the bug the owner's answer closes)
 *   N2 the poster reports N: N's spot closes (off the roster, application
 *      rejected 'no_show'), ONE no_show strike, N told           RED before
 *   N3 ...and the crew completes at once: M1 and M2 are not held up RED before
 *   N4 the share is refunded once: the roster M1+M2 shares add to 6000 of
 *      the 9000 budget, so the payout's unfilled-spot refund returns 3000,
 *      and a second report is refused (already_reported), still one strike
 *                                                                RED before
 *   N5 only the poster: N himself, a crew member (M1) and a stranger are
 *      refused not_authorized and nothing changes                RED before
 *   N6 a member who arrived, or one before the start, cannot be reported;
 *      an unconfirmed spot is not a no-show                      RED before
 *   N7 a test (is_seed) job: the notice to a real member is dropped by the
 *      seed boundary, the report still closes the spot            RED before
 *   N8 report BEFORE the others finish: the crew completes on the last
 *      member's own Done (rpc_group_member_mark_done unchanged)   RED before
 *   N9 a second reporter's no-show: the notice says "restricted", the rung
 *      the ladder recorded; every notice is a type prod's
 *      notifications_type_check allows (read from the newest migration) RED before
 *   N10 the same poster's earlier report never escalates (DISTINCT reporters) RED before
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261101031804_crew_member_no_show.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
const FNS = [
  "is_server_context", "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation",
  "crew_slot_share_cents", "crew_completes_when_hired_done", "job_offer_cutoff", "group_member_slot",
  "enforce_group_member_lifecycle_server_owned", "enforce_group_member_completion_gates",
  "enforce_group_member_completion_not_clearable", "enforce_helper_completion_gates", "sync_job_after_roster_departure",
  "rpc_group_member_confirm", "rpc_group_member_mark_arrival", "rpc_poster_confirm_member_arrival",
  "rpc_group_member_mark_done", "notification_job_id_from_link", "notification_crosses_seed_boundary", "notifications_seed_boundary",
];
const TRIGGERS = [
  "zza_group_member_lifecycle_server_owned", "zzb_group_member_completion_gates", "zzc_group_member_completion_not_clearable",
  "trg_helper_completion_gates", "trg_sync_job_after_roster_departure", "trg_notifications_seed_boundary",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

/** prod's notifications.type list: the newest migration's notifications_type_check, verbatim (a notice of an unlisted
 *  type aborts the whole report on prod; the harness must refuse it too). */
function notificationTypeCheck() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const sql = blankSqlComments(readFileSync(DIR + f, "utf8"));
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+notifications_type_check\s+(CHECK\s*\([\s\S]*?\)\s*\));/gi)) found = m[1];
  }
  if (!found) throw new Error(`no migration before ${THIS} sets notifications_type_check`);
  return `ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check ${found};`;
}
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), M1 = U(3), M2 = U(4), N = U(5), STRANGER = U(6), CREW = U(101);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric, payment_status text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  is_seed boolean DEFAULT false, date_needed date, start_time time, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, response_deadline timestamptz, latitude numeric, longitude numeric,
  require_photo_proof boolean DEFAULT false, proof_before_urls text[], proof_after_urls text[],
  poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_arrived_at timestamptz);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  response_deadline timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, offer_message text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.notification_logs (user_id uuid, category text, channel text, status text, subject text, job_id uuid, error_message text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid,
  description text, reported_by uuid);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.job_detail_change_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, decided_at timestamptz);
CREATE TABLE public.error_logs (severity text, message text, url text, tags jsonb, context jsonb);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.settle_job_detail_change(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, 'job_denial', p_job, p_desc) RETURNING jsonb_build_object('action', 'strike') $$;
-- STUB: the real ladder writes this row and returns rung p_rungs[prior count]; its rules are not under test here.
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, p_violation_type, p_job_id, p_description)
     RETURNING jsonb_build_object('action', p_rungs[LEAST(p_prior_count, array_length(p_rungs, 1) - 1) + 1], 'prior_count', p_prior_count) $$;

${notificationTypeCheck()}

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const attempt = async (sql) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return e.message;
  }
};

await db.exec(SCHEMA);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}
await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('${POSTER}'), ('${M1}'), ('${M2}'), ('${N}'), ('${STRANGER}');`);

/** A booked, funded crew of three; everyone confirmed through the RPC while the start was ahead, then the clock moves past it. */
async function seed({ seedJob = false, startsInHours = -3, confirmN = true } = {}) {
  await server();
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.notification_logs; DELETE FROM public.user_violations;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, payment_status, status, is_group_job, helpers_needed, is_seed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 90, 'paid', 'accepted', true, 3, ${seedJob},
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, response_deadline) VALUES
      ('${CREW}', '${M1}', 0, 3000, now() + interval '6 hours'), ('${CREW}', '${M2}', 1, 3000, now() + interval '6 hours'),
      ('${CREW}', '${N}', 2, 3000, now() + interval '6 hours');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES
      ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted'), ('${CREW}', '${N}', 'accepted');
  `);
  for (const m of confirmN ? [M1, M2, N] : [M1, M2]) {
    await as(m);
    await db.exec(`SELECT public.rpc_group_member_confirm('${CREW}')`);
  }
  await server();
  await db.exec(`UPDATE public.jobs SET status = 'in_progress',
                   date_needed = (now() AT TIME ZONE 'America/Chicago' + interval '${startsInHours} hours')::date,
                   start_time = (now() AT TIME ZONE 'America/Chicago' + interval '${startsInHours} hours')::time
                 WHERE id = '${CREW}'`);
}
async function arriveAndWork(member) {
  await as(member);
  const e1 = await attempt(`SELECT public.rpc_group_member_mark_arrival('${CREW}')`);
  await as(POSTER);
  const e2 = await attempt(`SELECT public.rpc_poster_confirm_member_arrival('${CREW}', '${member}')`);
  await server();
  await db.exec(`UPDATE public.group_job_helpers SET poster_confirmed_working_at = now() - interval '2 hours',
                   helper_arrived_at = now() - interval '2 hours' WHERE job_id = '${CREW}' AND helper_id = '${member}'`);
  return e1 || e2;
}
async function markDone(member) {
  await as(member);
  try {
    return (await one(`SELECT public.rpc_group_member_mark_done('${CREW}') AS r`)).r;
  } catch (e) {
    return { error: e.message };
  }
}
async function report(by, member) {
  await as(by);
  try {
    return (await one(`SELECT public.rpc_poster_report_member_no_show('${CREW}', '${member}') AS r`)).r;
  } catch (e) {
    return { error: e.message };
  }
}
const roster = async () => (await all(`SELECT helper_id, share_cents FROM public.group_job_helpers WHERE job_id = '${CREW}' ORDER BY slot_no`));
const job = async () => one(`SELECT status::text AS status, helper_completed_at IS NOT NULL AS done FROM public.jobs WHERE id = '${CREW}'`);
const strikes = async (u) => Number((await one(`SELECT count(*) AS n FROM public.user_violations WHERE user_id = '${u}' AND job_id = '${CREW}' AND violation_type = 'no_show'`)).n);
const told = async (u) => (await all(`SELECT 1 FROM public.notifications WHERE user_id = '${u}' AND title = 'No-show warning' AND type = 'warning'`)).length;

// N1-N4: the two who came finish, then the poster reports the one who did not.
await seed();
let err = (await arriveAndWork(M1)) || (await arriveAndWork(M2));
await markDone(M1);
await markDone(M2);
await server();
const j1 = await job();
check("N1 control: with the no-show still on the roster the crew does not complete (he blocks it)", !err && j1.done === false,
  `err=${err} job=${JSON.stringify(j1)}`);
const r = await report(POSTER, N);
await server();
const r2 = await roster();
const nApp = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${N}'`);
check("N2 the poster's report closes N's spot (off the roster, application 'no_show'), one strike, N told",
  !r.error && !r2.some((x) => x.helper_id === N) && nApp.status === "rejected" && nApp.closed_reason === "no_show"
    && (await strikes(N)) === 1 && (await told(N)) === 1,
  `r=${JSON.stringify(r)} roster=${r2.length} app=${JSON.stringify(nApp)} strikes=${await strikes(N)} told=${await told(N)}`);
const j2 = await job();
check("N3 ...and the crew completes at once: the two who worked are not held up", j2.done === true && r.job_complete === true,
  `job=${JSON.stringify(j2)} r=${JSON.stringify(r)}`);
// The payout pays each roster row its frozen share and refunds the budget minus their sum
// (process-scheduled-payouts refundUnfilledCrewShares: budgetCents - paidBudget).
const paid = r2.reduce((s, x) => s + x.share_cents, 0);
const again = await report(POSTER, N);
check("N4 the no-show's share is refunded once (9000 budget - 6000 paid = 3000) and a second report is refused, still one strike",
  !r.error && paid === 6000 && 9000 - paid === 3000 && /already_reported/.test(again.error ?? "") && (await strikes(N)) === 1,
  `paid=${paid} again=${JSON.stringify(again)} strikes=${await strikes(N)}`);

// N5: only the poster.
await seed();
const byN = await report(N, N);
const byMember = await report(M1, N);
const byStranger = await report(STRANGER, N);
await server();
check("N5 only the poster: N himself, a crew member and a stranger are refused, nothing changes",
  [byN, byMember, byStranger].every((x) => /not_authorized/.test(x.error ?? "")) && (await strikes(N)) === 0
    && (await roster()).some((x) => x.helper_id === N),
  `${JSON.stringify([byN, byMember, byStranger])} strikes=${await strikes(N)}`);

// N6: who cannot be reported.
await seed();
await arriveAndWork(N);
const arrived = await report(POSTER, N);
await seed({ startsInHours: 3 });
const early = await report(POSTER, N);
await seed({ confirmN: false });
const unconfirmed = await report(POSTER, N);
await server();
check("N6 an arrived member, a report before the start and an unconfirmed spot are all refused, no strike",
  /helper_already_arrived/.test(arrived.error ?? "") && /job_not_started/.test(early.error ?? "")
    && /helper_never_accepted/.test(unconfirmed.error ?? "") && (await strikes(N)) === 0,
  `${JSON.stringify([arrived, early, unconfirmed])}`);

// N7: test data. A seed job's notice to a real member is dropped by the seed boundary.
await seed({ seedJob: true });
const seedR = await report(POSTER, N);
await server();
const dropped = (await all(`SELECT 1 FROM public.notification_logs WHERE user_id = '${N}' AND status = 'suppressed_seed'`)).length;
check("N7 test (is_seed) job: no notice reaches the real member (seed boundary), the spot still closes",
  !seedR.error && (await told(N)) === 0 && dropped === 1 && !(await roster()).some((x) => x.helper_id === N),
  `r=${JSON.stringify(seedR)} told=${await told(N)} dropped=${dropped}`);

// N8: reported before the others finish; the crew completes on the last Done.
await seed();
err = await arriveAndWork(M1);
const early8 = await report(POSTER, N);
await markDone(M1);
err = err || (await arriveAndWork(M2));
const last = await markDone(M2);
await server();
check("N8 reported first: the crew completes on the last worker's own Done", !err && !early8.error && early8.job_complete === false
  && last.job_complete === true && (await job()).done === true, `err=${err} early=${JSON.stringify(early8)} last=${JSON.stringify(last)}`);

// N9: a second no-show from a DIFFERENT poster: the member is told the account is restricted (the ladder's rung).
await seed();
await server();
await db.exec(`INSERT INTO public.user_violations (user_id, violation_type, job_id, reported_by) VALUES ('${N}', 'no_show', '${U(999)}', '${STRANGER}')`);
const r9 = await report(POSTER, N);
await server();
const t9 = await all(`SELECT title, type FROM public.notifications WHERE user_id = '${N}'`);
check("N9 a second reporter's no-show: the notice names the restriction the ladder recorded",
  r9.action === "pending_ban_review" && t9.length === 1 && t9[0].title === "Account restricted for 7 days" && t9[0].type === "warning",
  `r=${JSON.stringify(r9)} notices=${JSON.stringify(t9)}`);

// N10: the SAME poster's earlier no-show of this member does not escalate (one poster alone never restricts).
await seed();
await server();
await db.exec(`INSERT INTO public.user_violations (user_id, violation_type, job_id, reported_by) VALUES ('${N}', 'no_show', '${U(998)}', '${POSTER}')`);
const r10 = await report(POSTER, N);
await server();
check("N10 the same poster's earlier report does not escalate: still a warning",
  r10.action === "warning" && (await told(N)) === 1, `r=${JSON.stringify(r10)}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // Only N1 (the control that shows the bug) holds without the function.
  const expected = 9;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
