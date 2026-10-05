#!/usr/bin/env node
/**
 * PGlite proof for 20261005171601_crew_counts_exports_and_ban_alert (docs/OPEN.md
 * Q731 + Q729; a crew has no lead, Q407).
 *
 *   npx tsx src/test/pglite/crewCountsAndBanAlert.pglite.mjs [--replay] [--before]
 *
 * Every function is first loaded from its EFFECTIVE definition in the
 * migrations before this one (src/test/helpers/effectiveFunctionDefs.ts). With
 * --before the migration is NOT applied and every check below must FAIL (the
 * red state); without it the migration is applied (3x with --replay) and every
 * check must PASS. Stubs (not under test): identity_is_verified,
 * is_category_taxable, miles_between.
 *
 *   C1 a crew member's on-time and repeat-client figures count their crew jobs
 *   C2 a crew member's paid share is in their earnings export
 *   C3 a crew-only Helpr is on the admin tier list with their crew jobs counted
 *   C4 "hired by N neighbours" counts crew jobs
 *   C5 a crew member banned after completion, share unpaid: every admin alerted
 *   C6 ...and a member whose share already paid: nothing (no noise)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261005171601_crew_counts_exports_and_ban_alert.sql";
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
const FNS = [
  "has_role", "ban_settlement_action", "get_public_profile_stats", "get_helper_earnings_export",
  "get_helper_tiers", "get_neighbor_hire_count", "settle_one_off_jobs_for_banned_account",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), M1 = U(2), M2 = U(3), P1 = U(11), P2 = U(12), P3 = U(13), ASKER = U(14);
const J = (n) => U(100 + n);

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
  payment_status text, budget numeric, helper_fee_percent numeric, sales_tax_amount numeric,
  date_needed date, start_time time, helper_confirmed_at timestamptz, helper_arrived_at timestamptz,
  helper_completed_at timestamptz, poster_completed_at timestamptz, revision_count integer,
  proof_before_urls text[], proof_after_urls text[], parent_job_id uuid, recurrence_days integer[],
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz,
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz,
  poster_confirmed_completion_at timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  amount_cents integer, platform_fee_cents integer, status text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.profiles (id uuid DEFAULT gen_random_uuid(), user_id uuid PRIMARY KEY, full_name text, parish text, avatar_url text,
  stripe_identity_verified boolean, idv_status text, stripe_account_id text, background_check_status text,
  email_verified boolean DEFAULT true, ban_status text, latitude numeric, longitude numeric);
CREATE TABLE public.reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, reviewer_id uuid, reviewee_id uuid, rating int,
  status text DEFAULT 'published', feedback_visible_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.helper_credentials (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, status text);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, job_latitude numeric, job_longitude numeric);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.identity_is_verified(text, boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce($2, false) $$;
CREATE FUNCTION public.is_category_taxable(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.miles_between(numeric, numeric, numeric, numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT 0::numeric $$;

${FNS.map(fnStmt).join("\n\n")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);

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
  console.log(`--before: ${THIS} NOT applied (every check must FAIL)`);
}

// Five completed crew jobs for M1 (and M2), each M1 arrival on time, posted by
// P1, P1, P2, P3, P3 (so 3 distinct clients, 2 returning). Job 1 is the one
// whose payout is still pending.
await db.exec(`
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.profiles (user_id, full_name, latitude, longitude) VALUES
    ('${M1}', 'Member One', NULL, NULL), ('${M2}', 'Member Two', NULL, NULL),
    ('${P1}', 'P1', 30, -91), ('${P2}', 'P2', 30, -91), ('${P3}', 'P3', 30, -91), ('${ASKER}', 'Asker', 30, -91), ('${ADMIN}', 'Admin', NULL, NULL);
`);
const posters = [P1, P1, P2, P3, P3];
for (let n = 1; n <= 5; n++) {
  await db.exec(`
    INSERT INTO public.jobs (id, customer_id, title, category, status, is_group_job, helpers_needed, payment_status, budget,
                             helper_fee_percent, sales_tax_amount, date_needed, start_time, poster_completed_at)
      VALUES ('${J(n)}', '${posters[n - 1]}', 'Crew ${n}', 'moving', 'completed', true, 2,
              ${n === 1 ? "'payout_pending'" : "'released'"}, 200, 10, 18, current_date - ${n}, '09:00', now() - interval '${n} days');
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_arrived_at) VALUES
      ('${J(n)}', '${M1}', 0, 10000, ((current_date - ${n}) + time '09:05') AT TIME ZONE 'America/Chicago'),
      ('${J(n)}', '${M2}', 1, 10000, ((current_date - ${n}) + time '09:05') AT TIME ZONE 'America/Chicago');
    ${n === 1 ? `INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status) VALUES ('${J(n)}', '${M2}', 9000, 1000, 'paid');`
              : `INSERT INTO public.payout_transfers (job_id, helper_id, amount_cents, platform_fee_cents, status) VALUES ('${J(n)}', '${M1}', 9000, 1000, 'paid'), ('${J(n)}', '${M2}', 9000, 1000, 'paid');`}
  `);
}
// The asker's open job M1 applied to, for the neighbour count.
await db.exec(`
  INSERT INTO public.jobs (id, customer_id, title, status, payment_status) VALUES ('${J(9)}', '${ASKER}', 'Ask', 'open', 'escrow');
  INSERT INTO public.applications (job_id, helper_id, status, job_latitude, job_longitude) VALUES ('${J(9)}', '${M1}', 'pending', 30, -91);
`);

// C1
await as(M1);
const stats = await one(`SELECT on_time_sample, on_time_rate, repeat_client_sample, repeat_hire_percent FROM public.get_public_profile_stats(ARRAY['${M1}']::uuid[])`);
check("C1 a crew member's on-time figure counts their 5 crew jobs", Number(stats?.on_time_sample) === 5 && Number(stats?.on_time_rate) === 100,
  `on_time_sample=${stats?.on_time_sample} rate=${stats?.on_time_rate}`);
check("C1 a crew member's repeat-client figure counts their 3 crew clients", Number(stats?.repeat_client_sample) === 3 && Number(stats?.repeat_hire_percent) === 67,
  `client_sample=${stats?.repeat_client_sample} percent=${stats?.repeat_hire_percent}`);

// C2: M1 was paid on jobs 2-5 (job 1 still pending): 4 rows, net 90.00 each, gross 100.00, tax 9.00.
const exp = await all(`SELECT * FROM public.get_helper_earnings_export('${M1}', current_date - 30, current_date)`);
check("C2 a crew member's paid shares are in their earnings export (and only the paid ones)",
  exp.length === 4 && exp.every((r) => Number(r.net_payout) === 90 && Number(r.gross_budget) === 100 && Number(r.platform_fee) === 10 && Number(r.parish_tax_collected) === 9),
  `rows=${exp.length} first=${JSON.stringify(exp[0] ?? null)}`);

// C3
await as(ADMIN);
const tiers = await all(`SELECT user_id, completed_jobs FROM public.get_helper_tiers(50)`);
const t1 = tiers.find((r) => r.user_id === M1);
check("C3 a crew-only Helpr is on the admin tier list with 5 completed jobs", Number(t1?.completed_jobs) === 5,
  `row=${JSON.stringify(t1 ?? null)}`);

// C4
await as(ASKER);
const near = await one(`SELECT public.get_neighbor_hire_count('${M1}', '${J(9)}') AS n`);
check("C4 'hired by N neighbours' counts crew jobs (3 distinct nearby posters)", Number(near?.n) === 3, `n=${near?.n}`);

// C5 / C6
await as(ADMIN);
await db.exec(`DELETE FROM public.notifications`);
const r1 = await one(`SELECT public.settle_one_off_jobs_for_banned_account('${M1}') AS r`);
const alerts1 = await all(`SELECT user_id, job_id FROM public.notifications WHERE type = 'admin_alert'`);
check("C5 a crew member banned after completion with an unpaid share: every admin alerted naming the job",
  alerts1.length === 1 && alerts1[0].user_id === ADMIN && alerts1[0].job_id === J(1)
    && (r1?.r?.settled ?? []).some((s) => s.job_id === J(1) && s.action === "admin_review"),
  `alerts=${JSON.stringify(alerts1)} result=${JSON.stringify(r1?.r)}`);
const jobAfter = await one(`SELECT status, payment_status FROM public.jobs WHERE id = '${J(1)}'`);
check("C5 the job and its payout are left to run on schedule", jobAfter.status === "completed" && jobAfter.payment_status === "payout_pending",
  JSON.stringify(jobAfter));
await db.exec(`DELETE FROM public.notifications`);
await db.exec(`SELECT public.settle_one_off_jobs_for_banned_account('${M2}')`);
const alerts2 = await all(`SELECT job_id FROM public.notifications WHERE type = 'admin_alert'`);
// Not a red-before case (the old code also sent nothing); it pins "no noise".
const noNoise = alerts2.length === 0;
if (BEFORE) console.log(`INFO  C6 (no-noise pin, green both ways)  alerts=${alerts2.length}`);
else check("C6 a member whose share already paid out raises nothing", noNoise, `alerts=${JSON.stringify(alerts2)}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // Red state: the six crew checks (C1 x2, C2, C3, C4, C5 alert) must fail; the
  // "left to run" pin holds both ways.
  const expected = 6;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
