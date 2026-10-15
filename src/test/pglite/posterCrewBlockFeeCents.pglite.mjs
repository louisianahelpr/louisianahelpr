#!/usr/bin/env node
/**
 * PGlite proof for 20261015062926_poster_crew_block_fee_cents (docs/OPEN.md
 * Q1736): a poster reads the cents of the crew block fees owed on each of
 * their OWN jobs (every row but a void one, the sum void-cancelled-payments
 * captures), and nobody else reads anything.
 *
 *   node src/test/pglite/posterCrewBlockFeeCents.pglite.mjs [--before]
 *
 * --before leaves the migration out: the poster has no way to read them (C1
 * RED). Without it the migration is applied 3x (replay) and every check must
 * PASS. Calls run under the REAL anon / authenticated roles (SET ROLE).
 *
 *   C1 the poster reads one row per own job with block fees, void left out   RED before
 *   C2 another signed-in user reads no rows (not even for the poster's jobs)
 *   C3 a signed-in user with no JWT subject reads no rows
 *   C4 anon cannot call it
 *   C5 authenticated still cannot read crew_block_fees itself
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20261015062926_poster_crew_block_fee_cents.sql", import.meta.url),
  "utf8",
);
const BEFORE = process.argv.includes("--before");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), OTHER = U(2), HELPR_A = U(3), HELPR_B = U(4), HELPR_C = U(5);
const CREW = U(101), CREW_ALL_VOID = U(102), CREW_NONE = U(103), OTHERS_CREW = U(104);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, is_group_job boolean, status text);
-- Shape of 20261007073145's ledger: the columns this reads and its checks.
CREATE TABLE public.crew_block_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
  helper_id uuid, slot_no int NOT NULL, share_basis_cents int NOT NULL DEFAULT 10000, fee_percent int NOT NULL DEFAULT 25,
  fee_cents int NOT NULL CHECK (fee_cents > 0 AND fee_cents <= share_basis_cents),
  status text NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid', 'failed', 'void')), stripe_transfer_id text,
  CONSTRAINT crew_block_fees_paid_has_transfer CHECK (status <> 'paid' OR stripe_transfer_id IS NOT NULL),
  CONSTRAINT crew_block_fees_one_per_slot UNIQUE (job_id, slot_no));
ALTER TABLE public.crew_block_fees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_block_fees FROM PUBLIC, anon, authenticated;
INSERT INTO public.jobs VALUES ('${CREW}', '${POSTER}', true, 'cancelled'), ('${CREW_ALL_VOID}', '${POSTER}', true, 'cancelled'),
  ('${CREW_NONE}', '${POSTER}', true, 'cancelled'), ('${OTHERS_CREW}', '${OTHER}', true, 'cancelled');
INSERT INTO public.crew_block_fees (job_id, helper_id, slot_no, fee_cents, status, stripe_transfer_id) VALUES
  ('${CREW}', '${HELPR_A}', 1, 2500, 'owed', NULL),
  ('${CREW}', '${HELPR_B}', 2, 5000, 'paid', 'tr_1'),
  ('${CREW}', '${HELPR_C}', 3, 1200, 'failed', NULL),
  ('${CREW}', NULL, 4, 900, 'void', NULL),
  ('${CREW_ALL_VOID}', NULL, 1, 2500, 'void', NULL),
  ('${OTHERS_CREW}', '${HELPR_A}', 1, 3000, 'owed', NULL);
`;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(SCHEMA);
if (!BEFORE) for (let i = 0; i < 3; i++) await db.exec(MIGRATION);

async function as(role, uid, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`);
  try {
    return { rows: (await db.query(sql)).rows };
  } catch (e) {
    return { error: String(e.message ?? e) };
  } finally {
    await db.exec("RESET ROLE;");
  }
}
const CALL = "SELECT job_id, fee_cents::int AS fee_cents FROM public.poster_crew_block_fee_cents() ORDER BY job_id";
const show = (r) => (r.rows ? JSON.stringify(r.rows) : `error: ${r.error}`);

const mine = await as("authenticated", POSTER, CALL);
check("C1 the poster reads one row per own job with block fees (owed + paid + failed), void left out",
  !!mine.rows && mine.rows.length === 1 && mine.rows[0].job_id === CREW && mine.rows[0].fee_cents === 2500 + 5000 + 1200, show(mine));
const theirs = await as("authenticated", OTHER, CALL);
check("C2 another signed-in user reads only their own job, never the poster's",
  !!theirs.rows && theirs.rows.length === 1 && theirs.rows[0].job_id === OTHERS_CREW && theirs.rows[0].fee_cents === 3000, show(theirs));
const nobody = await as("authenticated", null, CALL);
check("C3 no JWT subject reads no rows", !!nobody.rows && nobody.rows.length === 0, show(nobody));
const anon = await as("anon", null, CALL);
check("C4 anon cannot call it", !!anon.error && /permission denied/.test(anon.error), show(anon));
const raw = await as("authenticated", POSTER, "SELECT count(*) FROM public.crew_block_fees");
check("C5 authenticated still cannot read crew_block_fees itself", !!raw.error && /permission denied/.test(raw.error), show(raw));

console.log(failures ? `${BEFORE ? "BEFORE" : "AFTER"}: ${failures} FAILED` : `${BEFORE ? "BEFORE" : "AFTER"}: ALL PASS`);
process.exit(failures ? 1 : 0);
