#!/usr/bin/env node
/**
 * PGlite proof for Q2008 "Helprs near you" (20261104062747_helprs_near_you.sql).
 *
 *   npx tsx src/test/pglite/helprsNearYou.pglite.mjs [--skip]
 *
 * The migration verbatim (applied 3x for replay-safety) on a prod-shaped profiles table, with the REAL newest
 * are_users_blocked, member_display_name and display_name_for_viewer read from the migrations. --skip leaves the
 * migration's RPC out and installs a naive one (every member, no filters, parish returned): every privacy check FAILS.
 *
 *   N1 only members who opted in (show_near_you) are listed; the default is OFF
 *   N2 only the caller's parish (case/space-insensitive); another parish never appears
 *   N3 the caller never lists themself
 *   N4 a block in EITHER direction hides the pair
 *   N5 banned, unverified and anonymized members are hidden
 *   N6 a test (is_seed) member is hidden while discovery hides test rows
 *   N7 the result has exactly user_id, full_name, avatar_url, active_now: no parish/location/zip/coordinates
 *   N8 the name is masked ("First L.")
 *   N9 active_now is true only while available_until is in the future, and active rows come first
 *   N10 a caller with no parish gets no rows
 *   N11 anon has no EXECUTE; authenticated does
 *   N12 a member can turn their own switch on (column grant) but not another member's (own-row policy)
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261104062747_helprs_near_you.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const SKIP = process.argv.includes("--skip");

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
const ME = U(1), OPTED = U(2), OFF = U(3), OTHER_PARISH = U(4), BLOCKED_BY_ME = U(5), BLOCKS_ME = U(6),
  BANNED = U(7), UNVERIFIED = U(8), ANON_ROW = U(9), SEED = U(10), ACTIVE = U(11), NOPARISH = U(12), CASEY = U(13);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('test.seed_hidden', true), 'on') = 'on' $$;
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  full_name text, avatar_url text, parish text, location text, zip_code text,
  latitude numeric, longitude numeric,
  email_verified boolean NOT NULL DEFAULT true,
  ban_status text, anonymized_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
  available_until timestamptz
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_select ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY own_update ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
`);
for (const fn of ["member_display_name", "display_name_for_viewer", "are_users_blocked"]) await db.exec(realFn(fn));
await db.exec(`GRANT EXECUTE ON FUNCTION public.display_name_for_viewer(text, uuid) TO authenticated;`);

if (SKIP) {
  const naive = MIGRATION.replace(/CREATE OR REPLACE FUNCTION public\.get_helprs_near_me[\s\S]*?\$function\$;/, `
CREATE OR REPLACE FUNCTION public.get_helprs_near_me()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, active_now boolean, parish text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.full_name, p.avatar_url, false, p.parish FROM public.profiles p ORDER BY p.user_id
$function$;`).replace(/REVOKE ALL ON FUNCTION public\.get_helprs_near_me\(\) FROM PUBLIC, anon;/, "GRANT EXECUTE ON FUNCTION public.get_helprs_near_me() TO anon;");
  for (let i = 0; i < 3; i++) await db.exec(naive);
} else {
  for (let i = 0; i < 3; i++) await db.exec(MIGRATION);
}

await db.exec(`
INSERT INTO public.profiles (user_id, full_name, parish, show_near_you, ban_status, email_verified, anonymized_at, is_seed, available_until, zip_code, latitude, longitude) VALUES
 ('${ME}', 'Me Myself', 'East Baton Rouge', true, NULL, true, NULL, false, NULL, '70801', 30.4, -91.1),
 ('${OPTED}', 'Opal Tester Smith', 'East Baton Rouge', true, NULL, true, NULL, false, now() - interval '1 hour', '70802', 30.41, -91.12),
 ('${OFF}', 'Off Person', 'East Baton Rouge', false, NULL, true, NULL, false, NULL, NULL, NULL, NULL),
 ('${OTHER_PARISH}', 'Far Away', 'Orleans', true, NULL, true, NULL, false, NULL, NULL, NULL, NULL),
 ('${BLOCKED_BY_ME}', 'Blocked One', 'East Baton Rouge', true, NULL, true, NULL, false, NULL, NULL, NULL, NULL),
 ('${BLOCKS_ME}', 'Blocker Two', 'East Baton Rouge', true, NULL, true, NULL, false, NULL, NULL, NULL, NULL),
 ('${BANNED}', 'Banned Person', 'East Baton Rouge', true, 'permanently_banned', true, NULL, false, NULL, NULL, NULL, NULL),
 ('${UNVERIFIED}', 'Unverified Person', 'East Baton Rouge', true, NULL, false, NULL, false, NULL, NULL, NULL, NULL),
 ('${ANON_ROW}', 'Gone Person', 'East Baton Rouge', true, NULL, true, now(), false, NULL, NULL, NULL, NULL),
 ('${SEED}', 'Seed Fixture', 'East Baton Rouge', true, NULL, true, NULL, true, NULL, NULL, NULL, NULL),
 ('${ACTIVE}', 'Active Andy', 'East Baton Rouge', true, NULL, true, NULL, false, now() + interval '2 hours', NULL, NULL, NULL),
 ('${NOPARISH}', 'No Parish', NULL, true, NULL, true, NULL, false, NULL, NULL, NULL, NULL),
 ('${CASEY}', 'Casey Case', '  east baton rouge ', true, NULL, true, NULL, false, NULL, NULL, NULL, NULL);
INSERT INTO public.user_blocks VALUES ('${ME}', '${BLOCKED_BY_ME}'), ('${BLOCKS_ME}', '${ME}');
`).catch(async (e) => {
  // --skip has no show_near_you column only if the migration did not run; it always runs, so rethrow.
  throw e;
});

const asUser = async (uid, sql, role = "authenticated") => {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  await db.exec(`SET ROLE ${role};`);
  try { return await db.query(sql); } finally { await db.exec("RESET ROLE;"); }
};

const rows = (await asUser(ME, "SELECT * FROM public.get_helprs_near_me()")).rows;
const ids = rows.map((r) => r.user_id);
const def = (await db.query(`SELECT column_default FROM information_schema.columns WHERE table_name='profiles' AND column_name='show_near_you'`)).rows[0];
check("N1 opted-in member listed; opted-out hidden; default OFF", ids.includes(OPTED) && !ids.includes(OFF) && def?.column_default === "false", `default=${def?.column_default}`);
check("N2 same parish only (case/space-insensitive)", !ids.includes(OTHER_PARISH) && ids.includes(CASEY) && !ids.includes(NOPARISH));
check("N3 caller never lists themself", !ids.includes(ME));
check("N4 block either direction hides", !ids.includes(BLOCKED_BY_ME) && !ids.includes(BLOCKS_ME));
check("N5 banned / unverified / anonymized hidden", !ids.includes(BANNED) && !ids.includes(UNVERIFIED) && !ids.includes(ANON_ROW));
check("N6 test member hidden while discovery hides test rows", !ids.includes(SEED));
const cols = (await asUser(ME, "SELECT * FROM public.get_helprs_near_me() LIMIT 0")).fields.map((f) => f.name).sort();
check("N7 only user_id, full_name, avatar_url, active_now", JSON.stringify(cols) === JSON.stringify(["active_now", "avatar_url", "full_name", "user_id"]), cols.join(","));
const opal = rows.find((r) => r.user_id === OPTED);
check("N8 name masked to First L.", opal?.full_name === "Opal S.", opal?.full_name);
const andy = rows.find((r) => r.user_id === ACTIVE);
check("N9 active_now only while available_until is future; active first", andy?.active_now === true && opal?.active_now === false && ids[0] === ACTIVE, ids.join(","));
const none = (await asUser(NOPARISH, "SELECT * FROM public.get_helprs_near_me()")).rows;
check("N10 caller with no parish gets no rows", none.length === 0, `rows=${none.length}`);
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.get_helprs_near_me()', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.get_helprs_near_me()', 'EXECUTE') AS auth`)).rows[0];
check("N11 anon no EXECUTE; authenticated yes", acl.anon === false && acl.auth === true, JSON.stringify(acl));
let ownOk = false;
let otherChanged = true;
try {
  await asUser(OFF, `UPDATE public.profiles SET show_near_you = true WHERE user_id = '${OFF}'`);
  ownOk = (await db.query(`SELECT show_near_you FROM public.profiles WHERE user_id='${OFF}'`)).rows[0].show_near_you === true;
  await asUser(OFF, `UPDATE public.profiles SET show_near_you = false WHERE user_id = '${OPTED}'`);
  otherChanged = (await db.query(`SELECT show_near_you FROM public.profiles WHERE user_id='${OPTED}'`)).rows[0].show_near_you === false;
} catch (e) {
  console.log("  N12 error:", e.message);
}
check("N12 own switch writable; another member's not", ownOk && !otherChanged);

console.log(`\n${checks - failures}/${checks} PASS${SKIP ? " (--skip: naive RPC; FAILs expected)" : ""}`);
process.exit(failures ? 1 : 0);
