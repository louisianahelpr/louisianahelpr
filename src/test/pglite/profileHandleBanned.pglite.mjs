#!/usr/bin/env node
/**
 * PGlite proof for the Q281 ban-gate exemptions of rpc_ensure_my_handle and rpc_set_my_handle
 * (scripts/ci/ban-gate-coverage.sql, lead 2026-11-01): neither RPC calls is_caller_banned() itself, because the
 * profiles UPDATE each one makes is refused for a banned caller by enforce_banned_profile_text_lock (handle is not
 * on its allowed list, and auth.uid() is still the caller inside SECURITY DEFINER).
 *
 *   npx tsx src/test/pglite/profileHandleBanned.pglite.mjs [--before]
 *
 * The REAL newest is_server_context, is_caller_banned and enforce_banned_profile_text_lock, read from the migrations,
 * on a prod-shaped profiles table. --before leaves out the ban-lock trigger and every check must FAIL.
 *
 *   B1 a banned member asking for a default handle is refused (account_restricted) and gets none
 *   B2 a banned member picking a handle is refused (account_restricted); the row keeps no handle
 *   B3 a temp-banned member (suspension running) is refused the same way
 *   B4 the same calls by a member in good standing work (the refusal is the ban, not the RPC)
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261101034834_profile_handle.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

// The newest real definition of a function (any dollar-quote tag), from the migrations before this one.
const realFn = (name) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS)
    .filter((f) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).test(readFileSync(DIR + f, "utf8"))).sort().at(-1);
  const t = readFileSync(DIR + file, "utf8");
  const start = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = t.indexOf(tag, start) + tag.length;
  return t.slice(start, t.indexOf(tag, bodyStart) + tag.length) + ";";
};

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BAN1 = U(1), BAN2 = U(2), TEMP = U(3), GOOD = U(4);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
INSERT INTO auth.users (id) VALUES ('${BAN1}'), ('${BAN2}'), ('${TEMP}'), ('${GOOD}');
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text, bio text, ban_status text, auto_suspended_until timestamptz, under_13_blocked_at timestamptz, updated_at timestamptz,
  terms_version_accepted text, terms_accepted_at timestamptz, accepted_terms_at timestamptz, marketing_consent boolean,
  senior_mode boolean, available_until timestamptz, share_job_photos boolean);
-- has_role stand-in: nobody here is an admin (the lock's admin bypass is not under test).
CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
${realFn("is_server_context")}
${realFn("is_caller_banned")}
${realFn("enforce_banned_profile_text_lock")}
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
INSERT INTO public.profiles (user_id, full_name, ban_status, auto_suspended_until) VALUES
  ('${BAN1}', 'Bea Banned', 'banned', NULL), ('${BAN2}', 'Bo Banned', 'permanently_banned', NULL),
  ('${TEMP}', 'Tia Temp', 'temp_banned', now() + interval '3 day'), ('${GOOD}', 'Gus Good', NULL, NULL);
`);
if (!BEFORE) {
  await db.exec(`CREATE TRIGGER enforce_banned_profile_text_lock BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.enforce_banned_profile_text_lock();`);
} else {
  console.log("--before: enforce_banned_profile_text_lock NOT attached (every check must FAIL)");
}
await db.exec(MIGRATION);
console.log(`applied ${THIS}`);

const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false); SET ROLE authenticated;`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const call = async (uid, sql) => {
  await as(uid);
  try {
    return { v: (await db.query(sql)).rows[0]?.v };
  } catch (e) {
    return { error: e.message };
  } finally {
    await server();
  }
};
const ensure = (uid) => call(uid, `SELECT public.rpc_ensure_my_handle() AS v`);
const set = (uid, h) => call(uid, `SELECT public.rpc_set_my_handle('${h}') AS v`);
const handleOf = async (uid) => (await db.query(`SELECT handle FROM public.profiles WHERE user_id = '${uid}'`)).rows[0]?.handle ?? null;

const b1 = await ensure(BAN1);
check("B1 a banned member's default handle is refused (account_restricted) and none is set",
  /account_restricted/.test(b1.error ?? "") && (await handleOf(BAN1)) === null, JSON.stringify([b1, await handleOf(BAN1)]));
const b2 = await set(BAN2, "bo-picks");
check("B2 a banned member's picked handle is refused (account_restricted); the row keeps no handle",
  /account_restricted/.test(b2.error ?? "") && (await handleOf(BAN2)) === null, JSON.stringify([b2, await handleOf(BAN2)]));
const t1 = await ensure(TEMP);
const t2 = await set(TEMP, "tia-picks");
check("B3 a temp-banned member (suspension running) is refused both ways",
  /account_restricted/.test(t1.error ?? "") && /account_restricted/.test(t2.error ?? "") && (await handleOf(TEMP)) === null,
  JSON.stringify([t1, t2]));
const g1 = await ensure(GOOD);
const g2 = await set(GOOD, "gus-hauls");
// B4 holds in both modes, so --before leaves it out of the red count: it proves the refusals above are the ban.
const good = g1.v === "gus-g" && g2.v === "gus-hauls" && (await handleOf(GOOD)) === "gus-hauls";
console.log(`${good ? "PASS" : "FAIL"}  B4 a member in good standing gets and picks a handle  (${JSON.stringify([g1, g2])})`);
if (!good) failures += BEFORE ? 100 : 1;

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  console.log(failures === checks ? `RED as expected (${failures}/${checks})` : `NOT RED: ${failures}/${checks} failed`);
  process.exit(failures === checks ? 0 : 1);
}
process.exit(failures ? 1 : 0);
