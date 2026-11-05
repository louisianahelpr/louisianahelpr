#!/usr/bin/env node
/**
 * PGlite proof for 20261105225245_shops_talk_inbox_and_reports.sql (Q1947, the rest of "message a shop"): a side of a
 * shop chat reports the other side's message (never their own, never a stranger), the report keeps a copy, the outcome
 * notice names it, the admin queue reads it; the chat closes and refuses a send by the whole shop-state rule (not only
 * hidden_at); an order's card opens the chat for either side.
 *
 *   node src/test/pglite/shopsTalkInbox.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsTalkInbox.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                            # red on a planted defect
 *
 * World: the H1 (20261105185006) and H2 (20261105182210) migrations run verbatim first, on cut-down prod-shaped
 * tables, then this one 3x. Supabase's DEFAULT PRIVILEGES (EXECUTE on new functions to anon, authenticated,
 * service_role) are emulated. Stubs: require_feature (no-op), is_caller_banned (false), shop_state_ok (hidden_at IS
 * NULL AND NOT is_seed AND the owner not in public.bad_standing: prod's rule with the seed switch on), are_users_blocked
 * (the blocks table), contact_leak_reason (7+ digits), declutter_notify (writes the bell row), has_role (ADMIN).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const H1 = readFileSync(`${DIR}20261105185006_shops_talk.sql`, "utf8");
const H2 = readFileSync(`${DIR}20261105182210_shops_report_shop_and_item.sql`, "utf8");
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261105225245_shops_talk_inbox_and_reports.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), OWNER = U(2), BUYER = U(3), STRANGER = U(4), GONE_OWNER = U(5);
const SHOP = U(10), BAD_SHOP = U(11);
const ORDER = U(30), ORDER_NOBUYER = U(31), MISSING = U(99);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${ADMIN}'::uuid $$;
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT auth.uid() IS NULL $$;
  CREATE TABLE public.blocks (a uuid, b uuid);
  CREATE FUNCTION public.are_users_blocked(x uuid, y uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.blocks WHERE (a = x AND b = y) OR (a = y AND b = x)) $$;
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $$ SELECT CASE WHEN t ~ '[0-9]{7,}' THEN 'A phone number' END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean DEFAULT false);
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
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, shop_id uuid, buyer_id uuid, seller_id uuid, status text);
  CREATE TABLE public.bad_standing (user_id uuid PRIMARY KEY);
  CREATE FUNCTION public.shop_state_ok(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT s.hidden_at IS NULL AND NOT s.is_seed AND NOT EXISTS (SELECT 1 FROM public.bad_standing b WHERE b.user_id = s.owner_id)
                          FROM public.shops s WHERE s.id = p_shop_id), false) $$;
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

  INSERT INTO public.profiles (user_id, full_name) VALUES ('${ADMIN}', 'Ad Min'), ('${OWNER}', 'Ruth Owner'), ('${BUYER}', 'Ann Buyer'),
    ('${STRANGER}', 'Sam Stranger'), ('${GONE_OWNER}', 'Gil Gone');
  INSERT INTO auth.users SELECT user_id FROM public.profiles;
  INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${OWNER}', 'Ruth''s Bakery'), ('${BAD_SHOP}', '${GONE_OWNER}', 'Gil''s Goods');
  INSERT INTO public.shop_orders (id, shop_id, buyer_id, seller_id, status) VALUES
    ('${ORDER}', '${SHOP}', '${BUYER}', '${OWNER}', 'accepted'), ('${ORDER_NOBUYER}', '${SHOP}', NULL, '${OWNER}', 'completed');
`);
// The state before this migration: H1 and H2 as they ship, and the report triggers prod has.
await db.exec(H1);
await db.exec(H2);
await db.exec(`
  CREATE TRIGGER trg_report_message_party_and_copy BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION public.report_message_party_and_copy();
  CREATE TRIGGER trg_notify_reporter_report_outcome AFTER UPDATE OF status ON public.reports FOR EACH ROW
    WHEN (NEW.status IN ('resolved', 'dismissed') AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.notify_reporter_report_outcome();
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};
const fileReport = (uid, id, type = "shop_talk_message") =>
  as(uid, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, $2, $3, 'harassment') RETURNING id, reported_content`, [uid, type, id]);

// --- The order card opens the chat, for either side.
const ob = await as(BUYER, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER]);
const TALK = ob.rows[0]?.id;
ok("the buyer opens the order's chat from the card", !ob.err && !!TALK, ob.err ?? "");
const plain = await as(BUYER, `SELECT public.shops_open_talk($1) AS id`, [SHOP]);
ok("it is the same thread as the shop page's Message", plain.rows[0]?.id === TALK, JSON.stringify(plain));
const oo = await as(OWNER, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER]);
ok("the shop's owner opens the same chat from their order card", oo.rows[0]?.id === TALK, oo.err ?? JSON.stringify(oo.rows));
const os_ = await as(STRANGER, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER]);
ok("a stranger can't open an order's chat", /order_not_found/.test(os_.err ?? ""), os_.err ?? "opened");
const onb = await as(OWNER, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER_NOBUYER]);
ok("an order whose buyer deleted their account has no chat", /order_not_found/.test(onb.err ?? ""), onb.err ?? "opened");
const omiss = await as(BUYER, `SELECT public.shops_open_order_talk($1) AS id`, [MISSING]);
ok("a missing order reads as not found", /order_not_found/.test(omiss.err ?? ""), omiss.err ?? "opened");
const oanon = await as(null, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER]);
ok("signed out it is refused", /not_authenticated/.test(oanon.err ?? ""), oanon.err ?? "opened");
await db.exec(`INSERT INTO public.blocks VALUES ('${OWNER}', '${BUYER}')`);
const oblk = await as(OWNER, `SELECT public.shops_open_order_talk($1) AS id`, [ORDER]);
ok("a blocked pair can't open it", /talk_blocked/.test(oblk.err ?? ""), oblk.err ?? "opened");
await db.exec(`DELETE FROM public.blocks`);

// --- Messages to report.
const send = (uid, body, talk = TALK) => as(uid, `SELECT public.shops_send_talk_message($1, $2) AS id`, [talk, body]);
const mB = (await send(BUYER, "Is the king cake ready?")).rows[0]?.id;
const mS = (await send(OWNER, "You are rude and I will find you")).rows[0]?.id;
ok("both sides wrote", !!mB && !!mS);

const r1 = await fileReport(BUYER, mS);
ok("the buyer reports the shop's message", !r1.err && !!r1.rows[0]?.id, r1.err ?? "");
ok("the report keeps the shop's name, the side and the words",
  r1.rows[0]?.reported_content === "Shop: Ruth's Bakery\nFrom the shop: You are rude and I will find you", JSON.stringify(r1.rows[0]?.reported_content));
const r2 = await fileReport(OWNER, mB);
ok("the shop's owner reports the buyer's message", !r2.err && r2.rows[0]?.reported_content === "Shop: Ruth's Bakery\nFrom the shopper: Is the king cake ready?", r2.err ?? JSON.stringify(r2.rows));
const rOwn = await fileReport(BUYER, mB);
ok("never your own message", /report_own_content/.test(rOwn.err ?? ""), rOwn.err ?? "filed");
const rOwn2 = await fileReport(OWNER, mS);
ok("the shop can't report its own message", /report_own_content/.test(rOwn2.err ?? ""), rOwn2.err ?? "filed");
const rStr = await fileReport(STRANGER, mS);
ok("a stranger can't report a chat they are not in", /report_target_not_found/.test(rStr.err ?? ""), rStr.err ?? "filed");
const rMiss = await fileReport(BUYER, MISSING);
ok("a missing message reads as not found", /report_target_not_found/.test(rMiss.err ?? ""), rMiss.err ?? "filed");
// The older types still work through the restated trigger.
const rShop = await fileReport(BUYER, SHOP, "shop");
ok("a shop report still works (H2 branch kept)", !rShop.err && /^Shop: Ruth's Bakery/.test(rShop.rows[0]?.reported_content ?? ""), rShop.err ?? "");

// --- The admin queue's read.
const adm = await as(ADMIN, `SELECT * FROM public.shops_admin_reported($1::uuid[])`, [[mS, SHOP]]);
const row = adm.rows.find((r) => r.reported_id === mS);
ok("the admin reads a reported chat message: kind, shop, writer, side",
  !adm.err && row?.kind === "shop_talk_message" && row?.shop_id === SHOP && row?.owner_id === OWNER && row?.status === "shop" && row?.label === "Ruth's Bakery",
  adm.err ?? JSON.stringify(adm.rows));
ok("the shop row still comes back too", adm.rows.some((r) => r.reported_id === SHOP && r.kind === "shop"));
const admNo = await as(BUYER, `SELECT * FROM public.shops_admin_reported($1::uuid[])`, [[mS]]);
ok("a member can't run the admin read", /not_admin/.test(admNo.err ?? ""), admNo.err ?? "read");

// --- The outcome notice.
await db.exec(`UPDATE public.reports SET status = 'dismissed' WHERE id = '${r1.rows[0]?.id}'`);
const note = (await db.query(`SELECT message FROM public.notifications WHERE user_id = $1 AND title = 'We looked into your report'`, [BUYER])).rows[0];
ok("the reporter's notice says 'a message'", /about a message \(case HLP-/.test(note?.message ?? ""), JSON.stringify(note));

// --- The shop-state rule (lh-authz-rls note on b5-shops-h1): an owner out of good standing closes the chat.
await db.exec(`INSERT INTO public.bad_standing VALUES ('${OWNER}')`);
const closed = await send(BUYER, "Hello?");
ok("a shop whose owner is out of good standing refuses a send", /talk_closed/.test(closed.err ?? ""), closed.err ?? "sent");
const vClosed = (await as(BUYER, `SELECT public.shops_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("and the chat reads as closed", vClosed?.open === false, JSON.stringify(vClosed?.open));
await db.exec(`DELETE FROM public.bad_standing`);
await db.exec(`UPDATE public.shops SET is_seed = true WHERE id = '${SHOP}'`);
const seedSend = await send(BUYER, "Hello again?");
ok("a test shop while test data is hidden refuses a send", /talk_closed/.test(seedSend.err ?? ""), seedSend.err ?? "sent");
await db.exec(`UPDATE public.shops SET is_seed = false WHERE id = '${SHOP}'`);
const back = await send(BUYER, "Back again");
ok("in good standing again, a send works", !back.err, back.err ?? "");
const vOpen = (await as(BUYER, `SELECT public.shops_talk_view($1) AS v`, [TALK])).rows[0]?.v;
ok("and the chat reads as open", vOpen?.open === true, JSON.stringify(vOpen?.open));

// --- Grants.
const g = await db.query(`SELECT has_function_privilege('anon', 'public.shops_open_order_talk(uuid)', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.shops_open_order_talk(uuid)', 'EXECUTE') AS m,
  has_function_privilege('anon', 'public.shops_admin_reported(uuid[])', 'EXECUTE') AS adm,
  has_function_privilege('authenticated', 'public.report_message_party_and_copy()', 'EXECUTE') AS trg`);
ok("shops_open_order_talk: members only, never anon", g.rows[0].a === false && g.rows[0].m === true, JSON.stringify(g.rows));
ok("the admin read and the trigger keep their grants", g.rows[0].adm === false && g.rows[0].trg === false, JSON.stringify(g.rows));

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
