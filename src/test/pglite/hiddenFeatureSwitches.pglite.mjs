#!/usr/bin/env node
/**
 * PGlite proof for 20261012031120_hidden_feature_switches (hidden feature
 * switches, owner decision 2026-10-11).
 *
 *   node src/test/pglite/hiddenFeatureSwitches.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/hiddenFeatureSwitches.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/hiddenFeatureSwitches.pglite.mjs
 *
 * Measured 2026-10-12: 49 PASS on the migration; NEW_MIGRATION=skip 48 FAIL;
 * planted defects each caught: testers/off branch `ELSE true` (6 FAIL), anon
 * left out of feature_enabled_for's REVOKE (4), the RPC's no-double-audit
 * marker removed (3), the audit trigger moved off UPDATE (2), authenticated
 * granted feature_enabled_for_user (1).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: auth.uid() from request.jwt.claim.sub, app_role,
 * user_roles + has_role (prod body), test_accounts, admin_audit_log.
 * Applies the migration 3x (replay-safe) and proves:
 *   - feature_enabled_for: off -> false for everyone; testers -> admin and
 *     test account true, ordinary false, signed-out false; everyone -> any
 *     signed-in true, signed-out false; missing key -> false; an unknown
 *     audience smuggled past the CHECK -> false;
 *   - require_feature raises feature_disabled (42501) exactly when off;
 *   - every audience change is audited (trigger), a server-side one included;
 *   - admin_set_feature_switch: non-admin refused (not_authorized), invalid
 *     audience refused, unknown key refused (cannot create), a change writes
 *     ONE admin_audit_log row {from,to}, a no-op change writes none;
 *   - admin_list_feature_switches refuses a non-admin;
 *   - INSERT as 'everyone' refused by the trigger; a replay keeps an audience
 *     an admin chose (ON CONFLICT DO NOTHING);
 *   - grants (with prod's default ACL that grants anon EXECUTE): anon executes nothing; authenticated cannot execute
 *     feature_enabled_for_user; no client role has any table privilege.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ??
    new URL("../../../supabase/migrations/20261012031120_hidden_feature_switches.sql", import.meta.url).pathname,
  "utf8",
);

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

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
               INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');`);

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

/** Run `sql` as `role` with auth.uid() = uid (null = signed out). Returns rows or { error }. */
async function as(role, uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
    const r = await db.query(sql);
    return r.rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const enabled = async (role, uid, key) => {
  const r = await as(role, uid, `SELECT public.feature_enabled_for('${key}') AS v`);
  return Array.isArray(r) ? r[0].v : r;
};
const setAudience = (key, aud) => db.exec(`UPDATE public.feature_switches SET audience = '${aud}' WHERE key = '${key}'`).catch(() => {});

// --- the canary as created
const canary = await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'switch_canary'`).catch(() => ({ rows: [] }));
ok(canary.rows[0]?.audience === "testers", "switch_canary is created as testers");

// --- decision matrix
for (const [aud, admin, tester, ordinary] of [
  ["off", false, false, false],
  ["testers", true, true, false],
  ["everyone", true, true, true],
]) {
  await setAudience("switch_canary", aud);
  ok((await enabled("authenticated", ADMIN, "switch_canary")) === admin, `${aud}: admin -> ${admin}`);
  ok((await enabled("authenticated", TESTER, "switch_canary")) === tester, `${aud}: test account -> ${tester}`);
  ok((await enabled("authenticated", ORDINARY, "switch_canary")) === ordinary, `${aud}: ordinary account -> ${ordinary}`);
  ok((await enabled("authenticated", null, "switch_canary")) === false, `${aud}: signed out (authenticated role, no uid) -> false`);
  const anon = await as("anon", null, `SELECT public.feature_enabled_for('switch_canary') AS v`);
  ok(!Array.isArray(anon) && /permission denied/.test(anon.error), `${aud}: anon cannot execute feature_enabled_for`);
  const req = await as("authenticated", ORDINARY, `SELECT public.require_feature('switch_canary')`);
  ok(ordinary ? Array.isArray(req) : !Array.isArray(req) && /feature_disabled/.test(req.error) && req.code === "42501",
    `${aud}: require_feature for ordinary ${ordinary ? "passes" : "raises feature_disabled 42501"}`);
}
ok((await enabled("authenticated", ADMIN, "no_such_switch")) === false, "missing key -> false (even for an admin)");
const reqMissing = await as("authenticated", ADMIN, `SELECT public.require_feature('no_such_switch')`);
ok(!Array.isArray(reqMissing) && /feature_disabled/.test(reqMissing.error), "require_feature on a missing key raises");

// unknown audience: drop the CHECK and smuggle one in
await db.exec(`ALTER TABLE public.feature_switches DROP CONSTRAINT IF EXISTS feature_switches_audience_check;
               UPDATE public.feature_switches SET audience = 'beta' WHERE key = 'switch_canary';`).catch(() => {});
ok((await enabled("authenticated", ADMIN, "switch_canary")) === false, "unknown audience -> false (fail closed)");
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'switch_canary';
               ALTER TABLE public.feature_switches ADD CONSTRAINT feature_switches_audience_check CHECK (audience IN ('off','testers','everyone'));`).catch(() => {});

