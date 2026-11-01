#!/usr/bin/env node
/**
 * PGlite proof for 20261101210500_export_my_data_meetup_spots.sql: "Download My Data" carries the seller's own meet
 * spots (seller_id = the member), without created_by, never another member's or a public spot; every other
 * section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/exportMeetupSpots.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportMeetupSpots.pglite.mjs  # RED: 20261101140006's body only
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
const BASE = "20261101140006_export_my_data_instant_book.sql";
const NEW_FILE = "20261101210500_export_my_data_meetup_spots.sql";
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
const ADDED = `  -- Meet spots (20261101194608): the seller's own saved public meeting places (seller_id = the member), without
  -- created_by (an admin's id on a public spot).
  v_out := v_out || jsonb_build_object('declutter_meetup_spots', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by' ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_meetup_spots t
      WHERE t.seller_id = v_uid));
`;
const ANCHOR = `  v_out := v_out || jsonb_build_object('declutter_seller_porch_days', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_porch_days t
      WHERE t.seller_id = v_uid));
`;
ok(oldDef.split(ANCHOR).length === 2 && def === oldDef.replace(ANCHOR, ANCHOR + ADDED),
  "the new body is 20261101140006's verbatim plus the one meet spots section", skip ? "skip" : "");
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
// declutter_meetup_spots with its real columns (20261027204500 + 20261101194608); the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.declutter_meetup_spots;
CREATE TABLE public.declutter_meetup_spots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parish text NOT NULL, name text NOT NULL, address text NOT NULL,
  lat numeric(9,6) NOT NULL, lng numeric(9,6) NOT NULL, kind text NOT NULL, note text, active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  seller_id uuid, windows jsonb);
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const ADMIN = "00000000-0000-0000-0000-0000000000dd";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'o@example.com', now()), ('${NOBODY}', 'n@example.com', now());
INSERT INTO public.declutter_meetup_spots (parish, name, address, lat, lng, kind, active, created_by, seller_id, created_at) VALUES
  ('Iberia', 'My bank lot', '1 Main St, New Iberia', 30, -91.8, 'seller', true, NULL, '${ME}', '2026-11-01 10:00+00'),
  ('Iberia', 'Old spot', '2 Main St, New Iberia', 30, -91.8, 'seller', false, '${ME}', '${ME}', '2026-11-01 11:00+00'),
  ('Lafayette', 'Their lot', '9 Elm St, Lafayette', 30.2, -92, 'seller', true, NULL, '${OTHER}', now()),
  ('Lafayette', 'Police station', '5 Pine St, Lafayette', 30.2, -92, 'police', true, '${ADMIN}', NULL, now());`);
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
const spots = me?.declutter_meetup_spots;
ok(Array.isArray(spots) && spots.length === 2 && spots[0].name === "My bank lot" && spots[1].name === "Old spot",
  "the seller gets their own two spots (active and removed), oldest first", JSON.stringify(spots));
ok(spots?.every((s) => !("created_by" in s)), "  without created_by", JSON.stringify(spots));
ok(!JSON.stringify(me ?? {}).includes("Their lot") && !JSON.stringify(spots ?? []).includes("Police station"), "  never another seller's spot or a public one", JSON.stringify(spots));
ok(other?.declutter_meetup_spots?.length === 1 && other.declutter_meetup_spots[0].name === "Their lot", "the other seller gets only their own", JSON.stringify(other?.declutter_meetup_spots));
ok(Array.isArray(nobody?.declutter_meetup_spots) && nobody.declutter_meetup_spots.length === 0, "a member with none gets an empty list", JSON.stringify(nobody?.declutter_meetup_spots));
ok(Array.isArray(me?.instant_book_floors) && Array.isArray(me?.declutter_seller_porch_days) && me?.email === "me@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
