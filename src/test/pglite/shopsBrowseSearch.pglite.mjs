#!/usr/bin/env node
/**
 * PGlite proof for 20261112203620_shops_browse_searches_item_titles.sql (Shops audit 11-12 S043): shops_browse takes
 * p_query and every word must appear in the shop's name / category label / area or in one of its LIVE item titles.
 *
 *   node src/test/pglite/shopsBrowseSearch.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsBrowseSearch.pglite.mjs # RED: 20261017061155's body (no p_query)
 *   MIGRATION_PATH=<planted copy> node ...                               # RED on a planted defect
 *
 * Stubbed, and said so: tables cut to the columns read; require_feature reads feature_switches; shop_visible_to is
 * "not hidden, owner not banned" (the real one is unchanged by this migration); shop_owner_rating no rows;
 * shop_badges '{}'.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112203620_shops_browse_searches_item_titles.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a1f-0000-0000-0000-${String(n).padStart(12, "0")}`;
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)[1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(s, t.indexOf(`\n${tag}`, open) + 1 + tag.length) + ";";
}
const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.feature_switches (key text, audience text);
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.feature_switches f WHERE f.key = k AND f.audience = 'everyone') THEN
    RAISE EXCEPTION 'feature_off' USING ERRCODE = '42501'; END IF; END $f$;
CREATE TABLE public.shop_categories (slug text PRIMARY KEY, group_slug text, group_label text, label text, position int);
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, category text, area_label text,
  pin_lat numeric, pin_lng numeric, paused boolean NOT NULL DEFAULT false, offers_selling boolean NOT NULL DEFAULT true, hidden_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.shop_photos (id uuid, shop_id uuid, photo_kind text, storage_path text);
CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, status text, title text);
CREATE TABLE public.banned (id uuid);
CREATE FUNCTION public.shop_visible_to(p_shop uuid, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop AND s.hidden_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM public.banned b WHERE b.id = s.owner_id)) $f$;
CREATE FUNCTION public.shop_owner_rating(uuid) RETURNS TABLE (rating numeric, review_count int) LANGUAGE sql AS 'SELECT NULL::numeric, 0 WHERE false';
CREATE FUNCTION public.shop_badges(uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
INSERT INTO public.feature_switches VALUES ('shops', 'everyone');
INSERT INTO public.shop_categories VALUES ('bakery', 'food', 'Food', 'Bakery', 1), ('woodwork', 'crafts', 'Crafts', 'Woodworking', 2);
`);
if (skip) {
  await db.exec(fnFrom("20261017061155_shops_profiles.sql", "shops_browse"));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer) TO authenticated;`);
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const OWNER = U(1), BANNED = U(2), BUYER = U(3);
const BAKERY = U(10), WOOD = U(11), HIDDEN = U(12), BANNED_SHOP = U(13), FAR = U(14);
await db.exec(`
INSERT INTO public.banned VALUES ('${BANNED}');
INSERT INTO public.shops (id, owner_id, name, category, area_label, pin_lat, pin_lng, hidden_at) VALUES
  ('${BAKERY}', '${OWNER}', 'Sweet Spot', 'bakery', 'Uptown', 29.93, -90.10, NULL),
  ('${WOOD}', '${OWNER}', 'Bayou Boards', 'woodwork', 'Mid-City', 29.97, -90.09, NULL),
  ('${HIDDEN}', '${OWNER}', 'Hidden Ovens', 'bakery', 'Uptown', 29.93, -90.10, now()),
  ('${BANNED_SHOP}', '${BANNED}', 'Banned Bakes', 'bakery', 'Uptown', 29.93, -90.10, NULL),
  ('${FAR}', '${OWNER}', 'Far Pies 100%', 'bakery', 'Shreveport', 32.50, -93.75, NULL);
INSERT INTO public.shop_items (id, shop_id, status, title) VALUES
  ('${U(20)}', '${BAKERY}', 'live', 'King Cake (cream cheese)'),
  ('${U(21)}', '${BAKERY}', 'draft', 'Secret Praline Box'),
  ('${U(22)}', '${WOOD}', 'live', 'Cypress cutting board'),
  ('${U(23)}', '${WOOD}', 'removed', 'Pecan rocking chair'),
  ('${U(24)}', '${HIDDEN}', 'live', 'Hidden king cake'),
  ('${U(25)}', '${BANNED_SHOP}', 'live', 'Banned king cake'),
  ('${U(26)}', '${FAR}', 'live', 'Sweet potato pie');
`);
const browse = async (args, uid = BUYER, role = "authenticated") => {
  await db.exec(`SET request.jwt.claim.sub = '${uid ?? ""}'; SET ROLE ${role};`);
  try {
    const keys = Object.keys(args);
    const sql = `SELECT id, name FROM public.shops_browse(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    return { rows: (await db.query(sql, keys.map((k) => args[k]))).rows };
  } catch (e) { return { err: e.message }; } finally { await db.exec(`RESET ROLE;`); }
};
const ids = (r) => (r.rows ?? []).map((x) => x.id);
const near = { p_lat: 29.95, p_lng: -90.07 };
const same = (r, want) => !r.err && JSON.stringify(ids(r)) === JSON.stringify(want);

let r = await browse({ ...near });
check(same(r, [WOOD, BAKERY, FAR]), "no query: every visible shop, nearest first (unchanged)", JSON.stringify(r));
r = await browse({ ...near, p_query: "king cake" });
check(same(r, [BAKERY]), "a LIVE item's title finds its shop ('king cake')", JSON.stringify(r));
r = await browse({ ...near, p_query: "CYPRESS" });
check(same(r, [WOOD]), "case does not matter ('CYPRESS')", JSON.stringify(r));
r = await browse({ ...near, p_query: "praline" });
check(same(r, []), "a draft item's title finds nothing", JSON.stringify(r));
r = await browse({ ...near, p_query: "rocking" });
check(same(r, []), "a removed item's title finds nothing", JSON.stringify(r));
r = await browse({ ...near, p_query: "sweet" });
check(same(r, [BAKERY, FAR]), "a shop name and an item title both match ('sweet')", JSON.stringify(r));
r = await browse({ ...near, p_query: "woodworking" });
check(same(r, [WOOD]), "the category label matches", JSON.stringify(r));
r = await browse({ ...near, p_query: "mid-city" });
check(same(r, [WOOD]), "the area matches", JSON.stringify(r));
r = await browse({ ...near, p_query: "  uptown   king  " });
check(same(r, [BAKERY]), "words may come from the area and an item title, extra spaces ignored", JSON.stringify(r));
r = await browse({ ...near, p_query: "uptown\tking\n" });
check(same(r, [BAKERY]), "a tab or newline also separates words", JSON.stringify(r));
r = await browse({ ...near, p_query: "king chair" });
check(same(r, []), "every word must match somewhere in the shop", JSON.stringify(r));
r = await browse({ ...near, p_query: "%" });
check(same(r, [FAR]), "% is a plain character, not a wildcard (only 'Far Pies 100%')", JSON.stringify(r));
r = await browse({ ...near, p_query: "_" });
check(same(r, []), "_ is a plain character, not a wildcard", JSON.stringify(r));
r = await browse({ ...near, p_query: "   " });
check(same(r, [WOOD, BAKERY, FAR]), "a blank query is no search", JSON.stringify(r));
r = await browse({ ...near, p_query: "hidden" });
check(same(r, []), "a hidden shop's name or items are never found", JSON.stringify(r));
r = await browse({ ...near, p_query: "banned" });
check(same(r, []), "a banned owner's shop is never found", JSON.stringify(r));
r = await browse({ ...near, p_query: "cake", p_category: "woodwork" });
check(same(r, []), "the query and the category filter both apply", JSON.stringify(r));
r = await browse({ ...near, p_query: "pie", p_limit: 1, p_offset: 0 });
check(same(r, [FAR]), "paging with a query (page 1)", JSON.stringify(r));
r = await browse({ ...near, p_query: "e", p_limit: 1, p_offset: 1 });
check(same(r, [BAKERY]), "paging with a query (offset 1)", JSON.stringify(r));
await db.exec(`UPDATE public.shops SET offers_selling = false WHERE id = '${WOOD}';`);
r = await browse({ ...near, p_query: "cypress" });
check(same(r, []), "a shop that stopped selling is not found by its items' titles (review note 1)", JSON.stringify(r));
r = await browse({ ...near, p_query: "bayou" });
check(same(r, [WOOD]), "but still by its name", JSON.stringify(r));
await db.exec(`UPDATE public.shops SET offers_selling = true, paused = true WHERE id = '${WOOD}';`);
r = await browse({ ...near, p_query: "cypress" });
check(same(r, []), "a paused shop is not found by its items' titles (its page shows none, S044)", JSON.stringify(r));
await db.exec(`UPDATE public.shops SET paused = false WHERE id = '${WOOD}';`);
r = await browse({ ...near, p_query: "cypress" });
check(same(r, [WOOD]), "back to selling and open: found again", JSON.stringify(r));
r = await browse({ ...near, p_query: "king" }, null);
check(!!r.err && /not_authenticated/.test(r.err), "signed out is still refused", JSON.stringify(r));
r = await browse({ ...near, p_query: "king" }, BUYER, "anon");
check(!!r.err && /permission denied/.test(r.err), "anon cannot run it", JSON.stringify(r));
await db.exec(`UPDATE public.feature_switches SET audience = 'off';`);
r = await browse({ ...near, p_query: "king" });
check(!!r.err && /feature_off/.test(r.err), "with Shops off it is refused", JSON.stringify(r));
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone';`);
const sigs = (await db.query(`SELECT p.oid::regprocedure::text AS s FROM pg_proc p WHERE p.proname = 'shops_browse'`)).rows.map((x) => x.s);
check(sigs.length === 1 && /integer,text\)$/.test(sigs[0]), "one shops_browse only (the 6-argument form is gone)", JSON.stringify(sigs));
const idx = (await db.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'shop_items_live_title_idx'`)).rows[0]?.indexdef ?? "";
check(/\(shop_id\) INCLUDE \(title\) WHERE \(status = 'live'::text\)/.test(idx), "the partial covering index on live titles exists", idx);

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
