#!/usr/bin/env node
/**
 * PGlite proof for 20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql (docs/OPEN.md Q2675 + Q2692; lead
 * verdict 11-02): block_user_and_settle, single-Helpr path.
 *
 *   npx tsx src/test/pglite/blockStrikeInside24h.pglite.mjs [--replay] [--before] [--plant=<n>]
 *
 * Every function is loaded from its EFFECTIVE definition before this migration (effectiveFunctionDefs). The
 * consequence functions are stubs that RECORD a strike row (they are not under test; which one is called, and when,
 * is). Supabase's default grant (EXECUTE to anon, authenticated, service_role on new public functions) is emulated
 * with ALTER DEFAULT PRIVILEGES before anything is created.
 *
 * --before leaves the migration out: every Q2675/Q2692 check must FAIL (the controls pass). --replay applies it 3x.
 * --plant=<n> applies the migration with one defect planted; it must FAIL:
 *   1 the poster's strike loses its 24 h gate        2 a Helpr's block prices the fee again
 *   3 the Helpr's block files no strike              4 the Helpr's strike loses its 24 h gate
 *   5 anon keeps EXECUTE
 *
 *   B1 poster blocks the committed Helpr 23 h out: the strike (cancel_with_helper) and the 25% fee ($30 of $120)
 *   B2 poster blocks the committed Helpr 25 h out: no strike, no fee                         (Q2675)
 *   B3 the Helpr blocks the poster 23 h out: fee 0 (the poster is not charged), the Helpr's strike (job_denial) (Q2692)
 *   B4 the Helpr blocks the poster 25 h out: fee 0, no strike (as helper_cancel_booking)      (Q2692)
 *   B5 control: a crew member blocked 10 h out: the crew ledger row and the poster's crew strike, unchanged
 *   B6 grants: authenticated may call it; anon may not
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102131745_block_strike_inside_24h_helpr_block_no_fee.sql";
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");
const PLANT = Number((process.argv.find((a) => a.startsWith("--plant=")) ?? "=0").split("=")[1]);

const PLANTS = {
  1: ["AND v_committed AND public.is_late_cancellation(v_committed, v_hours) THEN", "AND v_committed THEN"],
  2: ["      WHEN v_helpr_blocks THEN 0\n", ""],
  3: ["    IF v_helpr_blocks AND v_job.helper_confirmed_at IS NOT NULL AND public.is_late_cancellation(true, v_hours) THEN", "    IF false THEN"],
  4: ["    IF v_helpr_blocks AND v_job.helper_confirmed_at IS NOT NULL AND public.is_late_cancellation(true, v_hours) THEN", "    IF v_helpr_blocks AND v_job.helper_confirmed_at IS NOT NULL THEN"],
  5: ["REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;", "REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC;"],
};
let MIGRATION = readFileSync(DIR + THIS, "utf8");
if (PLANT) {
  const [find, repl] = PLANTS[PLANT];
  if (!MIGRATION.includes(find)) throw new Error(`plant ${PLANT}: find-string not in the migration`);
  MIGRATION = MIGRATION.replace(find, repl);
}

const BEFORE_DEFS = effectiveDefs(DIR, { before: THIS });
function fnStmt(name) {
  const d = BEFORE_DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}
const FNS = ["job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation", "crew_fee_pays_unconfirmed", "crew_slot_share_cents", "block_user_and_settle"];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), POSTER = U(2), HELPR = U(3), M1 = U(4), M2 = U(5), JOB = U(101), CREW = U(102);
const CREW_DDL = (() => {
  const t = readFileSync(DIR + "20261007073145_crew_block_fee_ledger.sql", "utf8");
  const i = t.indexOf("CREATE TABLE IF NOT EXISTS public.crew_block_fees");
  return t.slice(i, t.indexOf("\n);", i) + 3);
})();

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
-- Supabase's default: every new public function is executable by anon, authenticated and service_role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role public.app_role);
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  is_seed boolean DEFAULT false, date_needed date, start_time time, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, response_deadline timestamptz, cancelled_by uuid, cancelled_at timestamptz,
  cancellation_reason text, late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text,
  direct_offer_status text, direct_offer_expires_at timestamptz, offered_to_helper_id uuid, parent_job_id uuid,
  payment_status text DEFAULT 'escrow');
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_completed_at timestamptz,
  response_deadline timestamptz, UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, closed_reason text, offer_message text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid, description text);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
${CREW_DDL}
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, 'job_denial', p_job, p_desc) RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count integer, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days integer, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, p_violation_type, p_job_id, p_description) RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_cancellation_violation_consequence(p_job uuid) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id) VALUES (auth.uid(), 'cancel_with_helper', p_job) RETURNING jsonb_build_object('action', 'strike') $$;

${FNS.map(fnStmt).join("\n\n")}
REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO authenticated, service_role;
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);

await db.exec(SCHEMA);
await db.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${POSTER}'), ('${HELPR}'), ('${M1}'), ('${M2}');
  INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);
// The emulated default would hand anon EXECUTE on a fresh create; give it to the live function too, so the
// migration's own REVOKE ... FROM PUBLIC, anon is what has to take it away (plant 5).
if (!BEFORE) await db.exec(`GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO anon;`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(MIGRATION);
      console.log(`applied ${THIS} (run ${i})${PLANT ? ` with plant ${PLANT}` : ""}`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (every Q2675/Q2692 check must FAIL)`);
}

async function seedSingle(offset) {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks; DELETE FROM public.crew_block_fees;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, helper_id, title, budget, status, date_needed, start_time, helper_confirmed_at)
      VALUES ('${JOB}', '${POSTER}', '${HELPR}', 'Rake the front yard', 120, 'accepted',
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::time, now() - interval '2 days');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${JOB}', '${HELPR}', 'accepted');`);
}
async function block(who, whom) {
  await as(who);
  try { return (await one(`SELECT public.block_user_and_settle('${whom}', NULL) AS r`)).r; } catch (e) { return { error: e.message }; } finally { await db.exec("RESET ROLE"); }
}
const jobRow = () => one(`SELECT status, cancellation_fee::float AS fee, cancelled_by FROM public.jobs WHERE id = '${JOB}'`);
const strikes = () => all(`SELECT user_id, violation_type FROM public.user_violations ORDER BY violation_type`);

// B1
await seedSingle("23 hours");
let r = await block(POSTER, HELPR);
let j = await jobRow(); let s = await strikes();
check("B1 (control) poster blocks 23 h out: cancelled, $30 kept for the Helpr's time, the poster's strike",
  j.status === "cancelled" && j.fee === 30 && s.length === 1 && s[0].user_id === POSTER && s[0].violation_type === "cancel_with_helper",
  `job=${JSON.stringify(j)} strikes=${JSON.stringify(s)} r=${JSON.stringify(r)}`);

// B2
await seedSingle("25 hours");
r = await block(POSTER, HELPR);
j = await jobRow(); s = await strikes();
check("B2 poster blocks 25 h out: cancelled, no fee, and NO strike (Q2675)", j.status === "cancelled" && j.fee === 0 && s.length === 0,
  `job=${JSON.stringify(j)} strikes=${JSON.stringify(s)}`);

// B3
await seedSingle("23 hours");
r = await block(HELPR, POSTER);
j = await jobRow(); s = await strikes();
const posterNote = await one(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}'`);
check("B3 the Helpr blocks the poster 23 h out: the poster is charged NO fee (Q2692)", j.status === "cancelled" && j.fee === 0,
  `job=${JSON.stringify(j)}`);
check("B3 the Helpr's strike, as helper_cancel_booking files it (job_denial on the Helpr, nothing on the poster)",
  s.length === 1 && s[0].user_id === HELPR && s[0].violation_type === "job_denial", JSON.stringify(s));
check("B3 the poster is told nothing is owed", /was cancelled\. Nothing is owed for it\./.test(posterNote?.message ?? ""), JSON.stringify(posterNote));

// B4
await seedSingle("25 hours");
r = await block(HELPR, POSTER);
j = await jobRow(); s = await strikes();
check("B4 the Helpr blocks the poster 25 h out: no fee, no strike", j.fee === 0 && s.length === 0, `job=${JSON.stringify(j)} strikes=${JSON.stringify(s)}`);

// B5 crew control
await db.exec(`
  RESET ROLE;
  DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks; DELETE FROM public.crew_block_fees;
  DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
  INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
    VALUES ('${CREW}', '${POSTER}', 'Move a piano', 100, 'accepted', true, 2,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date, (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::time);
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES
    ('${CREW}', '${M1}', 0, 5000, now() - interval '2 days'), ('${CREW}', '${M2}', 1, 5000, now() - interval '2 days');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted');`);
r = await block(POSTER, M1);
const fees = await all(`SELECT helper_id, fee_cents FROM public.crew_block_fees WHERE job_id = '${CREW}'`);
s = await strikes();
check("B5 (control) the crew path is unchanged: a 25% ledger row for the member and the poster's crew strike",
  fees.length === 1 && fees[0].helper_id === M1 && fees[0].fee_cents === 1250 && s.length === 1 && s[0].user_id === POSTER,
  `fees=${JSON.stringify(fees)} strikes=${JSON.stringify(s)} r=${JSON.stringify(r)}`);

// B6
const grants = await one(`SELECT has_function_privilege('anon', 'public.block_user_and_settle(uuid, text)', 'EXECUTE') AS anon,
  has_function_privilege('authenticated', 'public.block_user_and_settle(uuid, text)', 'EXECUTE') AS auth`);
check("B6 authenticated may call it; anon may not (the Supabase default grant is revoked)", grants.auth === true && grants.anon === false, JSON.stringify(grants));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // B2, B3 fee, B3 strike, B3 notice are the Q2675/Q2692 checks; B1, B4, B5, B6 are controls.
  const expected = 4;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
