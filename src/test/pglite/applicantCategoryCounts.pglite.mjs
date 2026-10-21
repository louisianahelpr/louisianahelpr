#!/usr/bin/env node
/**
 * PGlite proof for 20261021020444_applicant_category_counts.sql (board 188).
 *
 *   node src/test/pglite/applicantCategoryCounts.pglite.mjs
 *
 * The whole migration file, verbatim, applied 3x (replay). auth.uid() and require_feature() are stubs
 * driven by session settings; jobs / applications / group_job_helpers / feature_switches are cut down to
 * the columns the RPC reads. Checks: the poster gets per-applicant counts in the job's category only
 * (a crew member counts, another category does not, an unfinished job does not); a stranger and a Helpr
 * get nothing; the switch off refuses; anon has no EXECUTE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(DIR + "20261021020444_applicant_category_counts.sql", "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const POSTER = U(1), A1 = U(2), A2 = U(3), STRANGER = U(4), JOB = U(10);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF coalesce(current_setting('test.feature', true), '') <> 'on' THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, category text, status text, is_group_job boolean DEFAULT false);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid, helper_id uuid);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
  INSERT INTO public.jobs VALUES
    ('${JOB}', '${POSTER}', NULL, 'pressure_washing', 'open', false),
    ('${U(20)}', '${U(9)}', '${A1}', 'pressure_washing', 'completed', false),
    ('${U(21)}', '${U(9)}', '${A1}', 'pressure_washing', 'completed', false),
    ('${U(22)}', '${U(9)}', '${A1}', 'cleaning', 'completed', false),
    ('${U(23)}', '${U(9)}', '${A1}', 'pressure_washing', 'in_progress', false),
    ('${U(24)}', '${U(9)}', NULL, 'pressure_washing', 'completed', true);
  INSERT INTO public.group_job_helpers VALUES ('${U(24)}', '${A2}');
  INSERT INTO public.applications (job_id, helper_id) VALUES ('${JOB}', '${A1}'), ('${JOB}', '${A2}');
`);
for (let i = 0; i < 3; i++) await db.exec(SQL);

const checks = [];
const check = (name, ok) => { checks.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };
const call = async (uid, feature = "on") => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET test.feature = '${feature}'`);
  const r = await db.query(`SELECT helper_id::text, category_completed::int AS n FROM public.get_applicant_category_counts('${JOB}') ORDER BY 1`);
  return r.rows;
};

const rows = await call(POSTER);
check("the poster gets each applicant's count in this category (2 solo, 1 as crew)",
  JSON.stringify(rows) === JSON.stringify([{ helper_id: A1, n: 2 }, { helper_id: A2, n: 1 }]));
check("a stranger gets nothing", (await call(STRANGER)).length === 0);
check("an applicant (not the poster) gets nothing", (await call(A1)).length === 0);
check("signed out gets nothing", (await call(null)).length === 0);
let refused = false;
try { await call(POSTER, "off"); } catch (e) { refused = /feature_disabled/.test(String(e.message)); }
check("switch off: refused (feature_disabled)", refused);
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'get_applicant_category_counts'`)).rows[0].a;
check("no EXECUTE for anon or PUBLIC", !/(^|,)anon=/.test(acl) && !/(^|\{|,)=X/.test(acl));
const sw = (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'applicant_proof'`)).rows[0]?.audience;
check("the switch is created at 'testers'", sw === "testers");

const fails = checks.filter((c) => !c).length;
console.log(`${checks.length - fails}/${checks.length} pass (3x applied)`);
process.exit(fails ? 1 : 0);
