#!/usr/bin/env node
/**
 * PGlite proof for 20261106054856_activity_cores_carry_active_continue_days (Builder 2, 2026-11-06; lead OK 11-06).
 *
 *   npx tsx src/test/pglite/activityCoresActiveContinueDays.pglite.mjs [--before]
 *
 * get_my_activity_cores is loaded from its EFFECTIVE definition before this migration (20261105111750, = live prosrc
 * md5 b6d044484f… on 2026-11-05). --before leaves the migration out: the RED checks must FAIL (count asserted).
 * One pass (owner rule: heavy proofs and replays run in CI). Every call runs AS authenticated, under prod-shaped RLS:
 * job_continue_days' live policy (a party of the job: poster or assigned Helpr) and a jobs policy.
 *
 *   A1 the payload gains exactly one key, active_continue_days, in the NULL call and in each part      RED before
 *   A2 its job ids are EXACTLY open_continue_days' job ids, per part and whole (the lead's check): a job
 *      the caller is the assigned Helpr of but never applied to (RLS lets them read its days) is in
 *      neither                                                                                          RED before
 *   A3 proposed + set only (declined / cancelled rows left out), closed set rows still in (the client's
 *      fetchContinueDays filter, word for word)                                                         RED before
 *   A4 each row has exactly the client's columns plus 'proposer'; no poster id                          RED before
 *   A5 proposer: 'poster' when proposed_by is the job's poster, else 'helpr' (a gone account too)       RED before
 *   A6 another member gets none of these rows                                                           RED before
 *   A7 every other key is the old function's answer, key for key
 *   A8 one overload, STABLE SECURITY INVOKER; execute authenticated + service_role only; anon refused
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261106054856_activity_cores_carry_active_continue_days.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), HELPER = U(3), OTHER = U(4), GONE = U(5);
// HELPER applied to APPLIED_JOB (and is its assigned Helpr); posted MY_POSTED; is the assigned Helpr of ASSIGNED_ONLY
// without an application row (RLS lets them read its days; the payload's scope must not).
const APPLIED_JOB = U(101), MY_POSTED = U(103), ASSIGNED_ONLY = U(104), OTHERS_JOB = U(105);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, budget numeric, status text DEFAULT 'open',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_violations (user_id uuid, job_id uuid, violation_type text);
CREATE TABLE public.reviews (reviewer_id uuid, job_id uuid);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, proposed_by uuid,
  new_date date, new_start_time time, note text, status text, created_at timestamptz DEFAULT now(), decided_at timestamptz,
  decided_by uuid, cleared_done_at timestamptz, helper_confirmed_at timestamptz, closed_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY parties ON public.jobs FOR SELECT TO authenticated USING (customer_id = auth.uid() OR helper_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = jobs.id AND a.helper_id = auth.uid()));
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
-- The poster arm through a definer helper (as prod avoids the jobs <-> applications policy loop).
CREATE FUNCTION public._lh_i_posted(p_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.customer_id = auth.uid()) $$;
GRANT EXECUTE ON FUNCTION public._lh_i_posted(uuid) TO authenticated;
CREATE POLICY mine ON public.applications FOR SELECT TO authenticated USING (helper_id = auth.uid() OR public._lh_i_posted(job_id));
ALTER TABLE public.job_continue_days ENABLE ROW LEVEL SECURITY;
-- Live policy (read 2026-11-06), minus the admin arm (no has_role here).
CREATE POLICY "Job parties read continue days" ON public.job_continue_days FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.jobs j WHERE j.id = job_continue_days.job_id AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id)));
CREATE FUNCTION public.get_job_offer_targets() RETURNS TABLE (job_id uuid, offered_to_helper_id uuid) LANGUAGE sql STABLE
  AS $$ SELECT j.id, j.offered_to_helper_id FROM public.jobs j WHERE j.customer_id = auth.uid() AND j.offered_to_helper_id IS NOT NULL $$;
CREATE FUNCTION public.get_jobs_for_my_applications() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.id IN (SELECT a.job_id FROM public.applications a WHERE a.helper_id = auth.uid()) $$;
CREATE FUNCTION public.get_my_pending_direct_offers() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.offered_to_helper_id = auth.uid() AND j.direct_offer_status = 'pending' $$;
GRANT EXECUTE ON FUNCTION public.get_job_offer_targets(), public.get_jobs_for_my_applications(), public.get_my_pending_direct_offers() TO authenticated;

${fnStmt("get_my_activity_cores")}
REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[], text[]) TO authenticated, service_role;

INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status) VALUES
  ('${APPLIED_JOB}', '${POSTER}', '${HELPER}', 'Mow the lawn', 40, 'in_progress'),
  ('${MY_POSTED}', '${HELPER}', '${OTHER}', 'My own job', 25, 'in_progress'),
  ('${ASSIGNED_ONLY}', '${POSTER}', '${HELPER}', 'Assigned, never applied', 30, 'in_progress'),
  ('${OTHERS_JOB}', '${OTHER}', '${POSTER}', 'Not mine', 30, 'in_progress');
INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${APPLIED_JOB}', '${HELPER}', 'accepted'), ('${MY_POSTED}', '${OTHER}', 'accepted');
INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at, closed_at) VALUES
  ('${APPLIED_JOB}', '${POSTER}', '2026-11-10', '09:00', 'poster asked', 'set', now(), NULL),
  ('${APPLIED_JOB}', '${HELPER}', '2026-11-11', '09:00', 'declined one', 'declined', NULL, NULL),
  ('${MY_POSTED}', '${OTHER}', '2026-11-12', '10:00', 'helpr asked', 'proposed', NULL, NULL),
  ('${MY_POSTED}', '${OTHER}', '2026-11-17', '10:00', 'helpr set', 'set', now(), NULL),
  ('${MY_POSTED}', '${GONE}', '2026-11-13', '10:00', 'old set, closed', 'set', NULL, now()),
  ('${MY_POSTED}', '${HELPER}', '2026-11-14', '10:00', 'cancelled', 'cancelled', NULL, NULL),
  ('${ASSIGNED_ONLY}', '${POSTER}', '2026-11-15', '11:00', 'assigned only', 'set', NULL, NULL),
  ('${OTHERS_JOB}', '${OTHER}', '2026-11-16', '11:00', 'not mine', 'set', NULL, NULL);
`;

const JOB_COLS = ["id", "title", "budget", "status", "customer_id", "helper_id", "created_at"];
const APP_COLS = ["id", "job_id", "helper_id", "status", "closed_reason", "created_at"];
const KEEP = ["id", "title", "status", "offered_to_helper_id", "direct_offer_status"];
const arr = (a) => `ARRAY[${a.map((c) => (c === null ? "NULL" : `'${c}'`)).join(",")}]::text[]`;

const db = new PGlite();
await db.exec(SCHEMA);
const call = async (uid, parts) => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);
  try {
    const sql = `SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}, ${arr(KEEP)}${parts === undefined ? "" : `, ${parts}`}) AS c`;
    return (await db.query(sql)).rows[0].c;
  } catch (e) {
    return { error: e.message, code: e.code };
  } finally {
    await db.exec("RESET ROLE;");
  }
};

const oldAll = await call(HELPER, undefined);
const oldPosted = await call(HELPER, arr(["posted"]));
const oldApplied = await call(HELPER, arr(["applied"]));
if (!BEFORE) {
  try {
    await db.exec(MIGRATION);
    console.log(`applied ${THIS}`);
  } catch (e) {
    check("migration applies", false, e.message);
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

const keys = (o) => (o && !o.error ? Object.keys(o).sort() : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (rows) => [...new Set((rows ?? []).map((d) => d.job_id))].sort();
const all = await call(HELPER, undefined);
const posted = await call(HELPER, arr(["posted"]));
const applied = await call(HELPER, arr(["applied"]));
const without = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== "active_continue_days"));

check("A1 exactly one new key, active_continue_days (NULL call and each part)",
  [[all, oldAll], [posted, oldPosted], [applied, oldApplied]].every(([n, o]) => same(keys(n), [...keys(o), "active_continue_days"].sort())),
  JSON.stringify({ all: all?.error ?? keys(all), posted: keys(posted), applied: keys(applied) }));
check("A2 active_continue_days' job ids are EXACTLY open_continue_days' (per part and whole); the assigned-only job is in neither",
  Array.isArray(all?.active_continue_days) && [all, posted, applied].every((o) => same(ids(o?.active_continue_days), ids(o?.open_continue_days)))
    && same(ids(all.active_continue_days), [APPLIED_JOB, MY_POSTED].sort()) && same(ids(posted?.active_continue_days), [MY_POSTED])
    && same(ids(applied?.active_continue_days), [APPLIED_JOB]) && !ids(all.active_continue_days).includes(ASSIGNED_ONLY),
  JSON.stringify({ active: ids(all?.active_continue_days), open: ids(all?.open_continue_days) }));
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${HELPER}', false); SET ROLE authenticated;`);
const readable = (await db.query(`SELECT count(*)::int n FROM public.job_continue_days WHERE job_id = '${ASSIGNED_ONLY}'`)).rows[0].n;
await db.exec("RESET ROLE;");
check("A2 fixture: RLS DOES let the caller read the assigned-only job's day (so A2 is not vacuous)", readable === 1, String(readable));
const notes = (all?.active_continue_days ?? []).map((d) => d.note).sort();
check("A3 proposed + set only (declined / cancelled out; a closed set row in, as the client's read)",
  same(notes, ["helpr asked", "helpr set", "old set, closed", "poster asked"]), JSON.stringify(notes));
const COLS = ["helper_confirmed_at", "id", "job_id", "new_date", "new_start_time", "note", "proposed_by", "proposer", "status"];
check("A4 each row: exactly the client's columns plus proposer, no poster id",
  (all?.active_continue_days ?? []).length === 4 && all.active_continue_days.every((d) => same(Object.keys(d).sort(), COLS)),
  JSON.stringify((all?.active_continue_days ?? []).map((d) => Object.keys(d).sort())));
const by = Object.fromEntries((all?.active_continue_days ?? []).map((d) => [d.note, d.proposer]));
check("A5 proposer: poster when proposed_by is the job's poster, else helpr (a gone account too)",
  by["poster asked"] === "poster" && by["helpr asked"] === "helpr" && by["helpr set"] === "helpr" && by["old set, closed"] === "helpr", JSON.stringify(by));
const other = await call(U(9), undefined);
check("A6 another member gets none of these rows", !other?.error && Array.isArray(other.active_continue_days) && other.active_continue_days.length === 0,
  JSON.stringify(other?.error ?? other?.active_continue_days));
check("A7 every other key is the old function's answer, key for key",
  !oldAll?.error && same(without(all), oldAll) && same(without(posted), oldPosted) && same(without(applied), oldApplied));

const procs = (await db.query(`SELECT oid::regprocedure::text sig, proacl::text acl, prosecdef, provolatile FROM pg_proc WHERE proname = 'get_my_activity_cores'`)).rows;
let anonRefused = false;
try {
  await db.exec(`SET ROLE anon;`);
  await db.query(`SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}, ${arr(KEEP)}, ${arr(["posted"])})`);
} catch (e) {
  anonRefused = /permission denied/.test(e.message);
} finally {
  await db.exec(`RESET ROLE;`);
}
check("A8 one overload, STABLE SECURITY INVOKER; execute authenticated + service_role only; anon refused",
  procs.length === 1 && procs[0].sig === "get_my_activity_cores(text[],text[],text[],text[])" && procs[0].prosecdef === false && procs[0].provolatile === "s"
    && /authenticated=X/.test(procs[0].acl) && /service_role=X/.test(procs[0].acl) && !/anon=/.test(procs[0].acl) && !/(^|[{,])=X/.test(procs[0].acl) && anonRefused,
  JSON.stringify({ procs, anonRefused }));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 6; // A1-A6 are RED on the old function; A7 and A8 hold on both.
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
