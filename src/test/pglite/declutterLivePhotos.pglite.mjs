#!/usr/bin/env node
/**
 * PGlite proof for 20261030061927_declutter_live_listing_photos (audit DC-8 / Q2476): a live listing's photos can be
 * added and removed; a change sends it to the automatic re-check the way a big edit does (20261030043553), its open
 * offers stay open and their buyers are told; a flagged listing, another seller's listing and the last photo are
 * refused.
 *
 *   node src/test/pglite/declutterLivePhotos.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterLivePhotos.pglite.mjs # RED: the prod definitions before it
 *
 * The baseline is the EFFECTIVE prod state (pg_get_functiondef, 2026-10-30): the photo functions verbatim from their
 * newest repo file (20261014193955, identical to prod), the photo trigger from 20261014200728, and the functions
 * 20261030043553 restates (loaded from their pre-20261030043553 files, then 20261030043553 itself), so the re-check
 * that puts a clean listing back live is the real one. Stubs as in declutterLiveOnPost.pglite.mjs.
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261030061927_declutter_live_listing_photos.sql", "utf8");
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
  fnFrom("20261027163240_payout_setup_only_when_owed.sql", "declutter_publish_item"),
  fnFrom("20261014200728_declutter_slice2_followups.sql", "declutter_record_ai_check"),
  fnFrom("20261029205908_declutter_edit_listing.sql", "declutter_edit_listing"),
  fnFrom("20261014193955_declutter_foundation.sql", "declutter_add_item_photo"),
  fnFrom("20261014193955_declutter_foundation.sql", "declutter_remove_item_photo"),
  fnFrom("20261014200728_declutter_slice2_followups.sql", "declutter_photos_void_ai_check"),
  `CREATE TRIGGER trg_declutter_photos_void_ai_check AFTER INSERT OR DELETE ON public.declutter_item_photos
     FOR EACH ROW EXECUTE FUNCTION public.declutter_photos_void_ai_check();`,
].join("\n");
const LIVE_ON_POST = readFileSync(MIG + "20261030043553_declutter_live_on_post.sql", "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const BANNED = "00000000-0000-4000-8000-0000000000a3";
const B1 = "00000000-0000-4000-8000-0000000000b1";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const I = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const P = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;

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
  CREATE TABLE public.declutter_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, seller_id uuid, storage_path text, position int);
  CREATE SCHEMA storage;
  CREATE TABLE storage.objects (bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
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
await db.exec(PROD_BEFORE);
await db.exec(LIVE_ON_POST);
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
/** A listing of `seller` in `status` with one photo, a passed check and open offers from `buyers`. */
async function listing(n, seller, status, buyers = []) {
  await db.query(`INSERT INTO public.declutter_items (id, seller_id, status, title, category, handovers, live_at)
    VALUES ($1, $2, $3, $4, 'furniture', ARRAY['porch'], CASE WHEN $3 = 'draft' THEN NULL ELSE now() - interval '2 days' END)`,
    [I(n), seller, status, `Item ${n}`]);
  await db.query(`INSERT INTO public.declutter_item_photos (id, item_id, seller_id, storage_path, position) VALUES ($1, $2, $3, $4, 0)`,
    [P(n), I(n), seller, `${seller}/declutter/${I(n)}/first.jpg`]);
  await db.query(`INSERT INTO public.declutter_item_private (item_id, floor_price_cents, ai_checked_at) VALUES ($1, 3000, now())`, [I(n)]);
  for (const [k, b] of buyers.entries()) {
    await db.query(`INSERT INTO public.declutter_offers (id, item_id, buyer_id, status) VALUES ($1, $2, $3, 'open')`,
      [`00000000-0000-4000-8000-00000004${String(n).padStart(2, "0")}${String(k).padStart(2, "0")}`, I(n), b]);
  }
}
/** The seller's upload, as the app's addPhoto leaves it in storage before it calls the function. */
async function uploaded(seller, n, name) {
  const path = `${seller}/declutter/${I(n)}/${name}.jpg`;
  await db.query(`INSERT INTO storage.objects VALUES ('job-photos', $1, $2, $3, '{"mimetype":"image/jpeg","size":"1000"}')`, [path, seller, seller]);
  return path;
}
const ADD = "SELECT public.declutter_add_item_photo($1, $2) AS id";
const REMOVE = "SELECT public.declutter_remove_item_photo($1) AS path";
async function verdict(n, seller, flag) {
  const it = await one("SELECT title, description, category FROM public.declutter_items WHERE id = $1", [I(n)]);
  const ids = (await db.query("SELECT id FROM public.declutter_item_photos WHERE item_id = $1", [I(n)])).rows.map((r) => r.id);
  return call(null, "SELECT public.declutter_record_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7) AS t",
    [I(n), seller, ids, it.title, it.description, it.category, flag]);
}
const status = async (n) => (await one("SELECT status FROM public.declutter_items WHERE id = $1", [I(n)])).status;
const photos = async (n) => (await one("SELECT count(*)::int AS c FROM public.declutter_item_photos WHERE item_id = $1", [I(n)])).c;
const offers = async (n) => (await db.query("SELECT status FROM public.declutter_offers WHERE item_id = $1 ORDER BY id", [I(n)])).rows.map((r) => r.status);
const updated = async (u) => (await db.query("SELECT message, link FROM public.notices WHERE user_id = $1 AND title = 'Listing updated'", [u])).rows;

