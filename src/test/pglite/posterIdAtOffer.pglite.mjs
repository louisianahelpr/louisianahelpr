#!/usr/bin/env node
/**
 * PGlite proof for 20261120205350_poster_id_at_offer_not_post (owner 2026-11-20: the poster's ID check moves from
 * posting to sending an offer; the Helpr sees the address only once the poster is verified).
 *
 *   node src/test/pglite/posterIdAtOffer.pglite.mjs                     # ALL PASS (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/posterIdAtOffer.pglite.mjs  # RED: every [RED] check fails
 *
 * Base, read verbatim from the migrations (the definitions in force before this one): enforce_identity_before_post
 * + trg_jobs_identity_before_post (20261021081258), identity_is_verified (20261021081258), is_identity_verified
 * (20261019051407), is_server_context (20260915101102), has_role (20261012184600) and user_may_see_job_address
 * (20261012184600). Stubbed, and said so: tables cut to the columns read; auth.uid()/auth.role() from settings;
 * identity_check_exempt is the shape it has while the identity_check switch is ON for the member (an enrolled seed
 * test account only) -- feature_enabled_for_user is not under test. Writes run as the real authenticated role, so the
 * triggers judge them exactly as they judge the hire RPCs' writes (the RPCs are definers, auth.uid() stays the caller).
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261120205350_poster_id_at_offer_not_post.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
let reds = 0;
let redFails = 0;
const check = (ok, name, red = false, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${red ? "[RED] " : ""}${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (red) reds++;
  if (!ok) {
    failures++;
    if (red) redFails++;
  }
};

/** The LAST `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in one migration file, any dollar tag. */
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
  let m, last = null;
  while ((m = re.exec(t))) last = m.index;
  if (last === null) throw new Error(`no ${name} in ${file}`);
  const tag = /\bAS\s+(\$\w*\$)/g;
  tag.lastIndex = last;
  const a = tag.exec(t);
  const end = t.indexOf(a[1], a.index + a[0].length);
  return t.slice(last, end + a[1].length) + ";";
}

const U = (n) => `0f0f0f0f-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), VERIFIED_POSTER = U(2), HELPR = U(3), HELPR2 = U(4), SEED = U(5), ADMIN = U(6);

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.uid', true), '')::uuid \$f\$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('test.role', true), '') \$f\$;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, idv_status text, stripe_identity_verified boolean NOT NULL DEFAULT false, is_seed boolean DEFAULT false);
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, offered_to_helper_id uuid,
  direct_offer_status text, direct_offer_expires_at timestamptz, status text NOT NULL DEFAULT 'open', location text DEFAULT '1 Main St, Delcambre, LA 70528');
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid);
CREATE TABLE public.series_date_offers (parent_job_id uuid, helper_id uuid);
CREATE TABLE public.applications (job_id uuid, helper_id uuid, status text);
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
CREATE FUNCTION public.identity_check_exempt(p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS \$f\$
  SELECT COALESCE((SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
    FROM public.profiles p WHERE p.user_id = p_user_id), false) \$f\$;
INSERT INTO public.profiles (user_id, idv_status, is_seed) VALUES
  ('${POSTER}', NULL, false), ('${VERIFIED_POSTER}', 'verified', false), ('${HELPR}', NULL, false), ('${HELPR2}', NULL, false),
  ('${SEED}', NULL, true), ('${ADMIN}', NULL, false);
INSERT INTO public.test_accounts VALUES ('${SEED}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
`);
const base = [
  fnFrom("20260915101102_null_uid_is_not_server.sql", "is_server_context"),
  fnFrom("20261012184600_scope_policy_helpers_to_caller.sql", "has_role"),
  fnFrom("20261021081258_stripe_identity_before_first_accept_post_and_start.sql", "identity_is_verified"),
  fnFrom("20261019051407_rentals_landlord_id_review.sql", "is_identity_verified"),
  fnFrom("20261021081258_stripe_identity_before_first_accept_post_and_start.sql", "enforce_identity_before_post"),
  `CREATE TRIGGER trg_jobs_identity_before_post BEFORE INSERT ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.enforce_identity_before_post();`,
  fnFrom("20261012184600_scope_policy_helpers_to_caller.sql", "user_may_see_job_address"),
];
for (const s of base) await db.exec(s);
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}

