#!/usr/bin/env node
/**
 * PGlite proof for 20261030215829_declutter_reorder_item_photos (audit posting 1030 #9): a seller reorders the photos on
 * their own listing; the set must be exact; nothing is re-checked, re-reviewed or sent to buyers; the statuses are the
 * ones adding a photo allows; another seller, a banned seller, a switched-off feature and anon are refused.
 *
 *   node src/test/pglite/declutterReorderPhotos.pglite.mjs                       # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/declutterReorderPhotos.pglite.mjs    # RED: prod before it
 *   NEW_MIGRATION=no-defer node src/test/pglite/declutterReorderPhotos.pglite.mjs # RED: the function on prod's constraint
 *
 * The table's constraints and the photo trigger are copied from prod (pg_constraint / pg_trigger, 2026-10-30), and
 * declutter_add_item_photo and declutter_remove_item_photo are the repo's newest (20261030061927), so a later add or
 * remove is proved against the deferrable constraint. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW = readFileSync(MIG + "20261030215829_declutter_reorder_item_photos.sql", "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE} (expect FAILs)`);

function fnFrom(file, name) {
  const sql = readFileSync(MIG + file, "utf8");
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(start))[1];
  const bodyAt = sql.indexOf(tag, start) + tag.length;
  const end = sql.indexOf(tag, bodyAt) + tag.length;
  return sql.slice(start, end) + ";";
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const SELLER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const BANNED = "00000000-0000-4000-8000-0000000000a3";
const BUYER = "00000000-0000-4000-8000-0000000000b1";
const I = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const P = (n, k) => `00000000-0000-4000-8000-000000${String(n).padStart(2, "0")}02${String(k).padStart(2, "0")}`;

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE TABLE auth.caller (uid uuid);
  INSERT INTO auth.caller VALUES (NULL);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.caller $$;
  CREATE TABLE public.switch_off (key text);
  CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM public.switch_off s WHERE s.key = k) THEN
      RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
    END IF;
  END $$;
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text);
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.ban_status = 'banned') $$;
  CREATE FUNCTION public.declutter_assert_member(p_selling boolean) RETURNS uuid LANGUAGE plpgsql AS $$
  BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    RETURN auth.uid();
  END $$;
  CREATE TABLE public.notices (user_id uuid, type text, title text);
  CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_message text, p_link text, p_other uuid DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $$ INSERT INTO public.notices VALUES (p_user, p_type, p_title) $$;
  CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text NOT NULL, title text, price_cents int DEFAULT 4000,
    submitted_at timestamptz, live_at timestamptz, updated_at timestamptz DEFAULT '2020-01-01');
  CREATE TABLE public.declutter_item_private (item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_flag_reason text, updated_at timestamptz);
  CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, status text);
  CREATE SCHEMA storage;
  CREATE TABLE storage.objects (bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
  -- As on prod (pg_constraint, 2026-10-30).
  CREATE TABLE public.declutter_item_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL,
    storage_path text NOT NULL UNIQUE,
    position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT declutter_item_photos_position_key UNIQUE (item_id, position));
  INSERT INTO public.profiles VALUES ('${SELLER}', NULL), ('${OTHER}', NULL), ('${BANNED}', 'banned');
`);
await db.exec(fnFrom("20261014200728_declutter_slice2_followups.sql", "declutter_photos_void_ai_check"));
await db.exec(`CREATE TRIGGER trg_declutter_photos_void_ai_check AFTER INSERT OR DELETE ON public.declutter_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.declutter_photos_void_ai_check();`);
await db.exec(fnFrom("20261030061927_declutter_live_listing_photos.sql", "declutter_add_item_photo"));
await db.exec(fnFrom("20261030061927_declutter_live_listing_photos.sql", "declutter_remove_item_photo"));
if (MODE === "") for (let i = 0; i < 3; i++) await db.exec(NEW);
else if (MODE === "no-defer") await db.exec(NEW.slice(NEW.indexOf("-- @function-step")));

const as = (uid) => db.query("UPDATE auth.caller SET uid = $1", [uid]);
async function call(uid, sql, args = []) {
  await as(uid);
  try {
    return { ok: (await db.query(sql, args)).rows[0] };
  } catch (e) {
    return { err: e.message };
  }
}
const REORDER = "SELECT public.declutter_reorder_item_photos($1, $2::uuid[]) AS n";
const reorder = (uid, item, ids) => call(uid, REORDER, [item, ids]);

/** A listing with `count` photos at positions 0.., and a passed check. */
async function listing(n, status, count, { seller = SELLER, liveAt = status !== "draft", flag = null, checked = true } = {}) {
  await db.query("INSERT INTO public.declutter_items (id, seller_id, status, title, live_at) VALUES ($1, $2, $3, $4, $5)",
    [I(n), seller, status, `Item ${n}`, liveAt ? "2026-10-01" : null]);
  for (let k = 0; k < count; k++) {
    await db.query("INSERT INTO public.declutter_item_photos (id, item_id, seller_id, storage_path, position) VALUES ($1, $2, $3, $4, $5)",
      [P(n, k), I(n), seller, `${seller}/declutter/${I(n)}/p${k}.jpg`, k]);
  }
  // After the photos: adding a photo voids the check and clears a flag (the trigger), which would undo this fixture.
  await db.query("INSERT INTO public.declutter_item_private (item_id, ai_checked_at, ai_flag_reason) VALUES ($1, $2, $3)", [I(n), checked ? "2026-10-01" : null, flag]);
}
const order = async (n) => (await db.query("SELECT id FROM public.declutter_item_photos WHERE item_id = $1 ORDER BY position", [I(n)])).rows.map((r) => r.id);
const positions = async (n) => (await db.query("SELECT position FROM public.declutter_item_photos WHERE item_id = $1 ORDER BY position", [I(n)])).rows.map((r) => r.position);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (n, ...ks) => ks.map((k) => P(n, k));
const err = (r, code) => (r.err ?? "").includes(code);
const fails = (r) => `${r.err ?? "no error"}`;

