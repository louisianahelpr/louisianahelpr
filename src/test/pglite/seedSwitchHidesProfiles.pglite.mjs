#!/usr/bin/env node
/**
 * PGlite proof for 20261007033530_seed_switch_hides_test_profiles (docs/OPEN.md
 * Q552; owner 2026-10-07: "hide test profiles and test jobs NOW").
 *
 *   npx tsx src/test/pglite/seedSwitchHidesProfiles.pglite.mjs [--replay] [--before]
 *
 * The four read functions are loaded from their EFFECTIVE definitions before
 * this migration, the reviews read policy from its live qual (pg_policies,
 * 2026-10-07). --before leaves the migration out and the RED checks must FAIL;
 * without it the migration is applied (3x with --replay) and every check must
 * PASS. Reads run under the REAL anon / authenticated roles (SET ROLE), with
 * RLS on for reviews.
 *
 * Switch ON:
 *   H1 anon: get_safe_profiles drops the test account, keeps the real one      RED before
 *   H2 real user: search_profiles_by_name does not find the test account       RED before
 *   H3 anon: get_public_profile_stats returns no row for the test account      RED before
 *   H4 real user: get_parish_activity counts no test job                       RED before
 *   H5 real user: a review between test accounts is not readable               RED before
 * Kept (green before and after):
 *   K1 a test account still sees another test account (the journeys)
 *   K2 an admin keeps a known test counterpart (row, stats, review)
 *   H6 an admin does not find test accounts by name or in the parish card    RED before
 *   K3 your own row; a review you wrote; a review about you
 * Switch OFF:
 *   K4 a real user sees the test account, its stats and its review (today's behaviour)
 */
import os from "node:os";
import { THIS, MIGRATION, SCHEMA as WORLD } from "./seedSwitchWorld.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

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
const REAL = U(1), SEED_A = U(2), SEED_B = U(3), ADMIN = U(4);
const SEED_JOB = U(101), REAL_JOB = U(102);

const SCHEMA = `
${WORLD}
GRANT SELECT ON public.reviews TO authenticated;

-- Live 2026-10-07 (pg_policies qual), the policy this migration replaces.
CREATE POLICY "Published reviews visible after reveal" ON public.reviews FOR SELECT TO authenticated
  USING (((reviewer_id = ( SELECT auth.uid() AS uid)) OR ((status = 'published'::text) AND (feedback_visible_at IS NOT NULL) AND (feedback_visible_at <= now()))));
CREATE POLICY "Admins can view all reviews" ON public.reviews FOR SELECT TO authenticated
  USING (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role));
REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_parish_activity(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_parish_activity(integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;
`;

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;

await db.exec(SCHEMA);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
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
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO auth.users (id) VALUES ('${REAL}'), ('${SEED_A}'), ('${SEED_B}'), ('${ADMIN}');
  INSERT INTO public.profiles (user_id, full_name, is_seed) VALUES
    ('${REAL}', 'Real Person', false), ('${SEED_A}', 'Testy Poster', true), ('${SEED_B}', 'Testy Helpr', true), ('${ADMIN}', 'Owner Admin', false);
  DO $$ BEGIN
    IF to_regclass('public.test_accounts') IS NOT NULL THEN
      INSERT INTO public.test_accounts (user_id) VALUES ('${SEED_A}'), ('${SEED_B}');
    END IF;
  END $$;
  INSERT INTO public.jobs (id, customer_id, helper_id, status, poster_completed_at, platform_fee_amount, customer_fee_amount, is_seed) VALUES
    ('${SEED_JOB}', '${SEED_A}', '${SEED_B}', 'completed', now() - interval '1 day', 5, 5, true),
    ('${REAL_JOB}', '${REAL}', NULL, 'open', NULL, 0, 0, false);
  INSERT INTO public.reviews (reviewer_id, reviewee_id, job_id, rating, status, feedback_visible_at) VALUES
    ('${SEED_A}', '${SEED_B}', '${SEED_JOB}', 5, 'published', now() - interval '1 hour');
  GRANT INSERT ON public.profile_search_rate_log TO authenticated;
