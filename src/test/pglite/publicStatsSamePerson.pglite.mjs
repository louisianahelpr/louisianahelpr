#!/usr/bin/env node
/**
 * PGlite proof for 20261105171508_public_profile_stats_same_person.sql (owner 11-05, L4: hide reviews between a
 * person's own accounts). get_public_profile_stats (/user/:id, applicant rows, Hire, every caller) leaves out a review
 * from the member's own other account (the same phone, profile_review_same_person), in both halves (job reviews and
 * Declutter reviews), so its count and stars agree with /u/<handle>.
 *
 *   npx tsx src/test/pglite/publicStatsSamePerson.pglite.mjs            # migration applied 3x, ALL PASS
 *   npx tsx src/test/pglite/publicStatsSamePerson.pglite.mjs --before   # only the previous definition: RED checks FAIL
 *   MIGRATION_PATH=<planted copy> npx tsx ...                            # red on a planted defect
 *
 * World: cut-down tables carrying every column get_public_profile_stats reads. The REAL definitions are applied in
 * order: normalize_phone_for_ban (newest), profile_review_same_person (20261105165059) and get_public_profile_stats
 * from 20261102040000 (the newest before this one); then the new migration 3x. is_test_member and
 * seed_hidden_from_caller are stubs (no test members here).
 *
 *   S1 a same-phone job review is left out of review_count / avg_rating                         RED before
 *   S2 a same-phone Declutter review is left out too                                            RED before
 *   K1 a review from a different phone, or from an account with no phone, still counts
 *   K2 anon still holds EXECUTE on get_public_profile_stats and gets the same numbers; anon has no EXECUTE on
 *      profile_review_same_person
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261105171508_public_profile_stats_same_person.sql";
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");

// The newest real definition of a function (any dollar-quote tag) from the migrations before this one.
const realFn = (name) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS)
    .filter((f) => new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`).test(readFileSync(DIR + f, "utf8"))).sort().at(-1);
  const t = readFileSync(DIR + file, "utf8");
  const start = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const tag = t.slice(start).match(/AS\s+(\$[A-Za-z_]*\$)/)[1];
  const bodyStart = t.indexOf(tag, start) + tag.length;
  return { file, sql: t.slice(start, t.indexOf(tag, bodyStart) + tag.length) + ";" };
};

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
const LEXI = U(1), LEXI_ADMIN = U(2), RITA = U(3), NOPHONE = U(4), BUYER = U(5);
const J1 = U(101), J2 = U(102), J3 = U(103);
const O1 = U(201), O2 = U(202);

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.is_test_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, phone text, is_seed boolean DEFAULT false,
    email_verified boolean DEFAULT true, ban_status text, idv_status text, stripe_account_id text, background_check_status text);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, is_group_job boolean DEFAULT false,
    is_seed boolean DEFAULT false, helper_arrived_at timestamptz, date_needed date, start_time time, revision_count int,
    cancellation_reason text, cancelled_by uuid);
  CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_arrived_at timestamptz);
  CREATE TABLE public.reviews (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int,
    status text DEFAULT 'published', feedback_visible_at timestamptz DEFAULT now() - interval '1 day');
  CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, status text, handed_over_at timestamptz, is_seed boolean DEFAULT false);
  CREATE TABLE public.declutter_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, reviewer_id uuid, reviewee_id uuid,
    stars smallint, is_seed boolean NOT NULL DEFAULT false, removed_at timestamptz);
  CREATE TABLE public.helper_credentials (user_id uuid, status text);
`);
const phone = realFn("normalize_phone_for_ban");
const same = realFn("profile_review_same_person");
const prev = realFn("get_public_profile_stats");
console.log(`real: normalize_phone_for_ban from ${phone.file}; profile_review_same_person from ${same.file}; previous stats from ${prev.file}`);
await db.exec(phone.sql);
await db.exec(same.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.profile_review_same_person(uuid, uuid) FROM PUBLIC, anon, authenticated;`);
await db.exec(prev.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.get_public_profile_stats(uuid[]) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.get_public_profile_stats(uuid[]) TO anon, authenticated, service_role;`);
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
  INSERT INTO public.profiles (user_id, phone) VALUES
    ('${LEXI}', '(337) 555-0101'), ('${LEXI_ADMIN}', '+1 337-555-0101'), ('${RITA}', '337-555-0199'), ('${NOPHONE}', NULL), ('${BUYER}', '337-555-0177');
  INSERT INTO public.jobs (id, customer_id, helper_id, status) VALUES
    ('${J1}', '${LEXI_ADMIN}', '${LEXI}', 'completed'), ('${J2}', '${RITA}', '${LEXI}', 'completed'), ('${J3}', '${NOPHONE}', '${LEXI}', 'completed');
  -- Lexi's own admin account (same phone) gives 1 star; Rita 5; a member with no phone 4.
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating) VALUES
    ('${J1}', '${LEXI_ADMIN}', '${LEXI}', 1), ('${J2}', '${RITA}', '${LEXI}', 5), ('${J3}', '${NOPHONE}', '${LEXI}', 4);
  INSERT INTO public.declutter_orders (id, status, handed_over_at) VALUES
    ('${O1}', 'handed_over', now() - interval '20 days'), ('${O2}', 'handed_over', now() - interval '20 days');
  -- A Declutter review from her own admin account (2 stars) and one from a real buyer (5 stars).
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, stars) VALUES
    ('${O1}', '${LEXI_ADMIN}', '${LEXI}', 2), ('${O2}', '${BUYER}', '${LEXI}', 5);
`);

const as = (role, uid) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const stats = async (id) =>
  (await all(`SELECT review_count, avg_rating::text AS avg FROM public.get_public_profile_stats(ARRAY['${id}']::uuid[])`))[0];

await as("authenticated", RITA);
const s = await stats(LEXI);
// Counted: Rita 5, no-phone 4, buyer 5 = 3 reviews, avg 4.67. Left out: own admin's 1 (job) and 2 (Declutter).
check("S1+S2 her own other account's job and Declutter reviews are left out (3 reviews, avg 4.67)",
  s?.review_count === 3 && s?.avg === "4.67", JSON.stringify(s), true);
check("K1 a different phone and a member with no phone still count (at least 3)", (s?.review_count ?? 0) >= 3, JSON.stringify(s));
await as("anon");
const a = await stats(LEXI);
check("K2 anon gets the same numbers", a?.review_count === s?.review_count && a?.avg === s?.avg, JSON.stringify(a), true);
await db.exec("RESET ROLE");
const acl = (await all(`SELECT has_function_privilege('anon', 'public.get_public_profile_stats(uuid[])', 'EXECUTE') AS stats,
  has_function_privilege('anon', 'public.profile_review_same_person(uuid, uuid)', 'EXECUTE') AS same`))[0];
check("K2 anon holds EXECUTE on the stats and none on profile_review_same_person", acl.stats === true && acl.same === false, JSON.stringify(acl));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL (${redFailures} of them RED checks)`}${BEFORE ? " [--before]" : ""}`);
process.exit(BEFORE ? (redFailures > 0 && failures === redFailures ? 0 : 1) : (failures ? 1 : 0));
