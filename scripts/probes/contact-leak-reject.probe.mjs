// Probe: 20260913020635_reject_contact_leaks_in_jobs_and_bios.sql, in real Postgres.
//
// Proves, in order:
//   1. the OLD contact_leak_reason (live body, pg_get_functiondef 2026-09-12)
//      misses `jane@my-domain.com`; the migration's version catches it
//   2. the migration applies 3x without error (replay-safe)
//   3. a phone number in a job insert is rejected with check_violation (23514)
//      and a bio update the same; clean text passes on both
//   4. an unrelated UPDATE on a row that already holds a leak is NOT blocked
//
// NOT a vitest test: pglite is deliberately not a dependency (CLAUDE.md):
//   mkdir -p ~/.lh-pglite-probe && cd ~/.lh-pglite-probe && npm i @electric-sql/pglite
//   node scripts/probes/contact-leak-reject.probe.mjs
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}
import { readFileSync } from "node:fs";

const MIG = new URL("../../supabase/migrations/20260913020635_reject_contact_leaks_in_jobs_and_bios.sql", import.meta.url).pathname;
const migration = readFileSync(MIG, "utf8");

// The email branch as it was LIVE before this migration; the rest of the body
// is identical, so only that line differs.
const OLD_EMAIL = String.raw`'[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}'`;
const NEW_EMAIL = String.raw`'[a-z0-9._]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'`;
if (!migration.includes(NEW_EMAIL)) throw new Error("migration does not contain the widened email pattern");
const fnStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.contact_leak_reason");
const fnEnd = migration.indexOf("$function$;", fnStart) + "$function$;".length;
const oldFn = migration.slice(fnStart, fnEnd).replace(NEW_EMAIL, OLD_EMAIL);

const db = new PGlite();
const q = (sql, params) => db.query(sql, params);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// Prod-shaped minimum: only the columns the triggers touch, plus a status
// column for the unrelated-update case. Roles the GRANT/REVOKE names.
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE TABLE public.jobs (id serial PRIMARY KEY, title text, description text, status text DEFAULT 'open');
  CREATE TABLE public.profiles (id serial PRIMARY KEY, user_id uuid, bio text, full_name text);
`);

// 1. old vs new on the hyphenated domain
await db.exec(oldFn);
const oldMiss = (await q(`select public.contact_leak_reason($1) r`, ["reach me jane@my-domain.com"])).rows[0].r;
check("OLD function misses jane@my-domain.com", oldMiss === null, `got ${JSON.stringify(oldMiss)}`);
const oldHit = (await q(`select public.contact_leak_reason($1) r`, ["email me jane.doe@gmail.com"])).rows[0].r;
check("OLD function still catches jane.doe@gmail.com", oldHit === "Email address detected", `got ${JSON.stringify(oldHit)}`);

// 2. apply the migration 3x
for (let i = 1; i <= 3; i++) {
  try {
    await db.exec(migration);
    check(`migration applies (pass ${i})`, true);
  } catch (e) {
    check(`migration applies (pass ${i})`, false, e.message);
  }
}
const newHit = (await q(`select public.contact_leak_reason($1) r`, ["reach me jane@my-domain.com"])).rows[0].r;
check("NEW function catches jane@my-domain.com", newHit === "Email address detected", `got ${JSON.stringify(newHit)}`);
const sub = (await q(`select public.contact_leak_reason($1) r`, ["me@mail.example.co.uk"])).rows[0].r;
check("NEW function catches a subdomain email", sub === "Email address detected", `got ${JSON.stringify(sub)}`);
const clean = (await q(`select public.contact_leak_reason($1) r`, ["Need help hauling a couch on Saturday, run r1k2j3m4"])).rows[0].r;
check("NEW function passes clean text with a base36 run id", clean === null, `got ${JSON.stringify(clean)}`);
const acl = (await q(`select proacl::text a from pg_proc where proname='contact_leak_reason'`)).rows[0].a;
check("proacl: anon absent, authenticated + service_role present", !/anon=/.test(acl) && /authenticated=X/.test(acl) && /service_role=X/.test(acl), acl);
const trg = (await q(`select count(*)::int n from pg_trigger where tgname in ('trg_reject_contact_leak_in_job','trg_reject_contact_leak_in_profile')`)).rows[0].n;
check("exactly the two triggers exist after 3 applies", trg === 2, `n=${trg}`);

// 3. rejects and passes
const expectReject = async (name, sql, params) => {
  try {
    await q(sql, params);
    check(name, false, "write succeeded");
  } catch (e) {
    check(name, e.code === "23514", `code=${e.code} msg=${e.message}`);
  }
};
await expectReject("job insert with a phone number is rejected (23514)", `insert into public.jobs(title, description) values ($1,$2)`, ["E2E automated lifecycle x", "Regular job text. reach me at 504-555-0100 anytime"]);
await expectReject("job insert with a numeric run id in the TITLE is rejected (why markers went base36)", `insert into public.jobs(title, description) values ($1,$2)`, ["E2E automated lifecycle 1757700000000-local", "clean"]);
await expectReject("job insert with a hyphenated-domain email is rejected", `insert into public.jobs(title, description) values ($1,$2)`, ["Mow my lawn", "email jane@my-domain.com"]);
await q(`insert into public.jobs(title, description) values ($1,$2)`, ["E2E automated lifecycle r1k2j3m4-local", "Need the yard mowed and edged, bags left at the curb."]);
check("clean job insert passes", true);
await q(`insert into public.profiles(bio) values ($1)`, ["Handy with most things around the house."]);
await expectReject("bio update with a phone number is rejected (23514)", `update public.profiles set bio=$1`, ["Experienced helper. Call 504-555-0100 or venmo me."]);
await expectReject("bio update with 'venmo' is rejected", `update public.profiles set bio=$1`, ["venmo me"]);
await q(`update public.profiles set bio=$1`, ["Twelve years of drywall and paint."]);
check("clean bio update passes", true);
await expectReject("job title update with 'text me' is rejected", `update public.jobs set title=$1`, ["text me about this one"]);

// 4. a pre-existing leaky row is not blocked on an unrelated update
await db.exec(`alter table public.jobs disable trigger trg_reject_contact_leak_in_job`);
await q(`insert into public.jobs(title, description) values ($1,$2)`, ["old row", "legacy 504-555-0100"]);
await db.exec(`alter table public.jobs enable trigger trg_reject_contact_leak_in_job`);
try {
  await q(`update public.jobs set status='closed' where title='old row'`);
  check("unrelated UPDATE on a pre-existing leaky row passes", true);
} catch (e) {
  check("unrelated UPDATE on a pre-existing leaky row passes", false, e.message);
}
await expectReject("but changing that row's description to another leak is rejected", `update public.jobs set description=$1 where title='old row'`, ["legacy 504-555-0199"]);

await db.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
