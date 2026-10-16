#!/usr/bin/env node
/**
 * PGlite proof for 20261015084728_export_my_data_declutter_reconcile: Download
 * My Data keeps BOTH main's "Suggest a category" section (20261015052622, I1)
 * AND the Declutter sections (slices 3 / 3b / 4), whichever order the
 * export_my_data restatements reach a database in.
 *
 *   node src/test/pglite/exportMyDataReconcile.pglite.mjs                  # all PASS
 *   node src/test/pglite/exportMyDataReconcile.pglite.mjs --no-reconcile   # RED: the reconcile left out
 *   node src/test/pglite/exportMyDataReconcile.pglite.mjs --no-against     # RED: 20261015092457 left out (problems filed against the member missing)
 *   node src/test/pglite/exportMyDataReconcile.pglite.mjs --no-delivery    # RED: 20261016070800 left out (Helpr delivery sections missing)
 *
 * Two orders, each in its own database, starting from 20261014200728 (the
 * last export_my_data both lines of history share):
 *   REPLAY  every restatement in version order (a from-scratch rebuild):
 *           200728, 210518, 224914, 042253, 052622, [084728]
 *           without the reconcile, main's 052622 runs last and the Declutter
 *           sections are lost.
 *   PROD    what db-deploy --include-all does: prod already holds main's
 *           052622, then applies the branch's pending versions in version
 *           order: 210518, 224914, 042253, [084728]
 *           without the reconcile, slice 4's 042253 runs last and the
 *           category_suggestions section is lost.
 * Only the export_my_data statements (DROP / CREATE / REVOKE / GRANT) of each
 * migration are applied: the rest of each file is proven by its own proof
 * (declutterSlice3/3b/4.pglite.mjs).
 *
 * Then the final function is RUN for a member who has a category suggestion
 * and a Declutter offer, order, booking, payout and review, on stub tables
 * built from the columns the body itself reads (so every section executes).
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NO_RECONCILE = process.argv.includes("--no-reconcile");

const BASE = "20261014200728_declutter_slice2_followups.sql";
const SLICE3 = "20261014210518_declutter_slice3_offers_checkout.sql";
const SLICE3B = "20261014224914_declutter_slice3b_payments.sql";
const SLICE4 = "20261015042253_declutter_slice4_handover_payout.sql";
const MAIN_CAT = "20261015052622_export_my_data_category_suggestions.sql";
const RECONCILE = "20261015084728_export_my_data_declutter_reconcile.sql";
// 20261015092457 restates the reconcile's body plus declutter_problems_about_me (problems filed AGAINST the member).
const AGAINST = "20261015092457_export_my_data_declutter_problems_against.sql";
const NO_AGAINST = process.argv.includes("--no-against");
// 20261016070800 restates 092457's body plus the Helpr-delivery sections (slice 5).
const DELIVERY = "20261016070800_export_my_data_helpr_delivery.sql";
const NO_DELIVERY = process.argv.includes("--no-delivery");
const DELIVERY_SECTIONS = ["helpr_vehicles", "helpr_tasks", "helpr_task_events", "helpr_task_payouts", "declutter_delivery_dropoffs"];

const DECLUTTER_SECTIONS = [
  "declutter_offers", "declutter_orders", "declutter_cart_items", "declutter_buyer_cards",
  "declutter_seller_fee_debts", "declutter_bookings", "declutter_problems", "declutter_payouts", "declutter_reviews",
];

let failures = 0;
const check = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
};

/** The export_my_data statements of one migration: the no-arg DROP, the (uuid) CREATE (any dollar tag), its REVOKE/GRANT. */
function exportStatements(file) {
  const sql = readFileSync(`${MIG_DIR}${file}`, "utf8");
  const out = [];
  const drop = /^DROP FUNCTION IF EXISTS public\.export_my_data\(\);$/m.exec(sql);
  if (drop) out.push(drop[0]);
  const create = /CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)[\s\S]*?\bAS (\$\w*\$)/.exec(sql);
  if (!create) throw new Error(`${file}: no export_my_data(uuid) definition`);
  const end = sql.indexOf(create[1], create.index + create[0].length);
  out.push(`${sql.slice(create.index, end + create[1].length)};`);
  for (const m of sql.matchAll(/^(?:REVOKE|GRANT) [^\n]*public\.export_my_data\(uuid\)[^\n]*;$/gm)) out.push(m[0]);
  if (out.length !== 4) throw new Error(`${file}: expected DROP + CREATE + REVOKE + GRANT, read ${out.length}`);
  return out.join("\n");
}

