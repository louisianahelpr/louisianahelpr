#!/usr/bin/env node
/**
 * PGlite proof for 20261101140006_export_my_data_instant_book.sql: "Download My Data" carries instant book (CMP-4,
 * live): the member's own instant_book_floors and instant_book_declines (helper_id = the member), never another
 * member's; every other section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/exportInstantBook.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportInstantBook.pglite.mjs  # RED: 20261101061156's body only
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * World: the export_my_data statements of 20261101061156 (the newest CREATE before this one), then this migration's
 * 3x; every table the body reads stubbed with the columns it reads, the two instant book tables with their real
 * columns (20261101063725, 20261101065105). pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261101061156_export_my_data_place_city_only.sql";
const NEW_FILE = "20261101140006_export_my_data_instant_book.sql";
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

// 1. The old body VERBATIM except the two new last sections.
const ADDED = `  -- CMP-4 instant book (20261101063725, 20261101065105): the member's own auto-accept floors, and the jobs they said
  -- they can't make. Their own rows only (helper_id = the member).
  v_out := v_out || jsonb_build_object('instant_book_floors', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'category', t.category, 'floor_cents', t.floor_cents, 'created_at', t.created_at, 'updated_at', t.updated_at)
             ORDER BY t.category::text), '[]'::jsonb) FROM public.instant_book_floors t
             WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_book_declines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'job_id', t.job_id, 'reason', t.reason, 'declined_at', t.declined_at) ORDER BY t.declined_at), '[]'::jsonb)
             FROM public.instant_book_declines t
             WHERE t.helper_id = v_uid));

  RETURN v_out;`;
ok(oldDef.split("  RETURN v_out;").length === 2 && def === oldDef.replace("  RETURN v_out;", ADDED),
  "the new body is 20261101061156's verbatim plus the two instant book sections", skip ? "skip" : "");
ok(/SET search_path TO 'public', 'pg_temp'/.test(def), "search_path still public, pg_temp");

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
// The two instant book tables exactly as 20261101063725 / 20261101065105 create them (the stubs cover the rest).
await db.exec(`
DROP TABLE IF EXISTS public.instant_book_floors, public.instant_book_declines;
CREATE TABLE IF NOT EXISTS public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
DO $$ BEGIN
  IF to_regtype('public.job_category') IS NULL THEN CREATE TYPE public.job_category AS ENUM ('moving', 'cleaning', 'yard_work'); END IF;
END $$;
CREATE TABLE public.instant_book_floors (
  helper_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category    public.job_category NOT NULL,
  floor_cents integer NOT NULL CHECK (floor_cents BETWEEN 1000 AND 100000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (helper_id, category)
);
CREATE TABLE public.instant_book_declines (
  job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      text NOT NULL DEFAULT 'declined' CHECK (reason IN ('declined', 'payment_failed')),
  declined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, helper_id)
);
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const JOB1 = "00000000-0000-0000-0000-0000000000d1";
const JOB2 = "00000000-0000-0000-0000-0000000000d2";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'o@example.com', now()), ('${NOBODY}', 'n@example.com', now());
INSERT INTO public.jobs (id) VALUES ('${JOB1}'), ('${JOB2}');
INSERT INTO public.instant_book_floors (helper_id, category, floor_cents, created_at, updated_at) VALUES
  ('${ME}', 'moving', 5000, '2026-11-01 10:00+00', '2026-11-01 11:00+00'),
  ('${ME}', 'cleaning', 3000, '2026-11-01 10:00+00', '2026-11-01 10:00+00'),
  ('${OTHER}', 'moving', 7700, now(), now());
INSERT INTO public.instant_book_declines (job_id, helper_id, reason, declined_at) VALUES
  ('${JOB1}', '${ME}', 'declined', '2026-11-01 12:00+00'),
  ('${JOB1}', '${OTHER}', 'payment_failed', now()),
  ('${JOB2}', '${OTHER}', 'declined', now());`);
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
const nobody = await exportOf(NOBODY);

const floors = me?.instant_book_floors;
ok(Array.isArray(floors) && floors.length === 2, "the member gets their own two floors", JSON.stringify(floors));
ok(floors?.[0]?.category === "cleaning" && floors?.[0]?.floor_cents === 3000 && floors?.[1]?.category === "moving" && floors?.[1]?.floor_cents === 5000,
  "  with category and floor, in category order", JSON.stringify(floors));
ok(floors?.every((f) => Object.keys(f).sort().join() === "category,created_at,floor_cents,updated_at"), "  with category, floor and timestamps only", JSON.stringify(floors));
ok(floors?.every((f) => f.floor_cents !== 7700) && !JSON.stringify(me).includes("7700"), "  never another member's floor", JSON.stringify(floors));
ok(other?.instant_book_floors?.length === 1 && other.instant_book_floors[0].floor_cents === 7700, "the other member gets only their own floor", JSON.stringify(other?.instant_book_floors));

const dec = me?.instant_book_declines;
ok(Array.isArray(dec) && dec.length === 1 && dec[0].job_id === JOB1 && dec[0].reason === "declined", "the member gets their own decline", JSON.stringify(dec));
ok(dec?.every((d) => Object.keys(d).sort().join() === "declined_at,job_id,reason"), "  with job, reason and time only", JSON.stringify(dec));
ok(!JSON.stringify(dec ?? []).includes("payment_failed") && !JSON.stringify(dec ?? []).includes(JOB2), "  never another member's decline (same job or another)", JSON.stringify(dec));
ok(other?.instant_book_declines?.length === 2 && other.instant_book_declines.every((d) => d.job_id === JOB1 || d.job_id === JOB2), "the other member gets only their own two declines", JSON.stringify(other?.instant_book_declines));
ok(Array.isArray(nobody?.instant_book_floors) && nobody.instant_book_floors.length === 0 && Array.isArray(nobody?.instant_book_declines) && nobody.instant_book_declines.length === 0,
  "a member with none gets two empty lists", JSON.stringify([nobody?.instant_book_floors, nobody?.instant_book_declines]));
ok(Array.isArray(me?.profile_handles_retired) && Array.isArray(me?.declutter_order_porch_places) && me?.email === "me@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
