#!/usr/bin/env node
/**
 * Q2081 PGlite proof for 20261107031822_rentals_no_crew_job_from_repair: link_maintenance_request_job refuses a
 * crew (group) job (false, the request stays unlinked) and still links a one-Helpr job, a retry of the same job,
 * and refuses a stranger's job as before.
 *
 *   node src/test/pglite/rentalsNoCrewRepairJob.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/rentalsNoCrewRepairJob.pglite.mjs   # RED: the crew job links
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/rentalsNoCrewRepairJob.pglite.mjs
 *
 * The previous definition (20261017220911) is loaded first, then this migration 3x (replay-safe), so the function
 * under test is the newest one. The tables are cut to the columns it reads. pglite is loaded from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SELF = readdirSync(MIG_DIR).find((f) => f.endsWith("_rentals_no_crew_job_from_repair.sql"));
const MIGRATION = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${SELF}`, "utf8");
const PREVIOUS = readFileSync(`${MIG_DIR}20261017220911_rentals_link_one_live_job.sql`, "utf8");

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
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT EXECUTE ON FUNCTION public.require_feature(text), public.is_caller_banned() TO authenticated;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, status text, payment_status text,
  stripe_session_id text, is_group_job boolean NOT NULL DEFAULT false);
CREATE TABLE public.maintenance_requests (id uuid PRIMARY KEY, landlord_id uuid, tenant_id uuid, job_id uuid,
  status text, updated_at timestamptz);
`);
await db.exec(PREVIOUS);
if (process.env.NEW_MIGRATION === "skip") console.log("NEW_MIGRATION=skip (expect FAILs)");
else for (let i = 0; i < 3; i++) await db.exec(MIGRATION); // replay-safe

const LANDLORD = "22222222-2222-4222-8222-222222222222";
const STRANGER = "55555555-5555-4555-8555-555555555555";
const TENANT = "11111111-1111-4111-8111-111111111111";
const CREW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOLO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHERS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQ = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
  await svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status, is_group_job) VALUES
      ($1, $2, 'open', 'unpaid', true), ($3, $2, 'open', 'unpaid', false), ($4, $5, 'open', 'unpaid', false)`,
    [CREW, LANDLORD, SOLO, OTHERS, STRANGER]);
  await svc(`INSERT INTO public.maintenance_requests VALUES ($1, $2, $3, NULL, 'approved', now())`, [REQ, LANDLORD, TENANT]);
};
const link = (uid, job) => as(uid, `SELECT public.link_maintenance_request_job($1, $2) AS ok`, [REQ, job]);
const linked = async () => (await svc(`SELECT job_id FROM public.maintenance_requests WHERE id = $1`, [REQ]))[0].job_id;

{
  await seed();
  const r = await link(LANDLORD, CREW);
  ok(Array.isArray(r) && r[0]?.ok === false, "a crew (group) job is refused (false)", JSON.stringify(r));
  ok((await linked()) === null, "and the request stays unlinked", String(await linked()));
}
{
  await seed();
  const r = await link(LANDLORD, SOLO);
  ok(Array.isArray(r) && r[0]?.ok === true && (await linked()) === SOLO, "a one-Helpr job still links", JSON.stringify(r));
  const again = await link(LANDLORD, SOLO);
  ok(Array.isArray(again) && again[0]?.ok === true, "a retry of the same job is still true", JSON.stringify(again));
  const crewAfter = await link(LANDLORD, CREW);
  ok(Array.isArray(crewAfter) && crewAfter[0]?.ok === false && (await linked()) === SOLO,
    "a crew job never replaces the linked one", JSON.stringify(crewAfter));
}
{
  await seed();
  await svc(`UPDATE public.jobs SET is_group_job = false WHERE id = $1`, [CREW]);
  const r = await link(LANDLORD, CREW);
  ok(Array.isArray(r) && r[0]?.ok === true, "the same job as a one-Helpr job links (the refusal is the crew flag only)", JSON.stringify(r));
}
{
  await seed();
  const r = await link(LANDLORD, OTHERS);
  ok(r?.error?.includes("not your open job"), "someone else's job is still refused", JSON.stringify(r));
}
{
  const g = await svc(`SELECT has_function_privilege('anon', 'public.link_maintenance_request_job(uuid, uuid)', 'EXECUTE') AS anon,
                              has_function_privilege('authenticated', 'public.link_maintenance_request_job(uuid, uuid)', 'EXECUTE') AS member`);
  ok(g[0].anon === false && g[0].member === true, "grants restated: members only, never signed-out callers", JSON.stringify(g));
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
