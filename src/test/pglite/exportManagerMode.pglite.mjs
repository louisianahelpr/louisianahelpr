#!/usr/bin/env node
/**
 * PGlite proof for 20261102161715_export_my_data_manager_mode.sql (Builder 4, batch fix for PR #4014): "Download My
 * Data" carries the member's Declutter manager-mode rows, as the seller or the manager, never another pair's; the
 * manager payout only with its member-readable columns; every other section, the search_path and the grants unchanged.
 *
 *   node src/test/pglite/exportManagerMode.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportManagerMode.pglite.mjs  # RED: 20261102074248's body only
 *
 * World: the export_my_data statements of 20261102074248 (the newest CREATE before this one), then this migration's
 * 3x; every table the body reads stubbed with the columns it reads. pglite loads from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261102074248_export_my_data_handovers_fee_debts.sql";
const NEW_FILE = "20261102161715_export_my_data_manager_mode.sql";
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

// 1. The old body VERBATIM except the six new last sections.
const ANCHOR = `FROM public.member_section_prefs t
      WHERE t.user_id = v_uid));
`;
const added = (() => {
  const s = readFileSync(`${MIG_DIR}${NEW_FILE}`, "utf8");
  const a = s.indexOf("  -- Declutter manager mode (20261101181005");
  return s.slice(a, s.indexOf("\n  RETURN v_out;", a));
})();
ok(oldDef.split(ANCHOR).length === 2 && def === oldDef.replace(ANCHOR, ANCHOR + added),
  "the new body is 20261102074248's verbatim plus the six manager-mode sections", skip ? "skip" : "");
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
  : c.endsWith("_cents") || c === "rating" || c === "slot_no" || c === "share_pct" ? "integer"
  : c === "weekdays" ? "smallint[]"
  : "text";
const stubs = [];
for (const [t, cols] of tables) {
  cols.delete("id");
  const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
  stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
}
await db.exec(stubs.join("\n"));
// Helpers the body calls.
await db.exec(`
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);
// The six manager-mode tables with the columns of their real definitions the body and this proof touch
// (20261101181005, 20261101230509, 20261101233256), the payout's member-hidden columns included.
await db.exec(`
DROP TABLE IF EXISTS public.declutter_manager_grants, public.declutter_manager_actions, public.declutter_manager_messages,
  public.declutter_manager_submissions, public.declutter_order_manager_shares, public.declutter_manager_payouts;
CREATE TABLE public.declutter_manager_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, manager_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offered', ended_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_manager_actions (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, seller_id uuid NOT NULL, manager_id uuid NOT NULL,
  action text NOT NULL DEFAULT 'list', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_manager_messages (message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, manager_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_manager_submissions (item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid NOT NULL, manager_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_order_manager_shares (order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, manager_id uuid,
  locked_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_manager_payouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid DEFAULT gen_random_uuid(),
  seller_payout_id uuid DEFAULT gen_random_uuid(), grant_id uuid DEFAULT gen_random_uuid(), seller_id uuid, manager_id uuid,
  share_cents integer NOT NULL, amount_cents integer NOT NULL, status text NOT NULL, stripe_transfer_id text, last_error text,
  review_reason text, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz);`);

const SELLER = "00000000-0000-0000-0000-0000000000aa";
const MANAGER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc";
const STRANGER = "00000000-0000-0000-0000-0000000000dd";
const STRANGER2 = "00000000-0000-0000-0000-0000000000ee";
const G = "30000000-0000-0000-0000-000000000001";
const G2 = "30000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${SELLER}', 's@example.com', now()), ('${MANAGER}', 'm@example.com', now()),
  ('${NOBODY}', 'n@example.com', now()), ('${STRANGER}', 'x@example.com', now()), ('${STRANGER2}', 'y@example.com', now());
INSERT INTO public.declutter_manager_grants (id, seller_id, manager_id, ended_by, created_at) VALUES
  ('${G}', '${SELLER}', '${MANAGER}', '${MANAGER}', '2026-11-01 10:00+00'), ('${G2}', '${STRANGER}', '${STRANGER2}', NULL, '2026-11-01 11:00+00');
INSERT INTO public.declutter_manager_actions (seller_id, manager_id, created_at) VALUES
  ('${SELLER}', '${MANAGER}', '2026-11-01 10:05+00'), ('${STRANGER}', '${STRANGER2}', '2026-11-01 11:05+00');
INSERT INTO public.declutter_manager_messages (seller_id, manager_id, created_at) VALUES
  ('${SELLER}', '${MANAGER}', '2026-11-01 10:06+00'), ('${STRANGER}', '${STRANGER2}', '2026-11-01 11:06+00');
INSERT INTO public.declutter_manager_submissions (seller_id, manager_id, submitted_at) VALUES
  ('${SELLER}', '${MANAGER}', '2026-11-01 10:07+00'), ('${STRANGER}', '${STRANGER2}', '2026-11-01 11:07+00');
INSERT INTO public.declutter_order_manager_shares (seller_id, manager_id, locked_at) VALUES
  ('${SELLER}', '${MANAGER}', '2026-11-01 10:08+00'), ('${STRANGER}', '${STRANGER2}', '2026-11-01 11:08+00');
INSERT INTO public.declutter_manager_payouts (seller_id, manager_id, share_cents, amount_cents, status, created_at, stripe_transfer_id, last_error, review_reason) VALUES
  ('${SELLER}', '${MANAGER}', 500, 500, 'succeeded', '2026-11-01 10:09+00', 'tr_secret', 'boom', 'held why'),
  ('${STRANGER}', '${STRANGER2}', 700, 700, 'pending', '2026-11-01 11:09+00', NULL, NULL, NULL);`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, `${e.message} ${e.where ?? ""} ${e.internalQuery ?? ""}`.slice(0, 600));
    return null;
  }
};
const SECTIONS = ["declutter_manager_grants", "declutter_manager_actions", "declutter_manager_messages", "declutter_manager_submissions", "declutter_order_manager_shares", "declutter_manager_payouts"];
for (const [who, uid] of [["the seller", SELLER], ["the manager", MANAGER]]) {
  const out = await exportOf(uid);
  for (const s of SECTIONS) {
    const rows = out?.[s];
    ok(Array.isArray(rows) && rows.length === 1 && rows[0].seller_id === SELLER && rows[0].manager_id === MANAGER, `${who} gets their one ${s} row`, JSON.stringify(rows));
  }
  const p = out?.declutter_manager_payouts?.[0] ?? {};
  ok(p.amount_cents === 500 && p.status === "succeeded" && !("stripe_transfer_id" in p) && !("last_error" in p) && !("review_reason" in p) && !("seller_payout_id" in p) && !("grant_id" in p),
    `  ${who}'s payout row has no Stripe id, error, review reason or internal ids`, JSON.stringify(p));
  ok(!JSON.stringify(out ?? {}).includes(STRANGER), `  ${who} never gets another pair's rows`);
}
const nobody = await exportOf(NOBODY);
ok(SECTIONS.every((s) => Array.isArray(nobody?.[s]) && nobody[s].length === 0), "a member with none gets six empty lists");
ok(Array.isArray(nobody?.member_section_prefs) && Array.isArray(nobody?.helpr_card_fee_debts) && nobody?.email === "n@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
