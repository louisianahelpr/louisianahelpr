#!/usr/bin/env node
/**
 * PGlite proof for the manager branch's guard fixes (B162, 11-02; PR #3990's repo-wide reds):
 *   G1  declutter_manager_first_name reads the name through member_display_name (memberNamesMaskedInResponses):
 *       the first word only, even for a name with a tab or doubled spaces, which the old btrim + split_part(' ')
 *       body handed back whole ("Ann<TAB>Smith");
 *   G2  it stays closed to every client role, with Supabase's default EXECUTE-to-anon/authenticated emulated;
 *   G3  20261101230509 attaches the unconfirmed-email write gate to the two tables it creates (Q807).
 * (The "You earned a share" kind, declutter_sales, is proven in declutterManagerShareSplit.pglite.mjs S1d.)
 *
 *   npx tsx src/test/pglite/declutterManagerGuardFixes.pglite.mjs                 # GREEN, both migrations' pieces 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/declutterManagerGuardFixes.pglite.mjs   # RED: the bodies before the fix
 *   PLANT=<name> npx tsx ...                                                     # each must FAIL its check
 *
 * World: auth.users/auth.uid/auth.role stubs, public.profiles, the NEWEST real member_display_name,
 * session_email_unconfirmed, refuse_unconfirmed_email_write and attach_unconfirmed_email_gate; the two share-split
 * tables as stubs (their real columns are not what G3 checks). From the migrations, verbatim: the first-name function
 * with its REVOKE/GRANT lines (20261101181005) and the Q807 DO block (20261101230509).
 */
import os from "node:os";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const MODE = readdirSync(DIR).find((f) => f.endsWith("_declutter_manager_mode.sql"));
const SPLIT = readdirSync(DIR).find((f) => f.endsWith("_declutter_manager_share_split.sql"));
const SKIP = process.env.NEW_MIGRATION === "skip";
const PLANT = process.env.PLANT ?? "";

let mode = readFileSync(DIR + MODE, "utf8");
let split = readFileSync(DIR + SPLIT, "utf8");
const PLANTS = {
  // G1: the raw name back (the pre-fix body)
  raw_name: ["mode", "split_part(public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = p_user), NULL), ' ', 1)",
    "split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = p_user)), ' ', 1)"],
  // G2: the client roles keep Supabase's default EXECUTE
  no_revoke: ["mode", "REVOKE ALL ON FUNCTION public.declutter_manager_first_name(uuid) FROM PUBLIC, anon, authenticated;", ""],
  // G3: the Q807 block dropped
  no_gate: ["split", "    PERFORM public.attach_unconfirmed_email_gate();\n  END IF;\nEND\n$do$;\n\n-- 3. The seller's row", "    NULL;\n  END IF;\nEND\n$do$;\n\n-- 3. The seller's row"],
};
if (PLANT) {
  const [which, find, repl] = PLANTS[PLANT] ?? [];
  const src = which === "mode" ? mode : split;
  if (!find || !src.includes(find)) throw new Error(`PLANT=${PLANT}: not found in the migration`);
  if (which === "mode") mode = mode.replace(find, repl); else split = split.replace(find, repl);
  console.log(`PLANT=${PLANT}: planted`);
}
if (SKIP) console.log("NEW_MIGRATION=skip: the bodies before the fix (expect FAILs)");

/** The pre-fix pieces, for NEW_MIGRATION=skip: the raw first-name body and no Q807 block. */
if (SKIP) {
  mode = mode.replace(PLANTS.raw_name[1], PLANTS.raw_name[2]);
  split = split.replace(PLANTS.no_gate[1], PLANTS.no_gate[2]);
}

const DEFS = effectiveDefs(DIR);
const real = (n) => {
  const d = DEFS.get(n);
  if (!d) throw new Error(`no definition of ${n}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  return `${d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length)};`;
};
/** The text from `start` up to and including the first `end` after it. */
const slice = (src, start, end) => {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`not found: ${start.slice(0, 60)}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error(`no end after: ${start.slice(0, 60)}`);
  return src.slice(i, j + end.length);
};
const FIRST_NAME = slice(mode, "CREATE OR REPLACE FUNCTION public.declutter_manager_first_name(p_user uuid)",
  "GRANT EXECUTE ON FUNCTION public.declutter_manager_first_name(uuid) TO service_role;");
const GATE_BLOCK = slice(split, "DO $do$\nBEGIN\n  IF to_regprocedure('public.attach_unconfirmed_email_gate()')", "$do$;");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  -- Supabase's default: every new public function is executable by anon and authenticated.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  create table public.profiles (user_id uuid primary key, full_name text);
  insert into public.profiles values
    ('${U(1)}', 'Kaci Lombas'), ('${U(2)}', E'Ann\\tSmith'), ('${U(3)}', '  Dana   Rivers  '), ('${U(4)}', 'Cher'),
    ('${U(5)}', null), ('${U(6)}', '   ');
  ${real("member_display_name")}
  ${real("session_email_unconfirmed")}
  ${real("refuse_unconfirmed_email_write")}
  ${real("attach_unconfirmed_email_gate")}
  create table public.declutter_order_manager_shares (order_id uuid primary key);
  create table public.declutter_manager_payouts (id uuid primary key);
`);
for (let i = 0; i < 3; i++) {
  await db.exec(FIRST_NAME);
  await db.exec(GATE_BLOCK);
}
console.log(`applied the first-name function (${MODE}) and the Q807 block (${SPLIT}) 3x`);

const name = async (n) => (await db.query(`select public.declutter_manager_first_name('${U(n)}') as v`)).rows[0].v;
const got = { kaci: await name(1), tab: await name(2), spaces: await name(3), one: await name(4), none: await name(5), blank: await name(6), missing: await name(9) };
check("G1a the first word: Kaci, Dana (doubled spaces), Cher (one word)", got.kaci === "Kaci" && got.spaces === "Dana" && got.one === "Cher", JSON.stringify(got));
check("G1b a tab-separated name gives the first word only, never the last name", got.tab === "Ann", JSON.stringify(got.tab));
check("G1c no name, a blank name or no profile: 'Someone'", got.none === "Someone" && got.blank === "Someone" && got.missing === "Someone", JSON.stringify(got));

const can = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.declutter_manager_first_name(uuid)', 'EXECUTE') as v`)).rows[0].v;
const roles = { anon: await can("anon"), authenticated: await can("authenticated"), service_role: await can("service_role") };
check("G2 closed to anon and authenticated (Supabase default emulated), open to service_role",
  roles.anon === false && roles.authenticated === false && roles.service_role === true, JSON.stringify(roles));

const gated = (await db.query(`select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where t.tgname = 'zz_refuse_unconfirmed_email_write' order by 1`)).rows.map((r) => r.relname);
check("G3 both share-split tables carry the unconfirmed-email write gate",
  gated.includes("declutter_order_manager_shares") && gated.includes("declutter_manager_payouts"), JSON.stringify(gated));

console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