// ---- 1. The move itself, on a draft: a swap, and every place taken (no free position to move through).
await listing(1, "draft", 2);
let r = await reorder(SELLER, I(1), ids(1, 1, 0));
check("a two-photo swap on a draft: the second is the cover", !r.err && same(await order(1), ids(1, 1, 0)), fails(r));
check("it returns how many photos", r.ok?.n === 2, JSON.stringify(r.ok));

await listing(2, "draft", 12);
const backwards = Array.from({ length: 12 }, (_, k) => P(2, 11 - k));
r = await reorder(SELLER, I(2), backwards);
check("12 photos, every place full, reversed", !r.err && same(await order(2), backwards), fails(r));
check("positions stay 0..11", same(await positions(2), Array.from({ length: 12 }, (_, k) => k)));
r = await reorder(SELLER, I(2), backwards);
check("the same order again changes nothing and doesn't fail", !r.err && same(await order(2), backwards), fails(r));

// ---- 2. Gaps a removal left are closed, and the listing's add/remove still work on the deferrable constraint.
await listing(3, "draft", 3);
await call(SELLER, "SELECT public.declutter_remove_item_photo($1)", [P(3, 0)]);
r = await reorder(SELLER, I(3), ids(3, 2, 1));
check("a gap is closed", !r.err && same(await positions(3), [0, 1]), fails(r));
await db.query("INSERT INTO storage.objects VALUES ('job-photos', $1, $2, $3, $4)",
  [`${SELLER}/declutter/${I(3)}/new.jpg`, SELLER, SELLER, { mimetype: "image/jpeg", size: "1000" }]);
r = await call(SELLER, "SELECT public.declutter_add_item_photo($1, $2) AS id", [I(3), `${SELLER}/declutter/${I(3)}/new.jpg`]);
check("adding after a reorder takes the next place", !r.err && same(await positions(3), [0, 1, 2]), fails(r));
let refused;
try {
  await db.query("INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position) VALUES ($1, $2, 'x', 0)", [I(3), SELLER]);
  refused = false;
} catch (e) {
  refused = /duplicate key|position_key/.test(e.message);
}
check("two photos in one place are still refused, at once, outside a reorder", refused === true);

// ---- 3. A live listing stays live and judged; nobody is told.
await listing(4, "live", 3);
await db.query("INSERT INTO public.declutter_offers (item_id, buyer_id, status) VALUES ($1, $2, 'open')", [I(4), BUYER]);
check("(fixture) the live listing's check has passed before the reorder", (await db.query("SELECT ai_checked_at IS NOT NULL AS c FROM public.declutter_item_private WHERE item_id = $1", [I(4)])).rows[0].c === true);
r = await reorder(SELLER, I(4), ids(4, 2, 0, 1));
const live = (await db.query("SELECT i.status, i.updated_at > '2020-01-02' AS bumped, pv.ai_checked_at IS NOT NULL AS checked FROM public.declutter_items i JOIN public.declutter_item_private pv ON pv.item_id = i.id WHERE i.id = $1", [I(4)])).rows[0];
check("a live listing can be reordered", !r.err && same(await order(4), ids(4, 2, 0, 1)), fails(r));
check("it stays live", live.status === "live", live.status);
check("its automatic check still stands", live.checked === true);
check("updated_at moves", live.bumped === true);
check("no buyer with an open offer is told", (await db.query("SELECT 1 FROM public.notices")).rows.length === 0 && !r.err);

