#!/usr/bin/env node
/**
 * PGlite proof for 20261015051301_declutter_shared_star_rating (Declutter row
 * 45; lead 2026-10-15): ONE public star rating across job reviews and
 * Declutter reviews, computed in get_public_profile_stats.
 *
 *   npx tsx src/test/pglite/declutterSharedStarRating.pglite.mjs            # applied 3x, all PASS
 *   npx tsx src/test/pglite/declutterSharedStarRating.pglite.mjs --before   # RED checks FAIL
 *
 * World: seedSwitchWorld (the prod-shaped stubs every profile-stats proof
 * uses) + 20261007033530 (the definition live on prod, md5-matched
 * 2026-10-15) + stub declutter_orders / declutter_reviews carrying the columns
 * the new branch reads (the real tables are proven by declutterSlice4.pglite.mjs).
 *
 *   R1 a public Declutter review (both sides reviewed) counts in review_count and avg_rating   RED before
 *   R2 a one-sided review older than 14 days after handover counts too                         RED before
 *   K1 a one-sided review inside the 14-day blind period does not count
 *   K2 a review on an order that is not handed over does not count
 *   K3 poster_review_count / poster_avg_rating are job-poster figures only (unchanged)
 *   K4 a test account's Declutter review stays hidden from others while the seed switch is on
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { MIGRATION as SEED_SWITCH, SCHEMA as WORLD } from "./seedSwitchWorld.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const BEFORE = process.argv.includes("--before");
const THIS = "20261015051301_declutter_shared_star_rating.sql";
const MIGRATION = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : readFileSync(new URL(`../../../supabase/migrations/${THIS}`, import.meta.url).pathname, "utf8");

let failures = 0;
let redFailures = 0;
const check = (name, ok, detail = "", red = false) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) {
    failures++;
    if (red) redFailures++;
  }
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), BUYER = U(2), OTHER = U(3), SEED = U(4), VIEWER = U(5);
const JOB = U(101);
const O_PUBLIC = U(201), O_OLD = U(202), O_BLIND = U(203), O_PAID = U(204), O_SEED = U(205);

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
await db.exec(WORLD);
await db.exec(SEED_SWITCH);
await db.exec(`
  REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text NOT NULL, handed_over_at timestamptz);
  CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL,
    reviewer_id uuid, reviewee_id uuid, reviewer_side text, stars smallint NOT NULL, is_seed boolean NOT NULL DEFAULT false);
`);
if (!BEFORE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}

await db.exec(`
  INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
  INSERT INTO auth.users (id) VALUES ('${SELLER}'), ('${BUYER}'), ('${OTHER}'), ('${SEED}'), ('${VIEWER}');
  INSERT INTO public.profiles (user_id, full_name, is_seed) VALUES
    ('${SELLER}', 'Sam Seller', false), ('${BUYER}', 'Bea Buyer', false), ('${OTHER}', 'Olly Other', false),
    ('${SEED}', 'Testy Seed', true), ('${VIEWER}', 'Vi Viewer', false);
  DO $$ BEGIN
    IF to_regclass('public.test_accounts') IS NOT NULL THEN INSERT INTO public.test_accounts (user_id) VALUES ('${SEED}'); END IF;
  END $$;
  -- One job review of the seller AS A POSTER: 3 stars.
  INSERT INTO public.jobs (id, customer_id, helper_id, status, poster_completed_at, platform_fee_amount, customer_fee_amount) VALUES
    ('${JOB}', '${SELLER}', '${OTHER}', 'completed', now() - interval '2 days', 5, 5);
  INSERT INTO public.reviews (reviewer_id, reviewee_id, job_id, rating, status, feedback_visible_at) VALUES
    ('${OTHER}', '${SELLER}', '${JOB}', 3, 'published', now() - interval '1 day');
  INSERT INTO public.declutter_orders (id, status, handed_over_at) VALUES
    ('${O_PUBLIC}', 'handed_over', now() - interval '2 days'),
    ('${O_OLD}', 'handed_over', now() - interval '15 days'),
    ('${O_BLIND}', 'handed_over', now() - interval '1 day'),
    ('${O_PAID}', 'refunded', now() - interval '20 days'),
    ('${O_SEED}', 'handed_over', now() - interval '20 days');
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, reviewer_side, stars, is_seed) VALUES
    ('${O_PUBLIC}', '${BUYER}', '${SELLER}', 'buyer', 5, false),
    ('${O_PUBLIC}', '${SELLER}', '${BUYER}', 'seller', 5, false),
    ('${O_OLD}', '${BUYER}', '${SELLER}', 'buyer', 4, false),
    ('${O_BLIND}', '${BUYER}', '${SELLER}', 'buyer', 1, false),
    ('${O_PAID}', '${BUYER}', '${SELLER}', 'buyer', 1, false),
    ('${O_SEED}', '${SEED}', '${SELLER}', 'buyer', 1, true);
`);

const as = (role, uid) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const stats = async (id) =>
  (await all(`SELECT review_count, avg_rating::text AS avg, poster_review_count, poster_avg_rating
                FROM public.get_public_profile_stats(ARRAY['${id}']::uuid[])`))[0];

await as("authenticated", VIEWER);
const s = await stats(SELLER);
// Job 3 + Declutter 5 (public) + 4 (old one-sided) = 3 reviews, avg 4.00. Blind 1, unpaid 1 and seed 1 are left out.
check("R1+R2 job + public Declutter reviews make ONE rating (3 reviews, avg 4.00)",
  s?.review_count === 3 && s?.avg === "4.00", JSON.stringify(s), true);
check("K1/K2/K4 blind, not-handed-over and test-account reviews are left out (no 1-star pulls it down)",
  s?.review_count <= 3 && Number(s?.avg) >= 3, JSON.stringify(s));
check("K3 the poster figures stay job-poster only (1 poster review, under the 3-review floor: hidden)",
  s?.poster_review_count === 1 && s?.poster_avg_rating === null, JSON.stringify(s));
const b = await stats(BUYER);
check("R1 the buyer's public Declutter review counts on their profile too", b?.review_count === 1 && b?.avg === "5.00", JSON.stringify(b), true);
await as("anon");
check("anon sees the same public rating", (await stats(SELLER))?.review_count === 3, "", true);
await db.exec("RESET ROLE");

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL (${redFailures} of them RED checks)`}${BEFORE ? " [--before]" : ""}`);
process.exit(BEFORE ? (redFailures > 0 && failures === redFailures ? 0 : 1) : (failures ? 1 : 0));
