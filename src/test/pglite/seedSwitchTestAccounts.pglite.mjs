#!/usr/bin/env node
/**
 * PGlite proof, second half, for 20261007033530_seed_switch_hides_test_profiles
 * (docs/OPEN.md Q552): with the launch switch ON, a TEST account (profiles.is_seed)
 * still lists and applies to test jobs, so the nightly journeys keep working,
 * while a real person, an admin and anon still never see or reach one.
 *
 *   npx tsx src/test/pglite/seedSwitchTestAccounts.pglite.mjs [--replay] [--before]
 *
 * The job surfaces are loaded from their EFFECTIVE definitions before this
 * migration, with the trigger trg_application_job_state; stubs as in
 * crewFreeSpotRelisted.pglite.mjs, plus the real seed_jobs_hidden_publicly()
 * over platform_settings and has_role over user_roles. --before leaves the
 * migration out: the RED checks must FAIL (count asserted).
 *
 *   T1 a test account lists the test job in browse, the ranked feed and the map   RED before
 *   T2 a test account applies to the test job (apply_to_job and a direct insert)  RED before
 *   R1 a real person lists no test job (browse, ranked, map)
 *   R2 a real person's application to the test job is refused
 *   R3 an admin lists no test job (discovery: the owner sees what the public sees)
 *   R4 anon: the landing teaser and browse list no test job
 *   K1 switch off: a real person lists the test job again (today's behaviour)
 *
 * Not run here: direct_accept_block_reason (plpgsql over a wider job row); its
 * one-call swap is held by src/test/seedSwitchHidesProfiles.test.ts.
 */
import os from "node:os";
import { THIS, MIGRATION, SCHEMA } from "./seedSwitchWorld.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEED_POSTER = U(2), SEED_HELPER = U(3), REAL = U(4), ADMIN = U(5), SELF_SEEDED = U(6);
const SEED_JOB = U(101), REAL_JOB = U(102);


const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const attempt = async (sql) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return e.message;
  }
};
const ids = async (sql) => {
  try {
    return (await all(sql)).map((r) => r.id);
  } catch (e) {
    return [`ERROR: ${e.message}`];
  }
};

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

const at = (offset) => `(now() AT TIME ZONE 'America/Chicago' + interval '${offset}')`;
await server();
await db.exec(`
  INSERT INTO public.platform_settings (feature_flags) VALUES ('{"seed_jobs_hidden_publicly": true}');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
  INSERT INTO auth.users (id) VALUES ('${SEED_POSTER}'), ('${SEED_HELPER}'), ('${REAL}'), ('${ADMIN}'), ('${SELF_SEEDED}');
  INSERT INTO public.profiles (user_id, full_name, is_seed) VALUES
    ('${SEED_POSTER}', 'Test Poster', true), ('${SEED_HELPER}', 'Test Helpr', true), ('${REAL}', 'Real Person', false), ('${ADMIN}', 'Owner', false),
    -- A stranger who signed up as someone@mailinator.com: the fixture-email trigger made them is_seed.
    ('${SELF_SEEDED}', 'Mailinator Stranger', true);
  -- Only the harness's own accounts are enrolled (service role).
  DO $$ BEGIN
    IF to_regclass('public.test_accounts') IS NOT NULL THEN
      INSERT INTO public.test_accounts (user_id) VALUES ('${SEED_POSTER}'), ('${SEED_HELPER}');
    END IF;
  END $$;
  INSERT INTO public.jobs (id, customer_id, title, budget, status, date_needed, start_time, is_seed) VALUES
    ('${SEED_JOB}', '${SEED_POSTER}', 'Test: mow the lawn', 40, 'open', ${at("3 days")}::date, ${at("3 days")}::time, true),
    ('${REAL_JOB}', '${ADMIN}', 'Wash the car', 40, 'open', ${at("3 days")}::date, ${at("3 days")}::time, false);
`);

