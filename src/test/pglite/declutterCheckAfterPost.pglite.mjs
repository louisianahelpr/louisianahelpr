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

// ---- 4. Grants.
const g = await one(`SELECT has_function_privilege('anon', 'public.declutter_hold_unchecked_listings()', 'EXECUTE') AS a,
  has_function_privilege('authenticated', 'public.declutter_hold_unchecked_listings()', 'EXECUTE') AS u`).catch((e) => ({ err: e.message }));
check("T13 members cannot run the sweep (anon, authenticated)", g?.a === false && g?.u === false, JSON.stringify(g));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
