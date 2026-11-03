#!/usr/bin/env node
/**
 * PGlite proof for 20261103212624_admin_jobs_read_continue_days.sql (owner report 11-03: Admin → Jobs called a job
 * with an agreed continue day "stale-dated", because an admin could not read job_continue_days).
 *
 *   node src/test/pglite/adminJobsReadContinueDays.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/adminJobsReadContinueDays.pglite.mjs  # RED: the parties-only policy
 *   MIGRATION_PATH=<planted copy> node ...                                         # RED on a planted defect
 *
 * World: the table's real grants, RLS and the parties-only policy from 20261101231015 (read verbatim from that file),
 * a jobs stub (id, customer_id, helper_id), user_roles + has_role as on prod, auth.uid() from the request GUC. Then
 * this migration 3x. Checks: an admin reads every row; the poster and the Helpr read their job's row; a stranger
 * reads none; anon has no grant at all; still ONE permissive SELECT policy and no write policy.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261101231015_job_continue_another_day.sql";
const NEW_FILE = "20261103212624_admin_jobs_read_continue_days.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

const base = readFileSync(`${MIG_DIR}${BASE}`, "utf8");
const pick = (re, label) => {
  const m = re.exec(base);
  if (!m) throw new Error(`${BASE}: no ${label}`);
  return m[0];
};
const basePolicy = pick(/DROP POLICY IF EXISTS "Job parties read continue days"[\s\S]*?j\.helper_id\)\)\);/, "parties policy");
const baseGrants = [
  pick(/^ALTER TABLE public\.job_continue_days ENABLE ROW LEVEL SECURITY;$/m, "RLS"),
  "REVOKE ALL ON TABLE public.job_continue_days FROM PUBLIC, anon, authenticated;",
  pick(/^GRANT SELECT ON TABLE public\.job_continue_days TO authenticated;$/m, "authenticated SELECT grant"),
].join("\n");

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid);
GRANT SELECT ON public.jobs TO authenticated;
CREATE TABLE public.job_continue_days (
  id uuid PRIMARY KEY, job_id uuid NOT NULL, proposed_by uuid, new_date date NOT NULL, new_start_time time NOT NULL,
  note text, status text NOT NULL, helper_confirmed_at timestamptz, decided_at timestamptz, decided_by uuid,
  closed_at timestamptz, cleared_done_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`);
await db.exec(baseGrants);
await db.exec(basePolicy);

const POSTER = "11111111-1111-1111-1111-111111111111";
const HELPR = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";
const STRANGER = "44444444-4444-4444-4444-444444444444";
const JOB = "7b1da54b-b59c-458a-9017-d4da604a1f1b";
const OTHER_JOB = "55555555-5555-5555-5555-555555555555";
await db.exec(`
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.jobs VALUES ('${JOB}', '${POSTER}', '${HELPR}'), ('${OTHER_JOB}', '${STRANGER}', NULL);
INSERT INTO public.job_continue_days (id, job_id, proposed_by, new_date, new_start_time, status, helper_confirmed_at)
VALUES ('a0000000-0000-0000-0000-000000000001', '${JOB}', '${HELPR}', '2026-11-05', '09:00', 'set', now()),
       ('a0000000-0000-0000-0000-000000000002', '${OTHER_JOB}', '${STRANGER}', '2026-11-09', '10:00', 'proposed', NULL);
`);

if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `the migration applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration applies (run ${i + 1} of 3)`, e.message);
    }
  }
}

/** Rows visible to `uid` as `role` (RLS applies: the table owner is not the reader). */
async function seen(role, uid) {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return (await db.query("SELECT job_id::text FROM public.job_continue_days ORDER BY job_id")).rows.map((r) => r.job_id);
  } catch (e) {
    return `error: ${e.message}`;
  } finally {
    await db.exec("RESET ROLE;");
  }
}

const adminRows = await seen("authenticated", ADMIN);
ok(Array.isArray(adminRows) && adminRows.length === 2, "an admin reads every continue day (Admin → Jobs)", JSON.stringify(adminRows));
const posterRows = await seen("authenticated", POSTER);
ok(JSON.stringify(posterRows) === JSON.stringify([JOB]), "the poster reads their job's row only", JSON.stringify(posterRows));
const helprRows = await seen("authenticated", HELPR);
ok(JSON.stringify(helprRows) === JSON.stringify([JOB]), "the Helpr reads their job's row only", JSON.stringify(helprRows));
const strangerRows = await seen("authenticated", STRANGER);
ok(JSON.stringify(strangerRows) === JSON.stringify([OTHER_JOB]), "another member reads none of this job's rows", JSON.stringify(strangerRows));
const noOne = await seen("authenticated", "66666666-6666-6666-6666-666666666666");
ok(Array.isArray(noOne) && noOne.length === 0, "a member with no job and no admin role reads nothing", JSON.stringify(noOne));
const anonRows = await seen("anon", null);
ok(typeof anonRows === "string" && /permission denied/.test(anonRows), "anon has no grant at all", JSON.stringify(anonRows));

const pol = (await db.query(
  "SELECT policyname, cmd, permissive, roles::text AS roles FROM pg_policies WHERE tablename = 'job_continue_days' ORDER BY policyname",
)).rows;
ok(pol.length === 1 && pol[0].cmd === "SELECT" && pol[0].permissive === "PERMISSIVE" && pol[0].roles === "{authenticated}",
  "still ONE permissive SELECT policy for authenticated, no write policy", JSON.stringify(pol));

// A write is still refused for every client role (writes are RPCs).
await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${ADMIN}', false);`);
let wrote = true;
try {
  await db.exec(`UPDATE public.job_continue_days SET status = 'closed'`);
} catch {
  wrote = false;
}
await db.exec("RESET ROLE;");
ok(!wrote, "an admin still cannot write from the client");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
