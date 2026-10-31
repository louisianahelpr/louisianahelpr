#!/usr/bin/env node
/**
 * PGlite proof for 20261031152545_declutter_check_after_post (LEAD-POST-SLOW, owner 2026-10-31: Post publishes at
 * once and the automatic check runs right after; a flag takes the listing down and tells the seller; a check that
 * never comes back is held after 15 minutes). Built on the harness of 20261030071816: (owner 2026-10-29, Selling audit item B: a new listing goes
 * live when posted; only a failed automatic check holds it; members can report a listing; an admin can take it down).
 *
 *   node src/test/pglite/declutterCheckAfterPost.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterCheckAfterPost.pglite.mjs # RED: the prod definitions before it
 *
 * The baseline is the EFFECTIVE prod state before this migration (pg_get_functiondef, 2026-10-30): the three
 * functions are loaded verbatim from their newest repo files (20261027163240 publish, 20261014200728
 * record_ai_check, 20261029205908 edit_listing), the reports CHECK as 20260924182505 left it. The new migration then
 * runs verbatim on top of that, three times. Stubs are prod-shaped: require_feature (feature_disabled 42501),
 * is_caller_banned, declutter_assert_member, has_role, strikes, under-18, declutter_notify (records the notice).
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261031152545_declutter_check_after_post.sql", "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: the prod definitions before the migration (expect FAILs)");

/** One CREATE FUNCTION statement out of a migration file, whatever its dollar-quote tag. */
function fnFrom(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start))[1];
  const bodyAt = sql.indexOf(tag, start) + tag.length;
  const end = sql.indexOf(tag, bodyAt) + tag.length;
  return sql.slice(start, end) + ";";
}
const PROD_BEFORE = [
  // The effective prod definitions on 2026-10-31 (pg_get_functiondef matched the newest repo copy).
  fnFrom("20261030071816_declutter_live_on_post.sql", "declutter_publish_item"),
  fnFrom("20261030071816_declutter_live_on_post.sql", "declutter_record_ai_check"),
  // Not changed here; the approval the sweep must leave alone (review of 41771724f3).
  fnFrom("20261028200440_declutter_audit3_notices_and_empty_cart.sql", "declutter_admin_review_item"),
].join("\n");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const BANNED = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const B1 = "00000000-0000-4000-8000-0000000000b1";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const I = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const P = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const R = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
  CREATE FUNCTION public.has_role(u uuid, r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u AND ur.role = r) $$;
  CREATE TABLE public.switch_off (key text);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.switch_off s WHERE s.key = k) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz, is_seed boolean DEFAULT false);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
  CREATE FUNCTION public.declutter_assert_member(p_selling boolean) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    RETURN auth.uid();
  END $$;
  CREATE FUNCTION public.declutter_active_strike_count(u uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
  CREATE FUNCTION public.member_under_18(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text, other uuid);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title, p_message, p_link, p_other) $$;

  -- The live CHECK on status (20261028192719).
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, sale_mode text NOT NULL DEFAULT 'offers',
    status text NOT NULL CHECK (status = ANY (ARRAY['draft', 'pending_review', 'live', 'paused', 'reserved', 'sold', 'completed', 'ended', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere'])),
    title text, description text NOT NULL DEFAULT '', category text, condition_stars smallint DEFAULT 4, delivery_size text DEFAULT 'small',
    handovers text[], porch_ok boolean DEFAULT true, price_cents int DEFAULT 4000, current_price_cents int DEFAULT 4000,
    submitted_at timestamptz, live_at timestamptz, admin_approved_at timestamptz, is_seed boolean DEFAULT false,
    updated_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY, item_id uuid, storage_path text, position int);
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, floor_price_cents int, ai_checked_at timestamptz,
    ai_flag_reason text, review_note text, updated_at timestamptz);
  CREATE TABLE public.declutter_tax_attestations (item_id uuid PRIMARY KEY, seller_id uuid, bought_for_personal_use boolean,
    not_in_the_business boolean, not_a_frequent_seller boolean, keeps_item_until_handover boolean, attested_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_pickup_windows (seller_id uuid);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid,
    status text NOT NULL CHECK (status = ANY (ARRAY['open', 'accepted', 'declined', 'expired', 'withdrawn', 'voided'])),
    closed_at timestamptz, updated_at timestamptz);
  CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text
    CHECK (action = ANY (ARRAY['offer', 'counter', 'accept', 'decline', 'withdraw', 'expire', 'void'])));
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobname text, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c) RETURNING 1::bigint $$;
  CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
  CREATE TABLE public.admin_audit_log (admin_id uuid, action text, target_type text, target_id text, details jsonb);
  CREATE TABLE public.reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid, reported_type text NOT NULL,
    reported_id uuid NOT NULL, reason text NOT NULL, description text, status text NOT NULL DEFAULT 'new', created_at timestamptz DEFAULT now());
  -- As 20260924182505 left it (the live CHECK before this migration).
  ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
    CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text]));

  -- Review of 41771724f3 (2): a buyer reserves or pays before the check lands. Shapes as prod (20261014210518,
  -- 20261028221904 statuses, 20261004162921 payout_holds), trimmed to the columns the functions touch.
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid, seller_id uuid,
    status text NOT NULL CHECK (status IN ('awaiting_payment', 'paid', 'superseded', 'expired', 'completed', 'refunded')),
    close_reason text, closed_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, seller_id uuid, order_id uuid,
    status text NOT NULL CHECK (status IN ('in_cart', 'paid', 'missed', 'cancelled_by_seller', 'removed')),
    created_at timestamptz DEFAULT now(), closed_at timestamptz);
  CREATE TABLE public.payout_holds (helper_id uuid PRIMARY KEY, reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    held_by uuid, held_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.notifications (user_id uuid, title text, message text, type text, link text);
  CREATE TABLE public.test_subjects (user_id uuid);
  CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.test_subjects t WHERE t.user_id = u) $$;

  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.profiles (user_id, ban_status) VALUES ('${SELLER}', NULL), ('${BANNED}', NULL), ('${ADMIN}', NULL), ('${B1}', NULL), ('${B2}', NULL);
  INSERT INTO public.declutter_pickup_windows VALUES ('${SELLER}'), ('${BANNED}'), ('${ADMIN}');
