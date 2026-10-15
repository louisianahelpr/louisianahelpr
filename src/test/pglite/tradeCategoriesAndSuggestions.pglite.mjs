#!/usr/bin/env node
/**
 * PGlite proof for 20261015050648_add_trade_job_categories (T1) and
 * 20261015051141_category_suggestions (I1), docs/specs/louisiana-hub-roadmap.md.
 *
 *   node src/test/pglite/tradeCategoriesAndSuggestions.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/tradeCategoriesAndSuggestions.pglite.mjs   # RED: every check fails
 *   SUGGEST_PATH=<planted copy> node src/test/pglite/tradeCategoriesAndSuggestions.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Prod-shaped stubs: roles + prod's default function ACL (anon/authenticated
 * EXECUTE on every new function, so a REVOKE that forgets anon is caught),
 * auth.users/auth.uid(), the job_category enum as prod has it today (12 values,
 * read 2026-10-15 with enum_range), user_roles/has_role, test_accounts,
 * admin_audit_log, profiles (ban columns). is_caller_banned is NOT re-typed: its
 * newest definition is read out of supabase/migrations. Then
 * 20261012031120_hidden_feature_switches.sql, then each new migration 3x, each
 * run in its own transaction like the migration runner.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const ENUM_MIG = readFileSync(process.env.ENUM_PATH ?? `${MIG_DIR}20261015050648_add_trade_job_categories.sql`, "utf8");
const SUGGEST_MIG = readFileSync(process.env.SUGGEST_PATH ?? `${MIG_DIR}20261015051141_category_suggestions.sql`, "utf8");
const SWITCHES = readFileSync(`${MIG_DIR}20261012031120_hidden_feature_switches.sql`, "utf8");

/** The newest CREATE [OR REPLACE] FUNCTION public.<name>( statement in the migrations, any dollar tag. */
function newestDefinition(name) {
  let found = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < "20261015050648").sort()) {
    const sql = readFileSync(`${MIG_DIR}${f}`, "utf8");
    const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
    let m;
    while ((m = re.exec(sql))) {
      const as = /\bAS\s+(\$\w*\$)/g;
      as.lastIndex = m.index;
      const t = as.exec(sql);
      const end = sql.indexOf(t[1], t.index + t[0].length);
      found = { file: f, stmt: `${sql.slice(m.index, end + t[1].length)};` };
    }
  }
  if (!found) throw new Error(`no definition of ${name}`);
  return found;
}

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.job_category AS ENUM ('cleaning','yard_work','moving','errands','handyman','painting','delivery','pet_care','assembly','other','storm_prep','events');
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category public.job_category NOT NULL DEFAULT 'other');
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY, enrolled_at timestamptz NOT NULL DEFAULT now(), note text);
CREATE TABLE public.admin_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), admin_id uuid, action text NOT NULL,
  target_type text, target_id text, details jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, full_name text,
  ban_status text DEFAULT 'active', auto_suspended_until timestamptz);
