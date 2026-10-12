#!/usr/bin/env node
/**
 * PGlite proof for 20261012201528_fill_rate_leaves_test_jobs_out (Q1692).
 *
 *   node src/test/pglite/fillRateLeavesTestJobsOut.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/fillRateLeavesTestJobsOut.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR). The "before" body is the only previous
 * definition (20260612230000), which is prod's (prosrc md5 equal, 2026-10-12).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const OLD = readFileSync(`${MIG}20260612230000_fill_rate_metrics.sql`, "utf8");
const NEW = readFileSync(`${MIG}20261012201528_fill_rate_leaves_test_jobs_out.sql`, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const USER = "00000000-0000-0000-0000-0000000000b1";
const REAL_H = "00000000-0000-0000-0000-0000000000d1";
const TEST_H = "00000000-0000-0000-0000-0000000000d2";
const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  -- As prod: one has_role(uuid, app_role) overload, so 'admin' resolves to the enum.
  CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
  CREATE TABLE public.user_roles(user_id uuid, role public.app_role);
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $$;
  CREATE TABLE public.jobs(id uuid PRIMARY KEY, parish text, created_at timestamptz, status text, is_seed boolean DEFAULT false);
  CREATE TABLE public.applications(id uuid DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, created_at timestamptz);
  CREATE TABLE public.profiles(user_id uuid, is_seed boolean DEFAULT false);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.profiles VALUES ('${REAL_H}', false), ('${TEST_H}', true);
  INSERT INTO public.jobs VALUES
    ('${id(1)}', 'Lafayette', now() - interval '2 days', 'open', false),   -- real, real applicant: filled
    ('${id(2)}', 'Lafayette', now() - interval '2 days', 'open', false),   -- real, only a TEST applicant: not filled
    ('${id(3)}', 'Lafayette', now() - interval '2 days', 'open', true),    -- a test job: not counted
    ('${id(4)}', 'Acadia', now() - interval '2 days', 'open', false);      -- real, no applicant
  INSERT INTO public.applications(job_id, helper_id, created_at) VALUES
    ('${id(1)}', '${REAL_H}', now() - interval '2 days' + interval '1 hour'),
    ('${id(2)}', '${TEST_H}', now() - interval '2 days' + interval '1 minute'),
    ('${id(3)}', '${TEST_H}', now() - interval '2 days' + interval '1 minute');
`);
await db.exec(OLD);
if (!MODE) for (let i = 0; i < 3; i++) await db.exec(NEW);

const read = async (uid) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
  const rows = (await db.query(`SELECT * FROM public.get_fill_rate_stats(30)`)).rows;
  return { overall: rows.find((r) => r.parish === null), parishes: rows.filter((r) => r.parish !== null) };
};

const a = await read(ADMIN);
check("an admin's total leaves the test job out (3 real jobs)", Number(a.overall?.total_jobs) === 3, String(a.overall?.total_jobs));
check("a real job only a test account applied to is not 'filled' (1 of 3)", Number(a.overall?.filled_jobs) === 1, String(a.overall?.filled_jobs));
check("time to first application is the real applicant's (60 min), not the test one's", Number(a.overall?.median_minutes_to_first_app) === 60, String(a.overall?.median_minutes_to_first_app));
const laf = a.parishes.find((p) => p.parish === "Lafayette");
check("the parish row counts real jobs only", Number(laf?.total_jobs) === 2, String(laf?.total_jobs));

const u = await read(USER);
check("a non-admin gets the empty summary only", Number(u.overall?.total_jobs) === 0 && u.parishes.length === 0, JSON.stringify(u));

if (!MODE) {
  const priv = async (role) => (await db.query(`SELECT has_function_privilege('${role}', 'public.get_fill_rate_stats(integer)', 'EXECUTE') x`)).rows[0].x;
  check("anon cannot execute; authenticated can (admin-gated inside)", !(await priv("anon")) && (await priv("authenticated")));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
