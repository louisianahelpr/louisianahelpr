#!/usr/bin/env node
/**
 * PGlite proof for 20261012175545_earnings_export_withheld (docs/OPEN.md Q1520).
 *
 *   npx tsx src/test/pglite/earningsExportWithheld.pglite.mjs [--replay] [--before]
 *
 * The export is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts). With --before the migration is
 * NOT applied and the red checks must FAIL; without it the migration is
 * applied (3x with --replay) and every check must PASS. Stub (not under
 * test): is_category_taxable.
 *
 *   W1 a single job's first payout: gross and fee include the onboarding fee
 *      and the rounding remainder the payout withheld (metadata), net is paid
 *   W2 a crew member's first payout: the same on the crew half
 *   W3 a row with no withheld keys is unchanged (pin, green both ways)
 *   W4 on every ledger row, gross - fee = net
 *   W5 a row written before the change (prod's one, 2026-10-11: $10 budget,
 *      12% fee, $8 paid) is backfilled: gross is the $10 earned, not $9.20
 *   W6 no JWT at all (auth.uid() NULL) is refused, not served
 * (W5/W6 from the lh-money-escrow review of this migration.)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261012175545_earnings_export_withheld.sql";
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
const SOLO = U(201), CREW = U(202), PLAIN = U(203), OLDROW = U(204);

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
// SOLO: earned $192.37 after a $30 fee; the first payout withheld the $2
// onboarding fee and rounded $190.37 down to $190: paid 19000, withheld 237.
// CREW: H's share earned $100 after the fee, the $2 onboarding fee withheld:
// paid 9800, fee 1000 recorded. PLAIN: an ordinary row, no withheld keys.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, helper_id, title, category, status, is_group_job, helpers_needed, payment_status,
                           budget, urgent_fee, helper_fee_percent, sales_tax_amount, poster_completed_at) VALUES
    ('${SOLO}', '${P}', '${H}', 'Solo', 'moving', 'completed', false, 1, 'released', 222.37, 0, 13.49, 0, now() - interval '2 days'),
    ('${CREW}', '${P}', NULL, 'Crew', 'moving', 'completed', true, 2, 'released', 220, 0, 10, 0, now() - interval '3 days'),
    ('${PLAIN}', '${P}', '${H}', 'Plain', 'moving', 'completed', false, 1, 'released', 220, 0, 15, 0, now() - interval '1 day'),
    ('${OLDROW}', '${P}', '${H}', 'Old', 'moving', 'completed', false, 1, 'released', 10, 0, 12, 0, now() - interval '4 days');
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES
    ('${CREW}', '${H}', 0, 11000), ('${CREW}', '${M2}', 1, 11000);
  INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status, metadata) VALUES
    ('${SOLO}', '${H}', 19000, 3000, 'paid', '{"source": "release-payout", "onboarding_fee_cents": 200, "rounding_remainder_cents": 37}'),
    ('${CREW}', '${H}', 9800, 1000, 'paid', '{"source": "scheduled_payout", "onboarding_fee_cents": 200, "rounding_remainder_cents": 0}'),
    ('${PLAIN}', '${H}', 19000, 3000, 'paid', '{"source": "scheduled_payout"}'),
    ('${OLDROW}', '${H}', 800, 120, 'paid', '{"source": "scheduled_payout", "onboarding_fee_cents": 0}');
  SELECT set_config('request.jwt.claim.sub', '${H}', false);
`);

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

const rows = await all(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`);
const by = (id) => rows.find((r) => r.job_id === id);
const n = (v) => Number(v);
const solo = by(SOLO), crew = by(CREW), plain = by(PLAIN);
check("W1 a single job's first payout: gross 222.37 = paid 190 + fee 30 + withheld 2.37; fee 32.37; net 190",
  n(solo?.gross_budget) === 222.37 && n(solo?.platform_fee) === 32.37 && n(solo?.net_payout) === 190, JSON.stringify(solo ?? null));
check("W2 a crew member's first payout: gross 110 = paid 98 + fee 10 + onboarding 2; fee 12; net 98",
  n(crew?.gross_budget) === 110 && n(crew?.platform_fee) === 12 && n(crew?.net_payout) === 98, JSON.stringify(crew ?? null));
const plainOk = n(plain?.gross_budget) === 220 && n(plain?.platform_fee) === 30 && n(plain?.net_payout) === 190;
if (BEFORE) console.log(`INFO  W3 (no withheld keys, green both ways)  ${plainOk}`);
else check("W3 a row with no withheld keys is unchanged (220 / 30 / 190)", plainOk, JSON.stringify(plain ?? null));
const oldrow = by(OLDROW);
check("W5 a row written before the change is backfilled: gross 10.00 = paid 8 + fee 1.20 + 0.80 rounded off",
  n(oldrow?.gross_budget) === 10 && n(oldrow?.platform_fee) === 2 && n(oldrow?.net_payout) === 8, JSON.stringify(oldrow ?? null));
const ledgerRows = [solo, crew, plain, oldrow].filter(Boolean);
check("W4 on every ledger row, gross - fee = net",
  ledgerRows.length === 4 && ledgerRows.every((r) => Math.abs(n(r.gross_budget) - n(r.platform_fee) - n(r.net_payout)) < 0.005),
  JSON.stringify(ledgerRows.map((r) => [r.gross_budget, r.platform_fee, r.net_payout])));

await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`);
let anonAnswer;
try {
  anonAnswer = `${(await all(`SELECT * FROM public.get_helper_earnings_export('${H}', current_date - 30, current_date)`)).length} rows`;
} catch (e) {
  anonAnswer = e.message;
}
check("W6 no JWT (auth.uid() NULL) is refused", /Not authorized/.test(anonAnswer), anonAnswer);

if (!BEFORE) {
  const acl = (await all(`SELECT proacl::text AS acl FROM pg_proc WHERE proname = 'get_helper_earnings_export'`))[0]?.acl ?? "";
  check("grants: no anon / PUBLIC execute", !/(^|[{,])(anon)?=X/.test(acl), acl);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 4;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