// ---- 4. One an edit sent back with its check pending: allowed. Flagged and every other status: refused, unmoved.
await listing(5, "pending_review", 2, { checked: false });
r = await reorder(SELLER, I(5), ids(5, 1, 0));
check("sent back by an edit, check pending: allowed", !r.err && same(await order(5), ids(5, 1, 0)), fails(r));
await listing(6, "pending_review", 2, { checked: false, flag: "looks wrong" });
check("(fixture) the flag is on the listing before the reorder", (await db.query("SELECT ai_flag_reason AS f FROM public.declutter_item_private WHERE item_id = $1", [I(6)])).rows[0].f === "looks wrong");
r = await reorder(SELLER, I(6), ids(6, 1, 0));
check("flagged: refused, unmoved", err(r, "item_not_editable") && same(await order(6), ids(6, 0, 1)), fails(r));
await listing(7, "pending_review", 2, { checked: false, liveAt: false });
r = await reorder(SELLER, I(7), ids(7, 1, 0));
check("first review, never live: refused, unmoved", err(r, "item_not_editable") && same(await order(7), ids(7, 0, 1)), fails(r));
let k = 8;
for (const s of ["paused", "reserved", "sold", "completed", "ended", "withdrawn", "rejected", "removed", "sold_elsewhere"]) {
  await listing(k, s, 2);
  r = await reorder(SELLER, I(k), ids(k, 1, 0));
  check(`${s}: refused, unmoved`, err(r, "item_not_editable") && same(await order(k), ids(k, 0, 1)), fails(r));
  k++;
}

// ---- 5. The set must be exact.
await listing(20, "draft", 3);
await listing(21, "draft", 2);
const before = ids(20, 0, 1, 2);
for (const [name, list] of [
  ["one missing", ids(20, 1, 0)],
  ["one too many", [...ids(20, 2, 1, 0), P(21, 0)]],
  ["a repeat in place of one", ids(20, 0, 0, 1)],
  ["another listing's photo", [P(20, 0), P(20, 1), P(21, 0)]],
  ["a made-up id", [P(20, 0), P(20, 1), "00000000-0000-4000-8000-00000000ffff"]],
  ["a NULL id", [P(20, 0), P(20, 1), null]],
  ["empty", []],
]) {
  r = await reorder(SELLER, I(20), list);
  check(`${name}: photos_changed, unmoved`, err(r, "photos_changed") && same(await order(20), before), fails(r));
}
r = await reorder(SELLER, I(20), null);
check("NULL: photos_changed, unmoved", err(r, "photos_changed") && same(await order(20), before), fails(r));
check("the other listing's photos never moved", same(await order(21), ids(21, 0, 1)));

// ---- 6. Who may.
r = await reorder(OTHER, I(20), ids(20, 2, 1, 0));
check("another seller: item_not_found, unmoved", err(r, "item_not_found") && same(await order(20), before), fails(r));
r = await reorder(BANNED, I(20), ids(20, 2, 1, 0));
check("a banned seller: account_restricted, unmoved", err(r, "account_restricted") && same(await order(20), before), fails(r));
r = await reorder(null, I(20), ids(20, 2, 1, 0));
check("signed out: not_authenticated, unmoved", err(r, "not_authenticated") && same(await order(20), before), fails(r));
await db.exec("INSERT INTO public.switch_off VALUES ('declutter')");
r = await reorder(SELLER, I(20), ids(20, 2, 1, 0));
check("the feature off: feature_disabled, unmoved", err(r, "feature_disabled") && same(await order(20), before), fails(r));
await db.exec("DELETE FROM public.switch_off");
const acl = (await db.query(`SELECT has_function_privilege('anon', 'public.declutter_reorder_item_photos(uuid, uuid[])', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.declutter_reorder_item_photos(uuid, uuid[])', 'EXECUTE') AS auth`).catch(() => ({ rows: [{}] }))).rows[0];
check("anon can't call it; a signed-in member can", acl.anon === false && acl.auth === true, JSON.stringify(acl));

// ---- 7. Back to the normal rule afterwards.
await as(SELLER);
await db.exec("BEGIN");
let stillImmediate = "the reorder itself failed";
try {
  await db.query(REORDER, [I(21), ids(21, 1, 0)]);
  try {
    await db.query("INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position) VALUES ($1, $2, 'y', 0)", [I(21), SELLER]);
    stillImmediate = "the second photo in one place went in";
  } catch (e) {
    stillImmediate = /duplicate key|position_key/.test(e.message) ? true : e.message;
  }
} catch (e) {
  stillImmediate = e.message;
}
await db.exec("ROLLBACK");
check("later statements in the same transaction are checked at once again", stillImmediate === true, String(stillImmediate));

await db.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
