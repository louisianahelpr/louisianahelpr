#!/usr/bin/env node
/**
 * PGlite proof for 20261112195345_shops_paused_link_says_paused.sql (Shops audit 11-12 S044): a paused shop's shared
 * link answers guests {id, name, paused: true} and nothing more; hidden, banned, switched-off, hidden-test and unknown
 * shops still answer NULL; a shown shop's page is unchanged.
 *
 *   node src/test/pglite/shopsPausedLinkSaysPaused.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsPausedLinkSaysPaused.pglite.mjs # RED: 20261105230819's body
 *   MIGRATION_PATH=<planted copy> node ...                                       # RED on a planted defect
 *
 * Real: shop_state_ok and shop_link_visible (20261019042744). Stubbed, and said so: tables cut to the columns read;
 * shop_owner_in_good_standing reads a banned list; seed_jobs_hidden_publicly true; shop_badges '{}';
 * shop_review_rating no rows.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112195345_shops_paused_link_says_paused.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a0f-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
CREATE TABLE public.feature_switches (key text, audience text);
CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, name text, about text DEFAULT 'About', category text DEFAULT 'bakery',
  parishes_served text[] DEFAULT ARRAY['Orleans'], area_label text DEFAULT 'Uptown', storefront boolean DEFAULT false,
  offers_selling boolean DEFAULT true, offers_quotes boolean DEFAULT false, paused boolean NOT NULL DEFAULT false,
  hidden_at timestamptz, is_seed boolean NOT NULL DEFAULT false, sos_number text DEFAULT 'SECRET-SOS');
CREATE TABLE public.shop_categories (slug text, label text, group_label text);
CREATE TABLE public.shop_hours (shop_id uuid, weekday int, opens_local time, closes_local time);
CREATE TABLE public.shop_photos (id uuid, shop_id uuid, photo_kind text, position int);
CREATE TABLE public.shop_items (id uuid, shop_id uuid, kind text, subtype text, status text, title text, description text, price_cents int,
  lead_time_days int, stock_count int, live_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.shop_item_photos (id uuid, item_id uuid, position int);
CREATE TABLE public.banned (id uuid);
CREATE FUNCTION public.shop_owner_in_good_standing(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT NOT EXISTS (SELECT 1 FROM public.banned b WHERE b.id = u) $f$;
CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.shop_badges(uuid) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
CREATE FUNCTION public.shop_review_rating(uuid) RETURNS TABLE (rating numeric, review_count int) LANGUAGE sql AS 'SELECT NULL::numeric, 0 WHERE false';
INSERT INTO public.feature_switches VALUES ('shops', 'everyone');
INSERT INTO public.shop_categories VALUES ('bakery', 'Bakery', 'Food');
`);
await db.exec(fnFrom("20261019042744_shops_public_page.sql", "shop_state_ok"));
await db.exec(fnFrom("20261019042744_shops_public_page.sql", "shop_link_visible"));
if (skip) {
  await db.exec(fnFrom("20261105230819_shops_reviews_and_rating.sql", "shops_public_shop"));
  await db.exec(`GRANT EXECUTE ON FUNCTION public.shops_public_shop(uuid) TO anon;`);
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const OWNER = U(1), BANNED = U(2);
await db.exec(`INSERT INTO public.banned VALUES ('${BANNED}');`);
const SHOWN = U(10), PAUSED = U(11), PAUSED_HIDDEN = U(12), PAUSED_BANNED = U(13), PAUSED_SEED = U(14);
await db.exec(`
INSERT INTO public.shops (id, owner_id, name, paused, hidden_at, is_seed) VALUES
  ('${SHOWN}', '${OWNER}', 'Open Bakery', false, NULL, false),
  ('${PAUSED}', '${OWNER}', 'Resting Bakery', true, NULL, false),
  ('${PAUSED_HIDDEN}', '${OWNER}', 'Hidden Bakery', true, now(), false),
  ('${PAUSED_BANNED}', '${BANNED}', 'Banned Bakery', true, NULL, false),
  ('${PAUSED_SEED}', '${OWNER}', 'Seed Bakery', true, NULL, true);
INSERT INTO public.shop_items (id, shop_id, kind, subtype, status, title, description, price_cents) VALUES
  ('${U(20)}', '${PAUSED}', 'made', 'x', 'live', 'Secret pie', 'd', 500),
  ('${U(21)}', '${SHOWN}', 'made', 'x', 'live', 'Open pie', 'd', 500);
`);
const asAnon = async (id) => {
  await db.exec(`SET ROLE anon;`);
  try { return { v: (await db.query(`SELECT public.shops_public_shop($1) AS v`, [id])).rows[0].v }; }
  catch (e) { return { err: e.message }; } finally { await db.exec(`RESET ROLE;`); }
};
let r = await asAnon(PAUSED);
check(!r.err && r.v && r.v.paused === true && r.v.name === "Resting Bakery" && r.v.id === PAUSED, "a paused shop's link answers its name and paused", JSON.stringify(r));
check(!r.err && r.v && Object.keys(r.v).sort().join(",") === "id,name,paused", "and nothing else (no items, photos, hours, about, rating)", JSON.stringify(r.v));
r = await asAnon(SHOWN);
check(!r.err && r.v && r.v.name === "Open Bakery" && !("paused" in r.v) && r.v.items?.length === 1 && r.v.about === "About", "a shown shop's page is unchanged", JSON.stringify(r));
check(!JSON.stringify(r.v).includes("SECRET-SOS") && !JSON.stringify(r.v).includes(OWNER), "the shown page still names no owner or SoS number");
check((await asAnon(PAUSED_HIDDEN)).v === null, "a paused AND hidden shop is still NULL");
check((await asAnon(PAUSED_BANNED)).v === null, "a paused shop of a banned owner is still NULL");
check((await asAnon(PAUSED_SEED)).v === null, "a paused hidden-test shop is still NULL");
check((await asAnon(U(99))).v === null, "an unknown shop is still NULL");
check((await asAnon(null)).v === null, "a null id is still NULL");
await db.exec(`UPDATE public.feature_switches SET audience = 'off';`);
check((await asAnon(PAUSED)).v === null, "with Shops switched off a paused shop is NULL");
check((await asAnon(SHOWN)).v === null, "with Shops switched off a shown shop is NULL");
await db.exec(`UPDATE public.feature_switches SET audience = 'everyone';`);
const pl = (await db.query(`SELECT public.shop_link_visible($1) AS v`, [PAUSED])).rows[0].v;
check(pl === false, "shop_link_visible itself still refuses a paused shop (photo proxy, FAQs, reviews stay closed)");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
