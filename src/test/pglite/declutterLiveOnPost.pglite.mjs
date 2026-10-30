#!/usr/bin/env node
/**
 * PGlite proof for 20261030043553_declutter_live_on_post (owner 2026-10-29, Selling audit item B: a new listing goes
 * live when posted; only a failed automatic check holds it; members can report a listing; an admin can take it down).
 *
 *   node src/test/pglite/declutterLiveOnPost.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterLiveOnPost.pglite.mjs # RED: the prod definitions before it
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
const NEW = readFileSync(MIG + "20261030043553_declutter_live_on_post.sql", "utf8");
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
const BASELINE = [
  fnFrom("20261027163240_payout_setup_only_when_owed.sql", "declutter_publish_item"),
  fnFrom("20261014200728_declutter_slice2_followups.sql", "declutter_record_ai_check"),
  fnFrom("20261029205908_declutter_edit_listing.sql", "declutter_edit_listing"),
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
await db.exec(BASELINE);
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

// ---- 1. Publish: a brand-new seller (0 admin-approved listings) goes live on a passed check.
await draft(1, SELLER, "clean");
let r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(1)]);
check("T1 a brand-new seller's first listing with a passed check goes LIVE (not held for an admin)", r.ok?.s === "live", JSON.stringify(r));
check("  its live_at is set", (await one("SELECT live_at FROM public.declutter_items WHERE id = $1", [I(1)])).live_at !== null);
await draft(2, SELLER, "unchecked");
r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(2)]);
check("T2 a check that never came back holds it (fail-safe)", r.ok?.s === "pending_review", JSON.stringify(r));
await draft(3, SELLER, "flagged");
r = await call(SELLER, "SELECT public.declutter_publish_item($1) AS s", [I(3)]);
check("T3 a flagged check holds it", r.ok?.s === "pending_review", JSON.stringify(r));

// ---- 2. A big edit on a live listing keeps its offers open and tells their buyers.
await liveWithOffers(4, SELLER, [B1, B2]);
r = await call(SELLER, EDIT, [I(4), "Oak rocking chair, refinished"]);
check("T4 a new title still goes to the automatic re-check (pending_review)", r.ok?.s === "pending_review", JSON.stringify(r));
check("T5 its open offers stay open", JSON.stringify(await offers(4)) === JSON.stringify(["open", "open"]), JSON.stringify(await offers(4)));
const upd = await noticesTo(B1, "Listing updated");
check("T6 each buyer with an open offer is told it changed, with a link to the item",
  upd.length === 1 && upd[0].message === 'The seller updated "Oak rocking chair, refinished". Check it before your offer is answered.'
    && upd[0].link === `/declutter/item/${I(4)}`, JSON.stringify(upd));
check("  the second buyer too", (await noticesTo(B2, "Listing updated")).length === 1);
r = await verdict(4, SELLER, null);
check("T7 a clean re-check is recorded on the edited listing", r.ok?.t != null, JSON.stringify(r));
check("T8 ... and puts it back LIVE by itself", (await status(4)) === "live", await status(4));
check("  offers still open after the clean re-check", JSON.stringify(await offers(4)) === JSON.stringify(["open", "open"]));
check("  live_at kept from the first posting",
  (await one("SELECT live_at < now() - interval '1 day' AS old FROM public.declutter_items WHERE id = $1", [I(4)])).old === true);

// ---- 3. A flagged re-check holds it and closes the offers.
await liveWithOffers(5, SELLER, [B1]);
await call(SELLER, EDIT, [I(5), "Disposable vape pack"]);
r = await verdict(5, SELLER, "vape");
check("T9 a flagged re-check keeps the edited listing held", r.ok?.t != null && (await status(5)) === "pending_review", `${JSON.stringify(r)} ${await status(5)}`);
check("T10 ... and closes its open offers", JSON.stringify(await offers(5)) === JSON.stringify(["voided"]), JSON.stringify(await offers(5)));
const ch = await noticesTo(B1, "Listing changed");
check("  the buyer is told nothing was charged", ch.some((n) => n.message === 'The seller changed "Disposable vape pack", so your offer is closed. Nothing was charged.'), JSON.stringify(ch));
check("  a void event is written", (await one("SELECT count(*)::int AS n FROM public.declutter_offer_events WHERE action = 'void'")).n === 1);
r = await verdict(5, SELLER, null);
check("T11 a flag can't be washed off by asking again (item_not_found)", r.err === "item_not_found" && (await status(5)) === "pending_review", JSON.stringify(r));
r = await verdict(2, SELLER, null);
check("T12 a new listing held because its check never came back stays for the admin", r.err === "item_not_found" && (await status(2)) === "pending_review", JSON.stringify(r));

// ---- 4. A seller who can't sell now stays held even on a clean re-check.
await liveWithOffers(6, BANNED, []);
await call(BANNED, EDIT, [I(6), "Lamp, new shade"]);
await db.query("UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = $1", [BANNED]);
r = await verdict(6, BANNED, null);
check("T13 a restricted seller's edited listing stays held on a clean re-check", (await status(6)) === "pending_review", `${JSON.stringify(r)} ${await status(6)}`);
await liveWithOffers(7, SELLER, []);
await call(SELLER, EDIT, [I(7), "Desk, new top"]);
const it7 = await one("SELECT category, description FROM public.declutter_items WHERE id = $1", [I(7)]);
r = await call(null, "SELECT public.declutter_record_ai_check($1, $2, ARRAY[$3]::uuid[], 'Desk, old words', $4, $5, NULL) AS t", [I(7), SELLER, P(7), it7.description, it7.category]);
check("T14 a verdict on words that changed since is refused (ai_check_stale)", r.err === "ai_check_stale" && (await status(7)) === "pending_review", JSON.stringify(r));

// ---- 5. A member reports a listing.
r = await call(B1, `INSERT INTO public.reports (reporter_id, reported_type, reported_id, reason) VALUES ($1, 'declutter_item', $2, 'Prohibited item') RETURNING id`, [B1, I(1)]);
check("T15 a member can file a report about a listing (reported_type declutter_item)", !!r.ok?.id, JSON.stringify(r));
const reportId = r.ok?.id;
await db.query(`INSERT INTO public.reports (id, reporter_id, reported_type, reported_id, reason) VALUES ($1, $2, 'job', $3, 'Spam or scam')`, [R(1), B2, I(1)]);

// ---- 6. An admin takes a reported listing down.
const DOWN = "SELECT public.declutter_admin_take_down_item($1, $2, $3) AS s";
await db.query(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, status) VALUES ('00000000-0000-4000-8000-000000000990', $1, $2, 'open')`, [I(1), B2]);
r = await call(SELLER, DOWN, [I(1), "Not allowed", null]);
check("T16 a member can't take a listing down (not_admin)", r.err === "not_admin", JSON.stringify(r));
await db.query(`INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES ($1, $2, 'live', 'Admin lamp')`, [I(20), ADMIN]);
r = await call(ADMIN, DOWN, [I(20), "Mine", null]);
check("T17 an admin can't take down their own listing (own_listing)", r.err === "own_listing", JSON.stringify(r));
r = await call(ADMIN, DOWN, [I(1), "   ", null]);
check("T18 a take-down needs a reason (review_note_required)", r.err === "review_note_required", JSON.stringify(r));
await db.query(`INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES ($1, $2, 'reserved', 'Sold chair')`, [I(21), SELLER]);
r = await call(ADMIN, DOWN, [I(21), "Prohibited", null]);
check("T19 a reserved listing (buyer and money in play) is not taken down here (item_not_removable)", r.err === "item_not_removable", JSON.stringify(r));
r = await call(ADMIN, DOWN, [I(1), "Prohibited", R(1)]);
check("T20 a report about something else is refused (report_not_for_item)", r.err === "report_not_for_item", JSON.stringify(r));
await db.exec("INSERT INTO public.switch_off VALUES ('declutter')");
r = await call(ADMIN, DOWN, [I(1), "Prohibited", reportId]);
check("T21 switch off: refused with feature_disabled", r.err === "feature_disabled", JSON.stringify(r));
await db.exec("DELETE FROM public.switch_off");
r = await call(ADMIN, DOWN, [I(1), "Prohibited item: a vape", reportId]);
check("T22 an admin takes a reported listing down", r.ok?.s === "removed" && (await status(1)) === "removed", `${JSON.stringify(r)}`);
check("  its open offer closes", (await one("SELECT status FROM public.declutter_offers WHERE id = '00000000-0000-4000-8000-000000000990'"))?.status === "voided");
check("  the buyer is told", (await noticesTo(B2, "Item taken down")).some((n) => n.message.includes("Nothing was charged")));
const log = await one("SELECT action, details FROM public.admin_audit_log WHERE target_id = $1", [I(1)]);
check("T23 admin_audit_log keeps the report id", log?.action === "declutter_listing_taken_down" && log?.details?.report_id === reportId, JSON.stringify(log));
check("  the report is resolved", (await one("SELECT status FROM public.reports WHERE id = $1", [reportId ?? R(99)]))?.status === "resolved");
const told = await noticesTo(SELLER, "Your listing was taken down");
check("  the seller is told why", told.some((n) => n.message === '"Item 1" was taken down: Prohibited item: a vape'), JSON.stringify(told));
check("  the reason is kept for the seller's page", (await one("SELECT review_note FROM public.declutter_item_private WHERE item_id = $1", [I(1)]))?.review_note === "Prohibited item: a vape");

// ---- 7. The admin reports queue names a listing whatever its status.
r = await call(SELLER, "SELECT * FROM public.declutter_admin_reported_items(ARRAY[$1]::uuid[])", [I(1)]);
check("T24 a member can't read the reported-listings list (not_admin)", r.err === "not_admin", JSON.stringify(r));
r = await call(ADMIN, "SELECT * FROM public.declutter_admin_reported_items(ARRAY[$1]::uuid[])", [I(1)]);
check("T25 an admin reads a removed listing's title and seller", r.ok?.title === "Item 1" && r.ok?.seller_id === SELLER && r.ok?.status === "removed", JSON.stringify(r));

// ---- 8. Grants by role name.
const can = async (role, sig) => {
  try {
    return (await one(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') AS c`)).c;
  } catch (e) {
    return `missing: ${e.message}`;
  }
};
check("T26 anon can't run the take-down", (await can("anon", "public.declutter_admin_take_down_item(uuid,text,uuid)")) === false);
check("  anon can't run the reported-listings read", (await can("anon", "public.declutter_admin_reported_items(uuid[])")) === false);
check("  a signed-in member can call the take-down (it refuses non-admins itself)", (await can("authenticated", "public.declutter_admin_take_down_item(uuid,text,uuid)")) === true);
check("  the verdict stays service-role only", (await can("authenticated", "public.declutter_record_ai_check(uuid,uuid,uuid[],text,text,text,text)")) === false
  && (await can("anon", "public.declutter_record_ai_check(uuid,uuid,uuid[],text,text,text,text)")) === false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL(S)`);
process.exit(failures === 0 ? 0 : 1);