`);
await db.exec(PROD_BEFORE);
await db.exec(`
  REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;
`);
if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
async function call(uid, sql, args = []) {
  await as(uid);
  try {
    return { ok: (await db.query(sql, args)).rows[0] };
  } catch (e) {
    return { err: e.message };
  }
}
/** A draft ready to publish: 1 photo, the four facts, a floor; ai = 'clean' | 'flagged' | 'unchecked'. */
async function draft(n, seller, ai) {
  await db.query(`INSERT INTO public.declutter_items (id, seller_id, status, title, category) VALUES ($1, $2, 'draft', $3, 'furniture')`, [I(n), seller, `Item ${n}`]);
  await db.query(`INSERT INTO public.declutter_item_photos VALUES ($1, $2, 'p.jpg', 0)`, [P(n), I(n)]);
  await db.query(`INSERT INTO public.declutter_tax_attestations (item_id, seller_id) VALUES ($1, $2)`, [I(n), seller]);
  await db.query(`INSERT INTO public.declutter_item_private (item_id, floor_price_cents, ai_checked_at, ai_flag_reason) VALUES ($1, 3000, $2, $3)`,
    [I(n), ai === "unchecked" ? null : new Date().toISOString(), ai === "flagged" ? "looks like a vape" : null]);
}
/** A live listing (was posted earlier) with open offers from the given buyers. */
async function liveWithOffers(n, seller, buyers) {
  await draft(n, seller, "clean");
  await db.query(`UPDATE public.declutter_items SET status = 'live', live_at = now() - interval '2 days', handovers = ARRAY['porch'] WHERE id = $1`, [I(n)]);
  for (const [k, b] of buyers.entries()) {
    await db.query(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, status) VALUES ($1, $2, $3, 'open')`, [`00000000-0000-4000-8000-000000000${n}${k}0`.slice(0, 36), I(n), b]);
  }
}
const EDIT = `SELECT public.declutter_edit_listing($1, $2, '', 'furniture', 4, 'small', ARRAY['porch'], true, true, true, true) AS s`;
// The service role's verdict, as the edge function records it (judged = the item's current photos and words).
async function verdict(n, seller, flag) {
  const it = await one("SELECT title, description, category FROM public.declutter_items WHERE id = $1", [I(n)]);
  const ids = (await db.query("SELECT id FROM public.declutter_item_photos WHERE item_id = $1", [I(n)])).rows.map((r) => r.id);
  return call(null, "SELECT public.declutter_record_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7) AS t",
    [I(n), seller, ids, it.title, it.description, it.category, flag]);
}
const status = async (n) => (await one("SELECT status FROM public.declutter_items WHERE id = $1", [I(n)])).status;
const offers = async (n) => (await db.query("SELECT status FROM public.declutter_offers WHERE item_id = $1 ORDER BY id", [I(n)])).rows.map((r) => r.status);
const noticesTo = async (u, title) => (await db.query("SELECT message, link FROM public.notices WHERE user_id = $1 AND title = $2", [u, title])).rows;


