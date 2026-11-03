#!/usr/bin/env node
/**
 * PGlite proof for 20261103202529_shipping_buyer_export.sql (Q2259 S5): "Download My Data" carries the buyer's own
 * shipments (buyer_id = the member) with their ship-to address and tracking, without the internal columns (EasyPost
 * ids, the claim key, the worker's error and retry clock, the label path, the platform's label cost); never another
 * buyer's, never in the seller's export; every other section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/shippingBuyerExport.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/shippingBuyerExport.pglite.mjs  # RED: 20261103014109's body only
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * World: the export_my_data statements of 20261103014109 (the newest CREATE before this one, = prod's prosrc md5), then
 * this migration's 3x; every table the body reads stubbed with the columns it reads. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261103014109_crew_share_held_reason.sql";
const NEW_FILE = "20261103202529_shipping_buyer_export.sql";
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

// 1. The old body VERBATIM except the one shipments section.
const ADDED = `  -- Shipping (Q2259 S5, 20261103202529): the buyer's own shipments: the address they gave, the service, the tracking
  -- number and scans. EasyPost handles, the per-order claim key, the worker's error text and retry clock, the label
  -- file path and what the label cost the platform are internal and stay out.
  v_out := v_out || jsonb_build_object('shipments', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'idempotency_key'
      - 'provider_rate_id' - 'provider_shipment_id' - 'last_error' - 'attempts' - 'next_attempt_at' - 'label_path'
      - 'label_cost_cents' ORDER BY t.created_at), '[]'::jsonb) FROM public.shipments t
      WHERE t.buyer_id = v_uid));
`;
const ANCHOR = `  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'waived_by'), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));
`;
ok(oldDef.split(ANCHOR).length === 2 && def === oldDef.replace(ANCHOR, ANCHOR + ADDED),
  "the new body is 20261103014109's verbatim plus the one shipments section", skip ? "skip" : "");
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
// shipments with its real columns (20261020024605 + later ADD COLUMNs, as in the generated types); the stubs cover the rest.
await db.exec(`
DROP TABLE IF EXISTS public.shipments;
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), declutter_order_id uuid, shop_order_id uuid, buyer_id uuid,
  idempotency_key text NOT NULL, label_mode text NOT NULL, label_provider text NOT NULL DEFAULT 'easypost',
  label_state text NOT NULL DEFAULT 'claimed', service text NOT NULL, quoted_cents integer NOT NULL,
  extra_insurance_cents integer NOT NULL DEFAULT 0, provider_shipment_id text, provider_rate_id text, label_cost_cents integer,
  label_path text, tracking_code text, tracking_status text, accepted_at timestamptz, delivered_at timestamptz,
  ship_to jsonb NOT NULL, parcel jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text, packed_at timestamptz, is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- ended_by is read as text by the stub's name rule (another section compares a column of that name with a word); it is a
-- uuid on prod (20261101233256), compared with the member's id here.
ALTER TABLE public.declutter_manager_grants ALTER COLUMN ended_by TYPE uuid USING NULL;
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const ADMIN = "00000000-0000-0000-0000-0000000000dd";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'o@example.com', now()), ('${NOBODY}', 'n@example.com', now());
INSERT INTO public.shipments (buyer_id, idempotency_key, label_mode, label_state, service, quoted_cents, provider_shipment_id,
  provider_rate_id, label_cost_cents, label_path, tracking_code, tracking_status, ship_to, parcel, last_error, attempts, created_at) VALUES
  ('${ME}', 'declutter:o1', 'test', 'bought', 'usps_ground_advantage', 700, 'shp_1', 'rate_1', 650, 'labels/1.pdf', 'T1', 'delivered',
   '{"zip":"70506","street1":"1 Main St","city":"Lafayette","state":"LA"}', '{"weight_oz":16}', 'boom', 2, '2026-11-01 10:00+00'),
  ('${ME}', 'declutter:o2', 'test', 'claimed', 'usps_priority', 900, NULL, NULL, NULL, NULL, NULL, NULL,
   '{"zip":"70508","street1":"2 Oak St","city":"Lafayette","state":"LA"}', '{"weight_oz":8}', NULL, 0, '2026-11-02 10:00+00'),
  ('${OTHER}', 'declutter:o3', 'test', 'bought', 'usps_ground_advantage', 700, 'shp_3', 'rate_3', 650, 'labels/3.pdf', 'T3', 'in_transit',
   '{"zip":"70501","street1":"9 Elm St","city":"Lafayette","state":"LA"}', '{"weight_oz":16}', NULL, 0, now());`);
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
const ships = me?.shipments;
ok(Array.isArray(ships) && ships.length === 2 && ships[0].tracking_code === "T1" && ships[1].service === "usps_priority",
  "the buyer gets their own two shipments, oldest first", JSON.stringify(ships));
ok(ships?.[0]?.ship_to?.street1 === "1 Main St" && ships?.[0]?.tracking_status === "delivered" && ships?.[0]?.quoted_cents === 700,
  "  with their address, tracking and what they paid", JSON.stringify(ships?.[0]));
const INTERNAL = ["idempotency_key", "provider_rate_id", "provider_shipment_id", "last_error", "attempts", "next_attempt_at", "label_path", "label_cost_cents"];
ok(ships?.length > 0 && ships.every((r) => INTERNAL.every((k) => !(k in r))), "  without any internal column", JSON.stringify(ships));
ok(!JSON.stringify(me ?? {}).includes("9 Elm St"), "never another buyer's shipment", "");
ok(other?.shipments?.length === 1 && other.shipments[0].tracking_code === "T3", "the other buyer gets only their own", JSON.stringify(other?.shipments));
ok(Array.isArray(nobody?.shipments) && nobody.shipments.length === 0, "a member with none gets an empty list", JSON.stringify(nobody?.shipments));
ok(Array.isArray(me?.declutter_seller_fee_debts) && Array.isArray(me?.declutter_meetup_spots) && me?.email === "me@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
