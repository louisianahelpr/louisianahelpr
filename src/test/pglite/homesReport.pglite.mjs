#!/usr/bin/env node
/**
 * PGlite proof for 20261106165850_homes_report_listing.sql (Homes report button, audit 11-05 A-H2, the rest of
 * docs/NOT-LAUNCHED.md Q2187): a member reports a Homes listing they can be shown (never their own), the report
 * keeps a copy of it, the reporter's outcome notice names it, and the types that were already reportable still are.
 *
 *   node src/test/pglite/homesReport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/homesReport.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                         # red on a planted defect
 *
 * World: cut-down prod-shaped tables. Supabase's DEFAULT PRIVILEGES are emulated. The prior state is the reports
 * CHECK from 20261105225245 (shop types, no home_listing). Stubs: feature_enabled_for (on for everyone but NO_SWITCH),
 * rentals_listing_visible (live and not expired: prod's rule is proved by the homes listing proofs; here it only
 * has to be the gate the trigger asks), shop_talk_side (null). The trigger and the outcome notice are the migration's.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261106165850_homes_report_listing.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ADMIN = U(1), OWNER = U(2), MEMBER = U(3), NO_SWITCH = U(4);
const SHOP = U(10);
const RENT = U(20), SALE = U(21), DRAFT = U(22), EXPIRED = U(23), REMOVED = U(24);
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
  CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${ADMIN}'::uuid $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.seed_hidden_in_discovery() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NULL AND coalesce(nullif(current_setting('test.role', true), ''), '') NOT IN ('anon', 'authenticated') $$;
  CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT auth.uid() IS NOT NULL AND auth.uid() <> '${NO_SWITCH}'::uuid $$;
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
    is_seed boolean NOT NULL DEFAULT false);
  CREATE FUNCTION public.shop_state_ok(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT s.hidden_at IS NULL AND NOT s.is_seed FROM public.shops s WHERE s.id = p_shop_id), false) $$;
  CREATE TABLE public.shop_talks (id uuid PRIMARY KEY, shop_id uuid);
  CREATE TABLE public.shop_talk_messages (id uuid PRIMARY KEY, talk_id uuid, sender_side text, body text);
  CREATE FUNCTION public.shop_talk_side(p_talk uuid, p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
  CREATE TABLE public.rental_listings (id uuid PRIMARY KEY, owner_id uuid NOT NULL, kind text NOT NULL DEFAULT 'rent', status text NOT NULL,
    headline text NOT NULL, description text, expires_at timestamptz);
  CREATE FUNCTION public.rentals_listing_visible(p_listing_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = p_listing_id AND l.status = 'live' AND l.expires_at > now()) $$;
  CREATE TABLE public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL, reported_id uuid NOT NULL, reason text NOT NULL,
    description text, status text NOT NULL DEFAULT 'pending', reported_content text, created_at timestamptz DEFAULT now(),
    CONSTRAINT reports_reported_type_check CHECK (reported_type = ANY (ARRAY['job','message','user','support','review','application',
      'declutter_item','declutter_wanted','declutter_question','declutter_answer','declutter_review','shop','shop_item','shop_talk_message'])));
  CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id), title text NOT NULL,
    message text NOT NULL, type text NOT NULL, link text, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb);

  INSERT INTO public.profiles (user_id) VALUES ('${ADMIN}'), ('${OWNER}'), ('${MEMBER}'), ('${NO_SWITCH}');
  INSERT INTO auth.users SELECT user_id FROM public.profiles;
  INSERT INTO public.shops (id, owner_id, name, about) VALUES ('${SHOP}', '${OWNER}', 'Ruth''s Bakery', 'Cakes');
  INSERT INTO public.rental_listings (id, owner_id, kind, status, headline, description, expires_at) VALUES
    ('${RENT}', '${OWNER}', 'rent', 'live', '2 bed near the park', 'Quiet street.', now() + interval '20 days'),
    ('${SALE}', '${OWNER}', 'sale', 'live', '3 bed brick home', NULL, now() + interval '20 days'),
    ('${DRAFT}', '${OWNER}', 'rent', 'draft', 'Secret draft', NULL, now() + interval '20 days'),
    ('${EXPIRED}', '${OWNER}', 'rent', 'live', 'Old listing', NULL, now() - interval '1 day'),
    ('${REMOVED}', '${OWNER}', 'rent', 'removed', 'Taken down', NULL, now() + interval '20 days');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(SQL);
}
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
  `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, $2, $3, 'Discriminates') RETURNING id, reported_content`,
  [uid, type, id]));

// 1. A member reports a live rent listing; the copy keeps its kind, headline and words.
const r1 = await fileReport(MEMBER, "home_listing", RENT);
ok("member reports a live rent listing", !r1.err && r1.rows.length === 1, r1.err ?? "");
ok("rent report keeps kind, headline and words", r1.rows[0]?.reported_content === "Home for rent: 2 bed near the park\nQuiet street.",
  JSON.stringify(r1.rows[0]?.reported_content));

// 2. A for-sale listing too; no description leaves no blank line.
const r2 = await fileReport(MEMBER, "home_listing", SALE);
ok("member reports a live sale listing", !r2.err && r2.rows.length === 1, r2.err ?? "");
ok("sale report says for sale", r2.rows[0]?.reported_content === "Home for sale: 3 bed brick home", JSON.stringify(r2.rows[0]?.reported_content));

// 3. Never your own.
const own = await fileReport(OWNER, "home_listing", RENT);
ok("owner can't report own listing", /report_own_content/.test(own.err ?? ""), own.err ?? "inserted");

// 4. What a member can't be shown reads as not found (no copy leaks a draft or a taken-down listing).
for (const [name, id] of [["draft", DRAFT], ["expired", EXPIRED], ["removed", REMOVED], ["missing", MISSING], ["a shop id", SHOP]]) {
  const r = await fileReport(MEMBER, "home_listing", id);
  ok(`${name} listing reads as not found`, /report_target_not_found/.test(r.err ?? ""), r.err ?? "inserted");
}

// 5. A member the 'rentals' switch is off for can't report one, even by a known id.
const ns = await fileReport(NO_SWITCH, "home_listing", RENT);
ok("switch off: reads as not found", /report_target_not_found/.test(ns.err ?? ""), ns.err ?? "inserted");

// 6. The server (support tooling) may file one without the visibility rule.
const srv = await as(null, () => tryq(`INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason)
  VALUES (NULL, 'home_listing', '${REMOVED}', 'Automatic check') RETURNING reported_content`));
ok("server context reports a removed listing", !srv.err && srv.rows[0]?.reported_content === "Home for rent: Taken down", srv.err ?? JSON.stringify(srv.rows));

// 7. The reporter hears the outcome, with the right noun.
await db.query(`UPDATE public.reports SET status = 'resolved' WHERE id = $1`, [r1.rows[0]?.id ?? MISSING]);
const notes = (await db.query(`SELECT message FROM public.notifications WHERE user_id = $1`, [MEMBER])).rows.map((r) => r.message);
ok("outcome notice says 'a home listing'", notes.some((m) => m.includes("report about a home listing (case")), JSON.stringify(notes));

// 8. The types already reportable still are (the restated trigger kept its branches).
const shop = await fileReport(MEMBER, "shop", SHOP);
ok("a shop report still works", !shop.err && shop.rows[0]?.reported_content === "Shop: Ruth's Bakery\nCakes", shop.err ?? JSON.stringify(shop.rows));
const user = await fileReport(MEMBER, "user", OWNER);
ok("a member report still works (no copy)", !user.err && user.rows[0]?.reported_content === null, user.err ?? JSON.stringify(user.rows));
const bad = await fileReport(MEMBER, "home_thing", RENT);
ok("an unknown type is still refused by the CHECK", /reports_reported_type_check/.test(bad.err ?? ""), bad.err ?? "inserted");

// 9. Grants: the trigger functions are never callable by a member.
for (const sig of ["public.report_message_party_and_copy()", "public.notify_reporter_report_outcome()"]) {
  const g = await tryq(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`, [sig]);
  ok(`${sig}: neither anon nor authenticated`, !g.err && g.rows[0]?.anon === false && g.rows[0]?.auth === false, g.err ?? JSON.stringify(g.rows));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