const ROLES = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
-- prod's default function ACL (pg_default_acl): a new function is EXECUTE for anon/authenticated
-- until the migration revokes it, so a REVOKE that forgets a role shows here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

async function installedAfter(label, files) {
  const db = new PGlite();
  await db.exec(ROLES);
  for (const f of files) {
    for (let i = 0; i < (f === RECONCILE || f === AGAINST || f === DELIVERY ? 3 : 1); i++) await db.exec(exportStatements(f)); // the reconcile 3x: replay-safe
  }
  const def = (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
  const acl = (await db.query(`SELECT
      has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
      (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
  const missing = ["category_suggestions", ...DECLUTTER_SECTIONS].filter((s) => !def.includes(`jsonb_build_object('${s}'`));
  check(`${label}: the final export_my_data has category_suggestions AND all ${DECLUTTER_SECTIONS.length} Declutter sections`,
    missing.length === 0, `missing: ${missing.join(", ")}`);
  check(`${label}: still the one (uuid) overload, EXECUTE for service_role only`,
    acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, JSON.stringify(acl));
  return { db, def };
}

const tail = NO_RECONCILE ? [] : [RECONCILE, ...(NO_AGAINST ? [] : [AGAINST]), ...(NO_AGAINST || NO_DELIVERY ? [] : [DELIVERY])];
const replay = await installedAfter("REPLAY (version order)", [BASE, SLICE3, SLICE3B, SLICE4, MAIN_CAT, ...tail]);
const prod = await installedAfter("PROD (main's 052622 live, branch versions pending)", [BASE, MAIN_CAT, SLICE3, SLICE3B, SLICE4, ...tail]);
check("both orders end with the same body", replay.def === prod.def);

// ---------------------------------------------------------------------------
// RUN it: stub every table the body reads, with the columns it reads.
const def = replay.def;
const body = def.slice(def.indexOf("BEGIN"));
const tables = new Map(); // "schema.table" -> Set(columns)
for (const chunk of body.split(/;\s*\n/)) {
  const alias = new Map();
  for (const m of chunk.matchAll(/\b(?:FROM|JOIN)\s+(public|auth|storage)\.(\w+)\s+(?:AS\s+)?(\w+)/gi)) {
    const t = `${m[1]}.${m[2]}`;
    if (!tables.has(t)) tables.set(t, new Set());
    if (!alias.has(m[3])) alias.set(m[3], new Set());
    alias.get(m[3]).add(t);
  }
  for (const m of chunk.matchAll(/\b([a-z]\w*)\.([a-z_]\w*)\b/g)) {
    for (const t of alias.get(m[1]) ?? []) tables.get(t).add(m[2]);
  }
}
// Booleans the body reads as such (coalesce(t.x, false), t.x IS TRUE).
const BOOL = new Set([...body.matchAll(/coalesce\(\w+\.(\w+),\s*(?:true|false)\)|\w+\.(\w+) IS (?:NOT )?(?:TRUE|FALSE)\b/gi)].map((m) => m[1] ?? m[2]));
const typeOf = (c) =>
  BOOL.has(c) ? "boolean" :
  c === "id" || c.endsWith("_id") || c.endsWith("_by") ? "uuid"
  : c.endsWith("_at") || c === "slot_start" || c === "slot_end" ? "timestamptz"
  : c.startsWith("is_") ? "boolean"
  : c.endsWith("_cents") || c === "rating" || c === "slot_no" ? "integer"
  : "text";
const stubs = [];
for (const [t, cols] of tables) {
  cols.delete("id");
  const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
  stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
}
const db = replay.db;
await db.exec(stubs.join("\n"));
// The rows below need these tables even when the body (--no-reconcile) does not read them.
await db.exec(`
CREATE TABLE IF NOT EXISTS public.category_suggestions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid, handed_over_at timestamptz);
CREATE TABLE IF NOT EXISTS public.declutter_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid, seller_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_problems (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reviewer_id uuid, reviewee_id uuid);
CREATE TABLE IF NOT EXISTS public.helpr_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE IF NOT EXISTS public.helpr_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid);
CREATE TABLE IF NOT EXISTS public.helpr_task_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid);
CREATE TABLE IF NOT EXISTS public.helpr_task_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helpr_id uuid);
CREATE TABLE IF NOT EXISTS public.declutter_delivery_dropoffs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), buyer_id uuid);`);
// Columns the body only strips (`- 'reviewed_by'`), so the scan above cannot see them.
await db.exec(`
ALTER TABLE public.category_suggestions ADD COLUMN IF NOT EXISTS reviewed_by uuid, ADD COLUMN IF NOT EXISTS admin_note text;
ALTER TABLE public.declutter_problems ADD COLUMN IF NOT EXISTS decided_by uuid, ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS photo_paths text[], ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS dropoff_code text, ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS pickup_lat numeric, ADD COLUMN IF NOT EXISTS pickup_lng numeric, ADD COLUMN IF NOT EXISTS dropoff_address text,
  ADD COLUMN IF NOT EXISTS dropoff_lat numeric, ADD COLUMN IF NOT EXISTS dropoff_lng numeric, ADD COLUMN IF NOT EXISTS customer_id uuid,
  ADD COLUMN IF NOT EXISTS pickup_contact_id uuid, ADD COLUMN IF NOT EXISTS close_note text, ADD COLUMN IF NOT EXISTS dropoff_area text;
ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS stripe_transfer_id text, ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS amount_cents integer;
ALTER TABLE public.declutter_delivery_dropoffs ADD COLUMN IF NOT EXISTS address text;`);
await db.exec(`
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const STAFF = "00000000-0000-0000-0000-0000000000cc";
const ORDER = "00000000-0000-0000-0000-0000000000dd";
const OTHER_ORDER = "00000000-0000-0000-0000-0000000000ee";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'Me@Example.com', now() - interval '1 year');
INSERT INTO public.category_suggestions (user_id, reviewed_by, admin_note) VALUES ('${ME}', '${STAFF}', 'staff only');
INSERT INTO public.category_suggestions (user_id) VALUES ('${OTHER}');
INSERT INTO public.declutter_offers (buyer_id, seller_id) VALUES ('${ME}', '${OTHER}');
INSERT INTO public.declutter_orders (id, buyer_id, seller_id, handed_over_at) VALUES ('${ORDER}', '${OTHER}', '${ME}', now() - interval '20 days');
INSERT INTO public.declutter_bookings (buyer_id, seller_id) VALUES ('${OTHER}', '${ME}');
INSERT INTO public.declutter_payouts (seller_id) VALUES ('${ME}');
INSERT INTO public.declutter_problems (reporter_id, decided_by) VALUES ('${ME}', '${STAFF}');
INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id) VALUES ('${ORDER}', '${OTHER}', '${ME}');
-- Filed AGAINST me by the buyer of my order (photos, reporter and decider are the reporter's / staff's), one filed by a
-- since-deleted account (reporter NULL), and one on an order I am not part of.
INSERT INTO public.declutter_orders (id, buyer_id, seller_id) VALUES ('${OTHER_ORDER}', '${OTHER}', '${STAFF}');
INSERT INTO public.declutter_problems (order_id, reporter_id, decided_by, photo_paths, note) VALUES
  ('${ORDER}', '${OTHER}', '${STAFF}', ARRAY['declutter/problem/x.jpg'], 'chair was broken'),
  ('${ORDER}', NULL, NULL, '{}', 'from a deleted account'),
  ('${OTHER_ORDER}', '${OTHER}', NULL, '{}', 'not about me');
