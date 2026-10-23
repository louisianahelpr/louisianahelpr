#!/usr/bin/env node
/**
 * PGlite proof for 20261023165006_remove_jobs_poster_fee_switch (owner
 * 2026-10-23, #3556: the jobs poster-fee model is removed from the app).
 *
 *   node src/test/pglite/removeJobsPosterFeeSwitch.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/removeJobsPosterFeeSwitch.pglite.mjs   # RED
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Builds the registry from the real migrations that made it
 * (20261012031120_hidden_feature_switches, which also creates switch_canary,
 * and 20261017234656_jobs_poster_fee_switch), with the prod-shaped stubs
 * hiddenFeatureSwitches.pglite.mjs uses, then applies the new migration 3x
 * (replay-safe) and proves:
 *   - the jobs_poster_fee row is gone, every other switch is untouched;
 *   - a shipped build that still asks for it reads OFF: feature_enabled_for
 *     (the app's useFeature) and feature_enabled_for_user (an older
 *     create-payment) both answer false, for an admin too;
 *   - the delete writes no admin_audit_log row (the audit trigger is
 *     UPDATE-only, and nothing changed an audience).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const REGISTRY = mig("20261012031120_hidden_feature_switches.sql");
const SWITCH = mig("20261017234656_jobs_poster_fee_switch.sql");
const MIGRATION = mig("20261023165006_remove_jobs_poster_fee_switch.sql");

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
`;

const ADMIN = "00000000-0000-0000-0000-00000000000a";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);
await db.exec(REGISTRY);
await db.exec(SWITCH);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const before = await db.query(`SELECT key, audience FROM public.feature_switches ORDER BY key`);
ok(before.rows.some((r) => r.key === "jobs_poster_fee" && r.audience === "off"), "setup: jobs_poster_fee exists, off (as on prod 2026-10-23)");
const auditsBefore = Number((await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log`)).rows[0].n);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

const after = await db.query(`SELECT key, audience FROM public.feature_switches ORDER BY key`);
ok(!after.rows.some((r) => r.key === "jobs_poster_fee"), "the jobs_poster_fee row is gone");
const others = (rows) => JSON.stringify(rows.filter((r) => r.key !== "jobs_poster_fee"));
ok(others(after.rows) === others(before.rows) && after.rows.length === before.rows.length - 1,
  "every other switch is untouched (key and audience)");

await db.exec(`SET request.jwt.claim.sub = '${ADMIN}'; SET ROLE authenticated;`);
const forMe = (await db.query(`SELECT public.feature_enabled_for('jobs_poster_fee') AS v`)).rows[0].v;
await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
ok(forMe === false, "feature_enabled_for('jobs_poster_fee') reads false for an admin (a shipped build's useFeature)");
const forUser = (await db.query(`SELECT public.feature_enabled_for_user('jobs_poster_fee', '${ADMIN}') AS v`)).rows[0].v;
ok(forUser === false, "feature_enabled_for_user('jobs_poster_fee', admin) reads false (an older create-payment)");

const auditsAfter = Number((await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log`)).rows[0].n);
ok(auditsAfter === auditsBefore, "the delete writes no audit row");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