// ---- 1. Post publishes at once: a listing not checked yet goes LIVE (the check runs right after).
await draft(1, SELLER, "unchecked");
let r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(1)]);
check("T1 a listing not checked yet goes LIVE at Post", r.ok?.s === "live", JSON.stringify(r));
await draft(2, SELLER, "clean");
r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(2)]);
check("T2 a passed check: LIVE", r.ok?.s === "live", JSON.stringify(r));
await draft(3, SELLER, "flagged");
r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(3)]);
check("T3 a check that already flagged it: held (pending_review)", r.ok?.s === "pending_review", JSON.stringify(r));

// ---- 2. The check right after Post, on the live listing.
r = await verdict(1, SELLER, null);
check("T4 a clean check is recorded on the live listing", r.ok?.t != null, JSON.stringify(r));
check("  and it stays LIVE", (await status(1)) === "live", await status(1));
await draft(6, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(6)]);
await db.query(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, status) VALUES ('00000000-0000-4000-8000-000000000610', $1, $2, 'open')`, [I(6), B1]);
r = await verdict(6, SELLER, "looks like a vape");
check("T5 a flagged check on the live listing is recorded", r.ok?.t != null, JSON.stringify(r));
check("T6 ... and takes it down at once (held for an admin)", (await status(6)) === "pending_review", await status(6));
check("T7 ... its open offer closes", JSON.stringify(await offers(6)) === JSON.stringify(["voided"]), JSON.stringify(await offers(6)));
const told = await noticesTo(SELLER, "Your listing is waiting for a check");
check("T8 ... and the seller is told why", told.some((n) => n.message.includes("looks like a vape") && n.message.includes('"Item 6"')), JSON.stringify(told));
check("  the buyer is told nothing was charged", (await noticesTo(B1, "Listing changed")).some((n) => n.message.includes("Nothing was charged")));
r = await verdict(1, SELLER, "late flag");
check("T9 a listing already judged is never judged again (no washing a result)", !!r.err, JSON.stringify(r));

// ---- 3. Fail-safe: live 15 minutes with no check is held; a checked one is not.
await draft(7, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(7)]);
await db.query(`UPDATE public.declutter_items SET live_at = now() - interval '20 minutes' WHERE id IN ($1, $2)`, [I(7), I(2)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T10 the sweep holds the one listing whose check never came back", r.ok?.n === 1 && (await status(7)) === "pending_review", `${JSON.stringify(r)} ${await status(7)}`);
check("  a checked listing stays live", (await status(2)) === "live", await status(2));
check("  the seller is told", (await noticesTo(SELLER, "Your listing is waiting for a check")).some((n) => n.message.includes("didn't finish")));
r = await verdict(7, SELLER, null);
check("T11 a late clean check puts the held listing back LIVE", r.ok?.t != null && (await status(7)) === "live", `${JSON.stringify(r)} ${await status(7)}`);
check("T12 the sweep runs every 10 minutes by cron", (await one("SELECT count(*)::int AS n FROM cron.job WHERE jobname = 'declutter-unchecked-hold'")).n === 1);

// ---- 3b. Review of 41771724f3 (1): an admin's approval is never undone by the sweep.
await draft(8, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(8)]);
await db.query(`UPDATE public.declutter_items SET live_at = now() - interval '20 minutes' WHERE id = $1`, [I(8)]);
await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T14 the sweep holds an unchecked listing", (await status(8)) === "pending_review", await status(8));
r = await call(ADMIN, "SELECT public.declutter_admin_review_item($1, true, NULL) AS s", [I(8)]);
check("  an admin approves it", r.ok?.s === "live", JSON.stringify(r));
await db.query(`UPDATE public.declutter_items SET live_at = now() - interval '30 minutes', admin_approved_at = now() - interval '30 minutes' WHERE id = $1`, [I(8)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T15 the next sweep leaves the approved listing LIVE", r.ok?.n === 0 && (await status(8)) === "live", `${JSON.stringify(r)} ${await status(8)}`);
r = await verdict(8, SELLER, "late flag after approval");
check("T16 a late check can't take down a listing an admin approved", !!r.err && (await status(8)) === "live", `${JSON.stringify(r)} ${await status(8)}`);
// Approved long ago, then posted again (live_at after the approval): the sweep still holds it.
await draft(9, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(9)]);
await db.query(`UPDATE public.declutter_items SET live_at = now() - interval '20 minutes', admin_approved_at = now() - interval '9 days' WHERE id = $1`, [I(9)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T17 an old approval does not shield a later Post", (await status(9)) === "pending_review", `${JSON.stringify(r)} ${await status(9)}`);

// ---- 3c. Review of 41771724f3 (2): a check that lands after a buyer reserved or paid is not lost.
const O = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const L = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`;
// Reserved, not paid (an unpaid order open), then flagged.
await draft(10, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(10)]);
await db.query(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = $1`, [I(10)]);
await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status) VALUES ($1, $2, $3, 'awaiting_payment')`, [O(10), B2, SELLER]);
await db.query(`INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, order_id, status) VALUES ($1, $2, $3, $4, $5, 'in_cart')`, [L(10), I(10), B2, SELLER, O(10)]);
r = await verdict(10, SELLER, "looks like a weapon");
check("T18 a flag on a RESERVED listing is recorded", r.ok?.t != null, JSON.stringify(r));
const line10 = await one("SELECT status FROM public.declutter_cart_items WHERE id = $1", [L(10)]);
check("  its cart line closes with no strike ('removed')", line10?.status === "removed", JSON.stringify(line10));
const o10 = await one("SELECT status, close_reason FROM public.declutter_orders WHERE id = $1", [O(10)]);
check("  its unpaid order is superseded", o10.status === "superseded", JSON.stringify(o10));
// Review of 62f90f3368 (2): 'superseded' as the reason means "the buyer restarted checkout" (card fee kept); a
// payment still landing here must be refunded in full, as the buyer's notice promises.
check("  ... as not payable, so a late payment is refunded in full", o10.close_reason === "not_payable", JSON.stringify(o10));
check("  the item is held for an admin", (await status(10)) === "pending_review", await status(10));
check("  the buyer is told it left their cart, nothing charged", (await noticesTo(B2, "Listing changed")).some((n) => n.message.includes("left your cart")));
check("  no payout hold for an unpaid sale", (await one("SELECT count(*)::int AS n FROM public.payout_holds")).n === 0);
// Paid, then flagged: the payout waits for an admin.
await draft(11, SELLER, "unchecked");
await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(11)]);
await db.query(`UPDATE public.declutter_items SET status = 'reserved' WHERE id = $1`, [I(11)]);
await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status) VALUES ($1, $2, $3, 'paid')`, [O(11), B2, SELLER]);
await db.query(`INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, order_id, status) VALUES ($1, $2, $3, $4, $5, 'paid')`, [L(11), I(11), B2, SELLER, O(11)]);
r = await verdict(11, SELLER, "looks like a weapon");
check("T19 a flag on a PAID listing is recorded", r.ok?.t != null, JSON.stringify(r));
const hold = await one("SELECT reason FROM public.payout_holds WHERE helper_id = $1", [SELLER]);
check("  the seller's payouts are held, naming the order", !!hold?.reason?.includes(O(11)), JSON.stringify(hold));
const alerts = (await db.query("SELECT user_id, link FROM public.notifications WHERE type = 'admin_alert'")).rows;
check("  every admin is alerted", alerts.length === 1 && alerts[0].user_id === ADMIN && alerts[0].link === "/admin?view=payouts", JSON.stringify(alerts));
check("  the sale stands (line paid, order paid)", (await one("SELECT status FROM public.declutter_cart_items WHERE id = $1", [L(11)])).status === "paid"
  && (await one("SELECT status FROM public.declutter_orders WHERE id = $1", [O(11)])).status === "paid");
check("  the seller is told the payout waits for a check", (await noticesTo(SELLER, "Your sale is waiting for a check")).length === 1);
// A test seller's flag holds the payout but alerts no admin (owner 2026-10-30).
await db.query(`INSERT INTO public.test_subjects VALUES ($1)`, [BANNED]);
await draft(12, BANNED, "unchecked");
await call(BANNED, "SELECT public.declutter_publish_item($1) AS s", [I(12)]);
await db.query(`UPDATE public.declutter_items SET status = 'sold' WHERE id = $1`, [I(12)]);
await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status) VALUES ($1, $2, $3, 'paid')`, [O(12), B1, BANNED]);
await db.query(`INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, order_id, status) VALUES ($1, $2, $3, $4, $5, 'paid')`, [L(12), I(12), B1, BANNED, O(12)]);
r = await verdict(12, BANNED, "looks like a weapon");
check("T20 a SOLD test listing's flag holds the payout, no admin bell", r.ok?.t != null
  && !!(await one("SELECT 1 AS x FROM public.payout_holds WHERE helper_id = $1", [BANNED]))
  && (await one("SELECT count(*)::int AS n FROM public.notifications WHERE type = 'admin_alert'")).n === 1, JSON.stringify(r));

