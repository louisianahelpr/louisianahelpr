#!/usr/bin/env node
/**
 * PGlite proof for the review-list half of owner 11-05 L4 (hide reviews between a person's own accounts):
 * get_public_profile_reviews (the /user/:id review LIST, and its total_count) leaves out a review from the member's own
 * other account (the same phone, profile_review_same_person), like get_public_profile_stats (20261105171508) and
 * /u/<handle> (20261105165059) already do.
 *
 *   npx tsx src/test/pglite/profileReviewListSamePerson.pglite.mjs            # migration applied 3x, ALL PASS
 *   npx tsx src/test/pglite/profileReviewListSamePerson.pglite.mjs --before   # only the previous definition: RED checks FAIL
 *   MIGRATION_PATH=<planted copy> npx tsx ...                                  # red on a planted defect
 *
 * World: cut-down tables carrying every column get_public_profile_reviews reads. The REAL definitions are applied in
 * order: normalize_phone_for_ban and profile_review_same_person (newest), get_public_profile_reviews (the newest before
 * this one); then the new migration 3x. review_text, seed_review_hidden, display_name_for_viewer and
 * seed_hidden_from_caller are stubs (no test members, no tags here).
 *
 *   R1 a same-phone review is left out of the list                                   RED before
 *   R2 total_count drops it too                                                      RED before
 *   R3 the member's OWN view of their list leaves it out too (every caller)          RED before
 *   K1 a review from a different phone, or from an account with no phone, still shows
 *   K2 anon has no EXECUTE on the list nor on profile_review_same_person; authenticated keeps the list
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = readdirSync(DIR).filter((f) => f.endsWith("_profile_review_list_same_person.sql")).sort().at(-1);
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
const LEXI = U(1), LEXI_ADMIN = U(2), RITA = U(3), NOPHONE = U(4);
const J1 = U(101), J2 = U(102), J3 = U(103);

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION public.seed_hidden_from_caller() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
  CREATE FUNCTION public.seed_review_hidden(a uuid, b uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.review_text(f text, t text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT f $$;
  CREATE FUNCTION public.display_name_for_viewer(n text, u uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT n $$;
  CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, phone text, full_name text,
    is_seed boolean DEFAULT false, email_verified boolean DEFAULT true, ban_status text);
  CREATE TABLE public.jobs (id uuid PRIMARY KEY, status text, category text);
  CREATE TABLE public.reviews (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, job_id uuid, reviewer_id uuid, reviewee_id uuid,
    rating int, feedback text, tags text[], status text DEFAULT 'published', created_at timestamptz DEFAULT now(),
    response_text text, response_at timestamptz, feedback_visible_at timestamptz DEFAULT now() - interval '1 day');
`);
const phone = realFn("normalize_phone_for_ban");
const same = realFn("profile_review_same_person");
const prev = realFn("get_public_profile_reviews");
console.log(`real: normalize_phone_for_ban from ${phone.file}; profile_review_same_person from ${same.file}; previous list from ${prev.file}`);
await db.exec(phone.sql);
await db.exec(same.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.profile_review_same_person(uuid, uuid) FROM PUBLIC, anon, authenticated;`);
await db.exec(prev.sql);
await db.exec(`REVOKE ALL ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_public_profile_reviews(uuid, integer, integer) TO authenticated, service_role;`);
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
  INSERT INTO public.profiles (user_id, phone, full_name) VALUES
    ('${LEXI}', '(337) 555-0101', 'Lexi L'), ('${LEXI_ADMIN}', '+1 337-555-0101', 'Lexi Admin'), ('${RITA}', '337-555-0199', 'Rita B'), ('${NOPHONE}', NULL, 'Nora N');
  INSERT INTO public.jobs (id, status, category) VALUES ('${J1}', 'completed', 'lawn_care'), ('${J2}', 'completed', 'moving'), ('${J3}', 'completed', 'cleaning');
  INSERT INTO public.reviews (job_id, reviewer_id, reviewee_id, rating, feedback) VALUES
    ('${J1}', '${LEXI_ADMIN}', '${LEXI}', 5, 'own admin account'), ('${J2}', '${RITA}', '${LEXI}', 4, 'from Rita'), ('${J3}', '${NOPHONE}', '${LEXI}', 3, 'no phone');
`);

const as = (role, uid) =>
  db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
const list = async (id) => await all(`SELECT feedback, total_count::int AS total FROM public.get_public_profile_reviews('${id}'::uuid, 20, 0)`);

await as("authenticated", RITA);
const v = await list(LEXI);
const texts = v.map((r) => r.feedback).sort();
check("R1 her own other account's review is not in the list", !texts.includes("own admin account"), JSON.stringify(texts), true);
check("R2 total_count is 2", v.length > 0 && v.every((r) => r.total === 2), JSON.stringify(v), true);
check("K1 a different phone and a member with no phone still show", texts.includes("from Rita") && texts.includes("no phone"), JSON.stringify(texts));
await as("authenticated", LEXI);
const own = (await list(LEXI)).map((r) => r.feedback);
check("R3 her own view of her list leaves it out too", own.length === 2 && !own.includes("own admin account"), JSON.stringify(own), true);
await db.exec("RESET ROLE");
const acl = (await all(`SELECT has_function_privilege('anon', 'public.get_public_profile_reviews(uuid, integer, integer)', 'EXECUTE') AS anon_list,
  has_function_privilege('authenticated', 'public.get_public_profile_reviews(uuid, integer, integer)', 'EXECUTE') AS auth_list,
  has_function_privilege('anon', 'public.profile_review_same_person(uuid, uuid)', 'EXECUTE') AS anon_same,
  has_function_privilege('authenticated', 'public.profile_review_same_person(uuid, uuid)', 'EXECUTE') AS auth_same`))[0];
check("K2 grants: authenticated keeps the list; anon has neither; nobody but the owner runs profile_review_same_person",
  acl.anon_list === false && acl.auth_list === true && acl.anon_same === false && acl.auth_same === false, JSON.stringify(acl));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL (${redFailures} of them RED checks)`}${BEFORE ? " [--before]" : ""}`);
process.exit(BEFORE ? (redFailures > 0 && failures === redFailures ? 0 : 1) : (failures ? 1 : 0));
