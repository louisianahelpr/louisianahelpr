#!/usr/bin/env node
/**
 * PGlite proof for 20261120150247_app_installs (owner 2026-11-20): who signs in on the native app.
 * record_app_open writes the CALLER's own row only (first_seen_at kept, last_seen_at at most once an hour), refuses a
 * signed-out call and a bad platform or version; deleting the account deletes the row (ON DELETE CASCADE); Download My
 * Data carries the member's own row and nobody else's; admin_app_signins_week is admin only, counts by platform, new vs
 * returning, lists this week's new members newest first, and leaves test accounts out; anon and authenticated hold no
 * table privilege.
 *
 *   node src/test/pglite/appInstalls.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/appInstalls.pglite.mjs # RED
 *   MUTANT=<name> node ...                                         # each must FAIL (see MUTANTS)
 *
 * World: auth.users, auth.uid() read from the test.uid setting, has_role read from a user_roles list, is_test_member
 * stubbed as a test_accounts list (its own proof: the 20261030015205 migration's), profiles (user_id, full_name,
 * location). The export run stubs every other table export_my_data reads with the columns it reads (the
 * bundleRequestExport.pglite.mjs method). attach_unconfirmed_email_gate is absent here (the migration skips it).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const THIS = readdirSync(MIG_DIR).find((f) => f.endsWith("_app_installs.sql"));
if (!THIS) throw new Error("migration not found");

const MUTANTS = {
  anyUser: ["  v_uid uuid := (SELECT auth.uid());\n  v_version", "  v_uid uuid := COALESCE((SELECT auth.uid()), '11111111-0000-0000-0000-000000000003');\n  v_version"],
  noHourSkip: ["   WHERE a.last_seen_at < now() - interval '1 hour';", "   ;"],
  firstSeenMoves: ["     SET platform = EXCLUDED.platform,\n", "     SET platform = EXCLUDED.platform, first_seen_at = EXCLUDED.first_seen_at,\n"],
  anyPlatform: ["  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN", "  IF false THEN"],
  noCascade: ["user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,", "user_id uuid PRIMARY KEY,"],
  noAdminCheck: ["  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false) THEN", "  IF false THEN"],
  testCounts: ["       AND NOT public.is_test_member(a.user_id)\n", ""],
  oldestFirst: ["ORDER BY n.first_seen_at DESC, n.user_id)", "ORDER BY n.first_seen_at, n.user_id)"],
  exportAll: ["      FROM public.app_installs t WHERE t.user_id = v_uid));", "      FROM public.app_installs t));"],
  noExport: ["  v_out := v_out || jsonb_build_object('app_installs',", "  v_out := v_out || jsonb_build_object('app_installs_x',"],
  tableGrant: ["REVOKE ALL ON TABLE public.app_installs FROM PUBLIC, anon, authenticated;", "GRANT SELECT ON TABLE public.app_installs TO authenticated;"],
  anonCalls: ["REVOKE ALL ON FUNCTION public.record_app_open(text, text) FROM PUBLIC, anon;", "GRANT EXECUTE ON FUNCTION public.record_app_open(text, text) TO anon;"],
};
let mig = readFileSync(MIG_DIR + THIS, "utf8");
const MUTANT = process.env.MUTANT ?? "";
if (MUTANT) {
  const m = MUTANTS[MUTANT];
  if (!m || mig.split(m[0]).length !== 2) throw new Error(`mutant ${MUTANT} did not apply`);
  mig = mig.replace(m[0], m[1]);
}

let failures = 0;
const check = (ok, name, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  (${detail})`}`); if (!ok) failures++; };
const ANN = "11111111-0000-0000-0000-000000000001";
const TEST = "11111111-0000-0000-0000-000000000002";
const BEN = "11111111-0000-0000-0000-000000000003";
const CAL = "11111111-0000-0000-0000-000000000004";
const ADMIN = "11111111-0000-0000-0000-000000000005";
const GONE = "11111111-0000-0000-0000-000000000006";

const db = await PGlite.create();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
  INSERT INTO auth.users (id, email) VALUES ('${ANN}', 'ann@example.com'), ('${TEST}', 't@example.com'), ('${BEN}', 'ben@example.com'),
    ('${CAL}', 'cal@example.com'), ('${ADMIN}', 'admin@example.com'), ('${GONE}', 'gone@example.com');
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $f$;
  CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
  INSERT INTO public.test_accounts VALUES ('${TEST}');
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p) $f$;
  CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, full_name text, location text);
  INSERT INTO public.profiles (user_id, full_name, location) VALUES ('${ANN}', 'Ann Arceneaux', 'Lafayette'), ('${BEN}', 'Ben Broussard', 'Delcambre'),
    ('${CAL}', 'Cal Comeaux', 'Abbeville'), ('${TEST}', 'Test Person', 'Testville');
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let k = 0; k < 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k + 1} of 3)`); } catch (e) { check(false, `the migration applies (run ${k + 1} of 3)`, e.message); }
  }
}

const as = async (uid) => { await db.query(`SELECT set_config('test.uid', $1, false)`, [uid ?? ""]); };
const open = async (platform, version) => {
  try { return { r: (await db.query(`SELECT public.record_app_open($1, $2) AS r`, [platform, version ?? null])).rows[0].r }; } catch (e) { return { err: String(e.message) }; }
};
const row = async (uid) => (await db.query(`SELECT platform, first_seen_at, last_seen_at, app_version FROM public.app_installs WHERE user_id = $1`, [uid])).rows[0];
const count = async () => { try { return (await db.query(`SELECT count(*)::int AS n FROM public.app_installs`)).rows[0].n; } catch { return -1; } };

// 1. Own row only.
await as(ANN);
const first = await open("ios", "1.0.4");
check(first.r === true, "a member's first app sign-in writes a row", JSON.stringify(first));
const a1 = await row(ANN);
check(a1?.platform === "ios" && a1?.app_version === "1.0.4", "the row holds the platform and app version", JSON.stringify(a1));
check((await count()) === 1, "only the caller's row exists (no other member's row is written)", String(await count()));
const again = await open("ios", "1.0.5");
check(again.r === false, "a second sign-in within the hour skips the write", JSON.stringify(again));
check((await row(ANN))?.app_version === "1.0.4", "  and changes nothing", JSON.stringify(await row(ANN)));
await db.exec(`UPDATE public.app_installs SET first_seen_at = now() - interval '30 days', last_seen_at = now() - interval '2 hours' WHERE user_id = '${ANN}'`);
const later = await open("android", "1.0.6");
const a2 = await row(ANN);
check(later.r === true && a2?.platform === "android" && a2?.app_version === "1.0.6", "a sign-in over an hour later updates platform, version and last seen", JSON.stringify(a2));
check(Date.now() - new Date(a2?.first_seen_at).getTime() > 29 * 86400e3, "  first_seen_at is kept", String(a2?.first_seen_at));
check(Date.now() - new Date(a2?.last_seen_at).getTime() < 60e3, "  last_seen_at is now", String(a2?.last_seen_at));

await as(null);
check(/not_authenticated/.test((await open("ios")).err ?? ""), "a signed-out call is refused");
await as(BEN);
check(/invalid_platform/.test((await open("web")).err ?? ""), "platform 'web' is refused");
check(/invalid_platform/.test((await open(null)).err ?? ""), "a null platform is refused");
check(/invalid_app_version/.test((await open("ios", "1.0<script>")).err ?? ""), "a version with odd characters is refused");
check((await row(BEN)) === undefined, "  none of the refusals wrote a row", JSON.stringify(await row(BEN)));

// 2. Cascade on account deletion.
await as(GONE);
await open("ios");
await db.exec(`DELETE FROM auth.users WHERE id = '${GONE}'`).catch((e) => check(false, "deleting an account with an app row works", e.message));
check((await row(GONE)) === undefined, "deleting the account deletes its app row (ON DELETE CASCADE)");

// 3. Admin week card: counts, new vs returning, list newest first, test accounts left out, admin only.
await as(BEN); await open("ios", "1.0.4");
await as(CAL); await open("android");
await as(TEST); await open("ios");
await db.exec(`UPDATE public.app_installs SET first_seen_at = now() - interval '2 days' WHERE user_id = '${BEN}'`);
await db.exec(`UPDATE public.app_installs SET first_seen_at = now() - interval '1 day' WHERE user_id = '${CAL}'`);
const week = async () => { try { return (await db.query(`SELECT public.admin_app_signins_week() AS w`)).rows[0].w; } catch (e) { return { err: String(e.message) }; } };
await as(BEN);
check(/admin_only/.test((await week()).err ?? ""), "an ordinary member cannot read the admin week card");
await as(null);
check(/admin_only/.test((await week()).err ?? ""), "a signed-out caller cannot read the admin week card");
await as(ADMIN);
const w = await week();
check(Number(w?.ios_new) === 1 && Number(w?.android_new) === 1, "new this week: 1 iOS (Ben), 1 Android (Cal); the test account does not count", JSON.stringify(w));
check(Number(w?.android_returning) === 1 && Number(w?.ios_returning) === 0, "returning this week: Ann (first seen 30 days ago, Android now)", JSON.stringify(w));
const names = (w?.new_members ?? []).map((m) => m.name);
check(JSON.stringify(names) === JSON.stringify(["Cal Comeaux", "Ben Broussard"]), "the list holds this week's new members, newest first, no test account", JSON.stringify(names));
check(w?.new_members?.[1]?.town === "Delcambre" && w?.new_members?.[1]?.platform === "ios" && !!w?.new_members?.[1]?.first_seen_at, "  each with town, platform and first seen", JSON.stringify(w?.new_members?.[1]));
await db.exec(`UPDATE public.app_installs SET last_seen_at = now() - interval '8 days' WHERE user_id = '${ANN}'`);
check(Number((await week())?.android_returning) === 0, "a member not seen this week is not counted as returning");

// 4. Privileges.
const priv = (await db.query(`SELECT has_table_privilege('anon', 'public.app_installs', 'SELECT') AS a, has_table_privilege('authenticated', 'public.app_installs', 'SELECT') AS b, has_table_privilege('authenticated', 'public.app_installs', 'INSERT') AS c`)).rows[0];
check(!priv.a && !priv.b && !priv.c, "anon/authenticated hold no table privilege", JSON.stringify(priv));
const fx = (await db.query(`SELECT has_function_privilege('anon', 'public.record_app_open(text, text)', 'EXECUTE') AS ra, has_function_privilege('authenticated', 'public.record_app_open(text, text)', 'EXECUTE') AS rau, has_function_privilege('anon', 'public.admin_app_signins_week()', 'EXECUTE') AS wa`)).rows[0];
check(!fx.ra && fx.rau && !fx.wa, "record_app_open: authenticated only; the week card: never anon", JSON.stringify(fx));

// 5. Download My Data: stub every table the body reads, with the columns it reads, then run it.
let def = "";
try { def = (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d; } catch (e) { check(false, "export_my_data exists", e.message); }
if (def) {
  const body = def.slice(def.indexOf("BEGIN"));
  const tables = new Map();
  for (const chunk of body.split(/;\s*\n/)) {
    const alias = new Map();
    for (const m of chunk.matchAll(/\b(?:FROM|JOIN)\s+(public|auth|storage)\.(\w+)\s+(?:AS\s+)?(\w+)/gi)) {
      const t = `${m[1]}.${m[2]}`;
      if (!tables.has(t)) tables.set(t, new Set());
      if (!alias.has(m[3])) alias.set(m[3], new Set());
      alias.get(m[3]).add(t);
    }
    for (const m of chunk.matchAll(/\b([a-z]\w*)\.([a-z_]\w*)\b/g)) for (const t of alias.get(m[1]) ?? []) tables.get(t).add(m[2]);
  }
  const BOOL = new Set([...body.matchAll(/coalesce\(\w+\.(\w+),\s*(?:true|false)\)|\w+\.(\w+) IS (?:NOT )?(?:TRUE|FALSE)\b/gi)].map((m) => m[1] ?? m[2]));
  const TEXT_COLS = new Set([...body.matchAll(/\w+\.(\w+)\s*(?:=|<>|IN)\s*\(?'[a-z_]+'/g)].map((m) => m[1]));
  const typeOf = (c) =>
    TEXT_COLS.has(c) ? "text"
    : BOOL.has(c) ? "boolean"
    : c === "id" || c.endsWith("_id") || c.endsWith("_by") ? "uuid"
    : c.endsWith("_at") || c === "slot_start" || c === "slot_end" ? "timestamptz"
    : c.endsWith("_on") || c === "pickup_day" ? "date"
    : c.startsWith("is_") ? "boolean"
    : c.endsWith("_cents") || c === "rating" || c === "slot_no" ? "integer"
    : c === "weekdays" ? "smallint[]"
    : "text";
  const stubs = [];
  for (const [t, cols] of tables) {
    cols.delete("id");
    const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
    stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
  }
  await db.exec(stubs.join("\n"));
  await db.exec(`
    ALTER TABLE public.declutter_manager_grants ALTER COLUMN ended_by TYPE uuid USING NULL;
    CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);
  const exportOf = async (uid) => {
    try { return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j; } catch (e) { check(false, `export_my_data runs for ${uid}`, e.message); return null; }
  };
  const ann = await exportOf(ANN);
  const sec = ann?.app_installs;
  check(Array.isArray(sec) && sec.length === 1 && sec[0].platform === "android" && sec[0].app_version === "1.0.6" && !!sec[0].first_seen_at && !!sec[0].last_seen_at,
    "Download My Data carries the member's own app sign-in row", JSON.stringify(sec));
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${GONE}', 'gone@example.com')`);
  const none = await exportOf(GONE);
  check(Array.isArray(none?.app_installs) && none.app_installs.length === 0, "  a member with no app sign-in gets an empty list (never another member's row)", JSON.stringify(none?.app_installs));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
