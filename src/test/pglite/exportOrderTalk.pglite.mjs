#!/usr/bin/env node
/**
 * PGlite proof for 20261030024748_export_my_data_order_talk.sql: "Download My Data" carries the member's paid-order chats
 * (declutter_order_talks + declutter_order_talk_messages, 20261030004216, D2-1), and nothing else about export_my_data changes.
 *
 *   node src/test/pglite/exportOrderTalk.pglite.mjs                     # GREEN
 *   NEW_MIGRATION=skip node src/test/pglite/exportOrderTalk.pglite.mjs  # RED: 20261030022344's body only (web push)
 *   MIGRATION_PATH=<planted copy> node ...                                    # RED on a planted defect
 *
 * World: the export_my_data statements (DROP / CREATE / REVOKE / GRANT) of 20261030022344 (web push; the newest before this
 * one), then this migration's 3x. Checks:
 *   1. The new body is the old body VERBATIM plus the two sections (nothing else moved).
 *   2. Still the one (uuid) overload, EXECUTE for service_role only.
 *   3. RUN: every table the body reads is stubbed with the columns it reads; a member gets the chats on orders
 *      they bought or sold and every message in them, never another order's chat.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const BASE = "20261030022344_web_push_subscriptions.sql";
const NEW_FILE = "20261030024748_export_my_data_order_talk.sql";
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

// 1. Old body + exactly the two sections.
const SECTION = `  -- D2-1 (20261030004216): the member's paid-order chats, buyer or seller of the order, and every message in them
  -- (each side sees the whole chat in the app), plus any message the member sent.
  v_out := v_out || jsonb_build_object('declutter_order_talks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_order_talks t
      WHERE EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id AND v_uid IN (o.buyer_id, o.seller_id))));
  v_out := v_out || jsonb_build_object('declutter_order_talk_messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb) FROM public.declutter_order_talk_messages t
      WHERE t.sender_id = v_uid OR t.talk_id IN (SELECT ot.id FROM public.declutter_order_talks ot JOIN public.declutter_orders o ON o.id = ot.order_id
                                                  WHERE v_uid IN (o.buyer_id, o.seller_id))));
`;
ok(def.includes(SECTION), "the new body has the two order-chat sections, scoped to the caller's orders");
ok(def.replace(SECTION, "") === oldDef, "and is otherwise 20261030022344's body verbatim");
ok(/jsonb_build_object\('push_subscriptions'/.test(def), "the web push section (20261030022344) is still there");

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
// The two chat tables as 20261030004216 creates them; the stubs cover the rest (declutter_orders included).
await db.exec(`
DROP TABLE IF EXISTS public.declutter_order_talk_messages;
DROP TABLE IF EXISTS public.declutter_order_talks;
CREATE TABLE public.declutter_order_talks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), buyer_notified_at timestamptz, seller_notified_at timestamptz);
CREATE TABLE public.declutter_order_talk_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), talk_id uuid NOT NULL,
  sender_id uuid, sender_side text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.user_may_see_job_address(j uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.shop_local_today() RETURNS date LANGUAGE sql STABLE AS $$ SELECT current_date $$;`);

const ME = "00000000-0000-0000-0000-0000000000aa";
const OTHER = "00000000-0000-0000-0000-0000000000bb";
const THIRD = "00000000-0000-0000-0000-0000000000cc";
const O1 = "00000000-0000-0000-0000-0000000001a1";
const O2 = "00000000-0000-0000-0000-0000000001a2";
const T1 = "00000000-0000-0000-0000-0000000002a1";
const T2 = "00000000-0000-0000-0000-0000000002a2";
await db.exec(`
INSERT INTO auth.users (id, email, created_at) VALUES ('${ME}', 'me@example.com', now()), ('${OTHER}', 'other@example.com', now()), ('${THIRD}', 'third@example.com', now());
INSERT INTO public.declutter_orders (id, buyer_id, seller_id) VALUES ('${O1}', '${ME}', '${OTHER}'), ('${O2}', '${THIRD}', '${OTHER}');
INSERT INTO public.declutter_order_talks (id, order_id) VALUES ('${T1}', '${O1}'), ('${T2}', '${O2}');
INSERT INTO public.declutter_order_talk_messages (talk_id, sender_id, sender_side, body, created_at) VALUES
  ('${T1}', '${ME}', 'buyer', 'Is Saturday ok?', now() - interval '2 minutes'),
  ('${T1}', '${OTHER}', 'seller', 'Yes, after 9.', now() - interval '1 minute'),
  ('${T2}', '${THIRD}', 'buyer', 'Not your chat', now());`);
let out = null;
try {
  out = (await db.query(`SELECT public.export_my_data('${ME}') AS j`)).rows[0].j;
  ok(true, "export_my_data runs for a buyer on the stubbed world");
} catch (e) {
  ok(false, "export_my_data runs for a buyer on the stubbed world", e.message);
}
const talks = out?.declutter_order_talks;
const msgs = out?.declutter_order_talk_messages;
ok(Array.isArray(talks) && talks.length === 1 && talks[0].id === T1, "the export has the chat on the order they bought, only that one", JSON.stringify(talks));
ok(Array.isArray(msgs) && msgs.length === 2 && msgs[0].body === "Is Saturday ok?" && msgs[1].body === "Yes, after 9.",
  "  and both sides' messages in it, oldest first", JSON.stringify(msgs));
ok(!JSON.stringify(msgs ?? []).includes("Not your chat"), "  and never another order's chat");
let outOther = null;
try { outOther = (await db.query(`SELECT public.export_my_data('${OTHER}') AS j`)).rows[0].j; } catch (e) { console.log("seller export failed:", e.message); }
ok(outOther?.declutter_order_talks?.length === 2 && outOther?.declutter_order_talk_messages?.length === 3, "the seller of both orders gets both chats");
ok(Array.isArray(out?.declutter_handover_talk_messages) && Array.isArray(out?.declutter_seller_porch_days) && Array.isArray(out?.push_subscriptions), "the handover chat, porch days and web push sections are still there");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
