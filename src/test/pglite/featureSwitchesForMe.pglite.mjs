#!/usr/bin/env node
/**
 * PGlite proof for 20261019043416_feature_switches_for_me (nightly-red
 * #2601: useFeature asked feature_enabled_for once per switch per cold load).
 *
 *   node src/test/pglite/featureSwitchesForMe.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/featureSwitchesForMe.pglite.mjs   # RED
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/featureSwitchesForMe.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs as in hiddenFeatureSwitches.pglite.mjs (auth.uid() from
 * request.jwt.claim.sub, user_roles + has_role, test_accounts,
 * admin_audit_log, prod's default ACL granting anon EXECUTE). Applies the
 * switch registry migration (20261012031120), then the batch migration 3x
 * (replay-safe), and proves:
 *   - per key, feature_switches_for_me(keys)->>key == feature_enabled_for(key)
 *     for every audience x caller (admin, test account, ordinary, signed out);
 *   - a missing key answers false; a null array answers {}; a null key is
 *     skipped; a repeated key appears once;
 *   - more than 64 keys raises too_many_keys (22023);
 *   - SECURITY INVOKER; anon cannot execute it; authenticated can (the
 *     migration GRANTs authenticated only). service_role still executes it
 *     through prod's default ACL (as every public function), and with no
 *     auth.uid() it reads all off.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url).pathname, "utf8");
const REGISTRY = mig("20261012031120_hidden_feature_switches.sql");
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : mig("20261019043416_feature_switches_for_me.sql");

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
await db.exec(REGISTRY);
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ORDINARY}', 'helper');
               INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}');
               INSERT INTO public.feature_switches (key, audience, description)
               VALUES ('sw_off', 'off', 'x'), ('sw_testers', 'testers', 'x'), ('sw_everyone', 'testers', 'x')
               ON CONFLICT (key) DO NOTHING;
               UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'sw_everyone';`);

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
    const r = await db.query(sql);
    return r.rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const batch = async (role, uid, arrSql) => {
  const r = await as(role, uid, `SELECT public.feature_switches_for_me(${arrSql}) AS v`);
  return Array.isArray(r) ? r[0].v : r;
};

// --- per key, the batch answers exactly what feature_enabled_for answers
const KEYS = ["switch_canary", "sw_off", "sw_testers", "sw_everyone", "no_such_switch"];
const ARR = `ARRAY[${KEYS.map((k) => `'${k}'`).join(",")}]::text[]`;
for (const [who, uid] of [["admin", ADMIN], ["test account", TESTER], ["ordinary", ORDINARY], ["signed out", null]]) {
  const got = await batch("authenticated", uid, ARR);
  let same = got && typeof got === "object" && !got.error;
  const detail = [];
  for (const k of KEYS) {
    const one = await as("authenticated", uid, `SELECT public.feature_enabled_for('${k}') AS v`);
    const want = Array.isArray(one) ? one[0].v : null;
    if (!same || got[k] !== want) { same = false; detail.push(`${k}: batch ${got?.[k]} vs single ${want}`); }
  }
  ok(same && Object.keys(got).length === KEYS.length, `${who}: batch == feature_enabled_for for every key ${detail.join("; ")}`);
}
const ord = await batch("authenticated", ORDINARY, ARR);
ok(ord?.sw_everyone === true && ord?.sw_testers === false && ord?.sw_off === false && ord?.no_such_switch === false,
  "ordinary: everyone on, testers off, off off, missing key false");
const tst = await batch("authenticated", TESTER, ARR);
ok(tst?.sw_testers === true && tst?.switch_canary === true && tst?.sw_off === false, "test account: testers switches on, off stays off");
const out = await batch("authenticated", null, ARR);
ok(out && !out.error && Object.values(out).every((v) => v === false), "signed out: every key false");

// --- edge inputs
const nul = await batch("authenticated", ADMIN, "NULL::text[]");
ok(nul && !nul.error && Object.keys(nul).length === 0, "null array -> {}");
const empty = await batch("authenticated", ADMIN, "ARRAY[]::text[]");
ok(empty && !empty.error && Object.keys(empty).length === 0, "empty array -> {}");
const withNull = await batch("authenticated", ADMIN, "ARRAY['sw_testers', NULL, 'sw_testers']::text[]");
ok(withNull && !withNull.error && Object.keys(withNull).length === 1 && withNull.sw_testers === true, "null key skipped, repeated key answered once");
const big = await as("authenticated", ADMIN, `SELECT public.feature_switches_for_me(array_fill('sw_off'::text, ARRAY[65])) AS v`);
ok(!Array.isArray(big) && /too_many_keys/.test(big.error) && big.code === "22023", "65 keys -> too_many_keys 22023");
const cap = await batch("authenticated", ADMIN, "array_fill('sw_off'::text, ARRAY[64])");
ok(cap && !cap.error && cap.sw_off === false, "64 keys is allowed");

// --- privilege
const fn = "public.feature_switches_for_me(text[])";
const priv = async (role) => (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS v`).catch(() => ({ rows: [{ v: null }] }))).rows[0].v;
ok((await priv("anon")) === false, "anon cannot execute feature_switches_for_me");
ok((await priv("authenticated")) === true, "authenticated executes feature_switches_for_me");
ok((await priv("service_role")) === true, "service_role executes feature_switches_for_me (default ACL; the migration grants authenticated only)");
const anon = await as("anon", null, `SELECT public.feature_switches_for_me(ARRAY['sw_everyone']) AS v`);
ok(!Array.isArray(anon) && /permission denied/.test(anon.error), "anon call is refused");
const definer = (await db.query(`SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('${fn}')`).catch(() => ({ rows: [] }))).rows[0];
ok(definer?.prosecdef === false, "SECURITY INVOKER (adds no privilege of its own)");
const svc = await batch("service_role", null, "ARRAY['sw_everyone', 'switch_canary']::text[]");
ok(svc && !svc.error && svc.sw_everyone === false && svc.switch_canary === false, "service_role (no auth.uid()) reads every key off");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
