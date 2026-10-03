#!/usr/bin/env node
/**
 * PGlite proof for 20261003192708_deleted_jobs_log (docs/OPEN.md Q1149):
 * every job delete, by any role and any path, leaves one deleted_jobs_log row
 * carrying the job's seed flag, and nobody but service_role can touch the log.
 *
 *   node src/test/pglite/deletedJobsLog.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/deletedJobsLog.pglite.mjs   # RED: no log
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Applies the
 * migration 3x (replay-safety).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const Q1149 = "20261003192708_deleted_jobs_log.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  -- prod's service_role has rolbypassrls=true; without it the reader check passes reading 0 rows.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, is_seed boolean, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (bucket_id text, name text, owner_id text, created_at timestamptz NOT NULL DEFAULT now());
-- The Q807 gate the migration attaches (20261002052502 calls it the same way);
-- a no-op here, it only has to exist.
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- Grant new tables to anon and authenticated by default (prod no longer does
-- for tables, but did): the migration's REVOKE must hold either way.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
GRANT ALL ON public.jobs TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Backfill fixtures (jobs deleted BEFORE the trigger existed): a seed slot,
-- a slot with one non-seed upload, and a live user's folder.
INSERT INTO public.profiles VALUES ('aaaaaaaa-0000-4000-8000-000000000001', true), ('bbbbbbbb-0000-4000-8000-000000000002', false);
INSERT INTO storage.objects (bucket_id, name, owner_id, created_at) VALUES
  ('proof-photos', '44444444-4444-4444-8444-444444444444/after-1.png', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '3 days'),
  ('message-attachments', '44444444-4444-4444-8444-444444444444/aaaaaaaa-0000-4000-8000-000000000001/m.png', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('job-photos', '55555555-5555-4555-8555-555555555555/x.png', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '3 days'),
  ('job-photos', '55555555-5555-4555-8555-555555555555/y.png', 'bbbbbbbb-0000-4000-8000-000000000002', now() - interval '3 days'),
  ('proof-photos', 'bbbbbbbb-0000-4000-8000-000000000002/e2e-proof-test.jpg', 'aaaaaaaa-0000-4000-8000-000000000001', now() - interval '30 days');
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q1149));
}
const has = async (q) => (await db.query(q)).rows;
const logExists = (await has(`SELECT to_regclass('public.deleted_jobs_log') IS NOT NULL AS ok`))[0].ok;
check("the log table exists after 3 applies", logExists);

const seed = "11111111-1111-4111-8111-111111111111";
const real = "22222222-2222-4222-8222-222222222222";
const nullSeed = "33333333-3333-4333-8333-333333333333";
await db.exec(`INSERT INTO public.jobs (id, title, is_seed) VALUES ('${seed}', 'seed', true), ('${real}', 'real', false), ('${nullSeed}', 'legacy', null)`);

// 1. A delete by an ordinary authenticated caller (a poster deleting their own job via PostgREST) is logged.
await db.exec(`SET ROLE authenticated; DELETE FROM public.jobs WHERE id = '${seed}'; RESET ROLE;`).catch((e) => check("authenticated delete runs", false, e.message));
const r1 = logExists ? await has(`SELECT is_seed FROM public.deleted_jobs_log WHERE job_id = '${seed}'`) : [];
check("a seed job deleted by authenticated is logged with is_seed=true", r1.length === 1 && r1[0].is_seed === true, JSON.stringify(r1));

// 2. A service-role / SQL delete of a real job is logged as NOT seed.
await db.exec(`DELETE FROM public.jobs WHERE id = '${real}'`);
const r2 = logExists ? await has(`SELECT is_seed FROM public.deleted_jobs_log WHERE job_id = '${real}'`) : [];
check("a real job's delete is logged with is_seed=false", r2.length === 1 && r2[0].is_seed === false, JSON.stringify(r2));

// 3. A NULL is_seed is recorded as false (never as seed).
await db.exec(`DELETE FROM public.jobs WHERE id = '${nullSeed}'`);
const r3 = logExists ? await has(`SELECT is_seed FROM public.deleted_jobs_log WHERE job_id = '${nullSeed}'`) : [];
check("a NULL is_seed is logged as false", r3.length === 1 && r3[0].is_seed === false, JSON.stringify(r3));

// 3b. The job's lifetime is logged, and "not seed" is sticky: a later seed
//     delete of a reused id cannot flip it.
const lt = logExists ? await has(`SELECT job_created_at IS NOT NULL AS has_created FROM public.deleted_jobs_log WHERE job_id = '${real}'`) : [];
check("the deleted job's created_at is logged", lt[0]?.has_created === true, JSON.stringify(lt));
await db.exec(`INSERT INTO public.jobs (id, title, is_seed) VALUES ('${real}', 'reused id', true)`);
await db.exec(`DELETE FROM public.jobs WHERE id = '${real}'`);
const sticky = logExists ? await has(`SELECT is_seed FROM public.deleted_jobs_log WHERE job_id = '${real}'`) : [];
check("a reused id deleted as seed does not flip a 'not seed' row", sticky[0]?.is_seed === false, JSON.stringify(sticky));

// 3d. Retention in the database: a row past 90 days is dropped by the next
//     job delete, a recent one is kept (the sweep's prune is a second copy).
if (logExists) {
  const stale = "77777777-7777-4777-8777-777777777777"; // not a backfill fixture id
  const fresh = "66666666-6666-4666-8666-666666666666";
  await db.exec(`INSERT INTO public.deleted_jobs_log (job_id, is_seed, job_created_at, deleted_at) VALUES ('${stale}', true, now() - interval '100 days', now() - interval '91 days')`);
  await db.exec(`INSERT INTO public.jobs (id, title, is_seed) VALUES ('${fresh}', 'fresh', true)`);
  await db.exec(`DELETE FROM public.jobs WHERE id = '${fresh}'`);
  const kept = await has(`SELECT job_id::text FROM public.deleted_jobs_log WHERE job_id IN ('${stale}', '${fresh}') ORDER BY 1`);
  check("a log row past 90 days is pruned by the next job delete; the new one is kept", JSON.stringify(kept) === JSON.stringify([{ job_id: fresh }]), JSON.stringify(kept));
}

// 3c. The one-time backfill: the all-seed slot only.
const bf = logExists ? await has(`SELECT job_id::text AS id, is_seed, job_created_at IS NOT NULL AS has_from FROM public.deleted_jobs_log WHERE job_id IN ('44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', 'bbbbbbbb-0000-4000-8000-000000000002') ORDER BY 1`) : [];
check("the backfill logs the all-seed slot, with its first upload as the window start", JSON.stringify(bf) === JSON.stringify([{ id: "44444444-4444-4444-8444-444444444444", is_seed: true, has_from: true }]), JSON.stringify(bf));

// 4. Nobody but service_role can read or write the log.
for (const role of ["anon", "authenticated"]) {
  let readable = true;
  try { await db.exec(`SET ROLE ${role}; SELECT * FROM public.deleted_jobs_log; RESET ROLE;`); } catch { readable = false; await db.exec("RESET ROLE"); }
  check(`${role} cannot read the log`, !readable);
  let writable = true;
  // Every NOT NULL column is supplied, so a refusal can only be the privilege.
  try { await db.exec(`SET ROLE ${role}; INSERT INTO public.deleted_jobs_log (job_id, is_seed, job_created_at) VALUES (gen_random_uuid(), true, now()); RESET ROLE;`); } catch { writable = false; await db.exec("RESET ROLE"); }
  check(`${role} cannot forge a seed entry`, !writable);
}
let srRows = -1;
try {
  await db.exec("SET ROLE service_role");
  srRows = Number((await db.query("SELECT count(*)::int AS n FROM public.deleted_jobs_log")).rows[0].n);
} catch { srRows = -1; }
await db.exec("RESET ROLE");
check("service_role reads the log's rows (the sweep's reader)", srRows > 0, `rows=${srRows}`);

// 5. CI replays on supabase/postgres 15.8.1.060, whose storage.objects has no
//    owner_id: the migration must apply there (the backfill skips itself).
if (process.env.NEW_MIGRATION !== "skip") {
  const ci = new PGlite();
  await ci.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, is_seed boolean, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (id uuid, bucket_id text, name text, owner uuid, created_at timestamptz, updated_at timestamptz, last_accessed_at timestamptz, metadata jsonb);
    CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  `);
  let ciErr = null;
  try { await ci.exec(mig(Q1149)); } catch (e) { ciErr = e.message; }
  check("the migration applies on CI's replay image (storage.objects without owner_id)", ciErr === null, ciErr ?? "");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
