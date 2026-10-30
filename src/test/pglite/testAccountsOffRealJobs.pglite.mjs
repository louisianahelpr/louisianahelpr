#!/usr/bin/env node
/**
 * PGlite proof for 20261030063902_test_accounts_off_real_jobs (docs/OPEN.md
 * Q1755): a test account is never put on a real job.
 *
 *   node src/test/pglite/testAccountsOffRealJobs.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/testAccountsOffRealJobs.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture: only the columns the trigger reads (jobs.id/customer_id/is_seed/
 * helper_id/offered_to_helper_id, applications.job_id/helper_id,
 * group_job_helpers.job_id/helper_id, test_accounts.user_id, profiles.is_seed),
 * plus a stand-in for prod's trg_jobs_seed_from_poster (BEFORE INSERT, marks a
 * seed poster's job is_seed) under the SAME trigger name, so the INSERT case
 * proves the new trigger reads the final is_seed (BEFORE triggers fire in name
 * order).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const NEW = read("../../../supabase/migrations/20261030063902_test_accounts_off_real_jobs.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const REAL_POSTER = "a0000000-0000-4000-8000-000000000001";
const REAL_HELPR = "a0000000-0000-4000-8000-000000000002";
const TEST_POSTER = "b0000000-0000-4000-8000-000000000001";
const TEST_HELPR = "b0000000-0000-4000-8000-000000000002";
const REAL_JOB = "c0000000-0000-4000-8000-000000000001";
const SEED_JOB = "c0000000-0000-4000-8000-000000000002";
const REAL_CREW = "c0000000-0000-4000-8000-000000000003";

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, customer_id uuid, is_seed boolean NOT NULL DEFAULT false,
    helper_id uuid, offered_to_helper_id uuid, title text);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.jobs(id), helper_id uuid NOT NULL);
  CREATE TABLE public.group_job_helpers (id serial PRIMARY KEY, job_id uuid NOT NULL REFERENCES public.jobs(id), helper_id uuid, status text NOT NULL DEFAULT 'open');
  -- prod's trg_jobs_seed_from_poster, reduced to its effect.
  CREATE FUNCTION public.jobs_seed_from_poster() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF NOT NEW.is_seed AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.customer_id AND p.is_seed) THEN
      NEW.is_seed := true;
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER trg_jobs_seed_from_poster BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.jobs_seed_from_poster();

  INSERT INTO public.profiles VALUES ('${REAL_POSTER}', false), ('${REAL_HELPR}', false), ('${TEST_POSTER}', true), ('${TEST_HELPR}', true);
  INSERT INTO public.test_accounts (user_id) VALUES ('${TEST_POSTER}'), ('${TEST_HELPR}');
  INSERT INTO public.jobs (id, customer_id, title) VALUES
    ('${REAL_JOB}', '${REAL_POSTER}', 'real'), ('${SEED_JOB}', '${TEST_POSTER}', 'seed'), ('${REAL_CREW}', '${REAL_POSTER}', 'real crew');
`);

if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied ${i}x`);
  }
}

/** Runs a write; returns "ok" or the error message. */
async function attempt(sql) {
  try {
    await db.exec(`BEGIN; ${sql}; COMMIT;`);
    return "ok";
  } catch (e) {
    await db.exec("ROLLBACK");
    return String(e.message);
  }
}
const refused = (r) => /test_account_real_job/.test(r);

check("fixture: the test poster's job is is_seed, the real poster's is not",
  (await db.query(`SELECT bool_and(is_seed = (id = '${SEED_JOB}')) ok FROM public.jobs`)).rows[0].ok === true);

// The bug: a test account on a real job.
let r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${REAL_JOB}', '${TEST_HELPR}')`);
check("a test account APPLYING to a real job is refused", refused(r), r);
r = await attempt(`UPDATE public.jobs SET offered_to_helper_id = '${TEST_HELPR}' WHERE id = '${REAL_JOB}'`);
check("a real poster's direct OFFER to a test account is refused", refused(r), r);
r = await attempt(`UPDATE public.jobs SET helper_id = '${TEST_HELPR}' WHERE id = '${REAL_JOB}'`);
check("HIRING a test account on a real job is refused", refused(r), r);
r = await attempt(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${REAL_CREW}', '${TEST_HELPR}')`);
check("a test account taking a real CREW spot is refused", refused(r), r);
r = await attempt(`INSERT INTO public.group_job_helpers (job_id) VALUES ('${REAL_CREW}');
                   UPDATE public.group_job_helpers SET helper_id = '${TEST_HELPR}' WHERE job_id = '${REAL_CREW}'`);
check("filling an open real crew spot with a test account is refused", refused(r), r);
r = await attempt(`INSERT INTO public.jobs (id, customer_id, offered_to_helper_id, title)
                   VALUES ('c0000000-0000-4000-8000-000000000009', '${REAL_POSTER}', '${TEST_HELPR}', 'real, offered at post time')`);
check("a real job POSTED as a direct offer to a test account is refused", refused(r), r);

// What must keep working.
r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${SEED_JOB}', '${TEST_HELPR}')`);
check("a test account applies to a test job", r === "ok", r);
r = await attempt(`UPDATE public.jobs SET offered_to_helper_id = '${TEST_HELPR}', helper_id = '${TEST_HELPR}' WHERE id = '${SEED_JOB}'`);
check("a test account is offered and hired on a test job", r === "ok", r);
r = await attempt(`INSERT INTO public.jobs (id, customer_id, offered_to_helper_id, title)
                   VALUES ('c0000000-0000-4000-8000-00000000000a', '${TEST_POSTER}', '${TEST_HELPR}', 'test, offered at post time')`);
check("a test poster's job posted as an offer to a test Helpr passes (reads is_seed AFTER seed_from_poster)", r === "ok", r);
r = await attempt(`INSERT INTO public.applications (job_id, helper_id) VALUES ('${REAL_JOB}', '${REAL_HELPR}');
                   UPDATE public.jobs SET offered_to_helper_id = '${REAL_HELPR}', helper_id = '${REAL_HELPR}' WHERE id = '${REAL_JOB}'`);
check("a real member applies, is offered and hired on a real job", r === "ok", r);
r = await attempt(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${REAL_CREW}', '${REAL_HELPR}')`);
check("a real member takes a real crew spot", r === "ok", r);
r = await attempt(`UPDATE public.jobs SET title = 'renamed', helper_id = helper_id WHERE id = '${SEED_JOB}'`);
check("an unrelated update of a row is never blocked", r === "ok", r);
r = await attempt(`UPDATE public.jobs SET helper_id = NULL, offered_to_helper_id = NULL WHERE id = '${REAL_JOB}'`);
check("clearing a hire (anonymise / back out) passes", r === "ok", r);

if (MODE !== "skip") {
  const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'enforce_test_account_off_real_jobs'`)).rows[0]?.a ?? "";
  check("the trigger function is not executable by anon or authenticated", !/\banon=|\bauthenticated=/.test(acl), acl);
  const order = (await db.query(`SELECT array_agg(tgname ORDER BY tgname)::text n FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal`)).rows[0].n;
  check("on jobs the new trigger fires after trg_jobs_seed_from_poster", order.indexOf("trg_jobs_seed_from_poster") < order.indexOf("trg_jobs_test_account_off_real_jobs"), order);
}

console.log(failures ? `RED: ${failures} failed` : "GREEN");
process.exit(failures ? 1 : 0);
