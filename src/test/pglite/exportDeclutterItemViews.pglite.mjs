#!/usr/bin/env node
/**
 * PGlite proof for 20261105184827_export_declutter_item_views.sql (Q2752): "Download My Data" carries the member's own
 * Declutter item views (declutter_item_views, 20261105163501) as item_id + created_at; never another member's or a
 * device's; and the job photos they picked for their public page (profile_job_photos, 20261105172514; id, job_id,
 * photo_path, created_at, their own only); every other section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/exportDeclutterItemViews.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportDeclutterItemViews.pglite.mjs  # RED: 20261104123305's body only
 *   MIGRATION_PATH=<planted copy> node ...                                      # RED on a planted defect
 *
 * World: the export_my_data statements of 20261104123305 (the newest CREATE before this one, = prod's prosrc md5
 * 7e3694155fb5f9d9f121c2781298f581, read 2026-11-05), then this migration's 3x; every table the body reads stubbed with
 * the columns it reads (the harness of bundleRequestExport.pglite.mjs). pglite is loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261104123305_bundle_request_export_and_notice_kinds.sql";
const NEW_FILE = "20261105184827_export_declutter_item_views.sql";
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

// 1. The old body VERBATIM except the one item-views block.
const MARK = "\n  -- Q2752: the member's own Declutter item views";
const AFTER = "\n  v_out := v_out || jsonb_build_object('pet_profiles',";
const added = def.includes(MARK) ? def.slice(def.indexOf(MARK), def.indexOf(AFTER)) : null;
// The second block: the job photos a member picked for their page (20261105172514), after profile_handles_retired.
const MARK2 = "\n\n  -- Owner 11-05 share-profile H4 (20261105172514)";
const AFTER2 = "\n\n  -- CMP-4 instant book";
const added2 = def.includes(MARK2) ? def.slice(def.indexOf(MARK2), def.indexOf(AFTER2, def.indexOf(MARK2))) : null;
ok(added !== null && added2 !== null && def.replace(added, "").replace(added2, "") === oldDef,
  "the new body is 20261104123305's verbatim plus the item-views block and the job-photos block", skip ? "skip" : "");
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
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;
DROP TABLE IF EXISTS public.declutter_item_views;
CREATE TABLE public.declutter_item_views (item_id uuid NOT NULL, viewer_id uuid, device_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_item_views_one_viewer CHECK ((viewer_id IS NULL) <> (device_id IS NULL)));
DROP TABLE IF EXISTS public.profile_job_photos;
CREATE TABLE public.profile_job_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, job_id uuid NOT NULL,
  photo_path text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const DEVICE = "00000000-0000-0000-0000-0000000000dd";
const I = (n) => `00000000-0000-0000-0000-0000000002${String(n).padStart(2, "0")}`;
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'o@example.com', now()), ('${NOBODY}', 'n@example.com', now());
INSERT INTO public.declutter_item_views (item_id, viewer_id, device_id, created_at) VALUES
  ('${I(1)}', '${ME}', NULL, '2026-11-05 10:00+00'), ('${I(2)}', '${ME}', NULL, '2026-11-05 11:00+00'),
  ('${I(1)}', '${OTHER}', NULL, '2026-11-05 12:00+00'), ('${I(3)}', NULL, '${DEVICE}', '2026-11-05 13:00+00');`);
const J = "00000000-0000-0000-0000-000000000301";
await db.exec(`INSERT INTO public.profile_job_photos (user_id, job_id, photo_path, created_at) VALUES
  ('${ME}', '${J}', '${J}/after-1.jpg', '2026-11-05 10:00+00'), ('${OTHER}', '${J}', '${J}/after-2.jpg', '2026-11-05 11:00+00');`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const me = await exportOf(ME);
const nobody = await exportOf(NOBODY);
const views = me?.declutter_item_views;
ok(Array.isArray(views) && views.length === 2 && views[0].item_id === I(1) && views[1].item_id === I(2) && !!views[0].created_at,
  "the member gets their own two item views (item, time), oldest first", JSON.stringify(views));
ok(Array.isArray(views) && views.every((v) => Object.keys(v).sort().join() === "created_at,item_id"),
  "  only item_id and created_at (no viewer or device id)", JSON.stringify(views));
ok(me != null && !JSON.stringify(me).includes(OTHER) && !JSON.stringify(me).includes(DEVICE) && !JSON.stringify(me).includes(I(3)),
  "never another member's view or a device's view", "");
ok(Array.isArray(nobody?.declutter_item_views) && nobody.declutter_item_views.length === 0, "a member with none gets an empty list",
  JSON.stringify(nobody?.declutter_item_views));
const picks = me?.profile_job_photos;
ok(Array.isArray(picks) && picks.length === 1 && picks[0].job_id === J && picks[0].photo_path === `${J}/after-1.jpg`
    && Object.keys(picks[0]).sort().join() === "created_at,id,job_id,photo_path",
  "the member gets their own job-photo pick (id, job, photo, time), never another member's", JSON.stringify(picks));
ok(Array.isArray(nobody?.profile_job_photos) && nobody.profile_job_photos.length === 0, "a member with no picks gets an empty list",
  JSON.stringify(nobody?.profile_job_photos));
ok(Array.isArray(me?.profile_views) && Array.isArray(me?.declutter_bundle_requests) && me?.email === "me@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
