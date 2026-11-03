#!/usr/bin/env node
/**
 * PGlite proof for 20261103212413_ai_support_answers_switch + 20261103214000_ai_support_answers_on_for_everyone
 * (AI help on support requests, owner 2026-11-03; on for everyone per the owner's 2026-10-25 rule via the lead).
 *
 *   node src/test/pglite/aiSupportAnswersSwitch.pglite.mjs                       # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/aiSupportAnswersSwitch.pglite.mjs    # RED (no switch row)
 *
 * Applies the REAL hidden-switch registry (20261012031120) on prod-shaped stubs (same stubs as
 * payoutSetupSwitch.pglite.mjs), then both migrations 3x in order, and proves: the switch is ON for an ordinary
 * member (feature_enabled_for and feature_enabled_for_user, what support-ai-answer asks); the go-live wrote one
 * audit row; an ordinary member cannot change it; an admin turning it OFF turns it off for everyone and a replay of
 * both migrations keeps the admin's choice.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const REGISTRY = readFileSync(url("20261012031120_hidden_feature_switches.sql"), "utf8");
const CREATE = readFileSync(url("20261103212413_ai_support_answers_switch.sql"), "utf8");
const GO_LIVE = readFileSync(url("20261103214000_ai_support_answers_on_for_everyone.sql"), "utf8");

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
const ORDINARY = "00000000-0000-0000-0000-00000000000c";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');`);
await db.exec(REGISTRY);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) {
    await db.exec(CREATE);
    await db.exec(GO_LIVE);
  }
}

async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const enabledFor = async (uid) => {
  const r = await as("authenticated", uid, `SELECT public.feature_enabled_for('ai_support_answers') AS v`);
  return Array.isArray(r) ? r[0].v : r;
};
const enabledForUser = async (uid) => (await db.query(`SELECT public.feature_enabled_for_user('ai_support_answers', '${uid}') AS v`)).rows[0].v;
const audience = async () => (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'ai_support_answers'`)).rows[0]?.audience;
const audits = async () => (await db.query(`SELECT details FROM public.admin_audit_log WHERE action = 'set_feature_switch' AND target_id = 'ai_support_answers'`)).rows;

ok((await audience()) === "everyone", "ai_support_answers is on for everyone after 3 applies of both migrations");
ok((await enabledFor(ORDINARY)) === true && (await enabledForUser(ORDINARY)) === true, "on for an ordinary member (both readers)");
const a1 = await audits();
ok(a1.length === 1 && a1[0].details.to === "everyone", "the go-live wrote exactly one audit row (replays wrote none)");

const byOrdinary = await as("authenticated", ORDINARY, `SELECT public.admin_set_feature_switch('ai_support_answers', 'off')`);
ok(!Array.isArray(byOrdinary) && /not_authorized/.test(byOrdinary.error), "an ordinary member cannot turn it off (not_authorized)");

const off = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('ai_support_answers', 'off') AS v`);
ok(Array.isArray(off) && off[0].v === "off", "an admin can turn it off (the off button)");
ok((await enabledForUser(ORDINARY)) === false, "off means off for an ordinary member (support-ai-answer refuses)");
await db.exec(CREATE);
await db.exec(GO_LIVE);
ok((await audience()) === "off", "a replay of both migrations keeps the admin's choice");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
