#!/usr/bin/env node
/**
 * PGlite proof for 20261031221530_id_notice_skips_test_data_restated (Builder 49s 20261031051341 rebuilt).
 *
 * identity_notify_posters_before_start tells a poster their hired Helpr has not
 * verified their ID. It had no test-data skip, so a seed job or a test account's
 * job would have written a real notification (owner: test data reaches nobody).
 *
 *   node src/test/pglite/idNoticeSkipsTestData.pglite.mjs                  # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/idNoticeSkipsTestData.pglite.mjs  # RED (no skip)
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Real text: the notifier before and after, is_test_subject, is_test_member,
 * is_fixture_email (the live definitions, read 2026-10-31). The switch is ON here.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261031221530_id_notice_skips_test_data_restated.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();

const defRe = (name) => new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
function cut(name) {
  const file = FILES.filter((f) => defRe(name).test(mig(f))).at(-1);
  if (!file) throw new Error(`${name}: no definition before ${THIS}`);
  const sql = mig(file);
  const m = [...sql.matchAll(defRe(name))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const start = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], start);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REAL_POSTER = id(1);
const REAL_HELPR = id(2);
const SEED_POSTER = id(3);
const SEED_HELPR = id(4);
const ACCOUNT_POSTER = id(5);
const ACCOUNT_HELPR = id(6);
const EMAIL_POSTER = id(7);
const EMAIL_HELPR = id(8);
const REAL_POSTER_2 = id(9);
const VERIFIED = id(10);

const db = new PGlite();
await db.exec(`
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, verified boolean NOT NULL DEFAULT false);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, message text, type text, link text, job_id uuid);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, date_needed date, start_time time, customer_id uuid, helper_id uuid, status text,
  helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, is_seed boolean DEFAULT false);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz);
CREATE FUNCTION public.job_hours_until_start(d date, t time, n timestamptz) RETURNS numeric LANGUAGE sql STABLE AS
  $$ SELECT extract(epoch FROM ((d + COALESCE(t, '00:00'::time))::timestamptz - n)) / 3600.0 $$;
-- Switch ON. Waits unless verified, as the real rule does for everyone but a seed test account (that exemption is
-- tested in idCheckTiming): a test account who is not also is_seed still waits, so the notifier must skip them itself.
CREATE FUNCTION public.payout_waits_on_identity(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT NOT COALESCE((SELECT verified FROM public.profiles WHERE user_id = p), false) $$;
`);
await db.exec(cut("is_fixture_email"));
await db.exec(cut("is_test_member"));
await db.exec(cut("is_test_subject"));
await db.exec(cut("identity_notify_posters_before_start"));

await db.exec(`
INSERT INTO public.profiles (user_id, is_seed, verified) VALUES
  ('${REAL_POSTER}', false, true), ('${REAL_HELPR}', false, false), ('${SEED_POSTER}', true, true), ('${SEED_HELPR}', true, false),
  ('${ACCOUNT_POSTER}', false, true), ('${ACCOUNT_HELPR}', false, false), ('${EMAIL_POSTER}', false, true), ('${EMAIL_HELPR}', false, false),
  ('${REAL_POSTER_2}', false, true), ('${VERIFIED}', false, true);
INSERT INTO public.test_accounts VALUES ('${ACCOUNT_POSTER}'), ('${ACCOUNT_HELPR}');
INSERT INTO auth.users (id, email) VALUES
  ('${REAL_POSTER}', 'real.poster@gmail.com'), ('${REAL_HELPR}', 'real.helpr@gmail.com'), ('${REAL_POSTER_2}', 'real.two@gmail.com'),
  ('${EMAIL_POSTER}', 'audit@mailinator.com'), ('${EMAIL_HELPR}', 'someone@example.com'), ('${VERIFIED}', 'v@gmail.com');
`);

const JOBS = {
  real: [21, REAL_POSTER, REAL_HELPR, false],
  seedJob: [22, REAL_POSTER, REAL_HELPR, true],
  seedPoster: [23, SEED_POSTER, REAL_HELPR, false],
  seedHelpr: [24, REAL_POSTER, SEED_HELPR, false],
  accountPoster: [25, ACCOUNT_POSTER, REAL_HELPR, false],
  accountHelpr: [26, REAL_POSTER, ACCOUNT_HELPR, false],
  emailPoster: [27, EMAIL_POSTER, REAL_HELPR, false],
  emailHelpr: [28, REAL_POSTER, EMAIL_HELPR, false],
};
const hours = 10;
const when = `(now() + interval '${hours} hours')::date, (now() + interval '${hours} hours')::time`;
for (const [jid, poster, helpr, seed] of Object.values(JOBS)) {
  await db.exec(`INSERT INTO public.jobs (id, title, date_needed, start_time, customer_id, helper_id, status, is_seed)
    VALUES ('${id(jid)}', 'Yard', ${when}, '${poster}', '${helpr}', 'accepted', ${seed});`);
}
// Crews: the roster path. A crew with one real member and one test member is a real job; the test member's
// row does not earn it a notice, and a crew whose only unverified member is a test member gets none.
const CREW_REAL = id(31);
const CREW_TEST_MEMBER = id(32);
const CREW_TEST_POSTER = id(33);
const CREW_SEED_JOB = id(34);
const CREW_MIXED = id(35);
await db.exec(`
INSERT INTO public.jobs (id, title, date_needed, start_time, customer_id, status, is_seed) VALUES
  ('${CREW_REAL}', 'Crew', ${when}, '${REAL_POSTER_2}', 'open', false),
  ('${CREW_TEST_MEMBER}', 'Crew', ${when}, '${REAL_POSTER_2}', 'accepted', false),
  ('${CREW_TEST_POSTER}', 'Crew', ${when}, '${ACCOUNT_POSTER}', 'accepted', false),
  ('${CREW_SEED_JOB}', 'Crew', ${when}, '${REAL_POSTER_2}', 'accepted', true),
  ('${CREW_MIXED}', 'Crew', ${when}, '${REAL_POSTER_2}', 'accepted', false);
INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES
  ('${CREW_REAL}', '${REAL_HELPR}'), ('${CREW_TEST_MEMBER}', '${ACCOUNT_HELPR}'), ('${CREW_TEST_POSTER}', '${REAL_HELPR}'),
  ('${CREW_SEED_JOB}', '${REAL_HELPR}'), ('${CREW_MIXED}', '${SEED_HELPR}'), ('${CREW_MIXED}', '${REAL_HELPR}');
`);

if (!skip) {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: the notifier with no skip");

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` ${extra}`}`);
  if (!cond) failed++;
};
const first = (await db.query(`SELECT public.identity_notify_posters_before_start(100) AS n`)).rows[0].n;
const again = (await db.query(`SELECT public.identity_notify_posters_before_start(100) AS n`)).rows[0].n;
const notices = async (jobId) => (await db.query(`SELECT count(*)::int AS c FROM public.notifications WHERE job_id='${jobId}'`)).rows[0].c;

ok("a real job with a real unverified Helpr: the poster is told", (await notices(id(JOBS.real[0]))) === 1);
ok("a real crew: the poster is told", (await notices(CREW_REAL)) === 1);
ok("a real crew with one test member and one real unverified member: told, for the real one", (await notices(CREW_MIXED)) === 1);
ok("is_seed on the job reaches nobody", (await notices(id(JOBS.seedJob[0]))) === 0);
ok("a seed poster reaches nobody", (await notices(id(JOBS.seedPoster[0]))) === 0);
ok("a seed Helpr reaches nobody", (await notices(id(JOBS.seedHelpr[0]))) === 0);
ok("a test_accounts poster reaches nobody", (await notices(id(JOBS.accountPoster[0]))) === 0);
ok("a test_accounts Helpr reaches nobody", (await notices(id(JOBS.accountHelpr[0]))) === 0);
ok("a fixture-mail poster (is_test_subject) reaches nobody", (await notices(id(JOBS.emailPoster[0]))) === 0);
ok("an example.com Helpr (is_test_subject) reaches nobody", (await notices(id(JOBS.emailHelpr[0]))) === 0);
ok("crew: a test member alone reaches nobody", (await notices(CREW_TEST_MEMBER)) === 0);
ok("crew: a test poster reaches nobody", (await notices(CREW_TEST_POSTER)) === 0);
ok("crew: a seed job reaches nobody", (await notices(CREW_SEED_JOB)) === 0);
ok("exactly the three real jobs were told, once", first === 3 && again === 0, `first=${first} again=${again}`);
const total = (await db.query(`SELECT count(*)::int AS c FROM public.notifications`)).rows[0].c;
ok("three notifications in all", total === 3, `total=${total}`);
const words = (await db.query(`SELECT message FROM public.notifications WHERE job_id='${id(JOBS.real[0])}'`)).rows[0]?.message ?? "";
ok("the words are unchanged", /without paying for their time/.test(words) && /what comes back to you before you confirm/.test(words), words);
const acl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.identity_notify_posters_before_start(integer)', 'EXECUTE') AS a`)).rows[0].a;
ok("a member cannot call it", acl === false);

console.log(failed ? `\n${failed} FAILED` : "\nALL GREEN");
process.exit(failed ? 1 : 0);