/** Run `sql` as the authenticated member `uid`; the error message, or null. */
async function as(uid, sql) {
  try {
    await db.exec(`BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('test.uid', '${uid}', true); SELECT set_config('test.role', 'authenticated', true); ${sql}; COMMIT;`);
    return null;
  } catch (e) {
    await db.exec("ROLLBACK").catch(() => {});
    return e.message;
  }
}
async function seesAddress(job, uid) {
  const r = await db.query(`SELECT set_config('test.uid', '${uid}', false) AS x, public.user_may_see_job_address('${job}', '${uid}') AS ok`);
  await db.exec(`SELECT set_config('test.uid', '', false)`);
  return r.rows[0].ok === true;
}
const q = async (s) => (await db.query(s)).rows;
const job = async (poster, extra = {}) => {
  const cols = ["customer_id", ...Object.keys(extra)];
  const vals = [poster === null ? "NULL" : `'${poster}'`, ...Object.values(extra).map((v) => (v === null ? "NULL" : `'${v}'`))];
  return (await q(`INSERT INTO public.jobs (${cols.join(", ")}) VALUES (${vals.join(", ")}) RETURNING id`))[0].id;
};

try {
  // 1. Posting works unverified.
  let e = await as(POSTER, `INSERT INTO public.jobs (customer_id) VALUES ('${POSTER}')`);
  check(e === null, "an unverified poster posts a job", true, e ?? "");

  // 2. An offer by an unverified poster is refused, whichever write makes it.
  e = await as(POSTER, `INSERT INTO public.jobs (customer_id, offered_to_helper_id) VALUES ('${POSTER}', '${HELPR}')`);
  check(/identity_required_to_offer/.test(e ?? ""), "a direct offer posted by an unverified poster is refused (identity_required_to_offer)", true, e ?? "no error");
  const j1 = await job(POSTER);
  e = await as(POSTER, `UPDATE public.jobs SET status = 'accepted', helper_id = '${HELPR}' WHERE id = '${j1}'`);
  check(/identity_required_to_offer/.test(e ?? ""), "accept_application's hire write by an unverified poster is refused", true, e ?? "no error");
  e = await as(POSTER, `UPDATE public.jobs SET offered_to_helper_id = '${HELPR}', direct_offer_status = 'pending' WHERE id = '${j1}'`);
  check(/identity_required_to_offer/.test(e ?? ""), "rpc_instant_book's offer write by an unverified poster is refused", true, e ?? "no error");
  e = await as(POSTER, `INSERT INTO public.group_job_helpers VALUES ('${j1}', '${HELPR}')`);
  check(/identity_required_to_offer/.test(e ?? ""), "a crew seat by an unverified poster is refused", true, e ?? "no error");
  e = await as(POSTER, `INSERT INTO public.series_date_offers VALUES ('${j1}', '${HELPR}')`);
  check(/identity_required_to_offer/.test(e ?? ""), "a series-dates offer by an unverified poster is refused", true, e ?? "no error");

  // 3. A verified poster's offers go through; so do an admin's and an enrolled test account's.
  e = await as(VERIFIED_POSTER, `INSERT INTO public.jobs (customer_id, offered_to_helper_id) VALUES ('${VERIFIED_POSTER}', '${HELPR}')`);
  check(e === null, "a verified poster's direct offer goes through", false, e ?? "");
  const j2 = await job(VERIFIED_POSTER);
  e = await as(VERIFIED_POSTER, `UPDATE public.jobs SET status = 'accepted', helper_id = '${HELPR}' WHERE id = '${j2}'`);
  check(e === null, "a verified poster's hire goes through", false, e ?? "");
  const j3 = await job(ADMIN);
  e = await as(ADMIN, `UPDATE public.jobs SET helper_id = '${HELPR}' WHERE id = '${j3}'`);
  check(e === null, "an admin poster's hire goes through", false, e ?? "");
  const j4 = await job(SEED);
  e = await as(SEED, `INSERT INTO public.group_job_helpers VALUES ('${j4}', '${HELPR}')`);
  check(e === null, "an enrolled test account's crew seat goes through", false, e ?? "");

  // 4. Not judged: a Helpr's own write on the job, and a server write.
  const j5 = await job(POSTER, { offered_to_helper_id: HELPR, direct_offer_status: "pending" });
  e = await as(HELPR, `UPDATE public.jobs SET helper_id = '${HELPR}', status = 'accepted' WHERE id = '${j5}'`);
  check(e === null, "the offered Helpr answering a legacy offer is not judged", false, e ?? "");
  e = await as(HELPR2, `INSERT INTO public.group_job_helpers VALUES ('${j1}', '${HELPR2}')`);
  check(e === null, "a Helpr's own crew-seat write is not judged", false, e ?? "");
  try {
    await q(`UPDATE public.jobs SET helper_id = '${HELPR}' WHERE id = '${j1}'`);
    e = null;
  } catch (err) {
    e = err.message;
  }
  check(e === null, "a server write (no auth.uid, no member role) is not judged", false, e ?? "");

  // 5. The address: hidden from the Helpr until the poster is verified; the poster always sees their own.
  const j6 = await job(POSTER, { helper_id: HELPR, status: "accepted" });
  const j7 = await job(POSTER, { offered_to_helper_id: HELPR2, direct_offer_status: "pending" });
  const j8 = await job(POSTER);
  await q(`INSERT INTO public.group_job_helpers VALUES ('${j8}', '${HELPR2}')`);
  await q(`INSERT INTO public.applications VALUES ('${j8}', '${HELPR}', 'accepted')`);
  check(!(await seesAddress(j6, HELPR)), "unverified poster: the hired Helpr does not see the address", true);
  check(!(await seesAddress(j7, HELPR2)), "unverified poster: the direct-offer Helpr does not see the address", true);
  check(!(await seesAddress(j8, HELPR2)), "unverified poster: a crew member does not see the address", true);
  check(!(await seesAddress(j8, HELPR)), "unverified poster: an accepted applicant does not see the address", true);
  check(await seesAddress(j6, POSTER), "the poster sees their own address", false);
  await q(`UPDATE public.profiles SET idv_status = 'verified' WHERE user_id = '${POSTER}'`);
  check(await seesAddress(j6, HELPR), "verified poster: the hired Helpr sees the address", false);
  check(await seesAddress(j8, HELPR2), "verified poster: a crew member sees the address", false);
  const j9 = await job(VERIFIED_POSTER);
  await q(`INSERT INTO public.applications VALUES ('${j9}', '${HELPR2}', 'pending')`);
  check(!(await seesAddress(j9, HELPR2)), "verified poster: a pending applicant still does not see it (rule kept)", false);
  const j10 = await job(null, { helper_id: HELPR, status: "accepted" });
  check(await seesAddress(j10, HELPR), "an ownerless job (deleted poster) keeps the existing rule", false);

  // Q140: a NULL never says yes.
  if (!skip) {
    const n = (await q(`SELECT public.poster_id_cleared(NULL) AS v`))[0].v;
    check(n === false, "poster_id_cleared(NULL) is exactly FALSE", false, String(n));
  }

  // 6. Grants.
  const acl = await q(`SELECT proname, coalesce(proacl::text, '') a FROM pg_proc WHERE proname IN ('poster_id_cleared', 'enforce_poster_identity_before_offer', 'user_may_see_job_address', 'enforce_identity_before_post')`);
  const by = Object.fromEntries(acl.map((r) => [r.proname, r.a]));
  check(!("enforce_identity_before_post" in by), "enforce_identity_before_post is dropped", true, JSON.stringify(by));
  check(/service_role=X/.test(by.poster_id_cleared ?? "") && !/authenticated=|anon=/.test(by.poster_id_cleared ?? ""), "poster_id_cleared: service_role only", false, by.poster_id_cleared ?? "missing");
  check(!/authenticated=|anon=/.test(by.enforce_poster_identity_before_offer ?? "x") && (by.enforce_poster_identity_before_offer ?? null) !== null, "the trigger function is not client-callable", false, by.enforce_poster_identity_before_offer ?? "missing");
  check(/authenticated=X/.test(by.user_may_see_job_address ?? "") && !/anon=/.test(by.user_may_see_job_address ?? ""), "user_may_see_job_address: authenticated, never anon", false, by.user_may_see_job_address ?? "missing");
} catch (err) {
  check(false, `threw: ${err.message}`);
}
console.log(`\n${reds} RED checks, ${redFails} failed`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
