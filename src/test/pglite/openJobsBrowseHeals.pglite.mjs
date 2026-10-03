#!/usr/bin/env node
/**
 * PGlite proof for 20261003144349_open_jobs_browse_heals_itself (docs/OPEN.md
 * Q1156): a flip of open_jobs_browse to security_invoker is put back and paged.
 *
 *   node src/test/pglite/openJobsBrowseHeals.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/openJobsBrowseHeals.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/openJobsBrowseHeals.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Fixture: the prod shapes the migration touches, measured read-only on prod
 * 2026-10-03 (view owned by postgres with security_invoker=false, error_logs'
 * severity CHECK, cron_work_expectations' work_visibility CHECK); no pg_cron,
 * so the schedule is skipped exactly as replay-safety says.
 *
 * Applies the migration 3x, then proves:
 *   - a definer view is left alone and nothing is logged;
 *   - security_invoker=true, =on and the abbreviations Postgres stores as
 *     typed (t, ye, TRU) are all healed to false, each with ONE error_logs row
 *     (source open-jobs-browse-healed, severity fatal) naming what it found;
 *     the next run is a no-op again; a caller's temp pg_class cannot mask it;
 *   - the client grants are SELECT-only after a heal;
 *   - anon and authenticated cannot EXECUTE the function; service_role can;
 *   - the cron expectation row exists and passes its CHECK.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = process.env.MIGRATION_PATH
  ?? new URL("../../../supabase/migrations/20261003144349_open_jobs_browse_heals_itself.sql", import.meta.url).pathname;

const db = new PGlite();
let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; console.log(`PASS ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } };
const one = async (sql) => (await db.query(sql)).rows[0];
const heal = async () => {
  try { return (await one("SELECT public.check_browse_view_definer() AS r")).r; }
  catch (e) { return { error: e.message }; }
};
const opts = async () => (await one("SELECT coalesce(array_to_string(reloptions, ','), '') AS o FROM pg_class WHERE oid = 'public.open_jobs_browse'::regclass")).o;
const logs = async () => (await db.query("SELECT severity, message, tags FROM public.error_logs WHERE tags ->> 'source' = 'open-jobs-browse-healed' ORDER BY created_at")).rows;

await db.exec(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
  -- prod's pg_default_acl (measured 2026-10-03): functions postgres creates in
  -- public are EXECUTE for anon, authenticated and service_role, so the
  -- migration's REVOKE is what keeps clients out (and this proof can go red).
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.jobs (id int PRIMARY KEY, status text NOT NULL);
  INSERT INTO public.jobs VALUES (1, 'open'), (2, 'completed');
  CREATE VIEW public.open_jobs_browse WITH (security_invoker = false) AS
    SELECT id FROM public.jobs WHERE status = 'open';
  REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
  GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;
  CREATE TABLE public.error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error','fatal')),
    message text NOT NULL,
    tags jsonb NOT NULL DEFAULT '{}'::jsonb,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE TABLE public.cron_work_expectations (
    jobname text PRIMARY KEY,
    expected_max_gap interval,
    note text,
    work_visibility text,
    work_exempt_reason text,
    CHECK ((work_visibility IS NULL) OR (work_visibility = 'candidates')
        OR ((work_visibility = 'exempt') AND (length(btrim(COALESCE(work_exempt_reason, ''))) >= 40)))
  );
`);

if (process.env.NEW_MIGRATION !== "skip") {
  const sql = readFileSync(MIG, "utf8");
  for (let i = 1; i <= 3; i++) {
    try { await db.exec(sql); check(true, `migration applies (run ${i})`); }
    catch (e) { check(false, `migration applies (run ${i}): ${e.message}`); }
  }
}

let r = await heal();
check(r?.ok === true && !r.healed, `a definer view is left alone (${JSON.stringify(r)})`);
check((await logs()).length === 0, "nothing is logged while the view is definer");

await db.exec("ALTER VIEW public.open_jobs_browse SET (security_invoker = true)");
check((await opts()) === "security_invoker=true", "fixture: the view is flipped the way the dashboard did");
r = await heal();
check(r?.healed === true, `security_invoker=true is healed (${JSON.stringify(r)})`);
check((await opts()) === "security_invoker=false", `the view is definer again (${await opts()})`);
let l = await logs();
check(l.length === 1 && l[0].severity === "fatal", `one error_logs page at severity fatal, which clients cannot write (${l.length}, ${l[0]?.severity})`);
check(l.length === 1 && l[0].message.includes("security_invoker=true") && l[0].message.includes("Q1156"), "the page names what it found and the item");

r = await heal();
check(r?.ok === true && !r.healed && (await logs()).length === 1, "the next run is a no-op");

await db.exec("ALTER VIEW public.open_jobs_browse SET (security_invoker = on)");
r = await heal();
check(r?.healed === true && (await opts()) === "security_invoker=false", `security_invoker=on is healed too (${await opts()})`);
check((await logs()).length === 2, "each flip writes its own row");

// Postgres stores an abbreviated boolean as typed, and it still flips the view.
for (const spelling of ["t", "ye", "TRU"]) {
  await db.exec(`ALTER VIEW public.open_jobs_browse SET (security_invoker = ${spelling})`);
  const before = await opts();
  r = await heal();
  check(r?.healed === true && (await opts()) === "security_invoker=false", `security_invoker=${spelling} (stored as ${before}) is healed`);
}

// A caller's temp table named pg_class cannot hide a flip from the catalog read.
await db.exec("ALTER VIEW public.open_jobs_browse SET (security_invoker = true)");
await db.exec("CREATE TEMP TABLE pg_class (oid oid, reloptions text[]); INSERT INTO pg_temp.pg_class VALUES ('public.open_jobs_browse'::regclass, ARRAY['security_invoker=false'])");
r = await heal();
check(r?.healed === true && (await opts()) === "security_invoker=false", `a temp pg_class cannot mask the flip (${JSON.stringify(r)})`);
await db.exec("DROP TABLE pg_temp.pg_class");

const priv = await one(`SELECT
  has_table_privilege('anon', 'public.open_jobs_browse', 'SELECT') AS anon_select,
  has_table_privilege('anon', 'public.open_jobs_browse', 'INSERT') AS anon_insert,
  has_table_privilege('authenticated', 'public.open_jobs_browse', 'UPDATE') AS auth_update`);
check(priv?.anon_select === true && priv?.anon_insert === false && priv?.auth_update === false, `client grants are SELECT-only after a heal (${JSON.stringify(priv)})`);

let ex;
try {
  ex = await one(`SELECT
    has_function_privilege('anon', 'public.check_browse_view_definer()', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.check_browse_view_definer()', 'EXECUTE') AS authed,
    has_function_privilege('service_role', 'public.check_browse_view_definer()', 'EXECUTE') AS service`);
} catch (e) { ex = { error: e.message }; }
check(ex?.anon === false && ex?.authed === false && ex?.service === true, `only service_role may call it (${JSON.stringify(ex)})`);

let exp;
try { exp = await one("SELECT jobname, work_visibility FROM public.cron_work_expectations WHERE jobname = 'open-jobs-browse-heal'"); }
catch (e) { exp = { error: e.message }; }
check(exp?.jobname === "open-jobs-browse-heal" && exp?.work_visibility === "exempt", `the cron expectation row is registered (${JSON.stringify(exp)})`);

console.log(`\n${fail ? "FAILED" : "ALL PASS"}: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