await db.query("INSERT INTO public.profiles (user_id, ban_status) VALUES ($1, NULL) ON CONFLICT DO NOTHING", [OTHER]);

// ---- 1. A live listing gets a new photo.
await listing(1, SELLER, "live", [B1, B2]);
let r = await call(SELLER, ADD, [I(1), await uploaded(SELLER, 1, "second")]);
check("T1 a photo can be added to the seller's own LIVE listing", !!r.ok?.id && (await photos(1)) === 2, JSON.stringify(r));
check("T2 ... which sends it to the automatic re-check (pending_review, hidden from buyers)", (await status(1)) === "pending_review", await status(1));
check("  its check is cleared (the photo trigger)", (await one("SELECT ai_checked_at FROM public.declutter_item_private WHERE item_id = $1", [I(1)])).ai_checked_at === null);
check("T3 its open offers stay open", JSON.stringify(await offers(1)) === JSON.stringify(["open", "open"]), JSON.stringify(await offers(1)));
const told = await updated(B1);
check("T4 each buyer with an open offer is told it changed, with a link",
  told.length === 1 && told[0].message === 'The seller updated "Item 1". Check it before your offer is answered.' && told[0].link === `/declutter/item/${I(1)}`,
  JSON.stringify(told));
check("  the second buyer too", (await updated(B2)).length === 1);
// More changes in the same edit, while the check is still pending: allowed, buyers not told twice.
r = await call(SELLER, REMOVE, [P(1)]);
check("T5 while the re-check is pending, a photo can still be removed (same edit)", r.ok?.path === `${SELLER}/declutter/${I(1)}/first.jpg` && (await photos(1)) === 1, JSON.stringify(r));
check("  buyers are told once, not per photo", (await updated(B1)).length === 1, JSON.stringify(await updated(B1)));
r = await verdict(1, SELLER, null);
check("T6 a clean re-check of the new photos puts it back LIVE by itself", r.ok?.t != null && (await status(1)) === "live", `${JSON.stringify(r)} ${await status(1)}`);
check("  offers still open", JSON.stringify(await offers(1)) === JSON.stringify(["open", "open"]));

// ---- 2. Removing a photo from a live listing.
await listing(2, SELLER, "live", [B1]);
await call(SELLER, ADD, [I(2), await uploaded(SELLER, 2, "second")]);
await verdict(2, SELLER, null);
check("  (setup: listing 2 is live again with 2 photos)", (await status(2)) === "live" && (await photos(2)) === 2);
r = await call(SELLER, REMOVE, [P(2)]);
check("T7 a photo can be removed from a LIVE listing, and it goes to the re-check", r.ok?.path != null && (await status(2)) === "pending_review", `${JSON.stringify(r)} ${await status(2)}`);
const last = (await one("SELECT id FROM public.declutter_item_photos WHERE item_id = $1", [I(2)])).id;
r = await call(SELLER, REMOVE, [last]);
check("T8 the LAST photo of a listing on sale can't be removed (too_few_photos)", r.err === "too_few_photos" && (await photos(2)) === 1, JSON.stringify(r));

