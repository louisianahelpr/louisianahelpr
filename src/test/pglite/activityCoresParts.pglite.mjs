#!/usr/bin/env node
/**
 * PGlite proof for 20261105111750_activity_cores_parts (docs/OPEN.md Q2706 Posted, Builder 3, 2026-11-05).
 *
 *   npx tsx src/test/pglite/activityCoresParts.pglite.mjs [--replay] [--before]
 *
 * get_my_activity_cores is loaded from its EFFECTIVE definition before this migration (Q2742 part 2, three lists).
 * --before leaves the migration out and the RED checks must FAIL (count asserted); without it the migration is applied
 * (3x with --replay) and every check must PASS.
 * Stubs (not under test): get_jobs_for_my_applications / get_my_pending_direct_offers (SETOF jobs, as the definers
 * hand them) and get_job_offer_targets. Each raises when its part's "boom" setting is on, so a call that computes a
 * part it was not asked for fails.
 *
 *   P1 p_parts {posted}: exactly posted_jobs, poster_applications, offer_targets, open_continue_days      RED before
 *   P2 p_parts {applied}: exactly my_applications, application_jobs, direct_offers, violations, reviews,
 *      open_continue_days                                                                                 RED before
 *   P3 no key is in both part answers but open_continue_days, and the two days lists do not overlap      RED before
 *   P4 each part's keys equal the NULL call's (the merge of the two answers IS today's payload)            RED before
 *   P5 open_continue_days is scoped: posted = my posted job's day only, applied = my applied job's only   RED before
 *   P6 {posted, applied} is the NULL call                                                                  RED before
 *   P7 the NULL call (p_parts left out) is the old function's answer, key for key
 *   P8 a part never computes the other: the other part's reads raising does not fail it                    RED before
 *   P9 bad parts are refused (bad_parts, 22023): empty, a NULL, an unknown name, three names              RED before
 *   P10 the column-list checks still refuse (bad_columns) when p_parts is given                            RED before
 *   P11 one overload (four lists); execute authenticated + service_role only; anon refused                RED before
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105111750_activity_cores_parts.sql";
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

const boom = (part) => `IF current_setting('lh.boom_${part}', true) = 'on' THEN RAISE EXCEPTION 'computed the ${part} part'; END IF;`;
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
  customer_id uuid, helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
  stripe_session_id text, created_at timestamptz DEFAULT now());
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, created_at timestamptz DEFAULT now());
CREATE TABLE public.user_violations (user_id uuid, job_id uuid, violation_type text);
CREATE TABLE public.reviews (reviewer_id uuid, job_id uuid);
CREATE TABLE public.job_continue_days (job_id uuid, status text, closed_at timestamptz, new_date date, new_start_time time);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.get_job_offer_targets() RETURNS TABLE (job_id uuid, offered_to_helper_id uuid) LANGUAGE plpgsql STABLE
  AS $$ BEGIN ${boom("posted")} RETURN QUERY SELECT j.id, j.offered_to_helper_id FROM public.jobs j WHERE j.customer_id = auth.uid() AND j.offered_to_helper_id IS NOT NULL; END $$;
CREATE FUNCTION public.get_jobs_for_my_applications() RETURNS SETOF public.jobs LANGUAGE plpgsql STABLE SECURITY DEFINER
  AS $$ BEGIN ${boom("applied")} RETURN QUERY SELECT j.* FROM public.jobs j WHERE j.id IN (SELECT a.job_id FROM public.applications a WHERE a.helper_id = auth.uid()); END $$;
CREATE FUNCTION public.get_my_pending_direct_offers() RETURNS SETOF public.jobs LANGUAGE plpgsql STABLE SECURITY DEFINER
  AS $$ BEGIN ${boom("applied")} RETURN QUERY SELECT j.* FROM public.jobs j WHERE j.offered_to_helper_id = auth.uid() AND j.direct_offer_status = 'pending'; END $$;

${fnStmt("get_my_activity_cores")}
REVOKE ALL ON FUNCTION public.get_my_activity_cores(text[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_cores(text[], text[], text[]) TO authenticated, service_role;

INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status, offered_to_helper_id, direct_offer_status, stripe_session_id) VALUES
  ('${APPLIED_JOB}', '${POSTER}', NULL, 'Mow the lawn', 40, 'open', NULL, NULL, 'cs_secret'),
  ('${OFFER_JOB}',   '${POSTER}', NULL, 'Paint a fence', 70, 'open', '${HELPER}', 'pending', 'cs_secret2'),
  ('${MY_POSTED}',   '${HELPER}', NULL, 'My own job', 25, 'open', '${OTHER}', 'pending', NULL);
INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${APPLIED_JOB}', '${HELPER}', 'pending'), ('${MY_POSTED}', '${OTHER}', 'pending');
INSERT INTO public.user_violations VALUES ('${HELPER}', '${APPLIED_JOB}', 'job_denial');
INSERT INTO public.reviews VALUES ('${HELPER}', '${APPLIED_JOB}');
INSERT INTO public.job_continue_days VALUES ('${APPLIED_JOB}', 'set', NULL, '2026-11-10', '09:00'),
  ('${MY_POSTED}', 'set', NULL, '2026-11-12', '10:00'), ('${OFFER_JOB}', 'set', NULL, '2026-11-13', '11:00');
`;

const JOB_COLS = ["id", "title", "budget", "status", "customer_id", "helper_id", "created_at"];
const APP_COLS = ["id", "job_id", "helper_id", "status", "closed_reason", "created_at"];
const KEEP = ["id", "title", "status", "offered_to_helper_id", "direct_offer_status"];
const arr = (a) => `ARRAY[${a.map((c) => (c === null ? "NULL" : `'${c}'`)).join(",")}]::text[]`;
const POSTED_KEYS = ["offer_targets", "open_continue_days", "posted_jobs", "poster_applications"];
const APPLIED_KEYS = ["application_jobs", "direct_offers", "my_applications", "open_continue_days", "reviews", "violations"];

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`SELECT set_config('request.jwt.claim.sub', '${HELPER}', false);`);
const call = async (parts, jobCols = JOB_COLS) => {
  try {
    const sql = `SELECT public.get_my_activity_cores(${arr(jobCols)}, ${arr(APP_COLS)}, ${arr(KEEP)}${parts === undefined ? "" : `, ${parts}`}) AS c`;
    return (await db.query(sql)).rows[0].c;
  } catch (e) {
    return { error: e.message, code: e.code };
  }
};

const old = await call(undefined); // before applying: the old function, the baseline
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

const keys = (o) => (o && !o.error ? Object.keys(o).sort() : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const all = await call(undefined);
const posted = await call(arr(["posted"]));
const applied = await call(arr(["applied"]));
const both = await call(arr(["posted", "applied"]));

check("P1 {posted} answers exactly the posted keys", same(keys(posted), POSTED_KEYS), JSON.stringify(posted?.error ?? keys(posted)));
check("P2 {applied} answers exactly the applied keys", same(keys(applied), APPLIED_KEYS), JSON.stringify(applied?.error ?? keys(applied)));
const shared = keys(posted).filter((k) => keys(applied).includes(k));
const days = (o) => (o?.open_continue_days ?? []).map((d) => d.job_id).sort();
check("P3 no key in both answers but open_continue_days, whose job ids do not overlap",
  same(shared, ["open_continue_days"]) && !days(posted).some((j) => days(applied).includes(j)), JSON.stringify({ shared, p: days(posted), a: days(applied) }));
check("P4 each part's keys equal the NULL call's (the two answers merged are today's payload)",
  !all.error && POSTED_KEYS.length + APPLIED_KEYS.length - 1 === keys(all).length
    && POSTED_KEYS.filter((k) => k !== "open_continue_days").every((k) => same(posted?.[k], all[k]))
    && APPLIED_KEYS.filter((k) => k !== "open_continue_days").every((k) => same(applied?.[k], all[k]))
    && same([...days(posted), ...days(applied)].sort(), days(all))
    && all.posted_jobs.length === 1 && all.poster_applications.length === 1 && all.offer_targets.length === 1
    && all.application_jobs.length === 1 && all.direct_offers.length === 1 && all.violations.length === 1 && all.reviews.length === 1,
  JSON.stringify(keys(all)));
check("P5 open_continue_days is scoped to the asked part's jobs",
  same(days(posted), [MY_POSTED]) && same(days(applied), [APPLIED_JOB]) && same(days(all), [APPLIED_JOB, MY_POSTED].sort()),
  JSON.stringify({ p: days(posted), a: days(applied), all: days(all) }));
check("P6 {posted, applied} is the NULL call", !both.error && same(both, all), JSON.stringify(both?.error ?? ""));
check("P7 the NULL call is the old function's answer, key for key", !old.error && same(all, old), JSON.stringify(old?.error ?? ""));

await db.exec(`SELECT set_config('lh.boom_applied', 'on', false);`);
const postedAlone = await call(arr(["posted"]));
const allBoomApplied = await call(undefined);
await db.exec(`SELECT set_config('lh.boom_applied', 'off', false); SELECT set_config('lh.boom_posted', 'on', false);`);
const appliedAlone = await call(arr(["applied"]));
const allBoomPosted = await call(undefined);
await db.exec(`SELECT set_config('lh.boom_posted', 'off', false);`);
check("P8 a part never computes the other (the other part's reads raising does not fail it; the NULL call does)",
  !postedAlone.error && !appliedAlone.error && same(postedAlone, posted) && same(appliedAlone, applied)
    && /computed the applied part/.test(allBoomApplied?.error ?? "") && /computed the posted part/.test(allBoomPosted?.error ?? ""),
  JSON.stringify({ p: postedAlone?.error, a: appliedAlone?.error, ba: allBoomApplied?.error, bp: allBoomPosted?.error }));

const bads = [arr([]), arr(["posted", null]), arr(["everything"]), arr(["posted", "applied", "posted"]), arr(["Posted"])];
const badAnswers = [];
for (const b of bads) badAnswers.push(await call(b));
check("P9 bad parts are refused (bad_parts, 22023)",
  badAnswers.every((b) => b?.code === "22023" && /bad_parts/.test(b?.error ?? "")), JSON.stringify(badAnswers));
const badCols = await call(arr(["posted"]), ["id", "title; drop table jobs"]);
check("P10 the column checks still refuse with p_parts given (bad_columns)", badCols?.code === "22023" && /bad_columns/.test(badCols?.error ?? ""), JSON.stringify(badCols));

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
check("P11 one overload (four lists), STABLE SECURITY INVOKER; execute authenticated + service_role only; anon refused",
  procs.length === 1 && procs[0].sig === "get_my_activity_cores(text[],text[],text[],text[])" && procs[0].prosecdef === false && procs[0].provolatile === "s"
    && /authenticated=X/.test(procs[0].acl) && /service_role=X/.test(procs[0].acl) && !/anon=/.test(procs[0].acl) && !/(^|[{,])=X/.test(procs[0].acl) && anonRefused,
  JSON.stringify({ procs, anonRefused }));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // Only P7 holds on the old function (it has no fourth argument, so every p_parts call is 42883).
  const expected = 10;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
