#!/usr/bin/env node
/**
 * PGlite proof for 20261110200630_shops_talk_export.sql (NOT-LAUNCHED Q1947): Download My Data carries each side's
 * shop chats and their messages without the other side's id, the body is the newest CREATE verbatim plus the one
 * Shops block (shop chats, then the owner's shop permits, Q1952), EXECUTE stays service_role only, and deleting either side's account leaves no chat behind.
 *
 *   node src/test/pglite/shopsTalkExport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsTalkExport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                             # red on a planted defect
 *
 * export_my_data from 20261106191100 (the newest CREATE before this one), then this migration 3x; every table the
 * body reads is stubbed with the columns it reads, the Shops chat tables and shops with their real keys (so the
 * account-deletion cascade is the real one).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261110200630_shops_talk_export.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const EXPORT_BASE = readFileSync(`${DIR}20261106191100_homes_talk_report_and_export.sql`, "utf8");
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
  await db.exec(exportStatements(EXPORT_BASE, "20261106191100"));
  const oldDef = await defOf();
  if (!skip) {
    for (let i = 0; i < 3; i++) {
      try { await db.exec(exportStatements(SQL, NEW_FILE)); ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, true); }
      catch (e) { ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, false, e.message); }
    }
  }
  const def = await defOf();
  const ANCHOR = "\n\n  RETURN v_out;\nEND;";
  const added = def.split(ANCHOR)[0].split("\n  -- Shops messages (20261105185006):")[1];
  ok("the new body is 20261106191100's verbatim plus the one Shops block",
    oldDef.split(ANCHOR).length === 2 && added !== undefined
      && def === oldDef.replace(ANCHOR, "\n  -- Shops messages (20261105185006):" + added + ANCHOR), skip ? "skip" : "");
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
  const mem = await exportOf(MEMBER), own = await exportOf(OWNER), str = await exportOf(STRANGER);
  const ids = (a) => (Array.isArray(a) ? a.map((x) => x.id) : null);
  ok("the member gets their one chat", JSON.stringify(ids(mem?.shop_talks)) === JSON.stringify([TK]), JSON.stringify(mem?.shop_talks));
  ok("  with their own id and read mark, not the owner's marks",
    mem?.shop_talks?.[0]?.buyer_id === MEMBER && "buyer_read_at" in (mem?.shop_talks?.[0] ?? {})
      && !("shop_read_at" in (mem?.shop_talks?.[0] ?? {})) && !("shop_notified_at" in (mem?.shop_talks?.[0] ?? {})),
    JSON.stringify(mem?.shop_talks?.[0]));
  ok("the member gets both sides' messages in their thread, oldest first",
    JSON.stringify(ids(mem?.shop_talk_messages)) === JSON.stringify([M_MEMBER, M_OWNER]), JSON.stringify(mem?.shop_talk_messages));
  const mine = mem?.shop_talk_messages?.find((x) => x.id === M_MEMBER), theirs = mem?.shop_talk_messages?.find((x) => x.id === M_OWNER);
  ok("  each with its side, 'mine' and the words, never a sender id",
    mine?.mine === true && theirs?.mine === false && theirs?.sender_side === "shop" && theirs?.body === "Yes, any color."
      && (mem?.shop_talk_messages ?? []).every((x) => !("sender_id" in x)), JSON.stringify(mem?.shop_talk_messages));
  ok("the owner gets every thread on their shop (two members), not another shop's",
    JSON.stringify(ids(own?.shop_talks)) === JSON.stringify([TK, TK2]), JSON.stringify(own?.shop_talks));
  ok("  without the member's id or the member's marks",
    (own?.shop_talks ?? []).length === 2 && own.shop_talks.every((x) => !("buyer_id" in x) && !("buyer_read_at" in x) && !("buyer_notified_at" in x) && "shop_read_at" in x),
    JSON.stringify(own?.shop_talks));
  ok("the owner gets the messages on their shop's chats only",
    JSON.stringify(ids(own?.shop_talk_messages)) === JSON.stringify([M_MEMBER, M_OWNER, M2]), JSON.stringify(own?.shop_talk_messages));
  ok("a member with no thread gets empty sections",
    JSON.stringify(str?.shop_talks) === "[]" && JSON.stringify(str?.shop_talk_messages) === "[]", JSON.stringify([str?.shop_talks, str?.shop_talk_messages]));

  // Shops paperwork (Q1952): the owner's own permits, the listed columns only, never the reviewer or the ids.
  // The stub has only the columns the body reads; give it the real table's reviewer, shop and owner columns too.
  await db.exec(`ALTER TABLE public.shop_permits ADD COLUMN IF NOT EXISTS reviewed_by uuid, ADD COLUMN IF NOT EXISTS shop_id uuid, ADD COLUMN IF NOT EXISTS owner_id uuid;`);
  await db.exec(`INSERT INTO public.shop_permits (shop_id, owner_id, kind, expires_on, status, review_note, reviewed_at, reviewed_by, created_at, document_path) VALUES
    ('${SHOP2}', '${OWNER2}', 'food_permit', '2027-06-30', 'rejected', 'The photo is blurry.', now(), '${STRANGER}', '2026-11-09 10:00+00', 'o2/permit.jpg'),
    (NULL, '${MEMBER2}', 'inflatable_registration', '2027-01-31', 'verified', 'Looks good.', now(), '${STRANGER}', '2026-11-09 11:00+00', 'm2/reg.jpg');`);
  const o2 = await exportOf(OWNER2);
  ok("the owner gets their own permit with its check's outcome and note",
    o2?.shop_permits?.length === 1 && o2.shop_permits[0].kind === "food_permit" && o2.shop_permits[0].status === "rejected"
      && o2.shop_permits[0].review_note === "The photo is blurry." && o2.shop_permits[0].document_path === "o2/permit.jpg",
    JSON.stringify(o2?.shop_permits));
  ok("  exactly the listed columns: no reviewer, owner or row id",
    JSON.stringify(Object.keys(o2?.shop_permits?.[0] ?? {}).sort())
      === JSON.stringify(["created_at", "document_path", "expires_on", "kind", "review_note", "reviewed_at", "status"]),
    JSON.stringify(o2?.shop_permits?.[0]));
  // Exported again after the insert: another member (here also the admin who checked it) gets none of it.
  const strAfter = await exportOf(STRANGER), m2 = await exportOf(MEMBER2);
  ok("another member, even the reviewer, gets none of it", JSON.stringify(strAfter?.shop_permits) === "[]", JSON.stringify(strAfter?.shop_permits));
  ok("the note shows only on a turn-down, as in My shop", m2?.shop_permits?.length === 1 && m2.shop_permits[0].review_note === null, JSON.stringify(m2?.shop_permits));

  // Account deletion: the FKs alone leave nothing behind (the purge has no Shops chat step to forget).
  const count = async () => (await db.query(`SELECT (SELECT count(*)::int FROM public.shop_talks) AS t, (SELECT count(*)::int FROM public.shop_talk_messages) AS m`)).rows[0];
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [MEMBER]);
  const afterMember = await count();
  ok("deleting the member removes their thread and both sides' messages in it", afterMember.t === 2 && afterMember.m === 2, JSON.stringify(afterMember));
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [OWNER]);
  const afterOwner = await count();
  ok("deleting an owner removes every chat with their shop", afterOwner.t === 1 && afterOwner.m === 1, JSON.stringify(afterOwner));
  const left = (await db.query(`SELECT count(*)::int AS n FROM public.shop_talk_messages WHERE sender_id IS NULL`)).rows[0].n;
  ok("no message is left with no sender", left === 0, String(left));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