-- Slice 5: my truck; a delivery I made as the Helpr (the buyer OTHER, the seller STAFF) and one made by someone else;
-- my step on it; my pay; my typed drop-off address as a buyer, and someone else's.
INSERT INTO public.helpr_vehicles (user_id) VALUES ('${ME}'), ('${OTHER}');
INSERT INTO public.helpr_tasks (helpr_id, dropoff_code, pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
  customer_id, pickup_contact_id, close_note, dropoff_area) VALUES
  ('${ME}', '4821', '1 Seller St', 30.45, -91.18, '9 Buyer Rd', 30.6, -91.1, '${OTHER}', '${STAFF}', 'staff note', 'Baker, LA'),
  ('${OTHER}', '1111', 'x', 0, 0, 'y', 0, 0, '${ME}', '${STAFF}', NULL, 'Elsewhere');
INSERT INTO public.helpr_task_events (actor_id) VALUES ('${ME}'), ('${OTHER}');
INSERT INTO public.helpr_task_payouts (helpr_id, stripe_transfer_id, last_error, amount_cents) VALUES ('${ME}', 'tr_x', 'boom', 2620), ('${OTHER}', 'tr_y', NULL, 1);
INSERT INTO public.declutter_delivery_dropoffs (buyer_id, address) VALUES ('${ME}', '5 My Home Ln'), ('${OTHER}', '9 Buyer Rd');`);
let out;
try {
  out = (await db.query(`SELECT public.export_my_data('${ME}') AS x`)).rows[0].x;
} catch (e) {
  out = null;
  check("the final export_my_data RUNS", false, String(e.message ?? e));
}
if (out) {
  const len = (k) => (Array.isArray(out[k]) ? out[k].length : -1);
  check("the export carries category_suggestions: the member's own row only, staff reviewer and note stripped",
    len("category_suggestions") === 1 && !("reviewed_by" in out.category_suggestions[0]) && !("admin_note" in out.category_suggestions[0]),
    JSON.stringify(out.category_suggestions));
  const absent = DECLUTTER_SECTIONS.filter((s) => !(s in out));
  check("the export carries every Declutter section", absent.length === 0, `absent: ${absent.join(", ")}`);
  check("and fills them: offer, order, booking, payout, problem (decider stripped), review (reviewer stripped)",
    len("declutter_offers") === 1 && len("declutter_orders") === 1 && len("declutter_bookings") === 1 && len("declutter_payouts") === 1
      && len("declutter_problems") === 1 && !("decided_by" in out.declutter_problems[0])
      && len("declutter_reviews") === 1 && !("reviewer_id" in out.declutter_reviews[0]),
    JSON.stringify({ o: len("declutter_offers"), ord: len("declutter_orders"), b: len("declutter_bookings"), p: len("declutter_payouts"), pr: out.declutter_problems, r: out.declutter_reviews }));
  // lh-authz-rls should-fix (a) of the reconcile review: problems filed AGAINST the member are exported too.
  const about = Array.isArray(out.declutter_problems_about_me) ? out.declutter_problems_about_me : [];
  check("problems filed AGAINST the member are in the export (declutter_problems_about_me): both on my order, none from elsewhere",
    about.length === 2 && about.every((p) => p.order_id === ORDER), JSON.stringify(out.declutter_problems_about_me));
  check("...without the reporter's private fields (reporter_id, photo_paths) or the deciding admin, but with what was said",
    about.length > 0 && about.every((p) => !("reporter_id" in p) && !("photo_paths" in p) && !("decided_by" in p))
      && about.some((p) => p.note === "chair was broken"), JSON.stringify(about));
  check("the member's own report stays in declutter_problems only (not double-listed)",
    len("declutter_problems") === 1 && about.every((p) => p.note !== null && p.id !== out.declutter_problems[0]?.id));
  // Slice 5, Helpr delivery (20261016070800).
  const missingDelivery = DELIVERY_SECTIONS.filter((k) => !Array.isArray(out[k]));
  check("the export carries every Helpr-delivery section", missingDelivery.length === 0, `absent: ${missingDelivery.join(", ")}`);
  if (missingDelivery.length === 0) {
    check("...each scoped to the member: one vehicle, one task, one event, one payout, one drop-off",
      DELIVERY_SECTIONS.every((k) => out[k].length === 1), JSON.stringify(Object.fromEntries(DELIVERY_SECTIONS.map((k) => [k, out[k].length]))));
    const task = out.helpr_tasks[0] ?? {};
    const leaked = ["dropoff_code", "pickup_address", "pickup_lat", "pickup_lng", "dropoff_address", "dropoff_lat", "dropoff_lng",
      "customer_id", "pickup_contact_id", "close_note"].filter((k) => k in task);
    check("the Helpr's task keeps the area words but none of the buyer's or seller's address, points, ids, code or the staff note",
      leaked.length === 0 && task.dropoff_area === "Baker, LA", `leaked: ${leaked.join(", ")}`);
    const pay = out.helpr_task_payouts[0] ?? {};
    check("the Helpr's pay keeps the amount, not the Stripe transfer id or error text",
      pay.amount_cents === 2620 && !("stripe_transfer_id" in pay) && !("last_error" in pay), JSON.stringify(pay));
    check("the buyer's own typed drop-off address is theirs to download",
      out.declutter_delivery_dropoffs[0]?.address === "5 My Home Ln", JSON.stringify(out.declutter_delivery_dropoffs));
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}${NO_RECONCILE ? " [--no-reconcile]" : ""}${NO_AGAINST ? " [--no-against]" : ""}${NO_DELIVERY ? " [--no-delivery]" : ""}  (${tables.size} tables stubbed from the body)`);
process.exit(failures ? 1 : 0);
