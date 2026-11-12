#!/usr/bin/env node
/**
 * PGlite proof for 20261112201612_shops_review_first_name.sql (Shops audit 11-12 S052): each public buyer review in
 * shops_shop_reviews carries reviewer_name ("First L.", real member_display_name; a deleted account reads "A neighbor"),
 * never the reviewer's id; hidden reviews stay out; signed-out callers are still refused.
 *
 *   node src/test/pglite/shopsReviewFirstName.pglite.mjs                    # ALL PASS (migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReviewFirstName.pglite.mjs # RED: 20261111021548's body
 *   MIGRATION_PATH=<planted copy> node ...                                  # RED on a planted defect
 *
 * Real: member_display_name (20261021061341). Stubbed, and said so: require_feature no-op; shop_visible_to true;
 * shop_review_public = not removed; shop_review_rating no average; auth.uid() from a setting.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261112201612_shops_review_first_name.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
const check = (ok, name, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`); if (!ok) failures++; };
const U = (n) => `5a0b5a11-0000-0000-0000-${String(n).padStart(12, "0")}`;
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
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('test.uid', true), '')::uuid $f$;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, email_verified boolean DEFAULT true, ban_status text,
  anonymized_at timestamptz, auto_suspended_until timestamptz, is_test boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid);
CREATE FUNCTION public.is_test_member(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT COALESCE((SELECT is_test FROM public.profiles WHERE user_id = u), false) $f$;
CREATE FUNCTION public.declutter_member_out(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.member_under_18(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE TABLE public.shop_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, reviewer_id uuid, reviewer_side text,
  stars smallint, comment text, removed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.shop_visible_to(uuid, uuid) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE FUNCTION public.shop_review_public(p uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT removed_at IS NULL FROM public.shop_reviews WHERE id = p $f$;
CREATE FUNCTION public.shop_review_rating(uuid) RETURNS TABLE (rating numeric, review_count int) LANGUAGE sql AS 'SELECT NULL::numeric, 2';
`);
await db.exec(fnFrom("20261021061341_member_display_name.sql", "member_display_name"));
await db.exec(fnFrom("20261112010100_declutter_names_hidden_across_block_or_ban.sql", "declutter_names_hidden"));
if (skip) {
  await db.exec(fnFrom("20261111021548_shops_reviews_owner_sees_own_shop.sql", "shops_shop_reviews"));
  await db.exec(`REVOKE ALL ON FUNCTION public.shops_shop_reviews(uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.shops_shop_reviews(uuid) TO authenticated;`);
} else {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) {
    let err = null;
    try { await db.exec(mig); } catch (e) { err = e.message; }
    check(!err, `migration applies (run ${k})`, err ?? "");
  }
}
const SHOP = U(10), JANE = U(1), MONO = U(2), GONE = U(3), VIEWER = U(4), BANNED = U(5), TESTER = U(6), UNVER = U(7), BLOCKER = U(8);
await db.exec(`
INSERT INTO public.profiles (user_id, full_name) VALUES ('${JANE}', '  Jane Ann Doe '), ('${MONO}', 'Cher'), ('${VIEWER}', 'Vic Viewer'), ('${BLOCKER}', 'Bo Block');
INSERT INTO public.profiles (user_id, full_name, ban_status) VALUES ('${BANNED}', 'Bad Actor', 'banned');
INSERT INTO public.profiles (user_id, full_name, is_test) VALUES ('${TESTER}', 'Test Person', true);
INSERT INTO public.profiles (user_id, full_name, email_verified) VALUES ('${UNVER}', 'New Person', false);
INSERT INTO public.user_blocks VALUES ('${BLOCKER}', '${JANE}');
INSERT INTO public.shop_reviews (shop_id, reviewer_id, reviewer_side, stars, comment, created_at, removed_at) VALUES
  ('${SHOP}', '${JANE}', 'buyer', 5, 'Great', now() - interval '3 days', NULL),
  ('${SHOP}', '${MONO}', 'buyer', 4, NULL, now() - interval '2 days', NULL),
  ('${SHOP}', NULL, 'buyer', 3, 'ok', now() - interval '1 day', NULL),
  ('${SHOP}', '${JANE}', 'buyer', 1, 'removed one', now(), now()),
  ('${SHOP}', '${GONE}', 'shop', 5, 'shop side', now(), NULL),
  ('${SHOP}', '${BANNED}', 'buyer', 2, 'banned one', now() - interval '4 days', NULL),
  ('${SHOP}', '${TESTER}', 'buyer', 2, 'test one', now() - interval '5 days', NULL),
  ('${SHOP}', '${UNVER}', 'buyer', 2, 'unverified one', now() - interval '6 days', NULL);
`);
const call = async (uid, role = "authenticated") => {
  await db.exec(`SET test.uid = '${uid ?? ""}'; SET ROLE ${role};`);
  try { return { v: (await db.query(`SELECT public.shops_shop_reviews($1) AS v`, [SHOP])).rows[0].v }; }
  catch (e) { return { err: e.message }; } finally { await db.exec(`RESET ROLE; SET test.uid = '';`); }
};
const r = await call(VIEWER);
const rows = r.v?.reviews ?? [];
check(!r.err && rows.length === 6, "only the six public buyer reviews are listed", r.err ?? JSON.stringify(rows));
const by = (c) => rows.find((x) => x.comment === c);
check(by("Great")?.reviewer_name === "Jane D.", "a full name reads 'First L.'", JSON.stringify(by("Great")));
check(rows.find((x) => x.stars === 4)?.reviewer_name === "Cher", "a one-word name reads as is");
check(by("ok")?.reviewer_name === "A neighbor", "a deleted account reads 'A neighbor'", JSON.stringify(by("ok")));
check(!JSON.stringify(r.v).includes(JANE) && !JSON.stringify(r.v).includes(MONO) && rows.every((x) => !("reviewer_id" in x)), "the reviewer's id is never returned");
check(by("banned one")?.reviewer_name === "A neighbor", "a banned reviewer reads 'A neighbor'", JSON.stringify(by("banned one")));
check(by("test one")?.reviewer_name === "A neighbor", "a test reviewer reads 'A neighbor' to members", JSON.stringify(by("test one")));
check(by("unverified one")?.reviewer_name === "A neighbor", "an unverified reviewer reads 'A neighbor'", JSON.stringify(by("unverified one")));
const rb = await call(BLOCKER);
check((rb.v?.reviews ?? []).find((x) => x.comment === "Great")?.reviewer_name === "A neighbor", "across a block the name reads 'A neighbor'", JSON.stringify(rb));
check(!!(await call(null, "anon")).err, "signed-out callers are still refused");

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
