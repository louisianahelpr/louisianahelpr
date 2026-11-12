#!/usr/bin/env node
/**
 * PGlite proof for 20261112204756_shops_live_item_photos.sql (Shops audit 11-12 S009): a seller adds and removes
 * photos on a LIVE item; the photo trigger clears the AI verdict and approval; the AI check may then judge the live
 * item once and holds it for an admin only on a flag. pending_review and other states stay locked; a live item keeps
 * 3 photos; the Q1956 stamp and Q1957 shop_hidden rules still apply.
 *
 *   node src/test/pglite/shopsLiveItemPhotos.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsLiveItemPhotos.pglite.mjs # RED: the three old bodies
 *   MIGRATION_PATH=<planted copy> node ...                                 # RED on a planted defect
 *
 * Real: the trigger shop_item_photos_void_ai_check (20261017061157). Stubbed, and said so: storage.objects, the
 * tables cut to the columns read, require_feature, is_caller_banned false, shops_assert_owner_eligible = auth.uid(),
 * shops_lock_own_item (own item FOR UPDATE), shop_photos_held reads a list, declutter_notify writes a notices table.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112204756_shops_live_item_photos.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a2f-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const OWNER = U(1), OTHER = U(2), SHOP = U(10), HELD_SHOP = U(11);
const LIVE = U(20), PENDING = U(21), DRAFT = U(22), REJECTED = U(23), JUDGED = U(24), APPROVED = U(25), HELD_ITEM = U(26), LIVE2 = U(27);
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
CREATE FUNCTION public.require_feature(p text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.held_shops (id uuid PRIMARY KEY);
CREATE FUNCTION public.shop_photos_held(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.held_shops WHERE id = p) $$;
CREATE FUNCTION public.shops_assert_owner_eligible() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, status text, kind text DEFAULT 'made', subtype text DEFAULT 'art',
  title text, description text DEFAULT 'd', admin_approved_at timestamptz, submitted_at timestamptz, live_at timestamptz, updated_at timestamptz);
CREATE TABLE public.shop_item_private (item_id uuid PRIMARY KEY, ai_checked_at timestamptz, ai_flag_reason text, text_flag_reason text, updated_at timestamptz);
CREATE TABLE public.shop_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, owner_id uuid,
  storage_path text CONSTRAINT shop_item_photos_storage_path_key UNIQUE, position smallint);
CREATE TABLE public.shop_photo_byte_checks (storage_path text PRIMARY KEY, object_id uuid, owner_id uuid NOT NULL, checked_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.shops_lock_own_item(p_item uuid, p_uid uuid) RETURNS public.shop_items LANGUAGE plpgsql AS $$
  DECLARE r public.shop_items; BEGIN SELECT * INTO r FROM public.shop_items WHERE id = p_item AND owner_id = p_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404'; END IF; RETURN r; END $$;
CREATE TABLE public.notices (user_id uuid, type text, title text, message text, link text);
CREATE FUNCTION public.declutter_notify(u uuid, t text, ti text, m text, l text, a uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO public.notices VALUES (u, t, ti, m, l) $$;
INSERT INTO public.held_shops VALUES ('${HELD_SHOP}');
INSERT INTO public.shop_items (id, shop_id, owner_id, status, title, admin_approved_at, live_at) VALUES
  ('${LIVE}', '${SHOP}', '${OWNER}', 'live', 'Cypress bowl', now() - interval '1 day', now() - interval '2 days'),
  ('${LIVE2}', '${SHOP}', '${OWNER}', 'live', 'Oak spoon', NULL, now() - interval '2 days'),
  ('${PENDING}', '${SHOP}', '${OWNER}', 'pending_review', 'Held thing', NULL, NULL),
  ('${DRAFT}', '${SHOP}', '${OWNER}', 'draft', 'Draft thing', NULL, NULL),
  ('${REJECTED}', '${SHOP}', '${OWNER}', 'rejected', 'No thing', NULL, NULL),
  ('${JUDGED}', '${SHOP}', '${OWNER}', 'live', 'Judged thing', NULL, now()),
  ('${APPROVED}', '${SHOP}', '${OWNER}', 'live', 'Approved thing', now(), now() - interval '1 day'),
  ('${HELD_ITEM}', '${HELD_SHOP}', '${OWNER}', 'live', 'Hidden shop thing', NULL, now());
INSERT INTO public.shop_item_private (item_id, ai_checked_at)
  SELECT id, CASE WHEN id IN ('${JUDGED}', '${LIVE}', '${LIVE2}') THEN now() END FROM public.shop_items;
`);
await db.exec(fnFrom("20261017061157_shops_items.sql", "shop_item_photos_void_ai_check"));
await db.exec(`CREATE TRIGGER trg_shop_item_photos_void_ai_check AFTER INSERT OR DELETE ON public.shop_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_photos_void_ai_check();`);
const path = (item, n) => `${OWNER}/shop-items/${item}/p${n}.jpg`;
let seeded = 0;
const seedPhoto = async (item, n) => {
  await db.query(`ALTER TABLE public.shop_item_photos DISABLE TRIGGER trg_shop_item_photos_void_ai_check`);
  const r = await db.query(`INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position) VALUES ($1, $2, $3, $4) RETURNING id`, [item, OWNER, path(item, n), n]);
  await db.query(`ALTER TABLE public.shop_item_photos ENABLE TRIGGER trg_shop_item_photos_void_ai_check`);
  seeded++; return r.rows[0].id;
};
for (const it of [LIVE, PENDING, DRAFT, JUDGED, APPROVED, LIVE2]) for (let n = 0; n < 4; n++) await seedPhoto(it, n);
const upload = async (item, n, stamp = true) => {
  const o = await db.query(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', $1, $2::uuid, $3, '{"mimetype":"image/jpeg","size":"2048"}') RETURNING id`, [path(item, n), OWNER, OWNER]);
  if (stamp) await db.query(`INSERT INTO public.shop_photo_byte_checks (storage_path, object_id, owner_id) VALUES ($1, $2, $3)`, [path(item, n), o.rows[0].id, OWNER]);
};
if (skip) {
  await db.exec(fnFrom("20261112095000_shops_photo_byte_check.sql", "shops_add_item_photo"));
  await db.exec(fnFrom("20261103083559_shops_declutter_owner_actions_not_found_is_404.sql", "shops_remove_item_photo"));
  await db.exec(fnFrom("20261103084609_shops_declutter_follow_watch_ai_check_not_found_is_404.sql", "shops_record_item_ai_check"));
  await db.exec(`REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;`);
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const asOwner = async (sql, params, uid = OWNER) => {
  await db.exec(`SELECT set_config('test.uid', '${uid}', false);`);
  try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false);`); }
};
const add = (item, n, uid) => asOwner(`SELECT public.shops_add_item_photo($1, $2) AS id`, [item, path(item, n)], uid);
const photoIds = async (item) => (await db.query(`SELECT id FROM public.shop_item_photos WHERE item_id = $1 ORDER BY position`, [item])).rows.map((x) => x.id);
const remove = async (id, uid) => asOwner(`SELECT public.shops_remove_item_photo($1) AS p`, [id], uid);
const item = async (id) => (await db.query(`SELECT i.status, i.admin_approved_at, i.live_at, i.submitted_at, p.ai_checked_at, p.ai_flag_reason
  FROM public.shop_items i JOIN public.shop_item_private p ON p.item_id = i.id WHERE i.id = $1`, [id])).rows[0];
const judge = async (id, flag) => {
  const it = (await db.query(`SELECT * FROM public.shop_items WHERE id = $1`, [id])).rows[0];
  try {
    return { rows: (await db.query(`SELECT public.shops_record_item_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7, $8) AS at`,
      [id, OWNER, await photoIds(id), it.kind, it.subtype, it.title, it.description, flag])).rows };
  } catch (e) { return { err: e.message }; }
};
const notices = async () => (await db.query(`SELECT * FROM public.notices`)).rows;

// Add a photo to a LIVE item.
await upload(LIVE, 10);
let r = await add(LIVE, 10);
check(!r.err && r.rows[0].id, "a live item takes a new (byte-checked) photo", r.err);
let s = await item(LIVE);
check(s.status === "live", "and stays live", JSON.stringify(s));
check(s.ai_checked_at === null && s.admin_approved_at === null, "the trigger cleared its AI verdict and approval (the check must run again)", JSON.stringify(s));
await upload(LIVE, 11, false);
r = await add(LIVE, 11);
check(/photo_not_uploaded/.test(r.err ?? ""), "a live item still needs the Q1956 bytes stamp", r.err ?? "added");
await upload(HELD_ITEM, 12);
r = await add(HELD_ITEM, 12);
check(/shop_hidden/.test(r.err ?? ""), "a held shop's live item still takes no photo (Q1957)", r.err ?? "added");
await upload(PENDING, 13);
r = await add(PENDING, 13);
check(/item_not_editable/.test(r.err ?? ""), "an item waiting for an admin takes no new photo", r.err ?? "added");
await upload(REJECTED, 14);
r = await add(REJECTED, 14);
check(/item_not_editable/.test(r.err ?? ""), "a rejected item takes no new photo", r.err ?? "added");
r = await add(LIVE, 10, OTHER);
check(!!r.err, "another member cannot add to the item", r.err ?? "added");
await upload(DRAFT, 15);
r = await add(DRAFT, 15);
check(!r.err, "a draft still takes photos", r.err);

// The AI check on the live item.
r = await judge(LIVE, null);
s = await item(LIVE);
check(!r.err && s.status === "live" && s.ai_checked_at !== null, "a clean check on the changed live item: recorded, still live", JSON.stringify(r) + JSON.stringify(s));
r = await judge(LIVE, "a weapon");
check(/item_not_found/.test(r.err ?? ""), "a live item already judged is never judged again (no verdict swap)", JSON.stringify(r));
check((await item(LIVE)).status === "live", "and is still live");
check((await notices()).length === 0, "a clean check tells nobody");
r = await judge(JUDGED, "x");
check(/item_not_found/.test(r.err ?? ""), "a live item judged before any photo change is not re-judged", JSON.stringify(r));
r = await judge(PENDING, null);
check(/item_not_found/.test(r.err ?? ""), "an item waiting for an admin is never judged again (its flag stays)", JSON.stringify(r));
r = await judge(APPROVED, "x");
check(/item_not_found/.test(r.err ?? ""), "a live item an admin approved is not re-judged", JSON.stringify(r));

// Remove photos on a live item: down to 3, never under.
let ids = await photoIds(LIVE2);
r = await remove(ids[0]);
check(!r.err && r.rows[0].p === path(LIVE2, 0), "a live item drops a photo (4 -> 3) and the path comes back for cleanup", JSON.stringify(r));
s = await item(LIVE2);
check(s.status === "live" && s.ai_checked_at === null, "still live, verdict cleared", JSON.stringify(s));
r = await remove(ids[1]);
check(/photos_required/.test(r.err ?? ""), "a live item keeps at least 3 photos", r.err ?? "removed");
check((await photoIds(LIVE2)).length === 3, "nothing was removed");
r = await remove(ids[2], OTHER);
check(/photo_not_found/.test(r.err ?? ""), "another member cannot remove it", r.err ?? "removed");
r = await remove((await photoIds(PENDING))[0]);
check(/item_not_editable/.test(r.err ?? ""), "an item waiting for an admin cannot drop a photo", r.err ?? "removed");
ids = await photoIds(DRAFT);
for (const id of ids.slice(0, 4)) r = await remove(id);
check(!r.err && (await photoIds(DRAFT)).length === 1, "a draft can drop photos below 3 (Publish asks for 3)", JSON.stringify(r));

// A flag on the changed live item holds it.
r = await judge(LIVE2, "shows a weapon");
s = await item(LIVE2);
check(!r.err && s.status === "pending_review", "a flagged check takes the live item off the shop for an admin", JSON.stringify(r) + JSON.stringify(s));
check(s.live_at === null && s.submitted_at !== null && s.ai_flag_reason === "shows a weapon", "submitted now, live_at cleared, the reason kept", JSON.stringify(s));
const n = await notices();
check(n.length === 1 && n[0].user_id === OWNER && n[0].title === "Your item is waiting for a check" && n[0].message.includes('"Oak spoon"') && n[0].message.includes("shows a weapon") && n[0].link === "/shops/mine",
  "the seller is told which item and why", JSON.stringify(n));
r = await judge(DRAFT, "x");
s = await item(DRAFT);
check(!r.err && s.status === "draft" && s.ai_flag_reason === "x", "a draft's flag is recorded and the draft stays a draft (Publish decides)", JSON.stringify(r) + JSON.stringify(s));
check((await notices()).length === 1, "a draft's flag sends no notice");
// Stale verdict.
await upload(LIVE, 16);
await add(LIVE, 16);
const it = (await db.query(`SELECT * FROM public.shop_items WHERE id = $1`, [LIVE])).rows[0];
try { await db.query(`SELECT public.shops_record_item_ai_check($1, $2, $3::uuid[], $4, $5, $6, $7, NULL)`, [LIVE, OWNER, (await photoIds(LIVE)).slice(1), it.kind, it.subtype, it.title, it.description]); r = {}; }
catch (e) { r = { err: e.message }; }
check(/ai_check_stale/.test(r.err ?? ""), "a verdict that missed a photo is stale", JSON.stringify(r));
await db.exec(`SET ROLE authenticated;`);
try { await db.query(`SELECT public.shops_record_item_ai_check($1, $2, '{}'::uuid[], 'a', 'b', 'c', 'd', NULL)`, [LIVE, OWNER]); r = {}; } catch (e) { r = { err: e.message }; }
await db.exec(`RESET ROLE;`);
check(/permission denied/.test(r.err ?? ""), "members cannot record a verdict", JSON.stringify(r));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
