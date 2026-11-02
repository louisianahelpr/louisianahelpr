#!/usr/bin/env node
/**
 * PGlite proof for 20261102071213_store_reviewer_may_apply_to_real_jobs
 * (Q1755 follow-up, lead 2026-11-02): the App Review account
 * (public.store_review_accounts, itself a test account) may APPLY to a real
 * job; a hire, a direct offer or a crew spot on one stays refused, and every
 * other test account stays fully refused.
 *
 *   node src/test/pglite/storeReviewerMayApply.pglite.mjs                    # AFTER: base + new migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/storeReviewerMayApply.pglite.mjs # RED: base only
 *   PLANT=<name> node src/test/pglite/storeReviewerMayApply.pglite.mjs       # a planted defect must go RED
 *     PLANT=all_tables  the exemption on every table (hire/offer/crew let through)
 *     PLANT=any_test    the exemption for every test account
 *     PLANT=anon_grant  EXECUTE left to anon (Supabase's default grant not revoked)
 *
 * Supabase's default grant is emulated: ALTER DEFAULT PRIVILEGES grants EXECUTE
 * on new functions to anon and authenticated before any migration runs.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const BASE = read("../../../supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql");
let NEW = read("../../../supabase/migrations/20261102071213_store_reviewer_may_apply_to_real_jobs.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
const PLANT = process.env.PLANT ?? "";
const plant = (find, repl) => {
  if (!NEW.includes(find)) throw new Error(`plant ${PLANT}: find-string not in the migration`);
  NEW = NEW.replace(find, repl);
};
if (PLANT === "all_tables") plant("IF TG_TABLE_NAME = 'applications'\n     AND EXISTS (SELECT 1 FROM public.store_review_accounts", "IF true\n     AND EXISTS (SELECT 1 FROM public.store_review_accounts");
if (PLANT === "any_test") plant("AND EXISTS (SELECT 1 FROM public.store_review_accounts r WHERE r.user_id = v_member) THEN", "THEN");
if (PLANT === "anon_grant") plant("REVOKE ALL ON FUNCTION public.enforce_test_account_off_real_jobs() FROM PUBLIC, anon, authenticated;\n", "SELECT 1;\n");
if (PLANT && PLANT === "anon_grant") NEW = NEW.replace("CREATE OR REPLACE FUNCTION", "DROP FUNCTION IF EXISTS public.enforce_test_account_off_real_jobs() CASCADE;\nCREATE OR REPLACE FUNCTION");
if (MODE) console.log(`NEW_MIGRATION=${MODE}: base state only (expect FAILs)`);
if (PLANT) console.log(`PLANT=${PLANT} (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL_POSTER = "a0000000-0000-4000-8000-000000000001";
const REAL_HELPR = "a0000000-0000-4000-8000-000000000002";
const TEST_POSTER = "b0000000-0000-4000-8000-000000000001";
const TEST_HELPR = "b0000000-0000-4000-8000-000000000002";
const REVIEWER = "b0000000-0000-4000-8000-000000000003";
const REAL_JOB = "c0000000-0000-4000-8000-000000000001";
const SEED_JOB = "c0000000-0000-4000-8000-000000000002";
const REAL_CREW = "c0000000-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
  CREATE TABLE public.store_review_accounts (user_id uuid PRIMARY KEY, note text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, is_seed boolean NOT NULL DEFAULT false,
    helper_id uuid, offered_to_helper_id uuid, title text);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.jobs(id), helper_id uuid NOT NULL);
  CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.jobs(id), helper_id uuid, status text NOT NULL DEFAULT 'open');
  INSERT INTO public.profiles VALUES ('${REAL_POSTER}', false), ('${REAL_HELPR}', false), ('${TEST_POSTER}', true), ('${TEST_HELPR}', true), ('${REVIEWER}', true);
  INSERT INTO public.test_accounts (user_id) VALUES ('${TEST_POSTER}'), ('${TEST_HELPR}'), ('${REVIEWER}');
  INSERT INTO public.store_review_accounts (user_id) VALUES ('${REVIEWER}');
  INSERT INTO public.jobs (id, customer_id, is_seed, title) VALUES
    ('${REAL_JOB}', '${REAL_POSTER}', false, 'real'), ('${SEED_JOB}', '${TEST_POSTER}', true, 'seed'), ('${REAL_CREW}', '${REAL_POSTER}', false, 'real crew');
`);
await db.exec(BASE);
if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied ${i}x`);
  }
}

async function attempt(sql) {
  try {
    await db.exec(`BEGIN; ${sql}; ROLLBACK;`);
    return "ok";
  } catch (e) {
    await db.exec("ROLLBACK");
    return String(e.message);
  }
}
const refused = (r) => /test_account_real_job/.test(r);

let r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${REAL_JOB}', '${REVIEWER}')`);
check("the review account APPLIES to a real job", r === "ok", r);
r = await attempt(`UPDATE public.jobs SET helper_id = '${REVIEWER}' WHERE id = '${REAL_JOB}'`);
check("HIRING the review account on a real job stays refused", refused(r), r);
r = await attempt(`UPDATE public.jobs SET offered_to_helper_id = '${REVIEWER}' WHERE id = '${REAL_JOB}'`);
check("a direct OFFER of a real job to the review account stays refused", refused(r), r);
r = await attempt(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${REAL_CREW}', '${REVIEWER}')`);
check("a real CREW spot for the review account stays refused", refused(r), r);
r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${REAL_JOB}', '${TEST_HELPR}')`);
check("any other test account applying to a real job stays refused", refused(r), r);
r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${REAL_JOB}', '${REAL_HELPR}')`);
check("a real member applies to a real job", r === "ok", r);
r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${SEED_JOB}', '${REVIEWER}')`);
check("the review account applies to a test job", r === "ok", r);

const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'enforce_test_account_off_real_jobs'`)).rows[0]?.a ?? "";
check("the trigger function is not executable by anon or authenticated", !/\banon=|\bauthenticated=/.test(acl), acl || "(default)");
const trg = (await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname LIKE 'trg_%_test_account_off_real_jobs'`)).rows[0].n;
check("the three triggers still attach the function", trg === 3, String(trg));

console.log(failures ? `RED: ${failures} failed` : "GREEN");
process.exit(failures ? 1 : 0);
