#!/usr/bin/env node
/**
 * PGlite proof for 20261112095000_shops_photo_byte_check.sql (Q1956): a shop photo (logo / cover / gallery, and an
 * item photo) is attached only when the shop-photo-check edge function stamped its path for the caller in the last
 * hour (it read the object's own first bytes); the stamp is used once; members can neither read nor write stamps.
 * Stubs: storage.objects, shops / shop_items / shop_photos / shop_item_photos (the columns the RPCs use),
 * require_feature, is_caller_banned false, shops_assert_owner_eligible = auth.uid(), shops_lock_own_item.
 *
 *   node src/test/pglite/shopsPhotoByteCheck.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPhotoByteCheck.pglite.mjs # red (the old RPCs from their files)
 *   MIGRATION_PATH=<planted copy> node ...                                 # red on a planted defect
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261112095000_shops_photo_byte_check.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
const tryq = async (db, sql, params = []) => {
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
};
function stmt(sql, start, label) {
  const m = start.exec(sql);
  if (!m) throw new Error(`${label}: not found`);
  const tag = /\bAS (\$\w*\$)/.exec(sql.slice(m.index));
  const open = m.index + tag.index + tag[0].length;
  const end = sql.indexOf(tag[1], open);
  return `${sql.slice(m.index, end + tag[1].length)};`;
}

const U = (n) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const OWNER = U(1), OTHER = U(2), SHOP = U(10), OTHER_SHOP = U(11), ITEM = U(20);
const p = (n) => `${OWNER}/shops/p${n}.jpg`;
const ip = (n) => `${OWNER}/shop-items/${ITEM}/i${n}.jpg`;

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
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid UNIQUE, updated_at timestamptz);
  CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, owner_id uuid, status text, updated_at timestamptz);
  CREATE TABLE public.shop_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, owner_id uuid, photo_kind text,
    storage_path text CONSTRAINT shop_photos_storage_path_key UNIQUE, position smallint);
  CREATE TABLE public.shop_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, owner_id uuid,
    storage_path text CONSTRAINT shop_item_photos_storage_path_key UNIQUE, position smallint);
  CREATE FUNCTION public.shops_lock_own_item(p_item uuid, p_uid uuid) RETURNS public.shop_items LANGUAGE plpgsql AS $$
    DECLARE r public.shop_items; BEGIN SELECT * INTO r FROM public.shop_items WHERE id = p_item AND owner_id = p_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF; RETURN r; END $$;
  INSERT INTO public.shops VALUES ('${SHOP}', '${OWNER}', now()), ('${OTHER_SHOP}', '${OTHER}', now());
  INSERT INTO public.shop_items VALUES ('${ITEM}', '${SHOP}', '${OWNER}', 'draft', now());
`);
for (let n = 1; n <= 8; n++) {
  for (const path of [p(n), ip(n)]) {
    await db.query(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', $1, $2::uuid, $3, '{"mimetype":"image/jpeg","size":"2048"}')`, [path, OWNER, OWNER]);
  }
}

if (skip) {
  const OLD_ATTACH = readFileSync(`${DIR}20261103173728_q2390_haul_price_withdraw_guarantee_raise_refund_admin_delivery_cart_shops_rent_not_found_is_404.sql`, "utf8");
  const OLD_ITEM = readFileSync(`${DIR}20261017061157_shops_items.sql`, "utf8");
  await db.exec(stmt(OLD_ATTACH, /CREATE OR REPLACE FUNCTION public\.shops_attach_photo\(/, "attach"));
  await db.exec(stmt(OLD_ITEM, /CREATE OR REPLACE FUNCTION public\.shops_add_item_photo\(/, "item"));
  await db.exec(`CREATE TABLE public.shop_photo_byte_checks (storage_path text PRIMARY KEY, object_id uuid, owner_id uuid NOT NULL, checked_at timestamptz NOT NULL DEFAULT now());`);
} else {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try { await db.exec(SQL); } catch (e) { err = e.message; }
    ok(`migration applies (run ${i + 1})`, !err, err ?? "");
  }
}

const as = async (uid) => db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false);`);
const objId = async (path) => (await db.query(`SELECT id FROM storage.objects WHERE name = $1`, [path])).rows[0]?.id ?? null;
const stamp = async (path, owner, age = "0 minutes", objectId = undefined) =>
  db.query(`INSERT INTO public.shop_photo_byte_checks (storage_path, object_id, owner_id, checked_at) VALUES ($1, $4, $2, now() - $3::interval)
            ON CONFLICT (storage_path) DO UPDATE SET object_id = EXCLUDED.object_id, owner_id = EXCLUDED.owner_id, checked_at = EXCLUDED.checked_at`,
           [path, owner, age, objectId === undefined ? (await objId(path)) ?? "00000000-0000-4000-8000-000000000999" : objectId]);
const attach = async (kind, path) => { await as(OWNER); const r = await tryq(db, `SELECT public.shops_attach_photo($1, $2) AS j`, [kind, path]); await as(null); return r; };
const addItem = async (path) => { await as(OWNER); const r = await tryq(db, `SELECT public.shops_add_item_photo($1, $2) AS id`, [ITEM, path]); await as(null); return r; };
const stamped = async (path) => (await db.query(`SELECT count(*)::int AS n FROM public.shop_photo_byte_checks WHERE storage_path = $1`, [path])).rows[0].n;

// 1. No stamp: an object whose metadata says image/jpeg is NOT enough any more.
let r = await attach("gallery", p(1));
ok("attach without a bytes stamp is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");
r = await addItem(ip(1));
ok("item photo without a bytes stamp is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");

// 2. A fresh stamp for this owner: attached, and the stamp is used up.
await stamp(p(2), OWNER);
r = await attach("gallery", p(2));
ok("attach with a fresh stamp works", !r.err, r.err ?? "");
ok("the stamp is used once (gone after attach)", (await stamped(p(2))) === 0);
await stamp(ip(2), OWNER);
r = await addItem(ip(2));
ok("item photo with a fresh stamp works", !r.err, r.err ?? "");
ok("the item stamp is used once", (await stamped(ip(2))) === 0);

// 3. A stamp for someone else, or an old one, does not count.
await stamp(p(3), OTHER);
r = await attach("logo", p(3));
ok("a stamp written for another member is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");
await stamp(p(4), OWNER, "61 minutes");
r = await attach("cover", p(4));
ok("a stamp older than an hour is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");
await stamp(ip(4), OWNER, "61 minutes");
r = await addItem(ip(4));
ok("an old item stamp is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");
await stamp(ip(5), OTHER);
r = await addItem(ip(5));
ok("an item stamp for another member is refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");

// 4. A stamped path still needs the object and the folder rules (unchanged checks still run).
await stamp(`${OWNER}/shops/missing.jpg`, OWNER);
r = await attach("gallery", `${OWNER}/shops/missing.jpg`);
ok("a stamped path with no object is still refused", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");

// 4b. The swap (authz review): stamp a real photo, delete it, upload other bytes at the same path, attach. Refused:
// the stamp is for the old object id.
await stamp(p(6), OWNER);
await db.query(`DELETE FROM storage.objects WHERE name = $1`, [p(6)]);
await db.query(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', $1, $2::uuid, $3, '{"mimetype":"image/jpeg","size":"2048"}')`, [p(6), OWNER, OWNER]);
r = await attach("gallery", p(6));
ok("a stamp does not carry over to a re-uploaded object at the same path", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");
await stamp(ip(6), OWNER);
await db.query(`DELETE FROM storage.objects WHERE name = $1`, [ip(6)]);
await db.query(`INSERT INTO storage.objects (bucket_id, name, owner, owner_id, metadata) VALUES ('job-photos', $1, $2::uuid, $3, '{"mimetype":"image/jpeg","size":"2048"}')`, [ip(6), OWNER, OWNER]);
r = await addItem(ip(6));
ok("an item stamp does not carry over to a re-uploaded object", /photo_not_uploaded/.test(r.err ?? ""), r.err ?? "attached");

// 4c. shop_photo_object_id / shop_photo_stamp (what the edge function calls, as service_role).
if (!skip) {
  const id7 = await objId(p(7));
  const looked = (await db.query(`SELECT public.shop_photo_object_id($1, $2) AS id`, [p(7), OWNER])).rows[0].id;
  ok("shop_photo_object_id finds the owner's object", looked === id7);
  const notMine = (await db.query(`SELECT public.shop_photo_object_id($1, $2) AS id`, [p(7), OTHER])).rows[0].id;
  ok("shop_photo_object_id finds nothing for another member", notMine === null);
  const wrongId = (await db.query(`SELECT public.shop_photo_stamp($1, $2, $3) AS v`, [p(7), OWNER, "00000000-0000-4000-8000-000000000998"])).rows[0].v;
  ok("shop_photo_stamp refuses an object id no longer at the path", wrongId === false && (await stamped(p(7))) === 0);
  const otherOwner = (await db.query(`SELECT public.shop_photo_stamp($1, $2, $3) AS v`, [p(7), OTHER, id7])).rows[0].v;
  ok("shop_photo_stamp refuses another member as owner", otherOwner === false && (await stamped(p(7))) === 0);
  const good = (await db.query(`SELECT public.shop_photo_stamp($1, $2, $3) AS v`, [p(7), OWNER, id7])).rows[0].v;
  ok("shop_photo_stamp stamps the object it was given", good === true && (await stamped(p(7))) === 1);
  r = await attach("gallery", p(7));
  ok("a photo stamped by shop_photo_stamp attaches", !r.err, r.err ?? "");
  await stamp(p(8), OWNER, "25 hours");
  await db.query(`SELECT public.shop_photo_stamp($1, $2, $3)`, [ip(7), OWNER, await objId(ip(7))]);
  ok("a day-old unused stamp is dropped when a new one is written", (await stamped(p(8))) === 0);
  for (const fn of ["shop_photo_object_id(text, uuid)", "shop_photo_stamp(text, uuid, uuid)"]) {
    const v = (await db.query(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') OR has_function_privilege('anon', $1, 'EXECUTE') AS v`, [`public.${fn}`])).rows[0].v;
    ok(`members cannot run ${fn}`, v === false);
  }
}

// 4d. A held shop (hidden / owner not in good standing) adds no photo, even with a good stamp (Q1957 review).
await db.exec(`INSERT INTO public.held_shops VALUES ('${SHOP}')`);
await stamp(p(8), OWNER);
r = await attach("gallery", p(8));
ok("a held shop cannot attach a photo", /shop_hidden/.test(r.err ?? ""), r.err ?? "attached");
await stamp(ip(8), OWNER);
r = await addItem(ip(8));
ok("a held shop cannot attach an item photo", /shop_hidden/.test(r.err ?? ""), r.err ?? "attached");
await db.exec(`DELETE FROM public.held_shops`);

// 5. Members can neither read nor write stamps; service_role can.
const priv = async (role, what) => (await db.query(`SELECT has_table_privilege($1, 'public.shop_photo_byte_checks', $2) AS v`, [role, what])).rows[0].v;
if (!skip) {
  ok("authenticated cannot INSERT stamps", (await priv("authenticated", "INSERT")) === false);
  ok("authenticated cannot SELECT stamps", (await priv("authenticated", "SELECT")) === false);
  ok("anon cannot INSERT stamps", (await priv("anon", "INSERT")) === false);
  ok("service_role can INSERT and DELETE stamps", (await priv("service_role", "INSERT")) && (await priv("service_role", "DELETE")));
  const rls = (await db.query(`SELECT relrowsecurity AS v FROM pg_class WHERE oid = 'public.shop_photo_byte_checks'::regclass`)).rows[0].v;
  ok("RLS is on for the stamp table", rls === true);
  const anonExec = (await db.query(`SELECT has_function_privilege('anon', 'public.shops_attach_photo(text, text)', 'EXECUTE') AS v`)).rows[0].v;
  ok("anon still cannot run shops_attach_photo", anonExec === false);
} else {
  ok("(skip) stamp table grants exist", false, "old world has no stamp grants");
}

console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
