#!/usr/bin/env node
/**
 * PGlite proof for 20261106191100_homes_talk_report_and_export.sql (Homes messages server slice 2, A-H1 /
 * docs/NOT-LAUNCHED.md Q2209): a side of a Homes thread reports the OTHER side's message (never their own, never a
 * thread they are not on, never with the rentals switch off), the report keeps a copy without a name, the outcome
 * notice says "a message"; Download My Data carries each side's threads and messages without the other side's id;
 * and deleting either side's account leaves no thread or message behind.
 *
 *   node src/test/pglite/homesTalkReportExport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/homesTalkReportExport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                                   # red on a planted defect
 *
 * Two worlds. (A) Reports: the prior state is 20261106165850 (home_listing, no home_talk_message); the Homes tables and
 * home_talk_side are read from 20261106182837 itself. Stubs: feature_enabled_for (on for everyone but NO_SWITCH),
 * rentals_listing_visible, shop_talk_side. (B) Export: export_my_data from 20261106164100 (the newest CREATE before
 * this one), then this migration's 3x; every table the body reads stubbed with the columns it reads, the Homes tables
 * and rental_listings with their real keys (so the account-deletion cascade is the real one).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261106191100_homes_talk_report_and_export.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const REPORT_BASE = readFileSync(`${DIR}20261106165850_homes_report_listing.sql`, "utf8");
const EXPORT_BASE = readFileSync(`${DIR}20261106164100_export_declutter_swap_offers.sql`, "utf8");
const TALK = readFileSync(`${DIR}20261106182837_homes_talk.sql`, "utf8");
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
const homeTables = () => [
  stmt(TALK, /CREATE TABLE IF NOT EXISTS public\.home_talks \(/, "home_talks"),
  stmt(TALK, /CREATE TABLE IF NOT EXISTS public\.home_talk_messages \(/, "home_talk_messages"),
].join("\n");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MEMBER = U(2), STRANGER = U(3), NO_SWITCH = U(4), MEMBER2 = U(5), OWNER2 = U(6);
const LIST = U(10), LIST2 = U(11);
const TK = U(20), TK2 = U(21), TK3 = U(22);
const M_MEMBER = U(30), M_OWNER = U(31), M2 = U(32), M3 = U(33);
const MISSING = U(99);

// ---------------------------------------------------------------- (A) reports
{
  const db = new PGlite();
  await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT auth.uid() IS NULL AND coalesce(nullif(current_setting('test.role', true), ''), '') NOT IN ('anon', 'authenticated') $$;
    CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT p_key = 'rentals' AND auth.uid() IS NOT NULL AND auth.uid() <> '${NO_SWITCH}'::uuid $$;
    CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false, ban_status text, auto_suspended_until timestamptz);
    CREATE TABLE public.jobs (id uuid PRIMARY KEY);
    CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE public.messages(id uuid primary key default gen_random_uuid(), sender_id uuid, receiver_id uuid, content text, attachment_url text);
    CREATE TABLE public.declutter_items(id uuid primary key, seller_id uuid, status text, title text, seller_hidden boolean not null default false, is_seed boolean not null default false);
    CREATE TABLE public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text);
    CREATE TABLE public.declutter_questions(id uuid primary key, item_id uuid, asker_id uuid, question text, answer text, removed_at timestamptz);
    CREATE TABLE public.declutter_wanted(id uuid primary key, user_id uuid, what text, public boolean, removed_at timestamptz, is_seed boolean);
    CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, handed_over_at timestamptz, is_seed boolean DEFAULT false);
    CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY, order_id uuid, reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars smallint,
      comment text, is_seed boolean DEFAULT false, removed_at timestamptz);
    CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL, name text NOT NULL, about text NOT NULL DEFAULT '', hidden_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
    CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, status text, title text, description text, price_cents integer);
    CREATE FUNCTION public.shop_state_ok(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE public.shop_talks (id uuid PRIMARY KEY, shop_id uuid);
    CREATE TABLE public.shop_talk_messages (id uuid PRIMARY KEY, talk_id uuid, sender_side text, body text);
    CREATE FUNCTION public.shop_talk_side(p_talk uuid, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
    CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'rent', status text NOT NULL, headline text NOT NULL, description text, expires_at timestamptz);
    CREATE FUNCTION public.rentals_listing_visible(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = p AND l.status = 'live') $$;
    CREATE TABLE public.reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL, reason text NOT NULL,
      description text, status text NOT NULL DEFAULT 'pending', reported_content text, created_at timestamptz DEFAULT now(),
      CONSTRAINT reports_reported_type_check CHECK (reported_type = 'job'));
    CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
      message text NOT NULL, type text NOT NULL, link text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb);
  `);
  await db.exec(homeTables());
  await db.exec(stmt(TALK, /CREATE OR REPLACE FUNCTION public\.home_talk_side\(/, "home_talk_side"));
  await db.exec(REPORT_BASE);
  await db.exec(`
    INSERT INTO auth.users VALUES ('${OWNER}'), ('${MEMBER}'), ('${STRANGER}'), ('${NO_SWITCH}');
    INSERT INTO public.profiles (user_id) SELECT id FROM auth.users;
    INSERT INTO public.rental_listings (id, owner_id, kind, status, headline) VALUES ('${LIST}', '${OWNER}', 'sale', 'live', 'Brick 3-bed near the levee');
    INSERT INTO public.home_talks (id, listing_id, member_id) VALUES ('${TK}', '${LIST}', '${MEMBER}'), ('${TK2}', '${LIST}', '${NO_SWITCH}');
    INSERT INTO public.home_talk_messages (id, talk_id, sender_id, sender_side, body) VALUES
      ('${M_MEMBER}', '${TK}', '${MEMBER}', 'member', 'Is the roof new?'),
      ('${M_OWNER}', '${TK}', '${OWNER}', 'owner', 'Yes. Only Christians need apply.'),
      ('${M2}', '${TK2}', '${OWNER}', 'owner', 'Hello there');
  `);
  if (!skip) for (let i = 0; i < 3; i++) await db.exec(SQL);
  await db.exec(`
    CREATE TRIGGER trg_report_message_party_and_copy BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.report_message_party_and_copy();
    CREATE TRIGGER trg_notify_reporter_report_outcome AFTER UPDATE OF status ON public.reports FOR EACH ROW
      WHEN (NEW.status IN ('resolved', 'dismissed') AND OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION public.notify_reporter_report_outcome();
  `);
  const as = async (uid, fn) => {
    await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false), set_config('test.role', '${uid ? "authenticated" : ""}', false)`);
    try { return await fn(); } finally { await db.exec(`SELECT set_config('test.uid', '', false), set_config('test.role', '', false)`); }
  };
  const fileReport = (uid, id, type = "home_talk_message") => as(uid, () => tryq(db,
    `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, $2, $3, 'Discriminates') RETURNING id, reported_content`,
    [uid, type, id]));

  const r1 = await fileReport(MEMBER, M_OWNER);
  ok("the member reports the owner's message", !r1.err && r1.rows.length === 1, r1.err ?? "");
  ok("the copy keeps the listing, the side and the words, never a name",
    r1.rows[0]?.reported_content === "Home for sale: Brick 3-bed near the levee\nFrom the owner: Yes. Only Christians need apply.",
    JSON.stringify(r1.rows[0]?.reported_content));
  const r2 = await fileReport(OWNER, M_MEMBER);
  ok("the owner reports the member's message", !r2.err && r2.rows[0]?.reported_content?.endsWith("From the member: Is the roof new?"), r2.err ?? JSON.stringify(r2.rows));
  const ownMember = await fileReport(MEMBER, M_MEMBER);
  ok("the member can't report their own message", /report_own_content/.test(ownMember.err ?? ""), ownMember.err ?? "inserted");
  const ownOwner = await fileReport(OWNER, M_OWNER);
  ok("the owner can't report their own message", /report_own_content/.test(ownOwner.err ?? ""), ownOwner.err ?? "inserted");
  const str = await fileReport(STRANGER, M_OWNER);
  ok("a member not on the thread reads it as not found", /report_target_not_found/.test(str.err ?? ""), str.err ?? "inserted");
  const ns = await fileReport(NO_SWITCH, M2);
  ok("a side with the rentals switch off reads it as not found", /report_target_not_found/.test(ns.err ?? ""), ns.err ?? "inserted");
  const miss = await fileReport(MEMBER, MISSING);
  ok("a missing message reads as not found", /report_target_not_found/.test(miss.err ?? ""), miss.err ?? "inserted");
  const srv = await as(null, () => tryq(db, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason)
    VALUES (NULL, 'home_talk_message', '${M2}', 'Automatic check') RETURNING reported_content`));
  ok("the server may file one without the side rule", !srv.err && srv.rows[0]?.reported_content?.endsWith("From the owner: Hello there"), srv.err ?? JSON.stringify(srv.rows));
  await db.query(`UPDATE public.reports SET status = 'resolved' WHERE id = $1`, [r1.rows[0]?.id ?? MISSING]);
  const notes = (await db.query(`SELECT message FROM public.notifications WHERE user_id = $1`, [MEMBER])).rows.map((r) => r.message);
  ok("the outcome notice says 'a message'", notes.some((m) => m.includes("report about a message (case")), JSON.stringify(notes));
  const hl = await fileReport(MEMBER, LIST, "home_listing");
  ok("a home listing report still works", !hl.err && hl.rows[0]?.reported_content === "Home for sale: Brick 3-bed near the levee", hl.err ?? JSON.stringify(hl.rows));
  const bad = await fileReport(MEMBER, M_OWNER, "home_talk_thing");
  ok("an unknown type is still refused by the CHECK", /reports_reported_type_check/.test(bad.err ?? ""), bad.err ?? "inserted");
  for (const sig of ["public.report_message_party_and_copy()", "public.notify_reporter_report_outcome()"]) {
    const g = await tryq(db, `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`, [sig]);
    ok(`${sig}: neither anon nor authenticated`, !g.err && g.rows[0]?.anon === false && g.rows[0]?.auth === false, g.err ?? JSON.stringify(g.rows));
  }
}

// ---------------------------------------------------------------- (B) Download My Data + account deletion
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
    CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'rent', status text NOT NULL DEFAULT 'live', headline text NOT NULL DEFAULT 'Home');
  `);
  await db.exec(homeTables());
  const defOf = async () => (await db.query(`SELECT pg_get_functiondef('public.export_my_data(uuid)'::regprocedure) AS d`)).rows[0].d;
  await db.exec(exportStatements(EXPORT_BASE, "20261106164100"));
  const oldDef = await defOf();
  if (!skip) {
    for (let i = 0; i < 3; i++) {
      try { await db.exec(exportStatements(SQL, NEW_FILE)); ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, true); }
      catch (e) { ok(`the migration's export_my_data applies (run ${i + 1} of 3)`, false, e.message); }
    }
  }
  const def = await defOf();
  const ANCHOR = "\n\n  RETURN v_out;\nEND;";
  const added = def.split(ANCHOR)[0].split("\n  -- Homes messages (20261106182837):")[1];
  ok("the new body is 20261106164100's verbatim plus the one Homes block",
    oldDef.split(ANCHOR).length === 2 && added !== undefined
      && def === oldDef.replace(ANCHOR, "\n  -- Homes messages (20261106182837):" + added + ANCHOR), skip ? "skip" : "");
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
    INSERT INTO public.rental_listings (id, owner_id) VALUES ('${LIST}', '${OWNER}'), ('${LIST2}', '${OWNER2}');
    INSERT INTO public.home_talks (id, listing_id, member_id, created_at, member_read_at, owner_read_at) VALUES
      ('${TK}', '${LIST}', '${MEMBER}', '2026-11-06 10:00+00', now(), now()),
      ('${TK2}', '${LIST}', '${MEMBER2}', '2026-11-06 11:00+00', NULL, now()),
      ('${TK3}', '${LIST2}', '${MEMBER2}', '2026-11-06 12:00+00', NULL, NULL);
    INSERT INTO public.home_talk_messages (id, talk_id, sender_id, sender_side, body, created_at) VALUES
      ('${M_MEMBER}', '${TK}', '${MEMBER}', 'member', 'Is the roof new?', '2026-11-06 10:01+00'),
      ('${M_OWNER}', '${TK}', '${OWNER}', 'owner', 'Yes, 2024.', '2026-11-06 10:02+00'),
      ('${M2}', '${TK2}', '${MEMBER2}', 'member', 'Still open?', '2026-11-06 11:01+00'),
      ('${M3}', '${TK3}', '${MEMBER2}', 'member', 'Pets ok?', '2026-11-06 12:01+00');
  `);
  const exportOf = async (uid) => {
    const r = await tryq(db, `SELECT public.export_my_data('${uid}') AS j`);
    if (r.err) ok(`export_my_data runs for ${uid}`, false, r.err);
    return r.rows[0]?.j ?? null;
  };
  const mem = await exportOf(MEMBER), own = await exportOf(OWNER), str = await exportOf(STRANGER);
  const ids = (a) => (Array.isArray(a) ? a.map((x) => x.id) : null);
  ok("the member gets their one thread", JSON.stringify(ids(mem?.home_talks)) === JSON.stringify([TK]), JSON.stringify(mem?.home_talks));
  ok("  with their own id and read mark, not the owner's marks",
    mem?.home_talks?.[0]?.member_id === MEMBER && "member_read_at" in (mem?.home_talks?.[0] ?? {})
      && !("owner_read_at" in (mem?.home_talks?.[0] ?? {})) && !("owner_notified_at" in (mem?.home_talks?.[0] ?? {})),
    JSON.stringify(mem?.home_talks?.[0]));
  ok("the member gets both sides' messages in their thread, oldest first",
    JSON.stringify(ids(mem?.home_talk_messages)) === JSON.stringify([M_MEMBER, M_OWNER]), JSON.stringify(mem?.home_talk_messages));
  const mine = mem?.home_talk_messages?.find((x) => x.id === M_MEMBER), theirs = mem?.home_talk_messages?.find((x) => x.id === M_OWNER);
  ok("  each with its side, 'mine' and the words, never a sender id",
    mine?.mine === true && theirs?.mine === false && theirs?.sender_side === "owner" && theirs?.body === "Yes, 2024."
      && (mem?.home_talk_messages ?? []).every((x) => !("sender_id" in x)), JSON.stringify(mem?.home_talk_messages));
  ok("the owner gets every thread on their listing (two members), not another owner's",
    JSON.stringify(ids(own?.home_talks)) === JSON.stringify([TK, TK2]), JSON.stringify(own?.home_talks));
  ok("  without the member's id or the member's marks",
    (own?.home_talks ?? []).length === 2 && own.home_talks.every((x) => !("member_id" in x) && !("member_read_at" in x) && !("member_notified_at" in x) && "owner_read_at" in x),
    JSON.stringify(own?.home_talks));
  ok("the owner gets the messages on their listing's threads only",
    JSON.stringify(ids(own?.home_talk_messages)) === JSON.stringify([M_MEMBER, M_OWNER, M2]), JSON.stringify(own?.home_talk_messages));
  ok("a member with no thread gets empty sections",
    JSON.stringify(str?.home_talks) === "[]" && JSON.stringify(str?.home_talk_messages) === "[]", JSON.stringify([str?.home_talks, str?.home_talk_messages]));

  // Account deletion: the FKs alone leave nothing behind (the purge has no Homes step to forget).
  const count = async () => (await db.query(`SELECT (SELECT count(*)::int FROM public.home_talks) AS t, (SELECT count(*)::int FROM public.home_talk_messages) AS m`)).rows[0];
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [MEMBER]);
  const afterMember = await count();
  ok("deleting the member removes their thread and both sides' messages in it", afterMember.t === 2 && afterMember.m === 2, JSON.stringify(afterMember));
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [OWNER]);
  const afterOwner = await count();
  ok("deleting an owner removes every thread on their listings", afterOwner.t === 1 && afterOwner.m === 1, JSON.stringify(afterOwner));
  const left = (await db.query(`SELECT count(*)::int AS n FROM public.home_talk_messages WHERE sender_id IS NULL`)).rows[0].n;
  ok("no message is left with no sender", left === 0, String(left));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
