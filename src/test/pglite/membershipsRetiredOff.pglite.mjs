#!/usr/bin/env node
/**
 * PGlite proof for 20261104143451_memberships_retired_off (owner 2026-11-04:
 * no membership features anymore; Builder 114).
 *
 *   node src/test/pglite/membershipsRetiredOff.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/membershipsRetiredOff.pglite.mjs   # RED
 *
 * Applies, in order: 20261012031120 (switch machinery), 20261015033658 (memberships
 * created at testers), 20261028151647 (per-member switch lists), 20261101154236
 * (newest feature_enabled_for_user), then the retire migration 3x (replay-safe).
 * Proves: the switch is 'off'; feature_enabled_for_user('memberships', ...) is
 * false for an admin, a test account, a listed member and an ordinary member
 * (so every SQL/edge paid-tier branch that reads it is unreachable); before
 * the retire migration the ordinary member was ALREADY false (no change for a
 * real member) while the admin and tester were true; one audit row
 * {from: testers, to: off}, none from the replays; the switch row still exists
 * (server-only key until the follow-up deletes the reads).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
-- Prod's default ACL: functions created in public are executable by anon
-- (authz review note 5), so a REVOKE that forgets anon is caught here.
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
const LISTED = "00000000-0000-0000-0000-00000000000d";

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);`);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
               INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');`);
await db.exec(mig("20261012031120_hidden_feature_switches.sql"));
await db.exec(mig("20261015033658_memberships_switch_off.sql"));
await db.exec(mig("20261028151647_feature_switch_members.sql"));
await db.exec(mig("20261101154236_store_reviewer_sees_member_switches.sql"));
await db.exec(`INSERT INTO auth.users (id) VALUES ('${LISTED}'); INSERT INTO public.feature_switch_members (key, user_id) VALUES ('memberships', '${LISTED}')`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const on = async (uid) => (await db.query(`SELECT public.feature_enabled_for_user('memberships', '${uid}') AS v`)).rows[0].v;

// Before: what a real member had (off) and what testers had (on).
ok((await on(ORDINARY)) === false, "before: an ordinary (real) member already has memberships off");
ok((await on(ADMIN)) === true && (await on(TESTER)) === true && (await on(LISTED)) === true, "before: admin, tester and listed member had it on");
await db.exec(`DELETE FROM public.admin_audit_log`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig("20261104143451_memberships_retired_off.sql"));
}

const row = (await db.query(`SELECT audience, description FROM public.feature_switches WHERE key = 'memberships'`)).rows[0];
ok(row?.audience === "off", `the memberships switch is off (got ${row?.audience})`);
ok(/RETIRED/.test(row?.description ?? ""), "its description says it is retired");
for (const [name, uid] of [["admin", ADMIN], ["test account", TESTER], ["listed member", LISTED], ["ordinary member", ORDINARY]]) {
  ok((await on(uid)) === false, `after: memberships is off for the ${name}`);
}
ok((await db.query(`SELECT public.feature_enabled_for_user('memberships', NULL) AS v`)).rows[0].v === false, "after: off for a null user");
const audits = (await db.query(`SELECT details FROM public.admin_audit_log WHERE target_id = 'memberships'`)).rows;
ok(audits.length === 1 && audits[0].details.from === "testers" && audits[0].details.to === "off", `one audit row testers -> off, replays add none (got ${audits.length})`);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
