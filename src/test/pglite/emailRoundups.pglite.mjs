#!/usr/bin/env node
/**
 * PGlite proof for 20261025182522_application_email_roundup.sql (lead, 2026-10-25).
 *
 * Owner 2026-10-25: applicant emails = the first at once, then at most one
 * roundup every 3 hours; job-match emails = at most one a Louisiana day, the
 * rest in one email the next morning. Measured before: 50 applicant emails to
 * one poster on 10-22, up to 4 job-match emails to one Helpr on 10-21.
 *
 * Run: node src/test/pglite/emailRoundups.pglite.mjs
 * Skip the migration (expect failures): MIGRATION_PATH=/dev/null node ...
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  process.env.MIGRATION_PATH ?? new URL("../../../supabase/migrations/20261025182522_application_email_roundup.sql", import.meta.url).pathname,
  "utf8",
);

let failures = 0;
let passes = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (ok) passes++;
  else failures++;
};
const tryq = async (db, q) => {
  try {
    return { rows: (await db.query(q)).rows, error: null };
  } catch (e) {
    return { rows: [], error: e.message };
  }
};
const asRole = async (db, role, q) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await tryq(db, q);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS vault;
GRANT USAGE ON SCHEMA auth, public, net, vault TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'k');
CREATE TABLE net.sent (url text, body jsonb);
GRANT ALL ON net.sent TO service_role;
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql
  AS $$ INSERT INTO net.sent VALUES (url, body); SELECT 1::bigint $$;
`);
for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const P = "00000000-0000-0000-0000-00000000000a";
const H = "00000000-0000-0000-0000-00000000000b";
await db.exec(`INSERT INTO auth.users VALUES ('${P}'), ('${H}')`);
const svc = (q) => asRole(db, "service_role", q);

// 1. Server-only.
for (const t of ["application_email_state", "job_match_email_state"]) {
  for (const role of ["anon", "authenticated"]) {
    const r = await asRole(db, role, `SELECT count(*) FROM public.${t}`);
    check(`${role} cannot read ${t}`, !!r.error, r.error ?? "read");
  }
}
for (const f of ["application_email_should_wait('" + P + "')", "send_application_roundups(10)", "job_match_email_should_wait('" + H + "')", "send_job_match_roundups(10)"]) {
  const r = await asRole(db, "authenticated", `SELECT public.${f}`);
  check(`authenticated cannot call ${f.split("(")[0]}`, !!r.error, r.error ?? "called");
}

// 2. Applicants: first emails now, the next two wait.
let r = await svc(`SELECT public.application_email_should_wait('${P}') a`);
check("first applicant: email now", r.rows[0]?.a === false, JSON.stringify(r));
r = await svc(`SELECT public.application_email_should_wait('${P}') a, public.application_email_should_wait('${P}') b`);
check("second and third applicant within 3h: wait", r.rows[0]?.a === true && r.rows[0]?.b === true, JSON.stringify(r));
r = await svc(`SELECT public.send_application_roundups(10) n`);
check("no roundup before 3 hours have passed", r.rows[0]?.n === 0, JSON.stringify(r));
await db.exec(`UPDATE public.application_email_state SET last_emailed_at = now() - interval '3 hours 1 minute' WHERE user_id = '${P}'`);
r = await svc(`SELECT public.send_application_roundups(10) n`);
check("after 3 hours: one roundup", r.rows[0]?.n === 1, JSON.stringify(r));
r = await tryq(db, `SELECT body FROM net.sent ORDER BY ctid DESC LIMIT 1`);
const b = r.rows[0]?.body ?? {};
check("the roundup names the count and is an application email", b.type === "application" && /2 more new applicants/.test(b.message ?? "") && b.user_id === P, JSON.stringify(b));
r = await svc(`SELECT public.send_application_roundups(10) n`);
check("a second run sends nothing (claimed)", r.rows[0]?.n === 0, JSON.stringify(r));
r = await svc(`SELECT public.application_email_should_wait('${P}') a`);
check("an applicant right after the roundup waits (3h from the roundup)", r.rows[0]?.a === true, JSON.stringify(r));

// 3. Job matches: one per Louisiana day; the rest next morning.
r = await svc(`SELECT public.job_match_email_should_wait('${H}') a`);
check("first match of the day: email now", r.rows[0]?.a === false, JSON.stringify(r));
r = await svc(`SELECT public.job_match_email_should_wait('${H}') a, public.job_match_email_should_wait('${H}') b, public.job_match_email_should_wait('${H}') c`);
check("matches 2-4 the same day: wait", r.rows[0]?.a && r.rows[0]?.b && r.rows[0]?.c, JSON.stringify(r));
r = await svc(`SELECT public.send_job_match_roundups(10) n`);
check("no roundup the same day", r.rows[0]?.n === 0, JSON.stringify(r));
await db.exec(`UPDATE public.job_match_email_state SET last_emailed_day = last_emailed_day - 1 WHERE user_id = '${H}'`);
r = await svc(`SELECT public.send_job_match_roundups(10) n`);
check("next morning: one roundup", r.rows[0]?.n === 1, JSON.stringify(r));
r = await tryq(db, `SELECT body FROM net.sent ORDER BY ctid DESC LIMIT 1`);
const m = r.rows[0]?.body ?? {};
check("the roundup is a job_match email flagged roundup with the count", m.type === "job_match" && m.roundup === true && /3 more jobs near you/.test(m.message ?? ""), JSON.stringify(m));
r = await svc(`SELECT public.job_match_email_should_wait('${H}') a`);
check("a match later that morning waits for tomorrow (the roundup was today's email)", r.rows[0]?.a === true, JSON.stringify(r));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
