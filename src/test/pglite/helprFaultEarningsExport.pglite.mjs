#!/usr/bin/env node
/**
 * PGlite proof for 20261019015304_helpr_fault_earnings_export (Q2082 (b), b3).
 *
 *   npx tsx src/test/pglite/helprFaultEarningsExport.pglite.mjs [--before]
 *
 * The export is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts). With --before the migration is
 * NOT applied and F1/F2 must FAIL (exit 0 only when exactly those two fail);
 * without it the migration is applied 3x and every check must PASS.
 *
 *   F1 a single job's payout that kept back a Helpr-fault card fee
 *      (metadata.helpr_fault_fee_cents): gross includes it, net is what was sent
 *   F2 the same on a crew member's row
 *   F3 a row with no fault fee is unchanged (pin)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261019015304_helpr_fault_earnings_export.sql";
const MIG = readFileSync(DIR + THIS, "utf8");
const BEFORE = process.argv.includes("--before");
const defs = effectiveDefs(DIR, { before: THIS });
const fnStmt = (name) => {
  const d = defs.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const o = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const e = d.stmt.indexOf(o[1], o.index + o[0].length);
  return `${d.stmt.slice(0, e + o[1].length)};`;
};
let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) fails++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const H = U(1), M2 = U(2), P = U(11), SOLO = U(201), CREW = U(202), PLAIN = U(203);
const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','disputed');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, parish text, category text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, payment_status text, budget numeric,
  urgent_fee numeric, helper_fee_percent numeric, helper_fee_flat_cents integer, sales_tax_amount numeric,
  helper_completed_at timestamptz, poster_completed_at timestamptz, updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, share_cents integer,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz);
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  amount_cents integer, platform_fee_cents integer, status text, metadata jsonb DEFAULT '{}'::jsonb);
CREATE FUNCTION public.is_category_taxable(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
${["has_role", "helpr_flat_fee_cents", "get_helper_earnings_export"].map(fnStmt).join("\n\n")}
INSERT INTO public.jobs (id, customer_id, helper_id, title, category, status, is_group_job, payment_status, budget, urgent_fee, helper_fee_percent, sales_tax_amount, poster_completed_at) VALUES
  ('${SOLO}', '${P}', '${H}', 'Solo', 'moving', 'completed', false, 'released', 100, 0, 10, 0, now() - interval '2 days'),
  ('${CREW}', '${P}', NULL, 'Crew', 'moving', 'completed', true, 'released', 220, 0, 10, 0, now() - interval '3 days'),
  ('${PLAIN}', '${P}', '${H}', 'Plain', 'moving', 'completed', false, 'released', 220, 0, 15, 0, now() - interval '1 day');
INSERT INTO public.group_job_helpers (job_id, helper_id, share_cents) VALUES ('${CREW}', '${H}', 11000), ('${CREW}', '${M2}', 11000);
-- SOLO: earned 90.00 after a 10.00 fee; a 3.20 Helpr-fault card fee kept back,
-- 86.80 rounded down to 86: paid 8600, remainder 80.
INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
  ('${SOLO}', '${H}', 8600, 1000, 'paid', '{"onboarding_fee_cents": 0, "rounding_remainder_cents": 80, "helpr_fault_fee_cents": 320}'),
  ('${CREW}', '${H}', 9500, 1000, 'paid', '{"onboarding_fee_cents": 0, "rounding_remainder_cents": 0, "helpr_fault_fee_cents": 500}'),
  ('${PLAIN}', '${H}', 18700, 3300, 'paid', '{"onboarding_fee_cents": 0, "rounding_remainder_cents": 0}');
SELECT set_config('request.jwt.claim.sub', '${H}', false);
`);
if (!BEFORE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIG);
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (F1/F2 must FAIL)`);
}
const rows = (await db.query(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`)).rows;
const by = (id) => rows.find((r) => r.job_id === id);
const n = Number;
const s = by(SOLO), c = by(CREW), p = by(PLAIN);
check("F1 single job: gross 100 = paid 86 + fee 10 + remainder 0.80 + fault fee 3.20; fee 14; net 86",
  n(s?.gross_budget) === 100 && n(s?.platform_fee) === 14 && n(s?.net_payout) === 86, JSON.stringify(s ?? null));
check("F2 crew member: gross 110 = paid 95 + fee 10 + fault fee 5; fee 15; net 95",
  n(c?.gross_budget) === 110 && n(c?.platform_fee) === 15 && n(c?.net_payout) === 95, JSON.stringify(c ?? null));
const pOk = n(p?.gross_budget) === 220 && n(p?.platform_fee) === 33 && n(p?.net_payout) === 187;
if (BEFORE) console.log(`INFO  F3 (no fault fee, green both ways)  ${pOk}`);
else check("F3 a row with no fault fee is unchanged (220 / 33 / 187)", pOk, JSON.stringify(p ?? null));
if (!BEFORE) {
  const acl = (await db.query("SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'get_helper_earnings_export'")).rows[0]?.acl ?? "";
  check("grants: no anon / PUBLIC execute", !/(^|[{,])(anon)?=X/.test(acl), acl);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
if (BEFORE) {
  console.log(fails === 2 ? "RED as expected (2/2)" : `NOT RED as expected: ${fails}/2`);
  process.exit(fails === 2 ? 0 : 1);
}
process.exit(fails ? 1 : 0);
