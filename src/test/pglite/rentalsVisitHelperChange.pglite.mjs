#!/usr/bin/env node
/**
 * Q2080 PGlite proof for 20261106224103_rentals_visit_cleared_on_helper_change: when a repair job's Helpr changes
 * (backs out, or another is hired), the visit time the old Helpr offered (and the tenant's OK of it) is cleared, so
 * neither the request screen, the new Helpr's card (rentals_visit_for_job) nor rentals_confirm_visit reads it.
 *
 *   node src/test/pglite/rentalsVisitHelperChange.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/rentalsVisitHelperChange.pglite.mjs   # RED: the old offer stays
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/rentalsVisitHelperChange.pglite.mjs
 *
 * rentals_visit_for_job is loaded from its NEWEST definition (the reader the new Helpr's card calls); the tables are
 * cut to the columns it and the trigger touch. pglite is loaded from ~/.lh-pglite (CLAUDE.md).
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = readdirSync(MIG_DIR).find((f) => f.endsWith("_rentals_visit_cleared_on_helper_change.sql"));
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
const { newestFunction } = await import("./lib/fixedClock.mjs");

let failures = 0;
const ok = (cond, name, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE FUNCTION public.require_feature(k text) RETURNS void LANGUAGE sql STABLE AS $$ SELECT $$;
GRANT EXECUTE ON FUNCTION public.require_feature(text) TO authenticated;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, helper_confirmed_at timestamptz,
  status text, payment_status text, title text);
CREATE TABLE public.maintenance_requests (id uuid PRIMARY KEY, tenant_id uuid, landlord_id uuid, job_id uuid, status text,
  visit_job_id uuid, visit_proposed_for timestamptz, visit_proposed_at timestamptz, visit_confirmed_at timestamptz,
  updated_at timestamptz);
`);
const reader = newestFunction("rentals_visit_for_job");
await db.exec(reader.stmt);
await db.exec(`GRANT EXECUTE ON FUNCTION public.rentals_visit_for_job(uuid) TO authenticated;`);
if (process.env.NEW_MIGRATION === "skip") console.log("NEW_MIGRATION=skip (expect FAILs)");
else for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const TENANT = "11111111-1111-4111-8111-111111111111";
const LANDLORD = "22222222-2222-4222-8222-222222222222";
const OLD = "33333333-3333-4333-8333-333333333333";
const NEW = "44444444-4444-4444-8444-444444444444";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REQ2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const svc = async (sql, params) => (await db.query(sql, params)).rows;
async function as(uid, sql, params) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql, params)).rows;
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
const seed = async () => {
  await db.exec(`DELETE FROM public.maintenance_requests; DELETE FROM public.jobs;`);
  await svc(`INSERT INTO public.jobs VALUES ($1, $2, $3, now(), 'accepted', 'escrow', 'Fix the sink'), ($4, $2, $3, now(), 'accepted', 'escrow', 'Other')`,
    [JOB, LANDLORD, OLD, JOB2]);
  // The old Helpr offered a time on each job, and the tenant OK'd the first.
  await svc(`INSERT INTO public.maintenance_requests VALUES
      ($1, $2, $3, $4, 'approved', $4, now() + interval '2 days', now(), now(), now()),
      ($5, $2, $3, $6, 'approved', $6, now() + interval '3 days', now(), NULL, now())`,
    [REQ, TENANT, LANDLORD, JOB, REQ2, JOB2]);
};
const offer = async (req) => (await svc(`SELECT visit_job_id, visit_proposed_for, visit_proposed_at, visit_confirmed_at FROM public.maintenance_requests WHERE id = $1`, [req]))[0];
const card = async (uid, job = JOB) => as(uid, `SELECT proposed_for, confirmed_at FROM public.rentals_visit_for_job($1)`, [job]);

{
  await seed();
  const before = await card(OLD);
  ok(Array.isArray(before) && before[0]?.proposed_for != null && before[0]?.confirmed_at != null, "baseline: the old Helpr sees their offer and the OK", JSON.stringify(before));
  await svc(`UPDATE public.jobs SET helper_id = $2, helper_confirmed_at = now() WHERE id = $1`, [JOB, NEW]);
  const o = await offer(REQ);
  ok(o.visit_job_id === null && o.visit_proposed_for === null && o.visit_proposed_at === null && o.visit_confirmed_at === null,
    "another Helpr hired on the job: the old offer and the tenant's OK are cleared", JSON.stringify(o));
  const c = await card(NEW);
  ok(Array.isArray(c) && c.length === 1 && c[0].proposed_for === null && c[0].confirmed_at === null,
    "the new Helpr's card reads no offer", JSON.stringify(c));
  const l = await card(LANDLORD);
  ok(Array.isArray(l) && l[0]?.proposed_for === null, "nor does the landlord's", JSON.stringify(l));
  const other = await offer(REQ2);
  ok(other.visit_job_id === JOB2 && other.visit_proposed_for !== null, "another job's offer is untouched", JSON.stringify(other));
}
{
  await seed();
  await svc(`UPDATE public.jobs SET helper_id = NULL, helper_confirmed_at = NULL WHERE id = $1`, [JOB]);
  const o = await offer(REQ);
  ok(o.visit_job_id === null && o.visit_proposed_for === null, "the Helpr backs out (helper_id cleared): the offer is cleared", JSON.stringify(o));
}
{
  await seed();
  await svc(`UPDATE public.jobs SET status = 'in_progress', helper_confirmed_at = now() WHERE id = $1`, [JOB]);
  const o = await offer(REQ);
  ok(o.visit_job_id === JOB && o.visit_confirmed_at !== null, "the same Helpr moving the job on keeps the offer and the OK", JSON.stringify(o));
  await svc(`UPDATE public.jobs SET helper_id = $2 WHERE id = $1`, [JOB, OLD]);
  const same = await offer(REQ);
  ok(same.visit_job_id === JOB, "rewriting the same helper_id keeps it too", JSON.stringify(same));
}
{
  const fn = await svc(`SELECT has_function_privilege('authenticated', 'public.rentals_clear_visit_on_helper_change()', 'EXECUTE') AS a,
                               has_function_privilege('anon', 'public.rentals_clear_visit_on_helper_change()', 'EXECUTE') AS b`).catch((e) => [{ a: String(e) }]);
  ok(fn[0]?.a === false && fn[0]?.b === false, "the trigger function is not callable by members or signed-out callers", JSON.stringify(fn));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
