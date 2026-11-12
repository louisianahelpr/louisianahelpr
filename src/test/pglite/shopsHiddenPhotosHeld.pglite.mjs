#!/usr/bin/env node
/**
 * PGlite proof for 20261112100000_shops_hidden_photos_held.sql (Q1957): shop_photos_to_move lists every shop photo
 * object in the wrong bucket for its shop right now (hidden or owner not in good standing -> shop-photos-held; shown
 * -> job-photos), statelessly, so hide / unhide / ban / a temp ban running out all settle. Base: the real
 * shop_owner_in_good_standing (20261017061155); stubs: shops / shop_photos / shop_items / shop_item_photos /
 * profiles (columns used), storage.objects + storage.buckets, declutter_active_strike_count.
 *
 *   node src/test/pglite/shopsHiddenPhotosHeld.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsHiddenPhotosHeld.pglite.mjs # red
 *   MIGRATION_PATH=<planted copy> node ...                                   # red on a planted defect
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261112100000_shops_hidden_photos_held.sql";
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}${NEW_FILE}`, "utf8");
const skip = process.env.NEW_MIGRATION === "skip";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
};
function stmt(sql, start, label) {
  const m = start.exec(sql);
  if (!m) throw new Error(`${label}: not found`);
  const tag = /\bAS (\$\w*\$)/.exec(sql.slice(m.index));
  const open = m.index + tag.index + tag[0].length;
  const end = sql.indexOf(tag[1], open);
  return `${sql.slice(m.index, end + tag[1].length)};`;
}

const U = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const A = U(1), B = U(2), C = U(3);           // owners: A fine, B hidden shop, C banned
const SA = U(11), SB = U(12), SC = U(13), IA = U(21), IB = U(22);
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, UNIQUE (bucket_id, name));
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz);
  CREATE FUNCTION public.declutter_active_strike_count(p uuid) RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, hidden_at timestamptz);
  CREATE TABLE public.shop_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, storage_path text UNIQUE);
  CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid);
  CREATE TABLE public.shop_item_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, storage_path text UNIQUE);
  INSERT INTO public.profiles VALUES ('${A}', NULL, NULL), ('${B}', NULL, NULL), ('${C}', 'banned', NULL);
  INSERT INTO public.shops VALUES ('${SA}', '${A}', NULL), ('${SB}', '${B}', now()), ('${SC}', '${C}', NULL);
  INSERT INTO public.shop_items VALUES ('${IA}', '${SA}'), ('${IB}', '${SB}');
  INSERT INTO public.shop_photos (shop_id, storage_path) VALUES
    ('${SA}', '${A}/shops/a1.jpg'), ('${SB}', '${B}/shops/b1.jpg'), ('${SC}', '${C}/shops/c1.jpg');
  INSERT INTO public.shop_item_photos (item_id, storage_path) VALUES
    ('${IA}', '${A}/shop-items/${IA}/ia.jpg'), ('${IB}', '${B}/shop-items/${IB}/ib.jpg');
  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('job-photos', '${A}/shops/a1.jpg'), ('job-photos', '${B}/shops/b1.jpg'), ('job-photos', '${C}/shops/c1.jpg'),
    ('job-photos', '${A}/shop-items/${IA}/ia.jpg'), ('job-photos', '${B}/shop-items/${IB}/ib.jpg'),
    ('job-photos', '${A}/declutter/x/not-a-shop.jpg');
`);
await db.exec(stmt(readFileSync(`${DIR}20261017061155_shops_profiles.sql`, "utf8"), /CREATE OR REPLACE FUNCTION public\.shop_owner_in_good_standing\(/, "standing"));

if (!skip) {
  for (let i = 0; i < 3; i++) {
    let err = null;
    try { await db.exec(SQL); } catch (e) { err = e.message; }
    ok(`migration applies (run ${i + 1})`, !err, err ?? "");
  }
}

const list = async () => {
  try {
    return (await db.query(`SELECT storage_path, from_bucket, to_bucket FROM public.shop_photos_to_move(200) ORDER BY 1`)).rows;
  } catch (e) { return { err: e.message }; }
};
const key = (rows) => Array.isArray(rows) ? rows.map((r) => `${r.storage_path}:${r.from_bucket}>${r.to_bucket}`).join(",") : `ERR ${rows.err}`;
const moveAll = async (rows) => { for (const r of rows) await db.query(`UPDATE storage.objects SET bucket_id = $1 WHERE name = $2 AND bucket_id = $3`, [r.to_bucket, r.storage_path, r.from_bucket]); };

// 1. Hidden shop B and banned owner C: their photos (shop and item) go to held; A's and a Declutter photo stay.
let rows = await list();
ok("hidden + banned shops' photos are listed to move to shop-photos-held, nothing else",
  key(rows) === [`${B}/shop-items/${IB}/ib.jpg:job-photos>shop-photos-held`, `${B}/shops/b1.jpg:job-photos>shop-photos-held`, `${C}/shops/c1.jpg:job-photos>shop-photos-held`].join(","), key(rows));
if (Array.isArray(rows)) await moveAll(rows);
rows = await list();
ok("after the move, nothing is left to move (stateless, settled)", Array.isArray(rows) && rows.length === 0, key(rows));

// 2. Unhide B, temp ban on C runs out: their photos move back; A gets hidden: its photos move to held.
await db.exec(`UPDATE public.shops SET hidden_at = NULL WHERE id = '${SB}';
               UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() - interval '1 minute' WHERE user_id = '${C}';
               UPDATE public.shops SET hidden_at = now() WHERE id = '${SA}';`);
rows = await list();
ok("unhide / an ended temp ban move back to job-photos; a new hide moves to held",
  key(rows) === [`${A}/shop-items/${IA}/ia.jpg:job-photos>shop-photos-held`, `${A}/shops/a1.jpg:job-photos>shop-photos-held`,
                 `${B}/shop-items/${IB}/ib.jpg:shop-photos-held>job-photos`, `${B}/shops/b1.jpg:shop-photos-held>job-photos`,
                 `${C}/shops/c1.jpg:shop-photos-held>job-photos`].join(","), key(rows));
await db.exec(`UPDATE public.profiles SET auto_suspended_until = now() + interval '1 day' WHERE user_id = '${C}';`);
rows = await list();
ok("a temp ban still running keeps the photos held", Array.isArray(rows) && !rows.some((r) => r.storage_path.startsWith(C)), key(rows));

// 3. A photo row with no object (already gone) is never listed; the limit is honoured.
await db.exec(`INSERT INTO public.shop_photos (shop_id, storage_path) VALUES ('${SA}', '${A}/shops/missing.jpg');`);
rows = await list();
ok("a path with no object is not listed", Array.isArray(rows) && !rows.some((r) => r.storage_path.endsWith("missing.jpg")), key(rows));
const one = skip ? [] : (await db.query(`SELECT * FROM public.shop_photos_to_move(1)`)).rows;
ok("the limit is honoured", one.length === 1, String(one.length));

// 4. The bucket is private; the helpers are server-only.
if (!skip) {
  const b = (await db.query(`SELECT public FROM storage.buckets WHERE id = 'shop-photos-held'`)).rows[0];
  ok("shop-photos-held is a private bucket", b?.public === false);
  for (const fn of ["shop_photos_to_move(integer)", "shop_photos_held(uuid)"]) {
    const v = (await db.query(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') OR has_function_privilege('anon', $1, 'EXECUTE') AS v`, [`public.${fn}`])).rows[0].v;
    ok(`members cannot run ${fn}`, v === false);
  }
} else {
  ok("(skip) the bucket exists", false);
}

console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
