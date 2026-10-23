#!/usr/bin/env node
/**
 * PGlite proof for 20261023201657_payout_setup_switch (payout setup pause,
 * owner ruling by pop-up 2026-10-23).
 *
 *   node src/test/pglite/payoutSetupSwitch.pglite.mjs                 # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/payoutSetupSwitch.pglite.mjs   # RED (no switch row)
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/payoutSetupSwitch.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Applies the REAL hidden-switch registry (20261012031120) on prod-shaped stubs,
 * then the new migration 3x (replay-safe), and proves:
 *   - `payout_setup` exists and is OFF (= paused) after the migration;
 *   - paused for EVERY caller: an ordinary member, a test account and an admin
 *     (feature_enabled_for and feature_enabled_for_user both false);
 *   - only an admin can change it (admin_set_feature_switch refuses an ordinary
 *     member, not_authorized 42501; no client role can write the table), and an
 *     admin's change is audited (one admin_audit_log row {from,to});
 *   - an admin setting Everyone turns setup back on for an ordinary member;
 *   - a replay of the migration keeps the audience the admin chose;
 *   - an ordinary member cannot read feature_enabled_for_user (service role only).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const url = (p) => new URL(`../../../supabase/migrations/${p}`, import.meta.url).pathname;
const REGISTRY = readFileSync(url("20261012031120_hidden_feature_switches.sql"), "utf8");
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? url("20261023201657_payout_setup_switch.sql"), "utf8");

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
const TESTER = "00000000-0000-0000-0000-00000000000b";
const ORDINARY = "00000000-0000-0000-0000-00000000000c";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
               INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');`);
await db.exec(REGISTRY);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
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
  const r = await as("authenticated", uid, `SELECT public.feature_enabled_for('payout_setup') AS v`);
  return Array.isArray(r) ? r[0].v : r;
};
const enabledForUser = async (uid) => (await db.query(`SELECT public.feature_enabled_for_user('payout_setup', '${uid}') AS v`)).rows[0].v;
const audience = async () => (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'payout_setup'`)).rows[0]?.audience;

ok((await audience()) === "off", "payout_setup exists and is created OFF (paused), after 3 applies");
for (const [who, uid] of [["ordinary member", ORDINARY], ["test account", TESTER], ["admin", ADMIN]]) {
  ok((await enabledFor(uid)) === false, `paused for the ${who} (feature_enabled_for)`);
  ok((await enabledForUser(uid)) === false, `paused for the ${who} (feature_enabled_for_user, what stripe-connect asks)`);
}

// Only an admin flips it.
const byOrdinary = await as("authenticated", ORDINARY, `SELECT public.admin_set_feature_switch('payout_setup', 'everyone')`);
ok(!Array.isArray(byOrdinary) && /not_authorized/.test(byOrdinary.error) && byOrdinary.code === "42501", "an ordinary member cannot turn it on (not_authorized 42501)");
const tableWrite = await as("authenticated", ORDINARY, `UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'payout_setup'`);
ok(!Array.isArray(tableWrite) && /permission denied/.test(tableWrite.error), "no client write to feature_switches (permission denied)");
const readUser = await as("authenticated", ORDINARY, `SELECT public.feature_enabled_for_user('payout_setup', '${ORDINARY}')`);
ok(!Array.isArray(readUser) && /permission denied/.test(readUser.error), "an ordinary member cannot call feature_enabled_for_user");
ok((await audience()) === "off", "still OFF after the refused attempts");

const byAdmin = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('payout_setup', 'everyone') AS v`);
ok(Array.isArray(byAdmin) && byAdmin[0].v === "everyone", "an admin can set it to Everyone");
const audit = (await db.query(`SELECT details FROM public.admin_audit_log WHERE action = 'set_feature_switch' AND target_id = 'payout_setup'`)).rows;
ok(audit.length === 1 && audit[0].details.from === "off" && audit[0].details.to === "everyone", "the admin's flip writes one audit row {from: off, to: everyone}");
ok((await enabledFor(ORDINARY)) === true && (await enabledForUser(ORDINARY)) === true, "with Everyone, setup is back for an ordinary member");

await db.exec(MIGRATION);
ok((await audience()) === "everyone", "a replay of the migration keeps the audience the admin chose");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