// ---- 3d. Review of 62f90f3368 (3): reserved or sold with no check 15 minutes after going live. The sweep holds
// the payout and alerts every admin (never for a test account), once; the sale stands.
const S2 = "00000000-0000-4000-8000-0000000000a3";
await db.query(`INSERT INTO public.profiles (user_id, ban_status) VALUES ($1, NULL)`, [S2]);
await db.query(`INSERT INTO public.declutter_pickup_windows VALUES ($1)`, [S2]);
const alertCount = async () => (await one("SELECT count(*)::int AS n FROM public.notifications WHERE type = 'admin_alert'")).n;
const before = await alertCount();
await draft(13, S2, "unchecked");
await call(S2, "SELECT public.declutter_publish_item($1) AS s", [I(13)]);
await db.query(`UPDATE public.declutter_items SET status = 'reserved', live_at = now() - interval '20 minutes' WHERE id = $1`, [I(13)]);
await db.query(`INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status) VALUES ($1, $2, $3, 'awaiting_payment')`, [O(13), B1, S2]);
await db.query(`INSERT INTO public.declutter_cart_items (id, item_id, buyer_id, seller_id, order_id, status) VALUES ($1, $2, $3, $4, $5, 'in_cart')`, [L(13), I(13), B1, S2, O(13)]);
// Reserved only 5 minutes after going live: the check may still come back, so the sweep leaves it.
await draft(14, S2, "unchecked");
await call(S2, "SELECT public.declutter_publish_item($1) AS s", [I(14)]);
await db.query(`UPDATE public.declutter_items SET status = 'reserved', live_at = now() - interval '5 minutes' WHERE id = $1`, [I(14)]);
// A test seller's sold listing, never checked: held, no admin bell.
const S3 = "00000000-0000-4000-8000-0000000000a4";
await db.query(`INSERT INTO public.profiles (user_id, ban_status) VALUES ($1, NULL)`, [S3]);
await db.query(`INSERT INTO public.declutter_pickup_windows VALUES ($1)`, [S3]);
await db.query(`INSERT INTO public.test_subjects VALUES ($1)`, [S3]);
await draft(15, S3, "unchecked");
await call(S3, "SELECT public.declutter_publish_item($1) AS s", [I(15)]);
await db.query(`UPDATE public.declutter_items SET status = 'sold', live_at = now() - interval '20 minutes' WHERE id = $1`, [I(15)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
const hold13 = await one("SELECT reason FROM public.payout_holds WHERE helper_id = $1", [S2]);
check("T21 a RESERVED listing never checked 15 minutes after going live: the seller's payouts are held, naming the order",
  r.ok?.n === 2 && !!hold13?.reason?.includes(O(13)) && hold13.reason.includes("didn't finish"), `${JSON.stringify(r)} ${JSON.stringify(hold13)}`);
const newAlerts = (await db.query("SELECT user_id, link, title FROM public.notifications WHERE type = 'admin_alert' AND title = 'A sold Declutter listing was never checked'")).rows;
check("  every admin is alerted once, and not for the test seller", newAlerts.length === 1 && newAlerts[0].user_id === ADMIN && newAlerts[0].link === "/admin?view=payouts"
  && (await alertCount()) === before + 1, JSON.stringify(newAlerts));
check("  the sale stands (still reserved, its line in the cart)", (await status(13)) === "reserved"
  && (await one("SELECT status FROM public.declutter_cart_items WHERE id = $1", [L(13)])).status === "in_cart", await status(13));
check("  the seller is told", (await noticesTo(S2, "Your sale is waiting for a check")).length === 1);
check("  the test seller's payouts are held too", !!(await one("SELECT 1 AS x FROM public.payout_holds WHERE helper_id = $1", [S3])));
check("T22 a listing reserved 5 minutes after going live is left alone", (await one("SELECT ai_checked_at FROM public.declutter_item_private WHERE item_id = $1", [I(14)])).ai_checked_at === null);
await db.query("DELETE FROM public.payout_holds WHERE helper_id = $1", [S2]); // the admin lifts the hold
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T23 the next sweep does not hold or alert again (runs once per item; a lifted hold stays lifted)",
  r.ok?.n === 0 && !(await one("SELECT 1 AS x FROM public.payout_holds WHERE helper_id = $1", [S2])) && (await alertCount()) === before + 1,
  `${JSON.stringify(r)} ${await alertCount()}`);

// Re-review of e23f131d97: the sale falls through (the buyer removes it, 20261028221904: line 'removed', item back
// to 'live'). Marked "didn't finish" and live again, it must not stay up unchecked: the next sweep holds it.
await db.query(`UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now() WHERE id = $1`, [L(13)]);
await db.query(`UPDATE public.declutter_items SET status = 'live' WHERE id = $1`, [I(13)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T24 reserved, swept, the buyer removes it: the next sweep holds the listing that is live again",
  r.ok?.n === 1 && (await status(13)) === "pending_review", `${JSON.stringify(r)} ${await status(13)}`);
check("  the seller is told", (await noticesTo(S2, "Your listing is waiting for a check")).some((n) => n.message.includes("didn't finish") && n.message.includes('"Item 13"')));
// A flagged sale that falls through the same way (a real flag, from record_ai_check on a paid sale).
await db.query(`UPDATE public.declutter_cart_items SET status = 'removed', closed_at = now() WHERE id = $1`, [L(11)]);
await db.query(`UPDATE public.declutter_items SET status = 'live', live_at = now() - interval '1 hour' WHERE id = $1`, [I(11)]);
r = await call(null, "SELECT public.declutter_hold_unchecked_listings() AS n");
check("T25 a flagged sold listing that is live again is held too, and the seller is told the flag",
  r.ok?.n === 1 && (await status(11)) === "pending_review"
  && (await noticesTo(SELLER, "Your listing is waiting for a check")).some((n) => n.message.includes('flagged "Item 11" (looks like a weapon)')),
  `${JSON.stringify(r)} ${await status(11)}`);

// ---- 4. Grants.
const g = await one(`SELECT has_function_privilege('anon', 'public.declutter_hold_unchecked_listings()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_hold_unchecked_listings()', 'EXECUTE') AS u`).catch((e) => ({ err: e.message }));
check("T13 members cannot run the sweep (anon, authenticated)", g?.a === false && g?.u === false, JSON.stringify(g));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
