#!/usr/bin/env node
/**
 * PGlite proof for 20261015000241_drop_unused_user_strikes (Q1682).
 *
 *   node src/test/pglite/dropUserStrikes.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/dropUserStrikes.pglite.mjs   # RED: the table and its readers stay
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 *
 * Fixture: the two functions that read the table, restated from their newest
 * migrations (20261007113957 export_my_data, 20261007044702
 * purge_old_seed_data; both md5(prosrc)-identical to prod on 2026-10-14), the
 * table with prod's shape, and the jobs / profiles / seed_purge_runs columns
 * the seed purge reads. The migration is applied 3x (replay safety), then:
 *   - the table is gone;
 *   - neither function's body names it any more;
 *   - both keep EXECUTE for service_role only (anon, authenticated refused);
 *   - the seed purge still runs and deletes an old seed job after the drop.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const NEW = mig("20261015000241_drop_unused_user_strikes.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running without the migration (expect FAILs)`);

/** The CREATE OR REPLACE FUNCTION statement for `fn` in a migration file, any dollar tag. */
function fnStatement(src, fn) {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  if (i < 0) throw new Error(`${fn} not found`);
  const m = /AS (\$[A-Za-z_]*\$)/g;
  m.lastIndex = i;
  const hit = m.exec(src);
  const end = src.indexOf(hit[1], hit.index + hit[0].length);
  return src.slice(i, src.indexOf(";", end) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  END $$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
    payment_status text, status text, customer_id uuid, parent_job_id uuid
  );
  CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean NOT NULL DEFAULT false);
  CREATE TABLE public.seed_purge_runs (id bigserial PRIMARY KEY, ran_at timestamptz NOT NULL DEFAULT now(), dry_run boolean, result jsonb);
  -- prod's shape (information_schema, 2026-10-14): 0 rows there.
  CREATE TABLE public.user_strikes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, issued_by uuid,
    reason text, job_id uuid REFERENCES public.jobs(id), created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.user_strikes ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Users can view own strikes" ON public.user_strikes FOR SELECT USING (true);
`);
await db.exec(fnStatement(mig("20261007113957_booked_job_detail_change_request.sql"), "export_my_data"));
await db.exec(fnStatement(mig("20261007044702_seed_purge_clears_gift_residue.sql"), "purge_old_seed_data"));
await db.exec(`
  REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.purge_old_seed_data(boolean, interval, integer) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.purge_old_seed_data(boolean, interval, integer) TO service_role;
`);

if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    await db.exec(NEW);
    console.log(`applied ${i}x`);
  }
}

const one = async (q) => (await db.query(q)).rows[0];
check("the table is gone", (await one(`SELECT to_regclass('public.user_strikes') AS t`)).t === null);
for (const sig of ["public.export_my_data(uuid)", "public.purge_old_seed_data(boolean,interval,integer)"]) {
  const r = await one(`SELECT prosrc, has_function_privilege('anon', oid, 'EXECUTE') AS anon,
                              has_function_privilege('authenticated', oid, 'EXECUTE') AS authd,
                              has_function_privilege('service_role', oid, 'EXECUTE') AS svc
                         FROM pg_proc WHERE oid = '${sig}'::regprocedure`);
  check(`${sig} no longer names the table`, !/user_strikes/.test(r.prosrc));
  check(`${sig} EXECUTE: service_role only`, r.svc && !r.anon && !r.authd, `anon=${r.anon} authenticated=${r.authd} service_role=${r.svc}`);
}

// The seed purge still works after the drop: an old seed job with no money is deleted.
await db.exec(`
  INSERT INTO public.profiles (user_id, is_seed) VALUES ('11111111-0000-4000-8000-000000000001', true);
  INSERT INTO public.jobs (id, is_seed, created_at, payment_status, status, customer_id)
    VALUES ('22222222-0000-4000-8000-000000000001', true, now() - interval '30 days', 'unpaid', 'open', '11111111-0000-4000-8000-000000000001');
`);
const run = await one(`SELECT public.purge_old_seed_data(false, interval '14 days', 10) AS r`);
check("the seed purge deletes an old seed job after the drop", run.r.jobs_deleted === 1, JSON.stringify(run.r.jobs_skipped));

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
