#!/usr/bin/env node
/**
 * PGlite proof for 20261111021548_shops_reviews_owner_sees_own_shop.sql: a shop's owner reads its reviews section on
 * their own page while the shop is not public yet; everyone else is refused exactly as before.
 *
 *   node src/test/pglite/shopsReviewsOwnerSeesOwn.pglite.mjs                    # ALL OK (migration applied 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/shopsReviewsOwnerSeesOwn.pglite.mjs # red: the owner case needs it
 *   MIGRATION_PATH=<planted copy> node ...                                      # red on a planted defect
 *
 * World: the REAL newest bodies of shops_shop_reviews (20261105230819, the before), shop_visible_to (20261017061155)
 * and shop_publicly_visible (20261019042744), read from the migration files by tag-agnostic regex. Stubs:
 * require_feature (no-op), feature_enabled_for (true), shop_state_ok (a column), shop_review_rating,
 * shop_review_public (a column). Supabase's DEFAULT PRIVILEGES are emulated, so the REVOKE is proved.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SQL = readFileSync(process.env.MIGRATION_PATH ?? `${DIR}20261111021548_shops_reviews_owner_sees_own_shop.sql`, "utf8");
const fnBody = (file, name) => {
  const src = readFileSync(`${DIR}${file}`, "utf8");
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)[\\s\\S]*?\\1;`, "g");
  const all = [...src.matchAll(re)].map((m) => m[0]);
  if (!all.length) throw new Error(`setup: ${name} not found in ${file}`);
  return all[all.length - 1];
};
const BEFORE = fnBody("20261105230819_shops_reviews_and_rating.sql", "shops_shop_reviews");
const VISIBLE_TO = fnBody("20261017061155_shops_profiles.sql", "shop_visible_to");
const PUBLICLY = fnBody("20261019042744_shops_public_page.sql", "shop_publicly_visible");

const U = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), STRANGER = U(2), OWNER2 = U(3);
const SHUT = U(10), OPEN = U(11);

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE FUNCTION public.require_feature(p_key text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.feature_enabled_for(p_key text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE TABLE public.shops (id uuid PRIMARY KEY, owner_id uuid, state_ok boolean);
  CREATE FUNCTION public.shop_state_ok(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT state_ok FROM public.shops WHERE id = p_shop_id), false) $$;
  CREATE TABLE public.shop_reviews (id uuid PRIMARY KEY, shop_id uuid, reviewer_side text, stars int, comment text,
    created_at timestamptz DEFAULT now(), is_public boolean);
  CREATE FUNCTION public.shop_review_public(p_review_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
    $$ SELECT COALESCE((SELECT is_public FROM public.shop_reviews WHERE id = p_review_id), false) $$;
  CREATE FUNCTION public.shop_review_rating(p_shop_id uuid) RETURNS TABLE (rating numeric, review_count integer)
    LANGUAGE sql STABLE AS $$ SELECT avg(stars)::numeric, count(*)::int FROM public.shop_reviews
      WHERE shop_id = p_shop_id AND reviewer_side = 'buyer' AND is_public $$;
  ${PUBLICLY}
  ${VISIBLE_TO}
  ${BEFORE}
  INSERT INTO public.shops VALUES ('${SHUT}', '${OWNER}', false), ('${OPEN}', '${OWNER2}', true);
  INSERT INTO public.shop_reviews (id, shop_id, reviewer_side, stars, comment, is_public) VALUES
    ('${U(20)}', '${SHUT}', 'buyer', 5, 'kept public', true),
    ('${U(21)}', '${SHUT}', 'buyer', 1, 'not public', false),
    ('${U(22)}', '${SHUT}', 'seller', 4, 'seller side', true),
    ('${U(23)}', '${OPEN}', 'buyer', 4, 'open shop', true);
`);
if (process.env.NEW_MIGRATION !== "skip") for (let i = 0; i < 3; i++) await db.exec(SQL);

let failed = 0;
const ok = (name, cond, detail = "") => { if (cond) console.log(`OK   ${name}`); else { failed++; console.log(`FAIL ${name} ${detail}`); } };
const as = async (uid, shop) => {
  await db.exec(`SELECT set_config('test.uid', '${uid ?? ""}', false)`);
  try { return { v: (await db.query(`SELECT public.shops_shop_reviews($1::uuid) AS v`, [shop])).rows[0].v, err: null }; }
  catch (e) { return { v: null, err: e.message }; }
  finally { await db.exec(`SELECT set_config('test.uid', '', false)`); }
};

const own = await as(OWNER, SHUT);
ok("the owner reads their own not-yet-public shop's reviews", own.err === null && own.v?.review_count === 1, JSON.stringify(own));
ok("the owner sees only what the public would (buyer side, public only)",
  own.v?.reviews?.length === 1 && own.v.reviews[0].comment === "kept public", JSON.stringify(own.v));
const stranger = await as(STRANGER, SHUT);
ok("a stranger is still refused on a shop that is not public", stranger.err === "shop_not_found", JSON.stringify(stranger));
const otherOwner = await as(OWNER2, SHUT);
ok("another shop's owner is still refused", otherOwner.err === "shop_not_found", JSON.stringify(otherOwner));
const open = await as(STRANGER, OPEN);
ok("anyone still reads a public shop's reviews", open.err === null && open.v?.review_count === 1, JSON.stringify(open));
const nobody = await as(null, OPEN);
ok("signed out is still refused", nobody.err === "not_authenticated", JSON.stringify(nobody));
const missing = await as(OWNER, U(99));
ok("a shop that does not exist is shop_not_found", missing.err === "shop_not_found", JSON.stringify(missing));
const acl = (await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'shops_shop_reviews'`)).rows[0].a;
ok("anon cannot EXECUTE (REVOKE FROM PUBLIC, anon)", !/(^|[{,])anon=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);
ok("authenticated can EXECUTE", /authenticated=X/.test(acl), acl);

console.log(failed ? `\n${failed} FAIL` : "\nALL OK");
process.exit(failed ? 1 : 0);
