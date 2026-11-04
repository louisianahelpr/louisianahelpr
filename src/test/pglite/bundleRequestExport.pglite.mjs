#!/usr/bin/env node
/**
 * PGlite proof for 20261104123305_bundle_request_export_and_notice_kinds.sql (Q2268): "Download My Data" carries
 * the member's own bundle requests (as the buyer or the seller) and the items on them; never a stranger's; every other
 * section, the search_path and the grants unchanged. And declutter_notice_type maps the six bundle titles explicitly.
 *
 *   node src/test/pglite/bundleRequestExport.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/bundleRequestExport.pglite.mjs  # RED: 20261103202529's body only
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * World: the export_my_data statements of 20261103202529 (the newest CREATE before this one, = prod's prosrc md5
 * 3015476916ab67674d8019117f8a110d, read 2026-11-04), then this migration's 3x; every table the body reads stubbed with the columns it reads. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261103202529_shipping_buyer_export.sql";
const NEW_FILE = "20261104123305_bundle_request_export_and_notice_kinds.sql";
const NT_BASE = "20261102103524_declutter_ship_notice_kinds.sql";
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

/** The declutter_notice_type CREATE (any dollar tag) and its REVOKE/GRANT. */
function noticeTypeStatements(sql, label) {
  const create = /CREATE OR REPLACE FUNCTION public\.declutter_notice_type\(p_type text, p_title text, p_link text\)[\s\S]*?\bAS (\$\w*\$)/.exec(sql);
  if (!create) throw new Error(`${label}: no declutter_notice_type definition`);
  const end = sql.indexOf(create[1], create.index + create[0].length);
  const out = [`${sql.slice(create.index, end + create[1].length)};`];
  for (const m of sql.matchAll(/^(?:REVOKE|GRANT) [^\n]*public\.declutter_notice_type\(text, text, text\)[^\n]*;$/gm)) out.push(m[0]);
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
await db.exec(noticeTypeStatements(readFileSync(`${MIG_DIR}${NT_BASE}`, "utf8"), NT_BASE));
const oldDef = await defOf();
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${NEW_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(exportStatements(sql, NEW_FILE));
      await db.exec(noticeTypeStatements(sql, NEW_FILE));
      ok(true, `the migration's export_my_data applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `the migration's export_my_data applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const def = await defOf();

// 1. The old body VERBATIM except the one bundle block.
const ANCHOR = `\n  RETURN v_out;\nEND;`;
const added = def.split(ANCHOR)[0].split("\n  -- Bundle requests (Q2268,")[1];
ok(oldDef.split(ANCHOR).length === 2 && added !== undefined
  && def === oldDef.replace(ANCHOR, "\n  -- Bundle requests (Q2268," + added + ANCHOR),
  "the new body is 20261103202529's verbatim plus the one bundle block", skip ? "skip" : "");
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
// shipments and the bundle tables with their real columns; the stubs cover the rest.
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
DROP TABLE IF EXISTS public.declutter_bundle_request_items;
DROP TABLE IF EXISTS public.declutter_bundle_requests;
CREATE TABLE public.declutter_bundle_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open', respond_by timestamptz NOT NULL, is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz);
CREATE TABLE public.declutter_bundle_request_items (request_id uuid NOT NULL REFERENCES public.declutter_bundle_requests(id), item_id uuid NOT NULL,
  price_cents integer NOT NULL, outcome text, line_id uuid, PRIMARY KEY (request_id, item_id));
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const THIRD = "00000000-0000-0000-0000-0000000000ee";
const R1 = "00000000-0000-0000-0000-000000000101"; // ME buys from OTHER
const R2 = "00000000-0000-0000-0000-000000000102"; // OTHER buys from ME
const R3 = "00000000-0000-0000-0000-000000000103"; // THIRD buys from OTHER: not ME's
const I = (n) => `00000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'o@example.com', now()),
  ('${NOBODY}', 'n@example.com', now()), ('${THIRD}', 't@example.com', now());
INSERT INTO public.declutter_bundle_requests (id, buyer_id, seller_id, status, respond_by, created_at) VALUES
  ('${R1}', '${ME}', '${OTHER}', 'answered', now() + interval '1 day', '2026-11-01 10:00+00'),
  ('${R2}', '${OTHER}', '${ME}', 'open', now() + interval '1 day', '2026-11-02 10:00+00'),
  ('${R3}', '${THIRD}', '${OTHER}', 'open', now() + interval '1 day', '2026-11-03 10:00+00');
INSERT INTO public.declutter_bundle_request_items (request_id, item_id, price_cents, outcome) VALUES
  ('${R1}', '${I(1)}', 1500, 'accepted'), ('${R1}', '${I(2)}', 900, 'not_picked'),
  ('${R2}', '${I(3)}', 2000, NULL),
  ('${R3}', '${I(4)}', 777, NULL);`);
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
const reqs = me?.declutter_bundle_requests;
ok(Array.isArray(reqs) && reqs.length === 2 && reqs[0].id === R1 && reqs[1].id === R2,
  "the member gets their own two bundle requests (as buyer and as seller), oldest first", JSON.stringify(reqs));
ok(reqs?.[0]?.status === "answered" && reqs?.[0]?.respond_by && reqs?.[1]?.seller_id === ME, "  with status, deadline and both sides", JSON.stringify(reqs?.[0]));
const items = me?.declutter_bundle_request_items;
ok(Array.isArray(items) && items.length === 3 && items.map((x) => x.item_id).sort().join() === [I(1), I(2), I(3)].join(),
  "the member gets the items on their own requests (both sides)", JSON.stringify(items));
ok(items?.find((x) => x.item_id === I(1))?.outcome === "accepted" && items?.find((x) => x.item_id === I(1))?.price_cents === 1500,
  "  with the asked price and the seller's answer", JSON.stringify(items));
ok(me != null && !JSON.stringify(me).includes(R3) && !JSON.stringify(me).includes(I(4)) && !JSON.stringify(me).includes(THIRD),
  "never a request or item between two other members", "");
ok(other?.declutter_bundle_requests?.length === 3 && other?.declutter_bundle_request_items?.length === 4,
  "the seller of all three gets all three and their four items", JSON.stringify(other?.declutter_bundle_requests?.length));
ok(Array.isArray(nobody?.declutter_bundle_requests) && nobody.declutter_bundle_requests.length === 0
  && Array.isArray(nobody?.declutter_bundle_request_items) && nobody.declutter_bundle_request_items.length === 0,
  "a member with none gets two empty lists", JSON.stringify([nobody?.declutter_bundle_requests, nobody?.declutter_bundle_request_items]));
ok(Array.isArray(me?.shipments) && Array.isArray(me?.declutter_manager_payouts) && me?.email === "me@example.com", "the other sections are still there");

// 4. declutter_notice_type: the six bundle titles map to their kinds explicitly (by title, whatever the caller's type).
const LINK = "/declutter?tab=buying";
const KIND = {
  "Bundle request": "declutter_offers", "Bundle request declined": "declutter_offers", "Bundle request closed": "declutter_offers",
  "Bundle request expired": "declutter_offers",
  "Bundle accepted: pay within 24 hours": "declutter_sales", "Save a card to get your bundle": "declutter_sales",
};
for (const [title, kind] of Object.entries(KIND)) {
  // 'info' would fall back to declutter_listings: only an explicit title entry gives the kind.
  const got = (await db.query(`SELECT public.declutter_notice_type('info', $1, $2) AS k`, [title, LINK])).rows[0].k;
  ok(got === kind, `"${title}" -> ${kind}`, got);
}
const nt = (await db.query(`SELECT public.declutter_notice_type('payment', 'Buyer paid', $1) AS a, public.declutter_notice_type('info', 'Bundle request', '/jobs') AS b`, [LINK])).rows[0];
ok(nt.a === "declutter_sales" && nt.b === "info", "the other titles and the non-Declutter pass-through are unchanged", JSON.stringify(nt));
const ntAcl = (await db.query(`SELECT has_function_privilege('authenticated', 'public.declutter_notice_type(text, text, text)', 'EXECUTE') AS a,
  has_function_privilege('anon', 'public.declutter_notice_type(text, text, text)', 'EXECUTE') AS b`)).rows[0];
ok(!ntAcl.a && !ntAcl.b, "declutter_notice_type still not executable by anon or authenticated", JSON.stringify(ntAcl));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
