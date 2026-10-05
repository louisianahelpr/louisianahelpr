#!/usr/bin/env node
/**
 * PGlite proof for 20261005064908_job_refund_claims (Q1323).
 *
 *   node src/test/pglite/jobRefundClaims.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * is the one column the table references (jobs.id) and a stub of
 * attach_unconfirmed_email_gate(); the migration is applied 3x verbatim, then
 * the CHECK, the cascade and the grants are exercised.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/20261005064908_job_refund_claims.sql", import.meta.url).pathname;
const FIX = readFileSync(MIG, "utf8");

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE TABLE public.jobs (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT NULL::void $$;
`);
for (let i = 0; i < 3; i++) await db.exec(FIX);
check("the migration applies 3x verbatim (replay-safe)", true);

const J = "33333333-0000-0000-0000-000000000001";
await db.exec(`INSERT INTO public.jobs VALUES ('${J}')`);
await db.exec(`INSERT INTO public.job_refund_claims (job_id, claimed_by) VALUES ('${J}', 'admin_refund_general')
  ON CONFLICT (job_id) DO UPDATE SET claimed_by = excluded.claimed_by`);
await db.exec(`INSERT INTO public.job_refund_claims (job_id, claimed_by) VALUES ('${J}', 'cancel_escrow')
  ON CONFLICT (job_id) DO UPDATE SET claimed_by = excluded.claimed_by`);
const rows = (await db.query(`SELECT claimed_by FROM public.job_refund_claims`)).rows;
check("one row per job; a later claim overwrites the holder (upsert)", rows.length === 1 && rows[0].claimed_by === "cancel_escrow", JSON.stringify(rows));

let refused = false;
try { await db.exec(`UPDATE public.job_refund_claims SET claimed_by = 'someone_else'`); } catch { refused = true; }
check("claimed_by is limited to the two claim paths (CHECK)", refused);

await db.exec(`DELETE FROM public.jobs WHERE id = '${J}'`);
const left = (await db.query(`SELECT count(*)::int AS n FROM public.job_refund_claims`)).rows[0].n;
check("a deleted job takes its claim row with it (ON DELETE CASCADE)", left === 0, String(left));

for (const role of ["anon", "authenticated"]) {
  const can = (await db.query(`SELECT has_table_privilege('${role}', 'public.job_refund_claims', 'SELECT') OR has_table_privilege('${role}', 'public.job_refund_claims', 'INSERT') AS x`)).rows[0].x;
  check(`${role} can neither read nor write job_refund_claims`, !can);
}
const rls = (await db.query(`SELECT relrowsecurity AS x FROM pg_class WHERE oid = 'public.job_refund_claims'::regclass`)).rows[0].x;
check("RLS is on (no policy: service role only)", rls === true);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
