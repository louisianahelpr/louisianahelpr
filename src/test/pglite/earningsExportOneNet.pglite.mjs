#!/usr/bin/env node
/**
 * PGlite proof for 20261007145338_earnings_export_one_net (docs/OPEN.md Q1379;
 * finding: lh-money-escrow@d0933e1b3#3).
 *
 *   npx tsx src/test/pglite/earningsExportOneNet.pglite.mjs [--replay] [--before]
 *
 * The export is first loaded from its EFFECTIVE definition before this
 * migration (src/test/helpers/effectiveFunctionDefs.ts). With --before the
 * migration is NOT applied and the red checks below must FAIL; without it the
 * migration is applied (3x with --replay) and every check must PASS. Stub (not
 * under test): is_category_taxable.
 *
 *   E1 a crew row: gross includes the urgent share (paid + recorded fee)
 *   E2 a single job with a paid ledger row: net is what was PAID, not budget less 10%
 *   E3 a single job released before the ledger keeps the old recomputation (pin, green both ways)
 *   E4 on every ledger row, gross - fee = net
 *   E5 a partial reversal later won: net is the full payout (kept part + re-pay row)
 *   E6 a crew member's partial reversal lost: the kept part stays in the export
 *   E7 a legacy crew lead in jobs.helper_id is listed once, not twice
 * (E5-E7 from the lh-money-escrow review of this migration.)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261007145338_earnings_export_one_net.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = U(1), M2 = U(2), P = U(11);
const CREW = U(101), SOLO = U(102), LEGACY = U(103), PART = U(104), CREWLOST = U(105), LEAD = U(106);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, parish text, category text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  payment_status text, budget numeric, urgent_fee numeric, helper_fee_percent numeric, sales_tax_amount numeric,
  helper_completed_at timestamptz, poster_completed_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, slot_no integer, share_cents integer, helper_completed_at timestamptz,
  poster_confirmed_completion_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  amount_cents integer, platform_fee_cents integer, status text, metadata jsonb DEFAULT '{}'::jsonb);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION public.is_category_taxable(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

${["has_role", "get_helper_earnings_export"].map(fnStmt).join("\n\n")}
`;

const db = new PGlite();
const all = async (sql) => (await db.query(sql)).rows;
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
  console.log(`--before: ${THIS} NOT applied (the red checks must FAIL)`);
}

// CREW: $200 budget, $20 urgent bonus, two members. H's slot: $100 share + $10
// urgent share - $10 fee - $2 onboarding fee = $98 paid, fee $10 recorded.
// SOLO: $200 budget at a 15% fee + $20 urgent: paid $190, fee $30 recorded.
// LEGACY: $100 released before the ledger, no payout row.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, helper_id, title, category, status, is_group_job, helpers_needed, payment_status,
                           budget, urgent_fee, helper_fee_percent, sales_tax_amount, poster_completed_at) VALUES
    ('${CREW}', '${P}', NULL, 'Crew', 'moving', 'completed', true, 2, 'released', 200, 20, 10, 0, now() - interval '3 days'),
    ('${SOLO}', '${P}', '${H}', 'Solo', 'moving', 'completed', false, 1, 'released', 200, 20, 15, 0, now() - interval '2 days'),
    ('${LEGACY}', '${P}', '${H}', 'Legacy', 'moving', 'completed', false, 1, 'released', 100, 0, NULL, 0, now() - interval '1 day');
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES
    ('${CREW}', '${H}', 0, 10000), ('${CREW}', '${M2}', 1, 10000);
  INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status) VALUES
    ('${CREW}', '${H}', 9800, 1000, 'paid'),
    ('${SOLO}', '${H}', 19000, 3000, 'paid');
  -- PART: $190 paid, $50 of it reversed by a dispute, then won: the original
  -- row is 'reversed' (amount_reversed 5000) and a re-pay row of $50 is paid.
  INSERT INTO public.jobs (id, customer_id, helper_id, title, category, status, is_group_job, helpers_needed, payment_status,
                           budget, urgent_fee, helper_fee_percent, sales_tax_amount, poster_completed_at) VALUES
    ('${PART}', '${P}', '${H}', 'Part', 'moving', 'completed', false, 1, 'released', 200, 20, 15, 0, now() - interval '4 days'),
    ('${CREWLOST}', '${P}', NULL, 'CrewLost', 'moving', 'completed', true, 2, 'released', 200, 0, 10, 0, now() - interval '5 days'),
    ('${LEAD}', '${P}', '${H}', 'Lead', 'moving', 'completed', true, 2, 'released', 200, 0, 10, 0, now() - interval '6 days');
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES
    ('${CREWLOST}', '${H}', 0, 10000), ('${LEAD}', '${H}', 0, 10000);
  INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
    ('${PART}', '${H}', 19000, 3000, 'reversed', '{"amount_reversed_cents": 5000, "fully_reversed": false}'),
    ('${PART}', '${H}', 5000, 789, 'paid', '{"source": "chargeback-repay"}'),
    -- CREWLOST: $90 paid, $45 reversed, dispute lost: no re-pay row.
    ('${CREWLOST}', '${H}', 9000, 1000, 'reversed', '{"amount_reversed_cents": 4500, "fully_reversed": false}'),
    ('${LEAD}', '${H}', 9000, 1000, 'paid', '{}');
  SELECT set_config('request.jwt.claim.sub', '${H}', false);
`);

const rows = await all(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`);
const by = (id) => rows.find((r) => r.job_id === id);
const n = (v) => Number(v);
const crew = by(CREW), solo = by(SOLO), legacy = by(LEGACY);
check("E1 a crew row's gross includes the urgent share: 108 = paid 98 + fee 10",
  n(crew?.gross_budget) === 108 && n(crew?.platform_fee) === 10 && n(crew?.net_payout) === 98, JSON.stringify(crew ?? null));
check("E2 a single job's net is what was PAID (190), gross 220, fee 30 (not budget less a default 10%)",
  n(solo?.gross_budget) === 220 && n(solo?.platform_fee) === 30 && n(solo?.net_payout) === 190, JSON.stringify(solo ?? null));
const legacyOk = n(legacy?.gross_budget) === 100 && n(legacy?.platform_fee) === 10 && n(legacy?.net_payout) === 90;
if (BEFORE) console.log(`INFO  E3 (legacy pin, green both ways)  ${legacyOk}`);
else check("E3 a single job released before the ledger keeps the old recomputation (100 / 10 / 90)", legacyOk, JSON.stringify(legacy ?? null));
const ledgerRows = [crew, solo, by(PART), by(CREWLOST)].filter(Boolean);
check("E4 on every ledger row, gross - fee = net",
  ledgerRows.length === 4 && ledgerRows.every((r) => Math.abs(n(r.gross_budget) - n(r.platform_fee) - n(r.net_payout)) < 0.005),
  JSON.stringify(ledgerRows.map((r) => [r.gross_budget, r.platform_fee, r.net_payout])));

const part = by(PART);
check("E5 a partial reversal later won: net 190 (140 kept + 50 re-paid), fee 30, gross 220",
  n(part?.net_payout) === 190 && n(part?.platform_fee) === 30 && n(part?.gross_budget) === 220, JSON.stringify(part ?? null));
const lost = by(CREWLOST);
check("E6 a crew member's partial reversal lost: the kept $45 (fee 5) stays in the export",
  n(lost?.net_payout) === 45 && n(lost?.platform_fee) === 5 && n(lost?.gross_budget) === 50, JSON.stringify(lost ?? null));
const leadRows = rows.filter((r) => r.job_id === LEAD);
check("E7 a legacy crew lead in jobs.helper_id is listed once", leadRows.length === 1 && n(leadRows[0].net_payout) === 90,
  JSON.stringify(leadRows));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 6;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
