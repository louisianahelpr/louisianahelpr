#!/usr/bin/env node
/**
 * PGlite proof for 20261112081700_shops_export_rest.sql (Shops audit 11-12 S014): Download My Data carries the member's shop
 * reviews (written; received only once public to them, without the writer's id), custom requests (the shop's copy
 * without the buyer's id), their own delivery and service addresses, their download files and their orders' handover
 * steps (the problem note only to the buyer). The body is 20261110200630's verbatim plus the one S014 block, and
 * EXECUTE stays service_role only.
 *
 *   node src/test/pglite/shopsExportRest.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsExportRest.pglite.mjs # red: the sections are missing
 *   MIGRATION_PATH=<planted copy> node ...                             # red on a planted defect
 *
 * Built on shopsTalkExport.pglite.mjs: export_my_data from 20261110200630 (the newest CREATE before this one), then
 * this migration 3x; every table the body reads is stubbed with the columns it reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261112081700_shops_export_rest.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const EXPORT_BASE = readFileSync(`${DIR}20261110200630_shops_talk_export.sql`, "utf8");
const TALK = readFileSync(`${DIR}20261105185006_shops_talk.sql`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
const tryq = async (db, sql, params = []) => {
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
};

/** One statement of a migration: from `start` (a regex) to the end of its dollar-quoted body, or to the first `;`. */
function stmt(sql, start, label) {
  const m = start.exec(sql);
  if (!m) throw new Error(`${label}: not found`);
  const tag = /\bAS (\$\w*\$)/.exec(sql.slice(m.index));
  if (tag && sql.slice(m.index, m.index + tag.index).indexOf(";") === -1) {
    const open = m.index + tag.index + tag[0].length;
    const end = sql.indexOf(tag[1], open);
    return `${sql.slice(m.index, end + tag[1].length)};`;
  }
  return sql.slice(m.index, sql.indexOf(";", m.index) + 1);
}
const shopTables = () => [
  stmt(TALK, /CREATE TABLE IF NOT EXISTS public\.shop_talks \(/, "shop_talks"),
  stmt(TALK, /CREATE TABLE IF NOT EXISTS public\.shop_talk_messages \(/, "shop_talk_messages"),
].join("\n");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MEMBER = U(2), STRANGER = U(3), MEMBER2 = U(5), OWNER2 = U(6);
const SHOP = U(10), SHOP2 = U(11);
const TK = U(20), TK2 = U(21), TK3 = U(22);
const M_MEMBER = U(30), M_OWNER = U(31), M2 = U(32), M3 = U(33);

// ---------------------------------------------------------------- Download My Data + account deletion
{
  /** The export_my_data statements of one migration: the no-arg DROP, the (uuid) CREATE (any dollar tag), its REVOKE/GRANT. */
  const exportStatements = (sql, label) => {
    const out = [];
    const drop = /^DROP FUNCTION IF EXISTS public\.export_my_data\(\);$/m.exec(sql);
    if (drop) out.push(drop[0]);
    out.push(stmt(sql, /CREATE OR REPLACE FUNCTION public\.export_my_data\(p_user_id uuid\)/, label));
    for (const m of sql.matchAll(/^(?:REVOKE|GRANT) [^\n]*public\.export_my_data\(uuid\)[^\n]*;$/gm)) out.push(m[0]);
    if (out.length !== 4) throw new Error(`${label}: expected DROP + CREATE + REVOKE + GRANT, read ${out.length}`);
    return out.join("\n");
  };
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
      name text NOT NULL DEFAULT 'Shop');
  `);
  await db.exec(shopTables());
  const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
  await db.exec(exportStatements(EXPORT_BASE, "20261110200630"));
  const oldDef = await defOf();
  if (!skip) {
    for (let i = 0; i < 3; i++) {
      try { await db.exec(exportStatements(SQL, NEW_FILE)); ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, true); }
      catch (e) { ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, false, e.message); }
    }
  }
  const def = await defOf();
  const ANCHOR = "\n\n  RETURN v_out;\nEND;";
  const MARK = "\n\n  -- S014 (Shops audit 11-12):";
  const added = def.split(ANCHOR)[0].split(MARK)[1];
  ok("the new body is 20261110200630's verbatim plus the one S014 block",
    oldDef.split(ANCHOR).length === 2 && added !== undefined
      && def === oldDef.replace(ANCHOR, MARK + added + ANCHOR), skip ? "skip" : "");
  const acl = (await db.query(`SELECT
      has_function_privilege('anon', 'public.export_my_data(uuid)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.export_my_data(uuid)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.export_my_data(uuid)', 'EXECUTE') AS svc,
      (SELECT count(*)::int FROM pg_proc WHERE proname = 'export_my_data') AS overloads`)).rows[0];
  ok("still the one (uuid) overload, EXECUTE for service_role only", acl.overloads === 1 && acl.svc && !acl.anon && !acl.auth, JSON.stringify(acl));

  // Stub every other table the body reads, with the columns it reads (the bundleRequestExport method).
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
  const stubs = [];
  for (const [t, cols] of tables) {
    cols.delete("id");
    const colSql = ["id uuid PRIMARY KEY DEFAULT gen_random_uuid()", ...[...cols].map((c) => `${c} ${typeOf(c)}`)];
    stubs.push(`CREATE SCHEMA IF NOT EXISTS ${t.split(".")[0]}; CREATE TABLE IF NOT EXISTS ${t} (${colSql.join(", ")});`);
  }
  await db.exec(stubs.join("\n"));
  await db.exec(`
    ALTER TABLE public.declutter_manager_grants ALTER COLUMN ended_by TYPE uuid USING NULL;
    CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;
    INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'o@example.com'), ('${MEMBER}', 'm@example.com'), ('${STRANGER}', 's@example.com'),
      ('${MEMBER2}', 'm2@example.com'), ('${OWNER2}', 'o2@example.com');
    INSERT INTO public.shops (id, owner_id) VALUES ('${SHOP}', '${OWNER}'), ('${SHOP2}', '${OWNER2}');
    INSERT INTO public.shop_talks (id, shop_id, buyer_id, created_at, buyer_read_at, shop_read_at) VALUES
      ('${TK}', '${SHOP}', '${MEMBER}', '2026-11-06 10:00+00', now(), now()),
      ('${TK2}', '${SHOP}', '${MEMBER2}', '2026-11-06 11:00+00', NULL, now()),
      ('${TK3}', '${SHOP2}', '${MEMBER2}', '2026-11-06 12:00+00', NULL, NULL);
    INSERT INTO public.shop_talk_messages (id, talk_id, sender_id, sender_side, body, created_at) VALUES
      ('${M_MEMBER}', '${TK}', '${MEMBER}', 'buyer', 'Do you do custom colors?', '2026-11-06 10:01+00'),
      ('${M_OWNER}', '${TK}', '${OWNER}', 'shop', 'Yes, any color.', '2026-11-06 10:02+00'),
      ('${M2}', '${TK2}', '${MEMBER2}', 'buyer', 'Open Saturday?', '2026-11-06 11:01+00'),
      ('${M3}', '${TK3}', '${MEMBER2}', 'buyer', 'Gift wrap?', '2026-11-06 12:01+00');
  `);
  const exportOf = async (uid) => {
    const r = await tryq(db, `SELECT public.export_my_data('${uid}') AS j`);
    if (r.err) ok(`export_my_data runs for ${uid}`, false, r.err);
    return r.rows[0]?.j ?? null;
  };
  const R1 = U(40), R2 = U(41), R3 = U(42), O1 = U(50), O2 = U(51), O3 = U(52), CR = U(60), CR2 = U(61), F1 = U(70);
  await db.exec(`ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS created_at timestamptz;`);
  await db.exec(`
    INSERT INTO public.shop_orders (id, buyer_id, seller_id, handed_over_at, created_at) VALUES
      ('${O1}', '${MEMBER}', '${OWNER}', now() - interval '1 day', now() - interval '3 days'),
      ('${O2}', '${MEMBER}', '${OWNER}', now() - interval '20 days', now() - interval '25 days'),
      ('${O3}', '${MEMBER2}', '${OWNER2}', now() - interval '1 day', now() - interval '2 days');
    INSERT INTO public.shop_reviews (id, order_id, reviewer_id, reviewee_id, created_at) VALUES
      ('${R1}', '${O1}', '${MEMBER}', '${OWNER}', now() - interval '1 hour'),
      ('${R2}', '${O2}', '${OWNER}', '${MEMBER}', now() - interval '19 days'),
      ('${R3}', '${O1}', '${OWNER}', '${MEMBER}', now());
    INSERT INTO public.shop_custom_requests (id, shop_id, buyer_id, created_at) VALUES
      ('${CR}', '${SHOP}', '${MEMBER}', now() - interval '2 days'), ('${CR2}', '${SHOP2}', '${MEMBER2}', now());
    INSERT INTO public.shop_order_delivery_addresses (order_id, buyer_id, created_at) VALUES ('${O1}', '${MEMBER}', now());
    INSERT INTO public.shop_order_service_addresses (order_id, buyer_id, created_at) VALUES ('${O2}', '${MEMBER}', now());
    INSERT INTO public.shop_item_files (id, owner_id, created_at) VALUES ('${F1}', '${OWNER}', now());
  `);
  await db.exec(`ALTER TABLE public.shop_handovers ADD COLUMN IF NOT EXISTS problem_note text, ADD COLUMN IF NOT EXISTS problem_at timestamptz;
    INSERT INTO public.shop_handovers (order_id, problem_at, problem_note) VALUES ('${O1}', now(), 'It never came');`);
  const mem = await exportOf(MEMBER), own = await exportOf(OWNER), str = await exportOf(STRANGER);
  const ids = (a) => (Array.isArray(a) ? a.map((x) => x.id ?? x.order_id) : null);
  // Reviews: MEMBER wrote R1; OWNER wrote R2 (14+ days after its handover: public) and R3 (O1: both sides wrote: public).
  ok("the member gets the review they wrote and the two about them that are public", JSON.stringify(ids(mem?.shop_reviews)) === JSON.stringify([R2, R1, R3]), JSON.stringify(mem?.shop_reviews));
  ok("  a review about them carries no writer id; their own keeps it",
    mem?.shop_reviews?.find((x) => x.id === R2) && !("reviewer_id" in mem.shop_reviews.find((x) => x.id === R2))
      && mem.shop_reviews.find((x) => x.id === R1)?.reviewer_id === MEMBER, JSON.stringify(mem?.shop_reviews));
  await db.exec(`DELETE FROM public.shop_reviews WHERE id = '${R1}'`);
  const mem2 = await exportOf(MEMBER);
  ok("a review about them is held back while still blind (one side only, under 14 days)", JSON.stringify(ids(mem2?.shop_reviews)) === JSON.stringify([R2]), JSON.stringify(mem2?.shop_reviews));
  ok("the member gets their own custom request with their id", JSON.stringify(ids(mem?.shop_custom_requests)) === JSON.stringify([CR]) && mem.shop_custom_requests[0].buyer_id === MEMBER, JSON.stringify(mem?.shop_custom_requests));
  ok("the shop owner gets requests to their shop without the buyer's id", JSON.stringify(ids(own?.shop_custom_requests)) === JSON.stringify([CR]) && !("buyer_id" in own.shop_custom_requests[0]), JSON.stringify(own?.shop_custom_requests));
  ok("the buyer gets their delivery and service addresses", mem?.shop_order_delivery_addresses?.length === 1 && mem?.shop_order_service_addresses?.length === 1, JSON.stringify([mem?.shop_order_delivery_addresses, mem?.shop_order_service_addresses]));
  ok("the shop never gets the buyer's addresses", JSON.stringify(own?.shop_order_delivery_addresses) === "[]" && JSON.stringify(own?.shop_order_service_addresses) === "[]", JSON.stringify(own));
  ok("the seller gets their download files", JSON.stringify(ids(own?.shop_item_files)) === JSON.stringify([F1]) && JSON.stringify(mem?.shop_item_files) === "[]", JSON.stringify(own?.shop_item_files));
  ok("both sides get the handover steps, without the note", mem?.shop_handovers?.length === 1 && own?.shop_handovers?.length === 1
    && !("problem_note" in mem.shop_handovers[0]) && !("problem_note" in own.shop_handovers[0]), JSON.stringify([mem?.shop_handovers, own?.shop_handovers]));
  ok("the buyer gets their problem note", mem?.shop_handover_problem_notes?.length === 1 && mem.shop_handover_problem_notes[0].problem_note === "It never came", JSON.stringify(mem?.shop_handover_problem_notes));
  ok("the shop does not get the buyer's note", JSON.stringify(own?.shop_handover_problem_notes) === "[]", JSON.stringify(own?.shop_handover_problem_notes));
  ok("a stranger gets empty sections", ["shop_reviews", "shop_custom_requests", "shop_order_delivery_addresses", "shop_order_service_addresses", "shop_item_files", "shop_handovers", "shop_handover_problem_notes"].every((k) => JSON.stringify(str?.[k]) === "[]"), JSON.stringify(str));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