// ---- 3. A flagged re-check: the flag can't be washed off by swapping a photo.
await listing(3, SELLER, "live", [B1]);
await call(SELLER, ADD, [I(3), await uploaded(SELLER, 3, "vape")]);
await verdict(3, SELLER, "looks like a vape");
check("  (setup: listing 3 held on a flag)", (await status(3)) === "pending_review");
r = await call(SELLER, ADD, [I(3), await uploaded(SELLER, 3, "clean")]);
check("T9 a listing held on a flag refuses a new photo (item_not_editable)", r.err === "item_not_editable", JSON.stringify(r));
r = await call(SELLER, REMOVE, [P(3)]);
check("T10 ... and refuses removing one (photo_not_found, as for any photo it can't touch)", r.err === "photo_not_found" && (await photos(3)) === 2, JSON.stringify(r));

// ---- 4. Someone else's listing, other statuses, the switch.
await listing(4, OTHER, "live", []);
r = await call(SELLER, ADD, [I(4), await uploaded(SELLER, 4, "x")]);
check("T11 another seller's listing: item_not_found", r.err === "item_not_found", JSON.stringify(r));
r = await call(SELLER, REMOVE, [P(4)]);
check("T12 another seller's photo: photo_not_found", r.err === "photo_not_found" && (await photos(4)) === 1, JSON.stringify(r));
for (const [n, st] of [[5, "paused"], [6, "reserved"], [7, "sold"]]) {
  await listing(n, SELLER, st, []);
  await db.query(`INSERT INTO public.declutter_item_photos (id, item_id, seller_id, storage_path, position) VALUES (gen_random_uuid(), $1, $2, 'b.jpg', 1)`, [I(n), SELLER]);
  r = await call(SELLER, ADD, [I(n), await uploaded(SELLER, n, "x")]);
  const r2 = await call(SELLER, REMOVE, [P(n)]);
  check(`T13 a ${st} listing: no photo change (item_not_editable / photo_not_found)`, r.err === "item_not_editable" && r2.err === "photo_not_found" && (await status(n)) === st, `${JSON.stringify(r)} ${JSON.stringify(r2)}`);
}
await listing(8, SELLER, "live", []);
r = await call(SELLER, ADD, [I(8), `${SELLER}/declutter/${I(8)}/never-uploaded.jpg`]);
check("T14 a path with no upload behind it is refused (photo_not_uploaded) and nothing changes", r.err === "photo_not_uploaded" && (await status(8)) === "live", JSON.stringify(r));
await db.exec("INSERT INTO public.switch_off VALUES ('declutter')");
r = await call(SELLER, ADD, [I(8), await uploaded(SELLER, 8, "y")]);
check("T15 switch off: feature_disabled", r.err === "feature_disabled", JSON.stringify(r));
await db.exec("DELETE FROM public.switch_off");
await db.query("UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = $1", [SELLER]);
r = await call(SELLER, ADD, [I(8), await uploaded(SELLER, 8, "z")]);
check("T16 a restricted seller: account_restricted", r.err === "account_restricted" && (await status(8)) === "live", JSON.stringify(r));
await db.query("UPDATE public.profiles SET ban_status = NULL WHERE user_id = $1", [SELLER]);

// ---- 5. Drafts are as before.
await listing(9, SELLER, "draft", []);
r = await call(SELLER, ADD, [I(9), await uploaded(SELLER, 9, "a")]);
check("T17 a draft still takes photos and stays a draft", !!r.ok?.id && (await status(9)) === "draft", JSON.stringify(r));
r = await call(SELLER, REMOVE, [P(9)]);
const r9 = await call(SELLER, REMOVE, [(await one("SELECT id FROM public.declutter_item_photos WHERE item_id = $1", [I(9)])).id]);
check("T18 a draft's photos can all be removed (no minimum before posting)", !!r.ok?.path && !!r9.ok?.path && (await photos(9)) === 0, `${JSON.stringify(r)} ${JSON.stringify(r9)}`);

// ---- 6. Grants by role name.
const can = async (role, sig) => (await one(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') AS c`)).c;
check("T19 anon can run neither photo function", (await can("anon", "public.declutter_add_item_photo(uuid,text)")) === false
  && (await can("anon", "public.declutter_remove_item_photo(uuid)")) === false);
check("  a signed-in member can (each refuses what isn't theirs)", (await can("authenticated", "public.declutter_add_item_photo(uuid,text)")) === true
  && (await can("authenticated", "public.declutter_remove_item_photo(uuid)")) === true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL(S)`);
process.exit(failures === 0 ? 0 : 1);