// --- admin_set_feature_switch
const auditCount = async () => (await db.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'set_feature_switch'`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
// The matrix above changed audiences directly (a server context): audited.
ok((await auditCount()) >= 5, "direct (server-context) audience changes in the matrix were audited");
await db.exec(`DELETE FROM public.admin_audit_log`);
const r1 = await as("authenticated", ORDINARY, `SELECT public.admin_set_feature_switch('switch_canary', 'everyone')`);
ok(!Array.isArray(r1) && /not_authorized/.test(r1.error), "non-admin cannot set a switch");
const r1b = await as("authenticated", TESTER, `SELECT public.admin_set_feature_switch('switch_canary', 'everyone')`);
ok(!Array.isArray(r1b) && /not_authorized/.test(r1b.error), "test account (non-admin) cannot set a switch");
const r2 = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('switch_canary', 'beta')`);
ok(!Array.isArray(r2) && /invalid_audience/.test(r2.error), "invalid audience refused");
const r3 = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('brand_new', 'testers')`);
ok(!Array.isArray(r3) && /unknown_switch/.test(r3.error), "unknown key refused (an admin cannot create a switch)");
ok((await auditCount()) === 0, "refused calls wrote no audit row");
const r4 = await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('switch_canary', 'off') AS v`);
ok(Array.isArray(r4) && r4[0].v === "off", "admin sets testers -> off");
ok((await auditCount()) === 1, "one audit row for the change");
const row = (await db.query(`SELECT admin_id, target_type, target_id, details FROM public.admin_audit_log WHERE action = 'set_feature_switch'`).catch(() => ({ rows: [] }))).rows[0];
ok(row?.admin_id === ADMIN && row?.target_type === "feature_switch" && row?.target_id === "switch_canary"
  && row?.details?.from === "testers" && row?.details?.to === "off", "audit row names admin, switch, from and to");
await as("authenticated", ADMIN, `SELECT public.admin_set_feature_switch('switch_canary', 'off')`);
ok((await auditCount()) === 1, "a no-op set writes no audit row");
// A server-side change (service_role / a migration) is audited too, with no admin id.
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'switch_canary'`).catch(() => {});
const srv = (await db.query(`SELECT admin_id, details FROM public.admin_audit_log WHERE action = 'set_feature_switch' ORDER BY created_at DESC, id LIMIT 5`).catch(() => ({ rows: [] }))).rows;
ok((await auditCount()) === 2 && srv.some((r) => r.admin_id === null && r.details?.to === "everyone"), "a server-side UPDATE to everyone is audited too (admin_id null)");
await db.exec(`UPDATE public.feature_switches SET audience = 'off' WHERE key = 'switch_canary'`).catch(() => {});
// --- admin_list_feature_switches
const l1 = await as("authenticated", ORDINARY, `SELECT * FROM public.admin_list_feature_switches()`);
ok(!Array.isArray(l1) && /not_authorized/.test(l1.error), "non-admin cannot list switches");
const l2 = await as("authenticated", ADMIN, `SELECT * FROM public.admin_list_feature_switches()`);
ok(Array.isArray(l2) && l2.length === 1 && l2[0].key === "switch_canary", "admin lists the registry");

// --- creation never 'everyone'; replay keeps the chosen audience
const ins = await db.query(`INSERT INTO public.feature_switches (key, audience, description) VALUES ('born_on', 'everyone', 'x')`).then(() => null, (e) => String(e.message));
ok(/switch_created_on/.test(ins ?? ""), "INSERT as everyone refused by the trigger");
if (process.env.NEW_MIGRATION !== "skip") await db.exec(MIGRATION);
const after = (await db.query(`SELECT audience FROM public.feature_switches WHERE key = 'switch_canary'`).catch(() => ({ rows: [] }))).rows[0];
ok(after?.audience === "off", "a replay keeps the audience an admin chose");

// --- direct table access by clients
for (const role of ["anon", "authenticated"]) {
  const t = await as(role, ORDINARY, `SELECT * FROM public.feature_switches`);
  ok(!Array.isArray(t) && /permission denied/.test(t.error), `${role} cannot read the table`);
  const w = await as(role, ADMIN, `UPDATE public.feature_switches SET audience = 'everyone'`);
  ok(!Array.isArray(w) && /permission denied/.test(w.error), `${role} cannot write the table (even as an admin uid)`);
}
const priv = async (role, fn) => (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS v`).catch(() => ({ rows: [{ v: null }] }))).rows[0].v;
for (const fn of ["public.feature_enabled_for(text)", "public.feature_enabled_for_user(text,uuid)", "public.require_feature(text)",
  "public.admin_list_feature_switches()", "public.admin_set_feature_switch(text,text)"]) {
  ok((await priv("anon", fn)) === false, `anon cannot execute ${fn}`);
}
ok((await priv("authenticated", "public.feature_enabled_for_user(text,uuid)")) === false, "authenticated cannot execute feature_enabled_for_user (no tester lookup by id)");
ok((await priv("service_role", "public.feature_enabled_for_user(text,uuid)")) === true, "service_role executes feature_enabled_for_user");
const svc = await as("service_role", null, `SELECT public.feature_enabled_for_user('switch_canary', '${ADMIN}') AS v`);
await setAudience("switch_canary", "testers");
const svc2 = await as("service_role", null, `SELECT public.feature_enabled_for_user('switch_canary', '${TESTER}') AS v, public.feature_enabled_for_user('switch_canary', '${ORDINARY}') AS o`);
ok(Array.isArray(svc) && svc[0].v === false && Array.isArray(svc2) && svc2[0].v === true && svc2[0].o === false,
  "feature_enabled_for_user (service_role): off -> false; testers -> tester true, ordinary false");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
