#!/usr/bin/env node
/**
 * PGlite proof for 20261031213213_admin_own_job_status_not_an_override (NOID-23): an admin changing the status of her
 * OWN job (as its poster, or as its Helpr before or after the change) writes no job_status_override row; an admin
 * changing anyone else's job is logged exactly as before; a member or a service call is never logged.
 *
 *   node src/test/pglite/adminOwnJobStatusNotOverride.pglite.mjs                  # base, then the migration 3x
 *   NEW_MIGRATION=skip node src/test/pglite/adminOwnJobStatusNotOverride.pglite.mjs # RED: the old body logs own jobs
 *   MUTANT=<name> node src/test/pglite/adminOwnJobStatusNotOverride.pglite.mjs    # a planted defect: must FAIL
 *
 * Base: the old body cut from 20260504154605 (its newest CREATE) and run verbatim; auth.uid/has_role/admin_audit_log/
 * jobs are minimal stubs.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const BASE = readFileSync(MIG_DIR + "20260504154605_audit_admin_job_status_overrides.sql", "utf8");
let mig = readFileSync(MIG_DIR + "20261031213213_admin_own_job_status_not_an_override.sql", "utf8");
const MUTANTS = {
  // Every admin change skipped.
  skipall: ["IF auth.uid() = NEW.customer_id OR auth.uid() = NEW.helper_id OR auth.uid() = OLD.helper_id THEN", "IF true THEN"],
  // The Helpr side forgotten: an admin starting a job she was hired on is still an override.
  posteronly: ["IF auth.uid() = NEW.customer_id OR auth.uid() = NEW.helper_id OR auth.uid() = OLD.helper_id THEN", "IF auth.uid() = NEW.customer_id THEN"],
  // The grant not restated.
  nogrants: ["REVOKE ALL ON FUNCTION public.audit_admin_job_status_change() FROM PUBLIC, anon, authenticated;", ""],
};
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `11111111-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [ADMIN, MEMBER, OTHER] = [U(1), U(2), U(3)];

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u AND role = r) $f$;
  CREATE TABLE public.admin_audit_log (id serial PRIMARY KEY, admin_id uuid, action text, target_type text, target_id text, details jsonb);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, status text, title text, customer_id uuid, helper_id uuid, budget numeric, dispute_status text);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.jobs VALUES
    ('${U(10)}', 'open', 'Her own post', '${ADMIN}', NULL, 100, NULL),
    ('${U(11)}', 'accepted', 'Hired on it', '${OTHER}', '${ADMIN}', 50, NULL),
    ('${U(12)}', 'in_progress', 'Someone else''s', '${OTHER}', '${MEMBER}', 80, NULL),
    ('${U(13)}', 'accepted', 'She leaves it', '${OTHER}', '${ADMIN}', 40, NULL),
    ('${U(14)}', 'open', 'Member''s own', '${MEMBER}', NULL, 30, NULL);
`);
await db.exec(BASE);
if (!skip) for (let i = 0; i < 3; i++) await db.exec(mig);
const as = (u) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${u ?? ""}', false)`);
const logged = async (job) => Number((await db.query(`SELECT count(*)::int n FROM public.admin_audit_log WHERE action = 'job_status_override' AND target_id = '${job}'`)).rows[0].n);

await as(ADMIN);
await db.exec(`UPDATE public.jobs SET status = 'accepted', helper_id = '${MEMBER}' WHERE id = '${U(10)}'`);
check((await logged(U(10))) === 0, "the admin hiring on her own post: no override row");
await db.exec(`UPDATE public.jobs SET status = 'in_progress' WHERE id = '${U(11)}'`);
check((await logged(U(11))) === 0, "the admin starting a job she was hired on: no override row");
await db.exec(`UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = '${U(13)}'`);
check((await logged(U(13))) === 0, "the admin leaving a job she was hired on (helper cleared in the same change): no override row");
await db.exec(`UPDATE public.jobs SET status = 'completed' WHERE id = '${U(12)}'`);
check((await logged(U(12))) === 1, "the admin changing someone else's job: one override row, as before");
const row = (await db.query(`SELECT admin_id, details FROM public.admin_audit_log WHERE target_id = '${U(12)}'`)).rows[0];
check(row?.admin_id === ADMIN && row?.details?.from_status === "in_progress" && row?.details?.to_status === "completed", "the row names the admin and the change");
await as(MEMBER);
await db.exec(`UPDATE public.jobs SET status = 'cancelled' WHERE id = '${U(14)}'`);
check((await logged(U(14))) === 0, "a member is never logged");
await as(null);
await db.exec(`UPDATE public.jobs SET status = 'open' WHERE id = '${U(12)}'`);
check((await logged(U(12))) === 1, "a service call (no uid) is never logged");
const acl = (await db.query(`SELECT proacl::text a FROM pg_proc WHERE proname = 'audit_admin_job_status_change'`)).rows[0]?.a ?? "";
check(!!acl && !/(^|[{,])=/.test(acl) && !/anon=/.test(acl) && !/authenticated=/.test(acl), `not callable by PUBLIC/anon/authenticated (${acl})`);

console.log(failures ? `FAILED ${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
