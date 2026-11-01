#!/usr/bin/env node
/**
 * PGlite proof for 20261101025001_export_my_data_released_helpr.sql: "Download My Data" carries the deliveries a
 * Helpr was released from (helpr_tasks.released_helpr_id, 20261101020052; lead 10-31 "Released Helpr's task rows ARE
 * included in their data export"), each row once, without the other Helpr's id, and nothing else changes.
 *
 *   node src/test/pglite/exportReleasedHelpr.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportReleasedHelpr.pglite.mjs  # RED: 20261101022048's body only
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 *
 * World: the export_my_data statements (DROP / CREATE / REVOKE / GRANT) of 20261101022048 (the newest before this
 * one), then this migration's 3x. Checks:
 *   1. The new body is the old body VERBATIM except the helpr_tasks section.
 *   2. Still the one (uuid) overload, EXECUTE for service_role only.
 *   3. RUN: a released Helpr gets the tasks they were released from, once each (also one they took again), without the
 *      Helpr now on it; the Helpr now on it gets the row without the released Helpr's id; nobody gets another
 *      Helpr's task; the stripped address/code columns stay stripped.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261101022048_export_my_data_signup_source.sql";
const NEW_FILE = "20261101025001_export_my_data_released_helpr.sql";
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

// 1. Old body except the helpr_tasks section.
const OLD_SECTION = `  v_out := v_out || jsonb_build_object('helpr_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'dropoff_code' - 'pickup_address' - 'pickup_lat' - 'pickup_lng'
      - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' - 'customer_id' - 'pickup_contact_id' - 'close_note'), '[]'::jsonb) FROM public.helpr_tasks t
      WHERE t.helpr_id = v_uid));
`;
const sectionAt = (d) => {
  const a = d.indexOf("  -- B52 (20261101025001)") >= 0 ? d.indexOf("  -- B52 (20261101025001)") : d.indexOf("  v_out := v_out || jsonb_build_object('helpr_tasks',");
  const b = d.indexOf("  v_out := v_out || jsonb_build_object('helpr_task_events',", a);
  return [a, b];
};
{
  const [a, b] = sectionAt(def);
  ok(a > 0 && b > a && def.slice(a, b).includes("t.released_helpr_id = v_uid"), "the new body's helpr_tasks section reads released_helpr_id");
  ok(a > 0 && b > a && def.slice(0, a) + OLD_SECTION + def.slice(b) === oldDef, "and the rest is 20261101022048's body verbatim");
}

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
// helpr_tasks with the columns 20261017055505 + 20261101020052 give it (the ones that matter here); the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.helpr_tasks;
CREATE TABLE public.helpr_tasks (id uuid PRIMARY KEY, title text, status text, helpr_id uuid, released_helpr_id uuid,
  customer_id uuid, pickup_contact_id uuid, dropoff_code text, pickup_address text, pickup_lat numeric, pickup_lng numeric,
  dropoff_address text, dropoff_lat numeric, dropoff_lng numeric, close_note text, pay_cents integer);
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const H1 = "00000000-0000-0000-0000-0000000000a1"; // released from A and D, took C again after a release, on B
const H2 = "00000000-0000-0000-0000-0000000000a2"; // took A after H1 was released
const H3 = "00000000-0000-0000-0000-0000000000a3"; // on E only
const BUYER = "00000000-0000-0000-0000-0000000000b1";
const T = (n) => `00000000-0000-0000-0000-00000000f00${n}`;
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${H1}', 'h1@example.com', now()), ('${H2}', 'h2@example.com', now()), ('${H3}', 'h3@example.com', now());
INSERT INTO public.helpr_tasks (id, title, status, helpr_id, released_helpr_id, customer_id, pickup_contact_id, dropoff_code, pickup_address, dropoff_address, close_note, pay_cents) VALUES
  ('${T(1)}', 'A', 'accepted',  '${H2}', '${H1}', '${BUYER}', '${BUYER}', '4321', '1 Seller St', '2 Buyer Ave', 'n', 900),
  ('${T(2)}', 'B', 'delivered', '${H1}', NULL,    '${BUYER}', '${BUYER}', '4321', '1 Seller St', '2 Buyer Ave', 'n', 900),
  ('${T(3)}', 'C', 'accepted',  '${H1}', '${H1}', '${BUYER}', '${BUYER}', '4321', '1 Seller St', '2 Buyer Ave', 'n', 900),
  ('${T(4)}', 'D', 'open',      NULL,    '${H1}', '${BUYER}', '${BUYER}', '4321', '1 Seller St', '2 Buyer Ave', 'n', 900),
  ('${T(5)}', 'E', 'accepted',  '${H3}', NULL,    '${BUYER}', '${BUYER}', '4321', '1 Seller St', '2 Buyer Ave', 'n', 900);`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const byTitle = (j) => Object.fromEntries((j?.helpr_tasks ?? []).map((r) => [r.title, r]));
const h1 = await exportOf(H1);
const h2 = await exportOf(H2);
const h3 = await exportOf(H3);
const h1Titles = (h1?.helpr_tasks ?? []).map((r) => r.title).sort();
ok(JSON.stringify(h1Titles) === JSON.stringify(["A", "B", "C", "D"]), "a released Helpr gets the tasks they were released from (A, D) and their own (B, C), each once", JSON.stringify(h1Titles));
const t1 = byTitle(h1);
ok(t1.A && !("helpr_id" in t1.A) && t1.A.released_helpr_id === H1, "  task A: their own released id, never the Helpr now on it", JSON.stringify(t1.A));
ok(t1.D && !("helpr_id" in t1.D) && t1.D.released_helpr_id === H1 && t1.D.status === "open", "  task D (open again): their released id", JSON.stringify(t1.D));
ok(t1.C && t1.C.helpr_id === H1 && t1.C.released_helpr_id === H1, "  task C (taken again after a release): one row, both ids are theirs", JSON.stringify(t1.C));
ok(t1.B && t1.B.helpr_id === H1 && !("released_helpr_id" in t1.B), "  task B: their own Helpr id", JSON.stringify(t1.B));
const h2Titles = (h2?.helpr_tasks ?? []).map((r) => r.title).sort();
ok(JSON.stringify(h2Titles) === JSON.stringify(["A"]), "the Helpr now on A gets A only", JSON.stringify(h2Titles));
ok(h2?.helpr_tasks?.[0] && h2.helpr_tasks[0].helpr_id === H2 && !("released_helpr_id" in h2.helpr_tasks[0]), "  without the released Helpr's id", JSON.stringify(h2?.helpr_tasks?.[0]));
ok(JSON.stringify((h3?.helpr_tasks ?? []).map((r) => r.title)) === JSON.stringify(["E"]), "a Helpr on neither gets only their own task (E)", JSON.stringify(h3?.helpr_tasks));
const STRIPPED = ["dropoff_code", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_address", "dropoff_lat", "dropoff_lng", "customer_id", "pickup_contact_id", "close_note"];
const leaked = [...(h1?.helpr_tasks ?? []), ...(h2?.helpr_tasks ?? [])].flatMap((r) => STRIPPED.filter((c) => c in r).map((c) => `${r.title}.${c}`));
ok(h1?.helpr_tasks?.length > 0 && leaked.length === 0, "the address, code and buyer columns stay stripped on every row", JSON.stringify(leaked));
ok(Array.isArray(h1?.member_signup_sources), "the section after it (member_signup_sources) is still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
