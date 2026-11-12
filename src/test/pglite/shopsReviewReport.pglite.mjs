#!/usr/bin/env node
/**
 * PGlite proof for 20261112094500_shops_review_report.sql (Q1948 L46 leftovers): a Shops review can be reported (only
 * one the reporter could be shown, never their own) and an admin can take it down; the reporter's outcome says "a
 * review". Base: the newest report trigger and outcome (20261106191100, world A of homesTalkReportExport.pglite.mjs),
 * the real shop_review_public (20261105230819); stubs: shop_visible_to (false for one member), has_role from
 * user_roles, is_caller_banned false.
 *
 *   node src/test/pglite/shopsReviewReport.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReviewReport.pglite.mjs # red
 *   MIGRATION_PATH=<planted copy> node ...                               # red on a planted defect
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261112094500_shops_review_report.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const REPORT_BASE = readFileSync(`${DIR}20261106191100_homes_talk_report_and_export.sql`, "utf8");
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


const REVIEWS = readFileSync(`${DIR}20261105230819_shops_reviews_and_rating.sql`, "utf8");
const U = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const BUYER = U(1), SELLER = U(2), MEMBER = U(3), BLOCKED = U(4), ADMIN = U(5), NO_SWITCH = U(6);
const SHOP = U(10), O_OLD = U(20), O_NEW = U(21), O_BOTH = U(22);
const R_PUBLIC = U(30), R_BLIND = U(31), R_ABOUT_BUYER = U(32), R_BOTH_B = U(33), R_REMOVED = U(34);
const MISSING = U(99);
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
    CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid, shop_id uuid, handed_over_at timestamptz, is_seed boolean DEFAULT false);
    CREATE TABLE public.shop_reviews (id uuid PRIMARY KEY, order_id uuid NOT NULL, shop_id uuid NOT NULL, reviewer_id uuid, reviewee_id uuid,
      reviewer_side text NOT NULL, stars smallint NOT NULL, comment text, is_seed boolean NOT NULL DEFAULT false, removed_at timestamptz,
      CONSTRAINT shop_reviews_once UNIQUE (order_id, reviewer_side));
    CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.shop_visible_to(p_shop uuid, p_viewer uuid) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT p_viewer IS DISTINCT FROM '${BLOCKED}'::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('admin', 'user');
    CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
    CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT EXISTS (SELECT 1 FROM public.user_roles x WHERE x.user_id = u AND x.role = r) $$;
    CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
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

  await db.exec(homeTables());
  await db.exec(stmt(TALK, /CREATE OR REPLACE FUNCTION public\.home_talk_side\(/, "home_talk_side"));
  await db.exec(stmt(REVIEWS, /CREATE OR REPLACE FUNCTION public\.shop_review_public\(/, "shop_review_public"));
  await db.exec(REPORT_BASE.slice(0, REPORT_BASE.indexOf("-- 4. Download My Data.")));
  await db.exec(`
    INSERT INTO auth.users VALUES ('${BUYER}'), ('${SELLER}'), ('${MEMBER}'), ('${BLOCKED}'), ('${ADMIN}');
    INSERT INTO public.profiles (user_id) SELECT id FROM auth.users;
    INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
    INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${SELLER}', 'Bayou Candles');
    INSERT INTO public.shop_orders VALUES ('${O_OLD}', '${BUYER}', '${SELLER}', '${SHOP}', now() - interval '20 days'),
      ('${O_NEW}', '${BUYER}', '${SELLER}', '${SHOP}', now() - interval '2 days'),
      ('${O_BOTH}', '${BUYER}', '${SELLER}', '${SHOP}', now() - interval '2 days');
    INSERT INTO public.shop_reviews (id, order_id, shop_id, reviewer_id, reviewee_id, reviewer_side, stars, comment) VALUES
      ('${R_PUBLIC}', '${O_OLD}', '${SHOP}', '${BUYER}', '${SELLER}', 'buyer', 1, 'Rude, call me at 555'),
      ('${R_BLIND}', '${O_NEW}', '${SHOP}', '${BUYER}', '${SELLER}', 'buyer', 2, 'Meh'),
      ('${R_ABOUT_BUYER}', '${O_BOTH}', '${SHOP}', '${SELLER}', '${BUYER}', 'shop', 1, 'Never showed'),
      ('${R_BOTH_B}', '${O_BOTH}', '${SHOP}', '${BUYER}', '${SELLER}', 'buyer', 5, NULL);
    INSERT INTO public.shop_reviews (id, order_id, shop_id, reviewer_id, reviewee_id, reviewer_side, stars, removed_at)
      SELECT '${R_REMOVED}', '${O_OLD}', '${SHOP}', '${SELLER}', '${BUYER}', 'shop', 3, now();
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
  const fileReport = (uid, id) => as(uid, () => tryq(db,
    `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, 'shop_review', $2, 'Contact details') RETURNING id, reported_content`,
    [uid, id]));

  const r1 = await fileReport(MEMBER, R_PUBLIC);
  ok("a member reports a public shop review", !r1.err && r1.rows.length === 1, r1.err ?? "");
  ok("the copy keeps the stars and the words, never a name", r1.rows[0]?.reported_content === "1 star: Rude, call me at 555", JSON.stringify(r1.rows));
  const r2 = await fileReport(SELLER, R_PUBLIC);
  ok("the shop owner (the subject) reports a review about the shop", !r2.err, r2.err ?? "");
  const r3 = await fileReport(BUYER, R_PUBLIC);
  ok("never your own review", /report_own_content/.test(r3.err ?? ""), r3.err ?? "");
  const r4 = await fileReport(MEMBER, R_BLIND);
  ok("a review still blind reads as not found", /report_target_not_found/.test(r4.err ?? ""), r4.err ?? "");
  const r4b = await fileReport(SELLER, R_BLIND);
  ok("even its subject can't report it while blind", /report_target_not_found/.test(r4b.err ?? ""), r4b.err ?? "");
  const r5 = await fileReport(BUYER, R_ABOUT_BUYER);
  ok("the buyer reports the shop's review about them (both sides reviewed)", !r5.err, r5.err ?? "");
  const r5b = await fileReport(MEMBER, R_ABOUT_BUYER);
  ok("a third member can't report the shop's review of a buyer (members never see it)", /report_target_not_found/.test(r5b.err ?? ""), r5b.err ?? "");
  const r6 = await fileReport(BLOCKED, R_PUBLIC);
  ok("a member who can't see the shop can't report its reviews", /report_target_not_found/.test(r6.err ?? ""), r6.err ?? "");
  const r7 = await fileReport(MEMBER, R_REMOVED);
  ok("a removed review reads as not found", /report_target_not_found/.test(r7.err ?? ""), r7.err ?? "");
  const r8 = await fileReport(MEMBER, MISSING);
  ok("a missing review reads as not found", /report_target_not_found/.test(r8.err ?? ""), r8.err ?? "");

  // Admin remove.
  const reportId = r1.rows[0]?.id;
  const a0 = await as(MEMBER, () => tryq(db, `SELECT public.shops_admin_remove_review($1, 'x', NULL)`, [R_PUBLIC]));
  ok("a member can't remove a review", /not_admin/.test(a0.err ?? ""), a0.err ?? "");
  const a1 = await as(ADMIN, () => tryq(db, `SELECT public.shops_admin_remove_review($1, 'contact details', $2)`, [R_PUBLIC, r5.rows[0]?.id ?? MISSING]));
  ok("the report must be about this review", /report_not_for_review/.test(a1.err ?? ""), a1.err ?? "");
  const a2 = await as(ADMIN, () => tryq(db, `SELECT public.shops_admin_remove_review($1, 'contact details', $2) AS r`, [R_PUBLIC, reportId]));
  ok("an admin removes it", !a2.err && a2.rows[0]?.r === "removed", a2.err ?? "");
  const gone = (await db.query(`SELECT removed_at IS NOT NULL AS g FROM public.shop_reviews WHERE id = $1`, [R_PUBLIC])).rows[0]?.g;
  ok("removed_at is set", gone === true);
  const st = (await db.query(`SELECT status FROM public.reports WHERE id = $1`, [reportId])).rows[0]?.status;
  ok("the report is resolved", st === "resolved", st);
  const nt = (await db.query(`SELECT message FROM public.notifications WHERE user_id = $1`, [MEMBER])).rows;
  ok("the reporter's outcome notice says 'a review'", nt.some((n) => /a review/.test(n.message)), JSON.stringify(nt));
  const audit = (await db.query(`SELECT action FROM public.admin_audit_log`)).rows;
  ok("the removal is in the audit log", audit.some((x) => x.action === "shop_review_removed"), JSON.stringify(audit));
  const a3 = await as(ADMIN, () => tryq(db, `SELECT public.shops_admin_remove_review($1, NULL, NULL)`, [R_PUBLIC]));
  ok("twice reads as not found", /review_not_found/.test(a3.err ?? ""), a3.err ?? "");
  const rd = await as(ADMIN, () => tryq(db, `SELECT review_id, removed, stars FROM public.shops_admin_reported_reviews($1)`, [[R_PUBLIC, R_BLIND]]));
  ok("the admin read returns the reported reviews", !rd.err && rd.rows.length === 2 && rd.rows.some((x) => x.removed), rd.err ?? JSON.stringify(rd.rows));
  const rd2 = await as(MEMBER, () => tryq(db, `SELECT * FROM public.shops_admin_reported_reviews($1)`, [[R_PUBLIC]]));
  ok("a member can't read it", /not_admin/.test(rd2.err ?? ""), rd2.err ?? "");
  const acl = (await db.query(`SELECT proname, proacl::text a FROM pg_proc WHERE proname IN ('shops_admin_remove_review', 'shops_admin_reported_reviews')`)).rows;
  ok("both RPCs: authenticated + service_role, not anon", acl.length === 2 && acl.every((r) => /authenticated=X/.test(r.a) && !/anon=/.test(r.a) && !/^\{=X/.test(r.a)), JSON.stringify(acl));
  // Other report types still work (the restated trigger is verbatim): a Homes message by its other side.
}
console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