`;

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const TESTER = U(1), TESTER2 = U(2), ORDINARY = U(3), BANNED = U(4), ADMIN = U(5);

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(newestDefinition("is_caller_banned").stmt);
await db.exec(`REVOKE ALL ON FUNCTION public.is_caller_banned() FROM PUBLIC, anon;`);
await db.exec(SWITCHES);
await db.exec(`
  INSERT INTO auth.users (id) SELECT ('00000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 5) g;
  INSERT INTO public.profiles (user_id, full_name, ban_status) VALUES
    ('${TESTER}', 'Tess Tester', 'active'), ('${TESTER2}', 'Toby Tester', 'active'),
    ('${ORDINARY}', 'Ora Ordinary', 'active'), ('${BANNED}', 'Ben Banned', 'banned'), ('${ADMIN}', 'Ada Admin', 'active');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.test_accounts (user_id) VALUES ('${TESTER}'), ('${TESTER2}'), ('${BANNED}');`);

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const skip = process.env.NEW_MIGRATION === "skip";
const replayErrors = [];
if (!skip) {
  // The migration runner wraps each file in a transaction; ADD VALUE inside one
  // is legal since PG 12 as long as the new value is not used in it.
  for (let i = 0; i < 3; i++) {
    for (const [name, sql] of [["enum", ENUM_MIG], ["suggest", SUGGEST_MIG]]) {
      try {
        await db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
      } catch (e) {
        replayErrors.push(`${name} run ${i + 1}: ${e.message}`);
        await db.exec("ROLLBACK;").catch(() => undefined);
      }
    }
  }
}
ok(!skip && replayErrors.length === 0, `both migrations apply 3x, each in a transaction (${replayErrors.join(" | ") || "no errors"})`);

/** Run `sql` as `role` with auth.uid() = uid. Returns rows or { error, code }. */
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
const svc = async (sql) => {
  try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; }
};
const refused = (r, re, code) => !Array.isArray(r) && re.test(r.error) && (code === undefined || r.code === code);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);

// ── T1: the enum ──
const TRADES = ["electrical", "plumbing", "hvac", "roofing", "welding", "carpentry", "auto_repair",
  "appliance_repair", "flooring", "concrete_masonry", "fencing", "pressure_washing"];
const vals = await svc(`SELECT unnest(enum_range(NULL::public.job_category))::text AS v`);
const have = Array.isArray(vals) ? vals.map((r) => r.v) : [];
ok(TRADES.every((t) => have.includes(t)), `job_category has all 12 trades (${have.length} values)`);
ok(have.length === 24, `job_category has exactly 24 values after 3 replays, no duplicates (${have.length})`);
ok(have.indexOf("events") < have.indexOf("electrical") && have.includes("other"), "existing values keep their place; new ones appended");
const ins = await svc(`INSERT INTO public.jobs (category) VALUES ('plumbing'), ('pressure_washing') RETURNING category::text`);
ok(Array.isArray(ins) && ins.length === 2, "a job can be stored with a trade category");

// ── I1: the table is closed to clients ──
ok(refused(await as("authenticated", TESTER, `SELECT * FROM public.category_suggestions`), /permission denied/),
  "authenticated cannot SELECT category_suggestions directly");
ok(refused(await as("authenticated", TESTER, `INSERT INTO public.category_suggestions (user_id, suggested_in, suggestion) VALUES ('${TESTER}', 'jobs', 'Tutoring')`), /permission denied/),
  "authenticated cannot INSERT category_suggestions directly");
ok(refused(await as("anon", null, `SELECT * FROM public.category_suggestions`), /permission denied/), "anon cannot read the table");

// ── I1: ACLs ──
for (const fn of ["suggest_category(text, text)", "admin_list_category_suggestions(text)", "admin_review_category_suggestion(uuid, boolean, text)"]) {
  ok(refused(await as("anon", null, `SELECT public.${fn.replace(/\(.*\)/, "")}(${fn.includes("uuid") ? "gen_random_uuid(), true, null" : fn.includes("text, text") ? "'jobs','x'" : "'pending'"})`), /permission denied/),
    `anon cannot EXECUTE ${fn}`);
}

// ── I1: the hidden switch ──
const sw = await svc(`SELECT audience FROM public.feature_switches WHERE key = 'suggest_category'`);
ok(one(sw) === "testers", `switch suggest_category created as testers (${one(sw)})`);
ok(refused(await as("authenticated", ORDINARY, `SELECT public.suggest_category('jobs', 'Tutoring')`), /feature_disabled/, "42501"),
  "an ordinary (non-tester) account is refused: feature_disabled");

// ── I1: suggest ──
const id1 = one(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', '  Car   Detailing ')`));
ok(typeof id1 === "string" && id1.length === 36, "a tester can suggest; returns an id");
const stored = await svc(`SELECT suggestion, normalized, status, user_id::text AS u FROM public.category_suggestions WHERE id = '${id1}'`);
ok(Array.isArray(stored) && stored[0]?.suggestion === "Car Detailing" && stored[0]?.normalized === "car detailing" && stored[0]?.status === "pending" && stored[0]?.u === TESTER,
  "stored trimmed, whitespace collapsed, pending, owned by the caller (auth.uid, never a parameter)");
