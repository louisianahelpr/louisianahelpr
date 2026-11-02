#!/usr/bin/env node
/**
 * PGlite proof for Builder 160's two migrations (2026-11-02):
 *   20261102074244_member_section_prefs.sql (Q2199): the member's own Customize row, own-row RLS, anon nothing.
 *   20261102074248_export_my_data_handovers_fee_debts.sql: export_my_data restated from 20261102030000 VERBATIM except
 *     declutter_seller_fee_debts drops waived_by, plus five sections (declutter_handovers without the code,
 *     declutter_haul_aways and declutter_donations through the seller's items, helpr_card_fee_debts without
 *     refund_ref, member_section_prefs).
 *
 *   node src/test/pglite/sectionPrefsAndExport.pglite.mjs                      # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/sectionPrefsAndExport.pglite.mjs   # RED: neither migration applied
 *   PREFS_PATH=<planted copy> / EXPORT_PATH=<planted copy> node ...             # RED on a planted defect
 *
 * World: Supabase's default privileges (a new table is ALL for anon/authenticated, a new function EXECUTE for both,
 * until the migration revokes), auth.uid() from request.jwt.claim.sub, then 20261102030000's export statements, then
 * each migration 3x. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261102030000_export_my_data_continue_days.sql";
const PREFS_FILE = "20261102074244_member_section_prefs.sql";
const EXPORT_FILE = "20261102074248_export_my_data_handovers_fee_debts.sql";
const skip = process.env.NEW_MIGRATION === "skip";
if (skip) console.log("NEW_MIGRATION=skip: running WITHOUT the new migrations (expect FAILs)");

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
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
-- The unconfirmed-email gate (Q807) is attached by the migration; its body is proven in its own proof.
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Supabase's default ACLs: a new table / function is open to anon and authenticated until the migration revokes it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);

// ---------- 1. Q2199: member_section_prefs ----------
const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${ME}', 'me@example.com'), ('${OTHER}', 'o@example.com');`);
if (!skip) {
  const sql = readFileSync(process.env.PREFS_PATH ?? `${MIG_DIR}${PREFS_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(sql);
      ok(true, `${PREFS_FILE} applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `${PREFS_FILE} applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const as = (uid) => uid
  ? `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid}', false);`
  : `SET ROLE anon; SELECT set_config('request.jwt.claim.sub', '', false);`;
const reset = `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`;
async function tryAs(uid, sql) {
  try {
    await db.exec(as(uid));
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows ?? 0 };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec(reset);
  }
}
const ins = (uid, order, hidden) =>
  `INSERT INTO public.member_section_prefs (user_id, section_order, sections_hidden) VALUES ('${uid}', ARRAY[${order}]::text[], ARRAY[${hidden}]::text[])`;
const r1 = await tryAs(ME, ins(ME, "'declutter','jobs','shops','homes'", "'shops'"));
ok(!r1.error, "a member saves their own Customize row", r1.error);
const r2 = await tryAs(ME, ins(OTHER, "'jobs'", "'homes'"));
ok(!!r2.error, "a member cannot write another member's row", r2.error ?? "inserted");
await db.exec(ins(OTHER, "'jobs','declutter','shops','homes'", "'homes','shops'")).catch((e) => ok(false, "seed another member's row", e.message));
const r3 = await tryAs(ME, "SELECT user_id::text, sections_hidden FROM public.member_section_prefs ORDER BY user_id");
ok(!r3.error && r3.rows.length === 1 && r3.rows[0].user_id === ME && r3.rows[0].sections_hidden.join() === "shops",
  "a member reads only their own row", JSON.stringify(r3));
const r4 = await tryAs(ME, `UPDATE public.member_section_prefs SET sections_hidden = ARRAY['jobs']::text[] WHERE user_id = '${OTHER}'`);
const q1 = async (sql) => { try { return (await db.query(sql)).rows[0]; } catch (e) { return { error: e.message }; } };
const otherNow = await q1(`SELECT sections_hidden FROM public.member_section_prefs WHERE user_id = '${OTHER}'`);
ok(!r4.error && otherNow?.sections_hidden?.join() === "homes,shops", "a member's update never reaches another member's row", JSON.stringify({ r4, otherNow }));
const r5 = await tryAs(ME, `UPDATE public.member_section_prefs SET sections_hidden = ARRAY['homes']::text[] WHERE user_id = '${ME}'`);
const meNow = await q1(`SELECT sections_hidden FROM public.member_section_prefs WHERE user_id = '${ME}'`);
ok(!r5.error && meNow?.sections_hidden?.join() === "homes", "a member changes their own row", JSON.stringify({ r5, meNow }));
const r6 = await tryAs(ME, `UPDATE public.member_section_prefs SET user_id = '${OTHER}' WHERE user_id = '${ME}'`);
ok(!!r6.error, "a member cannot move their row to another account", r6.error ?? "moved");
const r7 = await tryAs(ME, `DELETE FROM public.member_section_prefs WHERE user_id = '${ME}'`);
const stillThere = (await q1(`SELECT count(*)::int AS n FROM public.member_section_prefs WHERE user_id = '${ME}'`)).n;
ok(!!r7.error && stillThere === 1, "no member DELETE (the row goes with the account)", JSON.stringify({ r7, stillThere }));
const r8 = await tryAs(null, "SELECT * FROM public.member_section_prefs");
const r9 = await tryAs(null, ins(ME, "'jobs'", ""));
ok(!!r8.error && !!r9.error, "anon can neither read nor write (default grant revoked)", JSON.stringify({ r8, r9 }));
for (const [label, sql] of [
  ["all four hidden", ins(OTHER, "'jobs'", "'jobs','declutter','shops','homes'")],
  ["an unknown key", ins(OTHER, "'jobs','wanted'", "")],
  ["a key twice", ins(OTHER, "'jobs','jobs'", "")],
  ["a NULL key", ins(OTHER, "'jobs',NULL", "")],
]) {
  await db.exec(`DELETE FROM public.member_section_prefs WHERE user_id = '${OTHER}'`).catch(() => {});
  let err = null;
  try { await db.exec(sql); } catch (e) { err = e.message; }
  ok(!!err, `the CHECK refuses ${label}`, err ?? "stored");
}
let cascaded = null;
try {
  await db.exec(`DELETE FROM auth.users WHERE id = '${OTHER}'; INSERT INTO auth.users (id, email) VALUES ('${OTHER}', 'o@example.com');`);
  await db.exec(ins(OTHER, "'jobs'", ""));
  await db.exec(`DELETE FROM auth.users WHERE id = '${OTHER}'`);
  cascaded = (await db.query(`SELECT count(*)::int AS n FROM public.member_section_prefs WHERE user_id = '${OTHER}'`)).rows[0].n;
} catch (e) {
  cascaded = e.message;
}
ok(cascaded === 0, "deleting the account removes its row", String(cascaded));

// ---------- 2. export_my_data ----------
const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
await db.exec(exportStatements(readFileSync(`${MIG_DIR}${BASE}`, "utf8"), BASE));
const oldDef = await defOf();
if (!skip) {
  const sql = readFileSync(process.env.EXPORT_PATH ?? `${MIG_DIR}${EXPORT_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) {
    try {
      await db.exec(exportStatements(sql, EXPORT_FILE));
      ok(true, `${EXPORT_FILE}'s export_my_data applies (run ${i + 1} of 3)`);
    } catch (e) {
      ok(false, `${EXPORT_FILE}'s export_my_data applies (run ${i + 1} of 3)`, e.message);
    }
  }
}
const def = await defOf();
const OLD_FEE = "jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t";
const NEW_FEE = "jsonb_agg(to_jsonb(t) - 'waived_by'), '[]'::jsonb) FROM public.declutter_seller_fee_debts t";
const ANCHOR = `        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
`;
const added = def.includes(ANCHOR) ? def.slice(def.lastIndexOf(ANCHOR) + ANCHOR.length, def.lastIndexOf("RETURN v_out;")) : "";
const expected = oldDef.replace(OLD_FEE, NEW_FEE);
const head = (d) => d.slice(0, d.lastIndexOf(ANCHOR) + ANCHOR.length);
const foot = (d) => d.slice(d.lastIndexOf("RETURN v_out;"));
const oldTail = expected.slice(head(expected).length, expected.lastIndexOf("RETURN v_out;"));
ok(oldDef.split(OLD_FEE).length === 2 && oldDef.includes(ANCHOR) && oldTail === "\n  "
  && head(def) === head(expected) && foot(def) === foot(expected) && added.trim().length > 0,
  "the new body is 20261102030000's verbatim except the waived_by strip and the new last sections",
  skip ? "skip" : JSON.stringify({ fee: oldDef.split(OLD_FEE).length, anchors: oldDef.split(ANCHOR).length, oldTail, head: head(def) === head(expected), foot: foot(def) === foot(expected) }));
for (const s of ["declutter_handovers", "declutter_haul_aways", "declutter_donations", "helpr_card_fee_debts", "member_section_prefs"]) {
  ok(added.includes(`jsonb_build_object('${s}'`), `  the added sections include ${s}`);
}
const acl = (await db.query(`SELECT
    has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
    has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
    has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
    (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
ok(acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, "still the one (uuid) overload, EXECUTE for service_role only", JSON.stringify(acl));

// RUN it: stub every table the body reads (not already real), with the columns it reads.
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
const REAL = new Set(["auth.users", "public.member_section_prefs", "public.declutter_handovers", "public.declutter_haul_aways",
  "public.declutter_donations", "public.helpr_card_fee_debts", "public.declutter_seller_fee_debts", "public.declutter_orders", "public.declutter_items"]);
const stubs = [];
for (const [t, cols] of tables) {
  if (REAL.has(t)) continue;
  cols.delete("id");
  const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
  stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
}
await db.exec(stubs.join("\n"));
// The tables this proof is about, with their real columns (types.ts rows); the Declutter orders/items with the
// columns the body reads plus their owners.
const colsOf = (t) => [...(tables.get(t) ?? [])].filter((c) => !["id", "buyer_id", "seller_id"].includes(c));
await db.exec(`
CREATE TABLE IF NOT EXISTS public.member_section_prefs (user_id uuid PRIMARY KEY, section_order text[] NOT NULL DEFAULT '{}', sections_hidden text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid${colsOf("public.declutter_orders").map((c) => `, ${c} ${typeOf(c)}`).join("")});
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid${colsOf("public.declutter_items").map((c) => `, ${c} ${typeOf(c)}`).join("")});
CREATE TABLE public.declutter_handovers (order_id uuid PRIMARY KEY, code text NOT NULL, confirmed_at timestamptz, confirmed_by text,
  created_at timestamptz NOT NULL DEFAULT now(), picked_up_at timestamptz, picked_up_distance_m integer, picked_up_photo_path text,
  set_out_at timestamptz, set_out_photo_path text, set_out_note text, set_out_distance_m integer, seller_confirmed_at timestamptz,
  no_show_reported_at timestamptz, no_show_answer_by timestamptz, held_nudged_at timestamptz, wrong_attempts integer NOT NULL DEFAULT 0);
CREATE TABLE public.declutter_haul_aways (item_id uuid PRIMARY KEY, job_id uuid, prior_status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_donations (item_id uuid PRIMARY KEY, job_id uuid, partner_id uuid, partner_name text NOT NULL, partner_address text NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now(), donated_at timestamptz);
CREATE TABLE public.helpr_card_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), helper_id uuid, source text NOT NULL, recurring_visit_payment_id uuid,
  job_id uuid, card_fee_cents integer NOT NULL, remaining_cents integer NOT NULL, refund_ref text, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_seller_fee_debts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seller_id uuid, amount_cents integer, remaining_cents integer,
  waived_at timestamptz, waived_by uuid, waived_cents integer, waive_note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const BUYER = "00000000-0000-0000-0000-0000000000c1";
const SELLER = "00000000-0000-0000-0000-0000000000c2";
const STRANGER = "00000000-0000-0000-0000-0000000000c3";
const ADMIN = "00000000-0000-0000-0000-0000000000c4";
const STRANGER2 = "00000000-0000-0000-0000-0000000000c5";
const ORDER = "30000000-0000-0000-0000-000000000001";
const OTHER_ORDER = "30000000-0000-0000-0000-000000000002";
const ITEM = "40000000-0000-0000-0000-000000000001";
const OTHER_ITEM = "40000000-0000-0000-0000-000000000002";
await db.exec(`
INSERT INTO auth.users (id, email) VALUES ('${BUYER}', 'b@example.com'), ('${SELLER}', 's@example.com'), ('${STRANGER}', 'x@example.com');
INSERT INTO public.declutter_orders (id, buyer_id, seller_id) VALUES ('${ORDER}', '${BUYER}', '${SELLER}'), ('${OTHER_ORDER}', '${STRANGER}', '${STRANGER}');
INSERT INTO public.declutter_items (id, seller_id) VALUES ('${ITEM}', '${SELLER}'), ('${OTHER_ITEM}', '${STRANGER}');
INSERT INTO public.declutter_handovers (order_id, code, set_out_note, set_out_photo_path) VALUES
  ('${ORDER}', '4821', 'Behind the blue pot', 'porch/a.jpg'), ('${OTHER_ORDER}', '9999', 'Not yours', 'porch/x.jpg');
INSERT INTO public.declutter_haul_aways (item_id, prior_status) VALUES ('${ITEM}', 'active'), ('${OTHER_ITEM}', 'active');
INSERT INTO public.declutter_donations (item_id, partner_name, partner_address) VALUES ('${ITEM}', 'St. Vincent', '1 Main St'), ('${OTHER_ITEM}', 'Other Partner', '2 Elm St');
INSERT INTO public.helpr_card_fee_debts (helper_id, source, card_fee_cents, remaining_cents, refund_ref) VALUES
  ('${SELLER}', 'series_visit_lapsed', 59, 59, 're_SECRET1'), ('${STRANGER}', 'series_visit_lapsed', 61, 61, 're_OTHER');
INSERT INTO public.declutter_seller_fee_debts (seller_id, amount_cents, remaining_cents, waived_at, waived_by, waived_cents, waive_note) VALUES
  ('${SELLER}', 120, 0, now(), '${ADMIN}', 120, 'Our mistake');
INSERT INTO public.member_section_prefs (user_id, section_order, sections_hidden) VALUES ('${SELLER}', ARRAY['declutter','jobs','shops','homes'], ARRAY['homes']),
  ('${STRANGER}', ARRAY['jobs','declutter','shops','homes'], ARRAY['shops']);`);
const exportOf = async (uid) => {
  try {
    return (await db.query(`SELECT public.export_my_data('${uid}') AS j`)).rows[0].j;
  } catch (e) {
    ok(false, `export_my_data runs for ${uid}`, e.message);
    return null;
  }
};
const buyer = await exportOf(BUYER);
const seller = await exportOf(SELLER);
const nobody = await exportOf(STRANGER2);
for (const [who, out] of [["the buyer", buyer], ["the seller", seller]]) {
  const h = out?.declutter_handovers;
  ok(Array.isArray(h) && h.length === 1 && h[0].order_id === ORDER && h[0].set_out_note === "Behind the blue pot" && h[0].set_out_photo_path === "porch/a.jpg",
    `Q2271: ${who} gets the order's handover row (note, photo)`, JSON.stringify(h));
  ok(Array.isArray(h) && h.every((r) => !("code" in r)) && !JSON.stringify(out ?? {}).includes("4821"), `  ${who} never gets the 4-digit code`, JSON.stringify(h));
  ok(!JSON.stringify(h ?? []).includes("Not yours"), `  ${who} never gets another order's handover`);
}
ok(Array.isArray(seller?.declutter_haul_aways) && seller.declutter_haul_aways.length === 1 && seller.declutter_haul_aways[0].item_id === ITEM,
  "Q2454: the seller gets their own item's haul-away link only", JSON.stringify(seller?.declutter_haul_aways));
ok(Array.isArray(seller?.declutter_donations) && seller.declutter_donations.length === 1 && seller.declutter_donations[0].partner_name === "St. Vincent",
  "Q2454: the seller gets their own item's donation only", JSON.stringify(seller?.declutter_donations));
ok(Array.isArray(buyer?.declutter_haul_aways) && buyer.declutter_haul_aways.length === 0 && buyer.declutter_donations?.length === 0,
  "  the buyer gets no haul-away or donation of the seller's items", JSON.stringify({ h: buyer?.declutter_haul_aways, d: buyer?.declutter_donations }));
const debts = seller?.helpr_card_fee_debts;
ok(Array.isArray(debts) && debts.length === 1 && debts[0].card_fee_cents === 59 && !("refund_ref" in debts[0]) && !JSON.stringify(seller).includes("re_SECRET1"),
  "Q2245: the Helpr gets their own card-fee debt, without refund_ref", JSON.stringify(debts));
const fee = seller?.declutter_seller_fee_debts;
ok(Array.isArray(fee) && fee.length === 1 && fee[0].waive_note === "Our mistake" && fee[0].waived_cents === 120 && !("waived_by" in fee[0]) && !JSON.stringify(seller).includes(ADMIN),
  "Q1928: a waived debt exports its amount and note, never the admin's id", JSON.stringify(fee));
const prefs = seller?.member_section_prefs;
ok(Array.isArray(prefs) && prefs.length === 1 && prefs[0].user_id === SELLER && prefs[0].sections_hidden.join() === "homes",
  "Q2199: the member gets their own Customize row only", JSON.stringify(prefs));
ok(["declutter_handovers", "declutter_haul_aways", "declutter_donations", "helpr_card_fee_debts", "member_section_prefs"]
  .every((k) => Array.isArray(nobody?.[k]) && nobody[k].length === 0), "a member with none gets five empty lists");
ok(Array.isArray(seller?.job_continue_days) && Array.isArray(seller?.declutter_meetup_spots) && seller?.email === "s@example.com", "the other sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