const lists = async () => ({
  browse: await ids(`SELECT id FROM public.open_jobs_browse`),
  ranked: await ids(`SELECT id FROM public.get_ranked_open_jobs(50, 0, true, NULL, NULL, NULL)`),
  map: await ids(`SELECT id FROM public.get_open_jobs_for_map()`),
});
const has = (l, id) => [l.browse, l.ranked, l.map].every((x) => x.includes(id));
const hasNone = (l, id) => [l.browse, l.ranked, l.map].every((x) => !x.includes(id));

await as(SEED_HELPER);
let l = await lists();
check("T1 a test account lists the test job in browse, the ranked feed and the map", has(l, SEED_JOB) && has(l, REAL_JOB), JSON.stringify(l));
let err = await attempt(`SELECT public.apply_to_job('${SEED_JOB}', 'I can mow')`);
await server();
await db.exec(`DELETE FROM public.applications`);
await as(SEED_HELPER);
const err2 = await attempt(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${SEED_JOB}', '${SEED_HELPER}', 'pending')`);
check("T2 a test account applies to the test job (apply_to_job and a direct insert)", !err && !err2, `${err} | ${err2}`);

await as(REAL);
l = await lists();
check("R1 a real person lists no test job (browse, ranked, map), and still the real one", hasNone(l, SEED_JOB) && has(l, REAL_JOB), JSON.stringify(l));
err = await attempt(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${SEED_JOB}', '${REAL}', 'pending')`);
check("R2 a real person's application to the test job is refused", /job_not_available|not available|no longer/i.test(err), err || "accepted");

await as(ADMIN);
l = await lists();
check("R3 an admin lists no test job (the owner sees what the public sees)", hasNone(l, SEED_JOB), JSON.stringify(l));

// No client can enrol itself (lh-authz-rls re-review of 55904235c).
await as(SELF_SEEDED);
await db.exec("SET ROLE authenticated"); // `as` only sets the JWT claims; the grant check needs the real role
const enrolAuth = await attempt(`INSERT INTO public.test_accounts (user_id) VALUES ('${SELF_SEEDED}')`);
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SET ROLE anon;`);
const enrolAnon = await attempt(`INSERT INTO public.test_accounts (user_id) VALUES ('${SELF_SEEDED}')`);
check("R6 neither a signed-in member nor anon can write public.test_accounts",
  /permission denied|does not exist/.test(enrolAuth) && /permission denied|does not exist/.test(enrolAnon), `${enrolAuth || "inserted"} | ${enrolAnon || "inserted"}`);

// lh-authz-rls review of 40adb6ade, finding 1: is_seed alone is reachable by a sign-up.
await as(SELF_SEEDED);
l = await lists();
err = await attempt(`INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${SEED_JOB}', '${SELF_SEEDED}', 'pending')`);
check("R5 an is_seed account that is NOT enrolled (a mailinator sign-up) gets no carve-out: no test job listed, application refused",
  hasNone(l, SEED_JOB) && /job_not_available|not available|no longer/i.test(err), `${JSON.stringify(l)} | ${err || "accepted"}`);

await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', 'anon', false); SET ROLE anon;`);
const teaser = await ids(`SELECT id FROM public.get_public_open_jobs(50)`);
const anonBrowse = await ids(`SELECT id FROM public.open_jobs_browse`);
check("R4 anon: the landing teaser and browse list no test job", !teaser.includes(SEED_JOB) && !anonBrowse.includes(SEED_JOB) && anonBrowse.includes(REAL_JOB),
  JSON.stringify({ teaser, anonBrowse }));

await server();
await db.exec(`UPDATE public.platform_settings SET feature_flags = '{"seed_jobs_hidden_publicly": false}'`);
await as(REAL);
l = await lists();
check("K1 switch off: a real person lists the test job again", has(l, SEED_JOB), JSON.stringify(l));

await db.exec("RESET ROLE");
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // T1 and T2 are RED on the old gates; every R and K check holds either way.
  const expected = 2;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
