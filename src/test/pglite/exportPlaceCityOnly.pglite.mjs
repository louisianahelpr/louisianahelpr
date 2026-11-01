#!/usr/bin/env node
/**
 * PGlite proof for 20261101061156_export_my_data_place_city_only.sql: in "Download My Data", the buyer's copy of the
 * pickup place frozen on their order has the city only, never the seller's label (owner 2026-10-31 "Pickup places
 * show the CITY only, never the place's label"); the seller's own copy keeps label and address; nothing else changes.
 *
 *   node src/test/pglite/exportPlaceCityOnly.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportPlaceCityOnly.pglite.mjs  # RED: 20261101025001's body only
 *   MIGRATION_PATH=<planted copy> node ...                                   # RED on a planted defect
 *
 * World: the export_my_data statements of 20261101025001 (the newest CREATE before this one), then this migration's
 * 3x; every table the body reads stubbed with the columns it reads, the three place tables with their real columns.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261101025001_export_my_data_released_helpr.sql";
const NEW_FILE = "20261101061156_export_my_data_place_city_only.sql";
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

// 1. The old body VERBATIM except the one dropped key.
const CHANGE = ["- 'seller_id' END), '[]'::jsonb) FROM public.declutter_order_porch_places t", "- 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t"];
ok(oldDef.split(CHANGE[0]).length === 2 && def === oldDef.replace(CHANGE[0], CHANGE[1]), "the new body is 20261101025001's verbatim except the buyer's copy drops 'label'", skip ? "skip" : "");

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
// The three tables as 20261030164712 has them; the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.declutter_porch_places, public.declutter_porch_place_choices, public.declutter_order_porch_places;
CREATE TABLE public.declutter_porch_places (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, position smallint NOT NULL, label text NOT NULL, address text NOT NULL, area text NOT NULL, lat numeric, lng numeric, weekdays smallint[] NOT NULL, windows jsonb);
CREATE TABLE public.declutter_porch_place_choices (buyer_id uuid NOT NULL, seller_id uuid NOT NULL, place_id uuid NOT NULL, chosen_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_order_porch_places (order_id uuid PRIMARY KEY, seller_id uuid, place_id uuid, label text, address text, area text, lat numeric, lng numeric, weekdays smallint[] NOT NULL, frozen_at timestamptz NOT NULL DEFAULT now(), windows jsonb);
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const SELLER = "00000000-0000-0000-0000-0000000000aa";
const BUYER = "00000000-0000-0000-0000-0000000000bb";
const STRANGER = "00000000-0000-0000-0000-0000000000cc";
const ORDER = "00000000-0000-0000-0000-0000000000d1";
const PLACE = "00000000-0000-0000-0000-0000000000e1";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${SELLER}', 's@example.com', now()), ('${BUYER}', 'b@example.com', now()), ('${STRANGER}', 'x@example.com', now());
INSERT INTO public.declutter_orders (id, buyer_id, seller_id) VALUES ('${ORDER}', '${BUYER}', '${SELLER}');
INSERT INTO public.declutter_porch_places (id, seller_id, position, label, address, area, lat, lng, weekdays)
  VALUES ('${PLACE}', '${SELLER}', 0, 'Camp', '99 Camp Road, New Orleans', 'New Orleans', 29.95, -90.07, ARRAY[6]::smallint[]);
INSERT INTO public.declutter_porch_place_choices (buyer_id, seller_id, place_id) VALUES ('${BUYER}', '${SELLER}', '${PLACE}');
INSERT INTO public.declutter_order_porch_places (order_id, seller_id, place_id, label, address, area, lat, lng, weekdays)
  VALUES ('${ORDER}', '${SELLER}', '${PLACE}', 'Camp', '99 Camp Road, New Orleans', 'New Orleans', 29.95, -90.07, ARRAY[6]::smallint[]);`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const seller = await exportOf(SELLER);
const buyer = await exportOf(BUYER);
const stranger = await exportOf(STRANGER);
ok(seller?.declutter_porch_places?.[0]?.address === "99 Camp Road, New Orleans", "the seller gets their own place, with its address", JSON.stringify(seller?.declutter_porch_places));
ok(buyer?.declutter_porch_places?.length === 0, "  the buyer does not get the seller's places");
ok(buyer?.declutter_porch_place_choices?.[0]?.place_id === PLACE, "the buyer gets their own pick");
ok(seller?.declutter_porch_place_choices?.length === 0, "  the seller never sees the buyer's pick");
ok(seller?.declutter_order_porch_places?.[0]?.address === "99 Camp Road, New Orleans", "the seller's copy of the frozen place has the address");
const bf = buyer?.declutter_order_porch_places?.[0];
ok(bf?.area === "New Orleans" && !("label" in bf) && !JSON.stringify(bf).includes("Camp"), "the buyer's copy has the city only, never the seller's label", JSON.stringify(bf));
ok(seller?.declutter_order_porch_places?.[0]?.label === "Camp", "  the seller's own copy keeps their label", JSON.stringify(seller?.declutter_order_porch_places));
ok(bf && !("address" in bf) && !("lat" in bf) && !("lng" in bf) && !("seller_id" in bf), "  and has no address, point or seller id", JSON.stringify(bf));
ok(Array.isArray(stranger?.declutter_order_porch_places) && stranger.declutter_order_porch_places.length === 0 && stranger.declutter_porch_places.length === 0, "a stranger gets none of it");
ok(Array.isArray(seller?.declutter_seller_porch_days), "the porch days section is still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
