#!/usr/bin/env node
/**
 * PGlite proof for 20261101022048_export_my_data_signup_source.sql: "Download My Data" carries the member's own
 * sign-up source row (LEAD-EXPORT-SIGNUP-SOURCE, lead 2026-10-31; the table is OPS-5's 20261031220447), and nothing
 * else about export_my_data changes.
 *
 *   node src/test/pglite/exportSignupSource.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportSignupSource.pglite.mjs  # RED: 20261031231948's body only
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 *
 * World: the export_my_data statements (DROP / CREATE / REVOKE / GRANT) of 20261031231948 (the newest before this
 * one), then this migration's 3x. Checks:
 *   1. The new body is the old body VERBATIM plus the one section (nothing else moved).
 *   2. Still the one (uuid) overload, EXECUTE for service_role only.
 *   3. RUN: every table the body reads is stubbed with the columns it reads; a member gets their own source and
 *      campaign, another member's never, and a member with no row an empty list.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261031231948_helpr_delivery_talk.sql";
const NEW_FILE = "20261101022048_export_my_data_signup_source.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migration (expect FAILs)");

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

/** The export_my_data statements of one migration: the no-arg DROP, the (uuid) CREATE (any dollar tag), its REVOKE/GRANT. */
function exportStatements(sql, label) {
  const out = [];
  const drop = /^DROP FUNCTION IF EXISTS public\.export_my_data\(\);$/m.exec(sql);
  if (drop) out.push(drop[0]);
  const create = /CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)[\s\S]*?\bAS (\$\w*\$)/.exec(sql);
  if (!create) throw new Error(`${label}: no export_my_data(uuid) definition`);
  const end = sql.indexOf(create[1], create.index + create[0].length);
  out.push(`${sql.slice(create.index, end + create[1].length)};`);
  for (const m of sql.matchAll(/^(?:REVOKE|GRANT) [^\n]*public\.export_my_data\(uuid\)[^\n]*;$/gm)) out.push(m[0]);
  if (out.length !== 4) throw new Error(`${label}: expected DROP + CREATE + REVOKE + GRANT, read ${out.length}`);
  return out.join("\n");
}

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
-- prod's default function ACL: a new function is EXECUTE for anon/authenticated until the migration revokes it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);

const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
await db.exec(exportStatements(readFileSync(`${MIG_DIR}${BASE}`, "utf8"), BASE));
const oldDef = await defOf();
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(exportStatements(sql, NEW_FILE));
      ok(true, `the migration's export_my_data applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration's export_my_data applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const def = await defOf();

// 1. Old body + exactly the new section.
const START = "  -- Where this account came from (OPS-5, 20261031220447)";
const at = def.indexOf(START);
const stop = at < 0 ? -1 : def.indexOf("\n  RETURN v_out;", at);
ok(at > 0 && stop > at, "the new body has the sign-up source section, right before RETURN");
ok(at > 0 && def.slice(0, at) + def.slice(stop) === oldDef, "and is otherwise 20261031231948's body verbatim");

// 2. ACL.
const acl = (await db.query(`SELECT
    has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
    (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
ok(acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, "still the one (uuid) overload, EXECUTE for service_role only", JSON.stringify(acl));

// 3. RUN it: stub every table the body reads, with the columns it reads.
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
// Columns the body compares with a word ('tenant'), whatever their name says.
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
// member_signup_sources as 20261031220447 has it; the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.member_signup_sources;
CREATE TABLE public.member_signup_sources (user_id uuid PRIMARY KEY, source text NOT NULL, campaign text, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NONE = "00000000-0000-0000-0000-0000000000cc";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'm@example.com', now()), ('${OTHER}', 'o@example.com', now()), ('${NONE}', 'n@example.com', now());
INSERT INTO public.member_signup_sources (user_id, source, campaign) VALUES ('${ME}', 'facebook', 'fall-yard'), ('${OTHER}', 'nextdoor', NULL);`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const me = await exportOf(ME);
const other = await exportOf(OTHER);
const none = await exportOf(NONE);
const mine = me?.member_signup_sources;
ok(Array.isArray(mine) && mine.length === 1 && mine[0].source === "facebook" && mine[0].campaign === "fall-yard" && !!mine[0].recorded_at, "a member gets their own source, campaign and when", JSON.stringify(mine));
ok(Array.isArray(mine) && mine.every((r) => !("user_id" in r)), "  as the three words only (no id column)", JSON.stringify(mine));
ok(other?.member_signup_sources?.length === 1 && other.member_signup_sources[0].source === "nextdoor", "another member gets their own, and only theirs", JSON.stringify(other?.member_signup_sources));
ok(Array.isArray(none?.member_signup_sources) && none.member_signup_sources.length === 0, "a member with no row gets an empty list");
ok(Array.isArray(me?.job_post_drafts), "the section before it (job_post_drafts) is still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
