#!/usr/bin/env node
/**
 * PGlite proof for 20260926015040_thread_counterparty_deleted (docs/OPEN.md
 * Q333/Q334): get_thread_counterparty_deleted(job, other) is true only when
 * the caller has a thread on the job AND the other party has no auth user
 * and no profile (a deleted account). A banned or unverified person (profile
 * and auth row present) is NOT deleted; a caller with no business on the job,
 * anon, or asking about themselves gets false; anon has no EXECUTE.
 *
 *   node src/test/pglite/threadCounterpartyDeleted.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/threadCounterpartyDeleted.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * carries the columns the function reads, with the live FK shapes: deleting an
 * auth user cascades its profile and its sent messages, and sets the receiver
 * of messages sent to it NULL (20260924010547, 20260924013306). The migration
 * is applied 3x.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = "20260926015040_thread_counterparty_deleted.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ban_status text, email_verified boolean DEFAULT true);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  offered_to_helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL);
CREATE TABLE public.group_job_helpers (job_id uuid REFERENCES public.jobs(id), helper_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.applications (job_id uuid REFERENCES public.jobs(id), helper_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  content text);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
`);

const U = (n) => `00000000-0000-0000-0000-00000000000${n}`;
const POSTER = U(1), HELPR = U(2), BANNED = U(3), STRANGER = U(4), APPLICANT = U(5), CREW = U(6);
const JOB = "10000000-0000-0000-0000-000000000001";
const BANNED_PROFILE = "30000000-0000-0000-0000-000000000003";
await db.exec(`
INSERT INTO auth.users (id) VALUES ('${POSTER}'),('${HELPR}'),('${BANNED}'),('${STRANGER}'),('${APPLICANT}'),('${CREW}');
INSERT INTO public.profiles (user_id) VALUES ('${POSTER}'),('${HELPR}'),('${STRANGER}'),('${APPLICANT}'),('${CREW}');
INSERT INTO public.profiles (id, user_id, ban_status) VALUES ('${BANNED_PROFILE}', '${BANNED}', 'permanently_banned');
INSERT INTO public.jobs (id, customer_id, helper_id) VALUES ('${JOB}', '${POSTER}', '${HELPR}');
INSERT INTO public.applications VALUES ('${JOB}', '${APPLICANT}');
INSERT INTO public.group_job_helpers VALUES ('${JOB}', '${CREW}');
INSERT INTO public.messages (job_id, sender_id, receiver_id, content) VALUES
  ('${JOB}', '${POSTER}', '${HELPR}', 'see you at 9'),
  ('${JOB}', '${HELPR}', '${POSTER}', 'on my way'),
  ('${JOB}', '${POSTER}', '${BANNED}', 'hello');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(mig(NEW));
      check(`migration applies (pass ${i})`, true);
    } catch (e) {
      check(`migration applies (pass ${i})`, false, e.message);
    }
  }
}

async function ask(caller, other, job = JOB) {
  try {
    await db.exec(`SELECT set_config('test.uid', '${caller ?? ""}', false)`);
    const r = await db.query(
      `SELECT public.get_thread_counterparty_deleted($1::uuid, $2::uuid) AS d`,
      [job, other],
    );
    return r.rows[0].d;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

// Before deletion: nobody is deleted.
check("live Helpr is not deleted", (await ask(POSTER, HELPR)) === false);
check("banned person (profile hidden from get_safe_profiles) is NOT deleted", (await ask(POSTER, BANNED)) === false);
check("banned person asked by profiles.id is NOT deleted", (await ask(POSTER, BANNED_PROFILE)) === false);

// The Helpr deletes their account.
await db.exec(`DELETE FROM auth.users WHERE id = '${HELPR}'`);
const kept = await db.query(`SELECT receiver_id FROM public.messages WHERE sender_id = '${POSTER}' AND content = 'see you at 9'`);
check("fixture: the poster's message to them is kept with receiver NULL", kept.rows.length === 1 && kept.rows[0].receiver_id === null);

check("poster (on the job) is told the Helpr deleted their account", (await ask(POSTER, HELPR)) === true);
check("applicant on the job may ask", (await ask(APPLICANT, HELPR)) === true);
check("crew member on the job may ask", (await ask(CREW, HELPR)) === true);
check("a caller with no business on the job gets false", (await ask(STRANGER, HELPR)) === false);
check("anon (no uid) gets false", (await ask(null, HELPR)) === false);
check("asking about yourself gets false", (await ask(POSTER, POSTER)) === false);
check("a NULL other gets false", (await ask(POSTER, null)) === false);
check("another job id gets false", (await ask(POSTER, HELPR, "10000000-0000-0000-0000-000000000009")) === false);

// The POSTER deletes; the Helpr side is covered above, check the mirror with the crew member.
await db.exec(`DELETE FROM auth.users WHERE id = '${POSTER}'`);
check("ownerless job: crew member told the poster deleted", (await ask(CREW, POSTER)) === true);

// Privileges.
const acl = await db.query(`
  SELECT has_function_privilege('anon', 'public.get_thread_counterparty_deleted(uuid,uuid)', 'EXECUTE') AS anon,
         has_function_privilege('authenticated', 'public.get_thread_counterparty_deleted(uuid,uuid)', 'EXECUTE') AS authd,
         (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.get_thread_counterparty_deleted(uuid,uuid)')) AS secdef,
         (SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.get_thread_counterparty_deleted(uuid,uuid)')) AS cfg
`).catch((e) => ({ rows: [{ error: e.message }] }));
const a = acl.rows[0];
check("anon has no EXECUTE", a.anon === false, JSON.stringify(a));
check("authenticated has EXECUTE", a.authd === true);
check("SECURITY DEFINER with a pinned search_path", a.secdef === true && String(a.cfg).includes("search_path"));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
