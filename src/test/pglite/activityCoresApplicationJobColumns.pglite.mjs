#!/usr/bin/env node
/**
 * PGlite proof for 20261105104129_activity_cores_application_job_columns (docs/OPEN.md Q2742 part 2, Builder 3,
 * 2026-11-05).
 *
 *   npx tsx src/test/pglite/activityCoresApplicationJobColumns.pglite.mjs [--replay] [--before]
 *
 * get_my_activity_cores is loaded from its EFFECTIVE definition before this migration. --before leaves the migration
 * out and the RED checks must FAIL (count asserted); without it the migration is applied (3x with --replay) and every
 * check must PASS.
 * Stubs (not under test): get_jobs_for_my_applications / get_my_pending_direct_offers (SETOF jobs, whole rows, as the
 * definers hand them), get_job_offer_targets (empty).
 *
 *   A1 with p_application_job_columns, application_jobs carry ONLY the asked keys                RED before
 *   A2 direct_offers likewise                                                                     RED before
 *   A3 the kept keys hold the same values as the whole row
 *   A4 a key the row does not have is absent, not an error                                        RED before
 *   A5 the two-list call (an older client) still gets whole rows on both keys
 *   A6 the other seven keys are identical between the two calls                                  RED before
 *   A7 a bad name or an empty list in the third argument is refused (bad_columns, 22023)          RED before
 *   A8 one overload; execute is authenticated + service_role only (anon refused when it calls)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105104129_activity_cores_application_job_columns.sql";
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

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), HELPER = U(3), OTHER = U(4);
const APPLIED_JOB = U(101), OFFER_JOB = U(102), MY_POSTED = U(103);

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
  id uuid PRIMARY KEY, title text, budget numeric, status text DEFAULT 'open', description text DEFAULT 'a long description',
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  stripe_session_id text, flag_reasons text[] DEFAULT '{}', start_reminder_sent_at timestamptz DEFAULT now(),
  series_split_ok boolean DEFAULT true, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_violations (user_id uuid, job_id uuid, violation_type text);
CREATE TABLE public.reviews (reviewer_id uuid, job_id uuid);
CREATE TABLE public.job_continue_days (job_id uuid, status text, closed_at timestamptz, new_date date, new_start_time time);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.get_job_offer_targets() RETURNS TABLE (job_id uuid, offered_to_helper_id uuid) LANGUAGE sql STABLE
  AS $$ SELECT NULL::uuid, NULL::uuid WHERE false $$;
CREATE FUNCTION public.get_jobs_for_my_applications() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.id IN (SELECT a.job_id FROM public.applications a WHERE a.helper_id = auth.uid()) $$;
CREATE FUNCTION public.get_my_pending_direct_offers() RETURNS SETOF public.jobs LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT j.* FROM public.jobs j WHERE j.offered_to_helper_id = auth.uid() AND j.direct_offer_status = 'pending' $$;

${fnStmt("get_my_activity_cores")}
REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[]) TO authenticated, service_role;

INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status, offered_to_helper_id, direct_offer_status, stripe_session_id) VALUES
  ('${APPLIED_JOB}', '${POSTER}', NULL, 'Mow the lawn', 40, 'open', NULL, NULL, 'cs_secret'),
  ('${OFFER_JOB}',   '${POSTER}', NULL, 'Paint a fence', 70, 'open', '${HELPER}', 'pending', 'cs_secret2'),
  ('${MY_POSTED}',   '${HELPER}', NULL, 'My own job', 25, 'open', NULL, NULL, NULL);
INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${APPLIED_JOB}', '${HELPER}', 'pending'), ('${MY_POSTED}', '${OTHER}', 'pending');
INSERT INTO public.user_violations VALUES ('${HELPER}', '${APPLIED_JOB}', 'job_denial');
INSERT INTO public.reviews VALUES ('${HELPER}', '${APPLIED_JOB}');
INSERT INTO public.job_continue_days VALUES ('${APPLIED_JOB}', 'set', NULL, '2026-11-10', '09:00');
`;

const JOB_COLS = ["id", "title", "budget", "status", "customer_id", "helper_id", "created_at"];
const APP_COLS = ["id", "job_id", "helper_id", "status", "closed_reason", "created_at"];
const KEEP = ["id", "title", "status", "offered_to_helper_id", "direct_offer_status", "series_split_ok", "date_window_end"];
const arr = (a) => `ARRAY[${a.map((c) => `'${c}'`).join(",")}]::text[]`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${HELPER}', false);`);
const call = async (third) => {
  try {
    const sql = `SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}${third === undefined ? "" : `, ${third}`}) AS c`;
    return (await db.query(sql)).rows[0].c;
  } catch (e) {
    return { error: e.message, code: e.code };
  }
};

const whole = await call(undefined); // before applying: the old function, the baseline
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

const kept = await call(arr(KEEP));
const keys = (o) => Object.keys(o ?? {}).sort();
const want = KEEP.filter((k) => k !== "date_window_end").sort();
const aj = kept?.application_jobs?.[0];
const dof = kept?.direct_offers?.[0];
check("A1 application_jobs carry only the asked keys", !!aj && JSON.stringify(keys(aj)) === JSON.stringify(want), JSON.stringify(keys(aj) || kept));
check("A2 direct_offers carry only the asked keys", !!dof && JSON.stringify(keys(dof)) === JSON.stringify(want), JSON.stringify(keys(dof)));
const wholeAj = whole?.application_jobs?.[0];
const wholeDo = whole?.direct_offers?.[0];
check("A3 the kept keys hold the whole row's values",
  !!aj && !!dof && want.every((k) => JSON.stringify(aj[k]) === JSON.stringify(wholeAj?.[k]) && JSON.stringify(dof[k]) === JSON.stringify(wholeDo?.[k]))
    && aj.title === "Mow the lawn" && dof.offered_to_helper_id === HELPER,
  JSON.stringify({ aj, dof }));
check("A4 a key the row does not have (date_window_end) is absent, not an error", !!aj && !kept.error && !("date_window_end" in aj), JSON.stringify(kept?.error ?? ""));

const old = await call(undefined);
const cols = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs'`)).rows[0].n;
check("A5 the two-list call (an older client) still gets whole rows on both keys",
  keys(old?.application_jobs?.[0]).length === cols && keys(old?.direct_offers?.[0]).length === cols
    && old.application_jobs[0].stripe_session_id === "cs_secret", `${keys(old?.application_jobs?.[0]).length}/${cols}`);
const others = ["posted_jobs", "poster_applications", "offer_targets", "my_applications", "violations", "reviews", "open_continue_days"];
check("A6 the other seven keys are identical between the two calls and the old function",
  !!kept && !kept.error && others.every((k) => JSON.stringify(kept[k]) === JSON.stringify(whole[k]) && JSON.stringify(old[k]) === JSON.stringify(whole[k]))
    && whole.posted_jobs.length === 1 && whole.violations.length === 1 && whole.open_continue_days.length === 1,
  others.filter((k) => JSON.stringify(kept?.[k]) !== JSON.stringify(whole?.[k])).join(","));

const bad1 = await call(`ARRAY['id','title; drop table jobs']::text[]`);
const bad2 = await call(`ARRAY[]::text[]`);
const bad3 = await call(`ARRAY['id', NULL]::text[]`);
check("A7 a bad name, an empty list or a NULL name is refused (bad_columns, 22023)",
  [bad1, bad2, bad3].every((b) => b?.code === "22023" && /bad_columns/.test(b?.error ?? "")), JSON.stringify([bad1, bad2, bad3]));

const procs = (await db.query(`SELECT oid::regprocedure::text sig, proacl::text acl FROM pg_proc WHERE proname = 'get_my_activity_cores'`)).rows;
let anonRefused = false;
try {
  await db.exec(`SET ROLE anon;`);
  await db.query(`SELECT public.get_my_activity_cores(${arr(JOB_COLS)}, ${arr(APP_COLS)}, ${arr(KEEP)})`);
} catch (e) {
  anonRefused = /permission denied/.test(e.message);
} finally {
  await db.exec(`RESET ROLE;`);
}
check("A8 one overload (three lists); execute is authenticated + service_role only; anon is refused",
  procs.length === 1 && procs[0].sig === "get_my_activity_cores(text[],text[],text[])"
    && /authenticated=X/.test(procs[0].acl) && /service_role=X/.test(procs[0].acl) && !/anon=/.test(procs[0].acl) && !/(^|[{,])=X/.test(procs[0].acl) && anonRefused,
  JSON.stringify({ procs, anonRefused }));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // Only A5 holds on the old function (it has no third list, so every three-list call is 42883; A6 compares it).
  const expected = 7;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
