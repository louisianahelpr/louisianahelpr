#!/usr/bin/env node
/**
 * PGlite proof for 20261012070009_crew_closed_spot_count (docs/OPEN.md Q1498):
 * the poster can read how many of their crew's spots a block closed, and
 * nobody else can.
 *
 *   PGLITE_DIR=~/.lh-pglite node src/test/pglite/crewClosedSpotCount.pglite.mjs [--before]
 *
 * --before leaves the migration out: the poster has no way to read the count
 * (C1 RED). Without it the migration is applied 3x (replay) and every check
 * must PASS. Calls run under the REAL anon / authenticated roles (SET ROLE).
 *
 *   C1 the job's poster reads the closed-spot count (2)               RED before
 *   C2 another signed-in user reads 0 for the same job
 *   C3 anon cannot call it
 *   C4 a job with no closed spot, and a job that does not exist, read 0
 *   C5 authenticated still cannot read crew_block_fees itself
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIGRATION = readFileSync(
  new URL("../../../supabase/migrations/20261012070009_crew_closed_spot_count.sql", import.meta.url),
  "utf8",
);
const BEFORE = process.argv.includes("--before");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), OTHER = U(2), HELPR = U(3);
const CREW = U(101), CREW_CLEAN = U(102), MISSING = U(199);

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
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, is_group_job boolean, helpers_needed int, status text);
-- Shape of 20261007073145's ledger, the columns this reads plus its uniqueness.
CREATE TABLE public.crew_block_fees (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
  helper_id uuid, slot_no int NOT NULL, fee_cents int NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'owed',
  CONSTRAINT crew_block_fees_one_per_slot UNIQUE (job_id, slot_no));
ALTER TABLE public.crew_block_fees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_block_fees FROM PUBLIC, anon, authenticated;
INSERT INTO public.jobs VALUES ('${CREW}', '${POSTER}', true, 4, 'accepted'), ('${CREW_CLEAN}', '${POSTER}', true, 3, 'accepted');
INSERT INTO public.crew_block_fees (job_id, helper_id, slot_no, fee_cents) VALUES ('${CREW}', '${HELPR}', 2, 500), ('${CREW}', NULL, 3, 0);
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
const count = (r) => (r.rows ? r.rows[0]?.n : `error: ${r.error}`);

const mine = await as("authenticated", POSTER, `SELECT public.crew_closed_spot_count('${CREW}') AS n`);
check("C1 the poster reads their crew's closed-spot count", count(mine) === 2, JSON.stringify(count(mine)));
const theirs = await as("authenticated", OTHER, `SELECT public.crew_closed_spot_count('${CREW}') AS n`);
check("C2 another signed-in user reads 0", count(theirs) === 0, JSON.stringify(count(theirs)));
const guest = await as("anon", null, `SELECT public.crew_closed_spot_count('${CREW}') AS n`);
check("C3 anon cannot call it", !!guest.error && /permission denied/i.test(guest.error), JSON.stringify(guest.error ?? guest.rows));
const clean = await as("authenticated", POSTER, `SELECT public.crew_closed_spot_count('${CREW_CLEAN}') AS n`);
const missing = await as("authenticated", POSTER, `SELECT public.crew_closed_spot_count('${MISSING}') AS n`);
check("C4 no closed spot / no such job read 0", count(clean) === 0 && count(missing) === 0, `${count(clean)}, ${count(missing)}`);
const raw = await as("authenticated", POSTER, "SELECT count(*) AS n FROM public.crew_block_fees");
check("C5 authenticated still cannot read the ledger", !!raw.error, JSON.stringify(raw.error ?? raw.rows));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
