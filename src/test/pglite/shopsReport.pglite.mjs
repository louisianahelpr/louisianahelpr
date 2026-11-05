#!/usr/bin/env node
/**
 * PGlite proof for 20261105182210_shops_report_shop_and_item.sql (Shops H2, audit 11-05): a member reports a shop or
 * a live shop item they can be shown (never their own), the report keeps a copy of it, the reporter's outcome notice
 * names it, and an admin reads reported shops/items and takes a reported item down from the reports queue.
 *
 *   node src/test/pglite/shopsReport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                         # red on a planted defect
 *
 * World: cut-down prod-shaped tables. Supabase's DEFAULT PRIVILEGES (EXECUTE on new functions to anon, authenticated,
 * service_role) are emulated, so a new function that forgets its REVOKE shows anon can run it. The prior state is the
 * reports CHECK from 20261102040000 (no shop types). Stubs: require_feature (no-op), is_caller_banned (false),
 * shop_state_ok (hidden_at IS NULL AND NOT is_seed: prod's rule with the seed switch on and the owner in good standing),
 * declutter_notify (writes the bell row). The trigger, the outcome notice and both new RPCs are the migration's own.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261105182210_shops_report_shop_and_item.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), OWNER = U(2), MEMBER = U(3), ADMIN_OWNER = U(4), SEED_OWNER = U(5), OWNER3 = U(6);
const SHOP = U(10), HIDDEN_SHOP = U(11), SEED_SHOP = U(12), ADMIN_SHOP = U(13);
const LIVE = U(20), DRAFT = U(21), HIDDEN_ITEM = U(22), ADMIN_ITEM = U(23), LIVE2 = U(24), SEED_ITEM = U(25);
const MISSING = U(99);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT $1 IN ('${ADMIN}'::uuid, '${ADMIN_OWNER}'::uuid) $$;
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NULL AND coalesce(nullif(current_setting('test.role', true), ''), '') NOT IN ('anon', 'authenticated') $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY);
  CREATE TABLE public.test_subjects (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.is_test_subject(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT p IS NOT NULL AND EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = p) $$;
  CREATE TABLE public.messages(id uuid primary key default gen_random_uuid(), sender_id uuid, receiver_id uuid, content text, attachment_url text);
  CREATE TABLE public.declutter_items(id uuid primary key, seller_id uuid, status text, title text, seller_hidden boolean not null default false, is_seed boolean not null default false);
  CREATE TABLE public.declutter_cart_items(id uuid primary key default gen_random_uuid(), item_id uuid, buyer_id uuid, status text);
  CREATE TABLE public.declutter_questions(id uuid primary key, item_id uuid, asker_id uuid, question text, answer text, removed_at timestamptz);
  CREATE TABLE public.declutter_wanted(id uuid primary key, user_id uuid, what text, public boolean, removed_at timestamptz, is_seed boolean);
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, status text, handed_over_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY, order_id uuid, reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars smallint,
    comment text, is_seed boolean DEFAULT false, removed_at timestamptz);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL, name text NOT NULL, about text NOT NULL DEFAULT '',
    paused boolean NOT NULL DEFAULT false, hidden_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES public.shops(id), owner_id uuid NOT NULL,
    status text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '', price_cents integer NOT NULL,
    is_seed boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.shop_item_private (item_id uuid PRIMARY KEY, owner_id uuid, review_note text, admin_rejected_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now());
  CREATE FUNCTION public.shop_state_ok(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT s.hidden_at IS NULL AND NOT s.is_seed FROM public.shops s WHERE s.id = p_shop_id), false) $$;
  CREATE TABLE public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL, reason text NOT NULL,
    description text, status text NOT NULL DEFAULT 'pending', reported_content text, created_at timestamptz DEFAULT now(),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application',
      'declutter_item','declutter_wanted','declutter_question','declutter_answer','declutter_review'])));
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), title text NOT NULL,
    message text NOT NULL, type text NOT NULL, link text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb);
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb, created_at timestamptz DEFAULT now());
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notifications (user_id, title, message, type, link) VALUES (p_user, p_title, p_message, p_type, p_link) $$;

  INSERT INTO public.profiles (user_id, is_seed) VALUES ('${ADMIN}', false), ('${OWNER}', false), ('${MEMBER}', false),
    ('${ADMIN_OWNER}', false), ('${SEED_OWNER}', true), ('${OWNER3}', false);
  INSERT INTO auth.users SELECT user_id FROM public.profiles;
  INSERT INTO public.shops (id, owner_id, name, about, hidden_at, is_seed) VALUES
    ('${SHOP}', '${OWNER}', 'Ruth''s Bakery', 'Cakes and pies from my kitchen.', NULL, false),
    ('${HIDDEN_SHOP}', '${OWNER3}', 'Hidden Goods', '', now(), false),
    ('${SEED_SHOP}', '${SEED_OWNER}', 'Test Shop', '', NULL, true),
    ('${ADMIN_SHOP}', '${ADMIN_OWNER}', 'Admin Crafts', '', NULL, false);
  INSERT INTO public.shop_items (id, shop_id, owner_id, status, title, description, price_cents) VALUES
    ('${LIVE}', '${SHOP}', '${OWNER}', 'live', 'Pecan pie', 'Whole 9 inch pie', 1250),
    ('${LIVE2}', '${SHOP}', '${OWNER}', 'live', 'King cake', '', 3000),
    ('${DRAFT}', '${SHOP}', '${OWNER}', 'draft', 'Secret draft', '', 500),
    ('${HIDDEN_ITEM}', '${HIDDEN_SHOP}', '${OWNER3}', 'live', 'Hidden thing', '', 500),
    ('${ADMIN_ITEM}', '${ADMIN_SHOP}', '${ADMIN_OWNER}', 'live', 'Admin bowl', '', 2000),
    ('${SEED_ITEM}', '${SEED_SHOP}', '${SEED_OWNER}', 'live', 'Test item', '', 100);
  INSERT INTO public.shop_item_private (item_id, owner_id) SELECT id, owner_id FROM public.shop_items;
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(SQL);
}
// The trigger the migration's function runs in (prod: trg_report_message_party_and_copy BEFORE INSERT, and the
// outcome notice AFTER UPDATE), created after the function so a skipped migration leaves no trigger.
await db.exec(`
  DO $$ BEGIN
    IF to_regprocedure('public.report_message_party_and_copy()') IS NOT NULL THEN
      CREATE TRIGGER trg_report_message_party_and_copy BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.report_message_party_and_copy();
    END IF;
    IF to_regprocedure('public.notify_reporter_report_outcome()') IS NOT NULL THEN
      CREATE TRIGGER trg_notify_reporter_report_outcome AFTER UPDATE OF status ON public.reports FOR EACH ROW
        WHEN (NEW.status IN ('resolved', 'dismissed') AND OLD.status IS DISTINCT FROM NEW.status)
        EXECUTE FUNCTION public.notify_reporter_report_outcome();
    END IF;
  END $$;
`);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
const as = async (uid, fn) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false), set_config('test.role', '${uid ? "authenticated" : ""}', false)`);
  try { return await fn(); } finally { await db.exec(`SELECT set_config('test.uid', '', false), set_config('test.role', '', false)`); }
};
const tryq = async (sql, params = []) => {
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
};
const fileReport = (uid, type, id) => as(uid, () => tryq(
  `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, $2, $3, 'Scam or fake') RETURNING id, reported_content`,
  [uid, type, id]));

// 1. A member reports a shop they can see; the report keeps its name and about.
const r1 = await fileReport(MEMBER, "shop", SHOP);
ok("member reports a visible shop", !r1.err && r1.rows.length === 1, r1.err ?? "");
ok("shop report keeps the name and about", r1.rows[0]?.reported_content === "Shop: Ruth's Bakery\nCakes and pies from my kitchen.",
  JSON.stringify(r1.rows[0]?.reported_content));

// 2. A member reports a live item; the copy names title, price, description and shop.
const r2 = await fileReport(MEMBER, "shop_item", LIVE);
ok("member reports a live item", !r2.err && r2.rows.length === 1, r2.err ?? "");
ok("item report keeps title, price, words and shop",
  r2.rows[0]?.reported_content === "Item: Pecan pie\nPrice: $12.50\nWhole 9 inch pie\nShop: Ruth's Bakery",
  JSON.stringify(r2.rows[0]?.reported_content));

// 3. Never your own.
const own1 = await fileReport(OWNER, "shop", SHOP);
ok("owner can't report own shop", /report_own_content/.test(own1.err ?? ""), own1.err ?? "inserted");
const own2 = await fileReport(OWNER, "shop_item", LIVE);
ok("owner can't report own item", /report_own_content/.test(own2.err ?? ""), own2.err ?? "inserted");

// 4. What a member can't be shown reads as not found (no copy leaks a hidden, draft or test thing).
for (const [name, type, id] of [
  ["hidden shop", "shop", HIDDEN_SHOP], ["item in a hidden shop", "shop_item", HIDDEN_ITEM], ["draft item", "shop_item", DRAFT],
  ["test shop", "shop", SEED_SHOP], ["test shop's item", "shop_item", SEED_ITEM], ["missing shop", "shop", MISSING],
  ["missing item", "shop_item", MISSING], ["a shop id sent as an item", "shop_item", SHOP],
]) {
  const r = await fileReport(MEMBER, type, id);
  ok(`${name} reads as not found`, /report_target_not_found/.test(r.err ?? ""), r.err ?? "inserted");
}

// 5. The server (support tooling) may file one without the visibility rule.
const srv = await as(null, () => tryq(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason)
  VALUES (NULL, 'shop', '${HIDDEN_SHOP}', 'Automatic check') RETURNING reported_content`));
ok("server context reports a hidden shop", !srv.err && srv.rows[0]?.reported_content === "Shop: Hidden Goods", srv.err ?? JSON.stringify(srv.rows));

// 6. The reporter hears the outcome, with the right noun.
await db.query(`UPDATE public.reports SET status = 'resolved' WHERE id = $1`, [r1.rows[0]?.id ?? MISSING]);
await db.query(`UPDATE public.reports SET status = 'dismissed' WHERE id = $1`, [r2.rows[0]?.id ?? MISSING]);
const notes = (await db.query(`SELECT message FROM public.notifications WHERE user_id = $1 ORDER BY created_at, message`, [MEMBER])).rows.map((r) => r.message);
ok("outcome notice says 'a shop'", notes.some((m) => m.includes("report about a shop (case")), JSON.stringify(notes));
ok("outcome notice says 'a shop item'", notes.some((m) => m.includes("report about a shop item (case")), JSON.stringify(notes));

// 7. The queue's read, admin only.
const nonAdminRead = await as(MEMBER, () => tryq(`SELECT * FROM public.shops_admin_reported($1)`, [[SHOP, LIVE]]));
ok("member can't read reported shops", /not_admin/.test(nonAdminRead.err ?? ""), nonAdminRead.err ?? "read");
const read = await as(ADMIN, () => tryq(`SELECT * FROM public.shops_admin_reported($1) ORDER BY kind`, [[SHOP, LIVE, SEED_ITEM, HIDDEN_SHOP, MISSING]]));
const byId = Object.fromEntries(read.rows.map((r) => [r.reported_id, r]));
ok("admin reads 4 of 5 ids (one is missing)", !read.err && read.rows.length === 4, read.err ?? JSON.stringify(read.rows));
ok("shop row: kind, name, open", byId[SHOP]?.kind === "shop" && byId[SHOP]?.label === "Ruth's Bakery" && byId[SHOP]?.status === "open" && byId[SHOP]?.owner_id === OWNER);
ok("item row: kind, title, live, its shop", byId[LIVE]?.kind === "shop_item" && byId[LIVE]?.label === "Pecan pie" && byId[LIVE]?.status === "live" && byId[LIVE]?.shop_id === SHOP);
ok("hidden shop reads hidden", byId[HIDDEN_SHOP]?.status === "hidden" && byId[HIDDEN_SHOP]?.shop_hidden === true);
ok("test item is flagged is_seed", byId[SEED_ITEM]?.is_seed === true && byId[SHOP]?.is_seed === false);

// 8. Take a reported item down. repOther names the same id under another type, so only the type check refuses it.
const rep = (await db.query(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES (NULL, 'shop_item', $1, 'x') RETURNING id`, [LIVE2])).rows[0].id;
const repOther = (await db.query(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES (NULL, 'user', $1, 'x') RETURNING id`, [LIVE2])).rows[0].id;
const td = (uid, item, note, report) => as(uid, () => tryq(`SELECT public.shops_admin_take_down_item($1, $2, $3) AS r`, [item, note, report]));
const tdMember = await td(MEMBER, LIVE2, "Not allowed here", rep);
ok("member can't take an item down", /not_admin/.test(tdMember.err ?? ""), tdMember.err ?? "ran");
const tdOwn = await td(ADMIN_OWNER, ADMIN_ITEM, "My own bowl", null);
ok("admin can't take their own item down", /own_item/.test(tdOwn.err ?? ""), tdOwn.err ?? "ran");
const tdShort = await td(ADMIN, LIVE2, " ", rep);
ok("a reason is required", /review_note_required/.test(tdShort.err ?? ""), tdShort.err ?? "ran");
const tdWrongRep = await td(ADMIN, LIVE2, "Prohibited item", repOther);
ok("a report for something else is refused", /report_not_for_item/.test(tdWrongRep.err ?? ""), tdWrongRep.err ?? "ran");
const tdDraft = await td(ADMIN, DRAFT, "Prohibited item", null);
ok("a draft can't be taken down (not shown)", /item_not_found/.test(tdDraft.err ?? ""), tdDraft.err ?? "ran");
const tdOk = await td(ADMIN, LIVE2, "Prohibited item", rep);
ok("admin takes the item down", !tdOk.err && tdOk.rows[0]?.r === "rejected", tdOk.err ?? "");
const item = (await db.query(`SELECT i.status, p.review_note, p.admin_rejected_at FROM public.shop_items i JOIN public.shop_item_private p ON p.item_id = i.id WHERE i.id = $1`, [LIVE2])).rows[0];
ok("item is rejected with the note", item.status === "rejected" && item.review_note === "Prohibited item" && item.admin_rejected_at !== null, JSON.stringify(item));
const repRow = (await db.query(`SELECT status FROM public.reports WHERE id = $1`, [rep])).rows[0];
ok("the report resolves", repRow.status === "resolved");
const audit = (await db.query(`SELECT details FROM public.admin_audit_log WHERE action = 'shop_item_rejected' AND target_id = $1`, [LIVE2])).rows;
ok("logged as shop_item_rejected with owner_id (the 30-day re-check reads it)", audit.length === 1 && audit[0].details.owner_id === OWNER, JSON.stringify(audit));
const ownerNote = (await db.query(`SELECT title, message, link FROM public.notifications WHERE user_id = $1`, [OWNER])).rows;
ok("the owner is told why", ownerNote.some((n) => n.title === "An item came off your shop" && n.message.includes("King cake") && n.message.includes("Prohibited item") && n.link === "/shops/mine"), JSON.stringify(ownerNote));
const tdAgain = await td(ADMIN, LIVE2, "Prohibited item", rep);
ok("a second take-down reads as not found", /item_not_found/.test(tdAgain.err ?? ""), tdAgain.err ?? "ran");

// 9. Grants: never anon or PUBLIC.
for (const sig of ["public.shops_admin_reported(uuid[])", "public.shops_admin_take_down_item(uuid, text, uuid)"]) {
  const g = await tryq(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`, [sig]);
  ok(`${sig}: anon can't run it, authenticated can`, !g.err && g.rows[0]?.anon === false && g.rows[0]?.auth === true, g.err ?? JSON.stringify(g.rows));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