`);

const as = (role, uid) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const safe = async () => (await all(`SELECT user_id FROM public.get_safe_profiles(ARRAY['${REAL}','${SEED_B}']::uuid[])`)).map((r) => r.user_id);
const stats = async (id) => (await all(`SELECT user_id, review_count FROM public.get_public_profile_stats(ARRAY['${id}']::uuid[])`));
const search = async () => (await all(`SELECT user_id FROM public.search_profiles_by_name('Testy')`)).map((r) => r.user_id);
const parish = async () => (await all(`SELECT completed_jobs_30d, revenue_30d, active_jobs FROM public.get_parish_activity(5)`));
const reviews = async () => (await all(`SELECT reviewer_id FROM public.reviews`)).length;

// ── switch ON ────────────────────────────────────────────────────────────────
await as("anon");
let ids = await safe();
check("H1 anon: get_safe_profiles drops the test account, keeps the real one", ids.includes(REAL) && !ids.includes(SEED_B), JSON.stringify(ids), true);
check("H3 anon: get_public_profile_stats returns no row for the test account", (await stats(SEED_B)).length === 0, "row returned", true);
await as("authenticated", REAL);
check("H2 real user: search_profiles_by_name does not find the test account", (await search()).length === 0, "found", true);
const pr = await parish();
check("H4 real user: get_parish_activity counts no test job", pr.length === 1 && pr[0].completed_jobs_30d === 0 && Number(pr[0].revenue_30d) === 0 && pr[0].active_jobs === 1, JSON.stringify(pr), true);
check("H5 real user: a review between test accounts is not readable", (await reviews()) === 0, "readable", true);
// lh-authz-rls review of 667446afd, finding 7 (and of 40adb6ade, finding 3): the reviews LIST reads as owner.
const listOf = async (id) => (await all(`SELECT id FROM public.get_public_profile_reviews('${id}'::uuid, 20, 0)`)).length;
check("H7 real user: get_public_profile_reviews lists no review of a test account", (await listOf(SEED_B)) === 0, "listed", true);

await as("authenticated", SEED_A);
ids = await safe();
check("K1 a test account still sees another test account (profile, search, stats, review)",
  ids.includes(SEED_B) && (await search()).includes(SEED_B) && (await stats(SEED_B))[0]?.review_count === 1 && (await reviews()) === 1);
await as("authenticated", ADMIN);
check("K2 an admin keeps a known test counterpart's row, stats and review",
  (await safe()).includes(SEED_B) && (await stats(SEED_B))[0]?.review_count === 1 && (await reviews()) === 1);
const adminParish = await parish();
check("H6 an admin does NOT find test accounts by name or in the parish card (discovery)",
  (await search()).length === 0 && adminParish[0]?.completed_jobs_30d === 0, JSON.stringify(adminParish), true);
// Own row / own reviews: make SEED_B look like a real account to itself? No: it is a test
// account and sees itself via K1. The self carve-outs matter for a real account whose
// counterpart is a test account: a review a test account wrote ABOUT a real person.
await db.exec(`RESET ROLE; INSERT INTO public.reviews (reviewer_id, reviewee_id, job_id, rating, status, feedback_visible_at)
  VALUES ('${SEED_A}', '${REAL}', '${SEED_JOB}', 4, 'published', now() - interval '1 hour'),
         ('${REAL}', '${SEED_A}', '${SEED_JOB}', 3, 'published', now() - interval '1 hour');`);
await as("authenticated", REAL);
const mine = await all(`SELECT reviewer_id, reviewee_id FROM public.reviews ORDER BY rating`);
const ownStats = await stats(REAL);
check("K3 a real person keeps their own row, the review they wrote and the one about them (and its count)",
  (await all(`SELECT user_id FROM public.get_safe_profiles(ARRAY['${REAL}']::uuid[])`)).length === 1 &&
    mine.some((r) => r.reviewer_id === REAL) && mine.some((r) => r.reviewee_id === REAL) && ownStats[0]?.review_count === 1,
  JSON.stringify({ mine, ownStats }));
await as("anon");
check("H3b anon: a review a test account wrote about a real person does not count on that person's stats",
  (await stats(REAL))[0]?.review_count === 0, JSON.stringify(await stats(REAL)), true);

// ── switch OFF ───────────────────────────────────────────────────────────────
await db.exec(`RESET ROLE; UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": false}';`);
await as("authenticated", REAL);
check("K4 switch off: a real user sees the test account, finds it, its stats, its review and its job in the parish card",
  (await safe()).includes(SEED_B) && (await search()).length === 2 && (await stats(SEED_B))[0]?.review_count === 1 && (await reviews()) === 3 && (await parish())[0]?.completed_jobs_30d === 1);

await db.exec("RESET ROLE");
console.log(`\n${failures} failure(s)${BEFORE ? `, ${redFailures} of them RED checks` : ""}`);
if (BEFORE) {
  // Before the migration every RED check must fail and every K check must pass.
  const expectedRed = 8;
  const ok = redFailures === expectedRed && failures === expectedRed;
  console.log(ok ? `RED as expected (${expectedRed} RED checks failed, keepers green)` : `UNEXPECTED: wanted exactly ${expectedRed} RED failures`);
  process.exit(ok ? 0 : 1);
}
process.exit(failures ? 1 : 0);
