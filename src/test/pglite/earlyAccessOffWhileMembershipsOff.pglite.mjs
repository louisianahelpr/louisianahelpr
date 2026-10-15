#!/usr/bin/env node
/**
 * PGlite proof for 20261015050803_early_access_off_while_memberships_off (roadmap F4a).
 *
 *   node src/test/pglite/earlyAccessOffWhileMembershipsOff.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/earlyAccessOffWhileMembershipsOff.pglite.mjs  # RED: the previous ladder
 *
 * The previous state is the newest early_access_delay_minutes definition from
 * BEFORE the new migration (20260925053412) and feature_enabled_for_user from
 * 20261012031120, both parsed out of supabase/migrations. GREEN applies the new
 * migration 3x on top (replay-safety). Minimal fixture: only what the two
 * functions read (profiles tier columns, feature_switches, has_role,
 * test_accounts).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261015050803_early_access_off_while_memberships_off.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS ladder (expect FAILs)");

/** The newest `CREATE OR REPLACE FUNCTION public.<name>(` statement in migrations before `before`. */
function previousDefinition(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = { file: f, text: rest.slice(0, end + tag[1].length) + ";" };
    }
  }
  if (!last) throw new Error(`no previous definition of ${name}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = {
  free: "33333333-0000-0000-0000-000000000001",
  basic: "33333333-0000-0000-0000-000000000002",
  pro: "33333333-0000-0000-0000-000000000003",
  plus: "33333333-0000-0000-0000-000000000004",
  elite: "33333333-0000-0000-0000-000000000005",
  tester: "33333333-0000-0000-0000-000000000006",
};
const TIER = { free: null, basic: "basic", pro: "pro", plus: "plus", elite: "elite", tester: "elite" };

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(p_user uuid, p_role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user AND r.role = p_role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, subscription_tier text, subscription_expires_at timestamptz);
`);
for (const [k, id] of Object.entries(U)) {
  await db.query("INSERT INTO public.profiles VALUES ($1, $2, NULL)", [id, TIER[k]]);
}
await db.query("INSERT INTO public.test_accounts VALUES ($1)", [U.tester]);
await db.exec(previousDefinition("feature_enabled_for_user", NEW_FILE).text);
await db.exec(previousDefinition("early_access_delay_minutes", NEW_FILE).text);
// The switch as 20261015033658 creates it.
await db.exec(readFileSync(MIG_DIR + "20261015033658_memberships_switch_off.sql", "utf8"));
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

const delay = async (id) =>
  (await db.query("SELECT public.early_access_delay_minutes($1::uuid) AS m", [id])).rows[0].m;

// 20261015033658 creates the switch at TESTERS (the App Review account keeps Pro
// during the 1.0.4 review; members are off), and a replay never undoes an admin's choice.
{
  const a0 = (await db.query("SELECT audience FROM public.feature_switches WHERE key = 'memberships'")).rows[0]?.audience;
  check("migration creates memberships at testers (review freeze: testers keep Pro, members off)", a0 === "testers", `got ${a0}`);
  await db.exec("UPDATE public.feature_switches SET audience = 'off' WHERE key = 'memberships'");
  await db.exec(readFileSync(MIG_DIR + "20261015033658_memberships_switch_off.sql", "utf8"));
  const a1 = (await db.query("SELECT audience FROM public.feature_switches WHERE key = 'memberships'")).rows[0]?.audience;
  check("a replay keeps the admin's off", a1 === "off", `got ${a1}`);
}

// Memberships OFF (the owner's F4 state, once she flips it): nobody gets a head start.
for (const k of Object.keys(U)) {
  check(`switch off: ${k} waits the full 20 minutes`, (await delay(U[k])) === 20, `got ${await delay(U[k])}`);
}
check("switch off: anonymous (null) waits 20", (await delay(null)) === 20);

// Testers only: the tester's tier earns its minutes again; nobody else's does.
await db.exec("UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'memberships'");
check("switch testers: elite tester earns 20 (waits 0)", (await delay(U.tester)) === 0, `got ${await delay(U.tester)}`);
check("switch testers: non-tester elite still waits 20", (await delay(U.elite)) === 20, `got ${await delay(U.elite)}`);

// Memberships back ON for everyone: the original ladder, unchanged.
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'memberships'");
const want = { free: 20, basic: 15, pro: 10, plus: 5, elite: 0 };
for (const [k, m] of Object.entries(want)) {
  check(`switch everyone: ${k} waits ${m}`, (await delay(U[k])) === m, `got ${await delay(U[k])}`);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