const id1b = one(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'car detailing')`));
ok(typeof id1 === "string" && id1b === id1, "repeating your own pending suggestion returns the same id (no second row)");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'call me 555-1212 @x')`), /invalid_suggestion/, "22023"), "contact-ish text refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'https://spam.example')`), /invalid_suggestion/), "a URL is refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'call me 504 555 1212')`), /invalid_suggestion/), "a phone number with no @ is refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'www.spam.com')`), /invalid_suggestion/), "a bare domain with no : is refused");
const stb = one(await as("authenticated", TESTER2, `SELECT public.suggest_category('declutter', 'St. Bernard crafts')`));
ok(typeof stb === "string", "an abbreviation with a dot and a space (St. Bernard) is allowed");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'x')`), /invalid_suggestion/), "1 character refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', '${"a".repeat(41)}')`), /invalid_suggestion/), "41 characters refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', NULL)`), /invalid_suggestion/), "NULL suggestion refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category('rentals', 'Tutoring')`), /invalid_area/), "unknown area refused");
ok(refused(await as("authenticated", TESTER, `SELECT public.suggest_category(NULL, 'Tutoring')`), /invalid_area/), "NULL area refused");
ok(refused(await as("authenticated", BANNED, `SELECT public.suggest_category('jobs', 'Tutoring')`), /account_restricted/, "42501"), "a banned tester is refused");
ok(refused(await as("authenticated", null, `SELECT public.suggest_category('jobs', 'Tutoring')`), /feature_disabled|not_authenticated/), "no auth.uid() is refused");
for (const t of ["Tutoring", "Piano / Music", "Sewing & Alterations", "Notary"]) {
  await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', '${t.replace(/'/g, "''")}')`);
}
const capped = await as("authenticated", TESTER, `SELECT public.suggest_category('jobs', 'Beekeeping')`);
ok(refused(capped, /rate_limited/, "54000"), "a 6th suggestion in 24 hours is refused: rate_limited");
const id2 = one(await as("authenticated", TESTER2, `SELECT public.suggest_category('jobs', 'Car detailing')`));
ok(typeof id2 === "string" && id2 !== id1, "another user's same suggestion is its own row (the demand count)");

// ── I1: admin list ──
ok(refused(await as("authenticated", TESTER, `SELECT * FROM public.admin_list_category_suggestions('pending')`), /not_authorized/, "42501"),
  "a tester who is not an admin cannot list the queue");
const list = await as("authenticated", ADMIN, `SELECT * FROM public.admin_list_category_suggestions('pending')`);
const carRow = Array.isArray(list) ? list.find((r) => r.id === id1) : null;
ok(Array.isArray(list) && list.length === 7, `admin lists the pending queue (${Array.isArray(list) ? list.length : list.error})`);
ok(carRow && Number(carRow.same_count) === 2 && carRow.suggester_name === "Tess Tester", "each row carries same_count and the suggester's name");
ok(refused(await as("authenticated", ADMIN, `SELECT * FROM public.admin_list_category_suggestions('bogus')`), /invalid_status/), "unknown status refused");

// ── I1: admin review ──
ok(refused(await as("authenticated", TESTER, `SELECT public.admin_review_category_suggestion('${id1}', true, NULL)`), /not_authorized/, "42501"),
  "a non-admin cannot approve");
const n = one(await as("authenticated", ADMIN, `SELECT public.admin_review_category_suggestion('${id1}', true, 'Good one')`));
ok(n === 2, `approving resolves every pending suggestion with the same words in that area (${n})`);
const after = await svc(`SELECT status, reviewed_by::text AS r FROM public.category_suggestions WHERE id IN ('${id1}', '${id2}')`);
ok(Array.isArray(after) && after.every((r) => r.status === "approved" && r.r === ADMIN), "both rows approved, reviewed_by = the admin");
const audit = await svc(`SELECT action, target_id, details->>'decision' AS d, (details->>'resolved')::int AS n FROM public.admin_audit_log WHERE action = 'review_category_suggestion'`);
ok(Array.isArray(audit) && audit.length === 1 && audit[0].target_id === id1 && audit[0].d === "approved" && audit[0].n === 2, "one admin_audit_log row with decision and count");
ok(refused(await as("authenticated", ADMIN, `SELECT public.admin_review_category_suggestion('${id1}', false, NULL)`), /already_reviewed/), "a reviewed suggestion cannot be re-decided");
ok(refused(await as("authenticated", ADMIN, `SELECT public.admin_review_category_suggestion(gen_random_uuid(), true, NULL)`), /unknown_suggestion/), "unknown id refused");
ok(refused(await as("authenticated", ADMIN, `SELECT public.admin_review_category_suggestion('${id1}', NULL, NULL)`), /invalid_arguments/), "NULL decision refused (never treated as approve)");
const tut = await svc(`SELECT id::text FROM public.category_suggestions WHERE normalized = 'tutoring'`);
const d = one(await as("authenticated", ADMIN, `SELECT public.admin_review_category_suggestion('${one(tut)}', false, NULL)`));
ok(d === 1, "declining works and resolves only that suggestion");

// ── I1: account deletion anonymises ──
const del = await svc(`DELETE FROM auth.users WHERE id = '${TESTER2}'`);
const orphan = await svc(`SELECT user_id FROM public.category_suggestions WHERE id = '${id2}'`);
ok(Array.isArray(del) && Array.isArray(orphan) && orphan.length === 1 && orphan[0].user_id === null, "deleting the suggester keeps the row with user_id NULL");

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
