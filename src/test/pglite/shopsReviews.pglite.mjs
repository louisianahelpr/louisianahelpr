#!/usr/bin/env node
/**
 * PGlite proof for 20261105230819_shops_reviews_and_rating.sql (Shops H9): either side of a handed-over shop order
 * reviews once; reviews stay blind until both sides reviewed or 14 days after the handover; the shop's rating is its
 * buyers' public reviews only, shown at 3 or more; shop_owner_rating (browse, full page) and shops_public_shop (the
 * link page) read the shop's own rating, never the owner's person rating.
 *
 *   node src/test/pglite/shopsReviews.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReviews.pglite.mjs # red: the checks need it
 *   MIGRATION_PATH=<planted copy> node ...                          # red on a planted defect
 *
 * World: cut-down prod-shaped tables; the prior shop_owner_rating (20261017061155, the person rating) is created
 * first, through a get_public_profile_stats stub that returns a fixed person rating (4.9, fifty job reviews, a 2026-11-05 test fixture). Supabase's DEFAULT PRIVILEGES
 * (EXECUTE on new functions to anon, authenticated, service_role) are emulated. Stubs: require_feature (no-op),
 * is_caller_banned (false), contact_leak_reason (7+ digits), seed_jobs_hidden_publicly (true), shop_state_ok /
 * shop_link_visible (hidden_at IS NULL), shop_badges ('[]').
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261105230819_shops_reviews_and_rating.sql`, "utf8");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), STRANGER = U(9), OWNER2 = U(8);
const BUYERS = [U(2), U(3), U(4), U(5)];
const SHOP = U(10), SHOP2 = U(11);
const ORD = [U(20), U(21), U(22), U(23)], NOT_HANDED = U(30), OLD = U(31);

const db = new PGlite();
await db.exec(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;`);
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE FUNCTION public.contact_leak_reason(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
    $$ SELECT CASE WHEN t ~ '[0-9]{7,}' THEN 'A phone number' END $$;
  CREATE FUNCTION public.seed_jobs_hidden_publicly() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE TABLE public.shop_categories (slug text PRIMARY KEY, label text, group_label text);
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid NOT NULL UNIQUE, name text NOT NULL, about text DEFAULT '',
    category text, parishes_served text[] DEFAULT '{}', area_label text, storefront boolean DEFAULT false,
    offers_selling boolean DEFAULT true, offers_quotes boolean DEFAULT false, hidden_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.shop_hours (shop_id uuid, weekday int, opens_local time, closes_local time);
  CREATE TABLE public.shop_photos (id uuid PRIMARY KEY, shop_id uuid, photo_kind text, position int);
  CREATE TABLE public.shop_items (id uuid PRIMARY KEY, shop_id uuid, kind text, subtype text, status text, title text, description text,
    price_cents int, lead_time_days int, stock_count int, live_at timestamptz, created_at timestamptz DEFAULT now());
  CREATE TABLE public.shop_item_photos (id uuid PRIMARY KEY, item_id uuid, position int);
  CREATE FUNCTION public.shop_state_ok(p uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT hidden_at IS NULL FROM public.shops WHERE id = p), false) $$;
  CREATE FUNCTION public.shop_link_visible(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.shop_state_ok(p) $$;
  CREATE FUNCTION public.shop_badges(p uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '[]'::jsonb $$;
  CREATE TABLE public.shop_orders (id uuid PRIMARY KEY, shop_id uuid REFERENCES public.shops(id), buyer_id uuid, seller_id uuid,
    status text, handed_over_at timestamptz, is_seed boolean NOT NULL DEFAULT false);
  -- The prior state: the person rating (20261017061155's body over a stub of get_public_profile_stats).
  CREATE FUNCTION public.get_public_profile_stats(p uuid[]) RETURNS TABLE (user_id uuid, avg_rating numeric, review_count integer)
    LANGUAGE sql STABLE AS $$ SELECT x, 4.9::numeric, 50 FROM unnest(p) x $$;
  CREATE FUNCTION public.shop_owner_rating(p_owner_id uuid) RETURNS TABLE (rating numeric, review_count integer)
    LANGUAGE sql STABLE SECURITY DEFINER AS
    $$ SELECT st.avg_rating, COALESCE(st.review_count, 0) FROM public.get_public_profile_stats(ARRAY[p_owner_id]) st $$;

  INSERT INTO auth.users VALUES ('${OWNER}'), ('${OWNER2}'), ('${STRANGER}'), ${BUYERS.map((b) => `('${b}')`).join(", ")};
  INSERT INTO public.shops (id, owner_id, name) VALUES ('${SHOP}', '${OWNER}', 'Ruth''s Bakery'), ('${SHOP2}', '${OWNER2}', 'Quiet Shop');
  INSERT INTO public.shop_orders (id, shop_id, buyer_id, seller_id, status, handed_over_at) VALUES
    ${ORD.map((o, i) => `('${o}', '${SHOP}', '${BUYERS[i]}', '${OWNER}', 'handed_over', now() - interval '1 day')`).join(",\n    ")},
    ('${NOT_HANDED}', '${SHOP}', '${BUYERS[0]}', '${OWNER}', 'accepted', NULL),
    ('${OLD}', '${SHOP2}', '${BUYERS[0]}', '${OWNER2}', 'handed_over', now() - interval '20 days');
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const as = async (uid, sql, params = []) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return { rows: (await db.query(sql, params)).rows, err: null }; } catch (e) { return { rows: [], err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};
const review = (uid, order, stars, comment = null) => as(uid, `SELECT public.shops_leave_review($1, $2, $3) AS id`, [order, stars, comment]);
const rating = async () => (await db.query(`SELECT * FROM public.shop_owner_rating($1)`, [OWNER])).rows[0];
const pub = async (shop = SHOP) => (await as(null, `SELECT public.shops_public_shop($1) AS v`, [shop])).rows[0]?.v;

// Before any review the shop has no rating, never the owner's 4.9 person rating.
const r0 = await rating();
ok("a new shop has no rating (not the owner's person rating)", r0?.rating === null && r0?.review_count === 0, JSON.stringify(r0));
const p0 = await pub();
ok("the public page carries a rating key, empty for a new shop", p0 && "rating" in p0 && p0.rating === null && p0.review_count === 0, JSON.stringify(p0 && { r: p0.rating, c: p0.review_count }));

// Leaving reviews.
const r1 = await review(BUYERS[0], ORD[0], 5, "Best king cake in Lafayette");
ok("the buyer reviews a handed-over order", !r1.err && !!r1.rows[0]?.id, r1.err ?? "");
const dup = await review(BUYERS[0], ORD[0], 1);
ok("only once per side", /already_reviewed/.test(dup.err ?? ""), dup.err ?? "twice");
const early = await review(BUYERS[0], NOT_HANDED, 4);
ok("not before the handover", /not_handed_over/.test(early.err ?? ""), early.err ?? "reviewed");
const str = await review(STRANGER, ORD[0], 1);
ok("a stranger can't review an order", /order_not_found/.test(str.err ?? ""), str.err ?? "reviewed");
const anon = await review(null, ORD[0], 1);
ok("signed out it is refused", /not_authenticated/.test(anon.err ?? ""), anon.err ?? "reviewed");
const stars0 = await review(BUYERS[1], ORD[1], 0);
ok("stars must be 1 to 5", /invalid_stars/.test(stars0.err ?? ""), stars0.err ?? "reviewed");
const leak = await review(BUYERS[1], ORD[1], 4, "call 3375551234");
ok("a phone number in the comment is refused", /review_contact_info/.test(leak.err ?? ""), leak.err ?? "reviewed");
const shopSide = await review(OWNER, ORD[0], 4, "Paid on time");
ok("the shop reviews the buyer", !shopSide.err, shopSide.err ?? "");

// Blind until both sides or 14 days: order 0 has both; orders 1-3 only the buyer's.
const mine = (await as(BUYERS[1], `SELECT public.shops_my_order_review($1) AS v`, [ORD[1]])).rows[0]?.v;
ok("before reviewing, the buyer may review", mine?.side === "buyer" && mine?.can_review === true && mine?.mine === null, JSON.stringify(mine));
for (let i = 1; i < 4; i++) await review(BUYERS[i], ORD[i], i === 3 ? 1 : 4);
const mine2 = (await as(BUYERS[1], `SELECT public.shops_my_order_review($1) AS v`, [ORD[1]])).rows[0]?.v;
ok("after, they see their own review and can't add another", mine2?.can_review === false && mine2?.mine?.stars === 4, JSON.stringify(mine2));
const strMine = await as(STRANGER, `SELECT public.shops_my_order_review($1) AS v`, [ORD[1]]);
ok("a stranger can't read an order's review state", /order_not_found/.test(strMine.err ?? ""), strMine.err ?? "read");

const list1 = (await as(STRANGER, `SELECT public.shops_shop_reviews($1) AS v`, [SHOP])).rows[0]?.v;
ok("blind: only the order both sides reviewed is public (1 of 4)", list1?.reviews?.length === 1 && list1.reviews[0].stars === 5, JSON.stringify(list1));
ok("under 3 public reviews there is no average", list1?.rating === null && list1?.review_count === 1, JSON.stringify(list1));
ok("the shop's own review of a buyer is not in the shop's reviews", list1?.reviews?.every((r) => r.comment !== "Paid on time"));
ok("no person ids in the list", !JSON.stringify(list1).includes(BUYERS[0]) && !JSON.stringify(list1).includes(OWNER));

// 14 days later every buyer review is public: 4 reviews, 5+4+4+1 = 14/4 = 3.5.
await db.exec(`UPDATE public.shop_orders SET handed_over_at = now() - interval '15 days' WHERE shop_id = '${SHOP}' AND handed_over_at IS NOT NULL`);
const r4 = await rating();
ok("at 3+ public reviews the shop's rating shows (3.5 from 4)", Number(r4?.rating) === 3.5 && r4?.review_count === 4, JSON.stringify(r4));
const p4 = await pub();
ok("the public page shows the shop's rating", Number(p4?.rating) === 3.5 && p4?.review_count === 4, JSON.stringify(p4 && { r: p4.rating, c: p4.review_count }));
ok("a negative review is never hidden", (await as(STRANGER, `SELECT public.shops_shop_reviews($1) AS v`, [SHOP])).rows[0]?.v?.reviews?.some((r) => r.stars === 1));

// A removed review (by the report rules) drops out; a test review stays out while test data is hidden.
await db.exec(`UPDATE public.shop_reviews SET removed_at = now() WHERE order_id = '${ORD[3]}' AND reviewer_side = 'buyer'`);
const r5 = await rating();
ok("a removed review leaves the rating (13/3 = 4.3)", Number(r5?.rating) === 4.3 && r5?.review_count === 3, JSON.stringify(r5));
await db.exec(`UPDATE public.shop_reviews SET is_seed = true WHERE order_id = '${ORD[2]}' AND reviewer_side = 'buyer'`);
const r6 = await rating();
ok("a test review stays out; back under 3 there is no average", r6?.rating === null && r6?.review_count === 2, JSON.stringify(r6));
const p6 = await pub();
ok("the public page shows nothing under 3 (not even the count)", p6?.rating === null && p6?.review_count === 0, JSON.stringify(p6 && { r: p6.rating, c: p6.review_count }));

// One owner with no reviews on their shop: still no rating.
const q = (await db.query(`SELECT * FROM public.shop_owner_rating($1)`, [OWNER2])).rows[0];
ok("another shop's owner still has no rating", q?.rating === null && q?.review_count === 0, JSON.stringify(q));

// Grants.
const tbl = await db.query(`SELECT has_table_privilege('authenticated', 'public.shop_reviews', 'SELECT') AS a, has_table_privilege('anon', 'public.shop_reviews', 'SELECT') AS b`);
ok("members can't read the table directly", tbl.rows[0].a === false && tbl.rows[0].b === false);
for (const sig of ["public.shops_leave_review(uuid, integer, text)", "public.shops_shop_reviews(uuid)", "public.shops_my_order_review(uuid)"]) {
  const g = await db.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS a, has_function_privilege('authenticated', $1, 'EXECUTE') AS m`, [sig]);
  ok(`${sig}: members only, never anon`, g.rows[0].a === false && g.rows[0].m === true, JSON.stringify(g.rows));
}
for (const sig of ["public.shop_review_public(uuid)", "public.shop_review_rating(uuid)", "public.shop_owner_rating(uuid)"]) {
  const g = await db.query(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS m, has_function_privilege('anon', $1, 'EXECUTE') AS a`, [sig]);
  ok(`${sig}: server only`, g.rows[0].a === false && g.rows[0].m === false, JSON.stringify(g.rows));
}

console.log(failed === 0 ? "ALL OK" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
