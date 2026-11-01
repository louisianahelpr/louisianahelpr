#!/usr/bin/env node
/**
 * PGlite proof for A3-31 (audit 11-01; lead 11-01: "the dialog promises all your money back, so the server must
 * truly charge 0 in the REAL all-no-show state"). No migration: the client now offers the refund cancel for an
 * ACCEPTED crew past its start with nobody left, and this run shows what poster_cancel_job does in exactly the state
 * the no-show flow leaves.
 *
 *   npx tsx src/test/pglite/crewAllNoShowCancel.pglite.mjs            # every check PASS
 *   npx tsx src/test/pglite/crewAllNoShowCancel.pglite.mjs --plant    # planted defect: the no-show report MARKS the
 *                                                                     # roster row instead of closing it; C1 must FAIL
 *
 * Every function in the path is its NEWEST definition across all migrations (effectiveDefs, no hand copies):
 * rpc_poster_report_member_no_show (20261101031804), poster_cancel_job (20261031220849), rpc_group_member_confirm,
 * sync_job_after_roster_departure and the roster triggers. Stubs (not under test): apply_consequence_ladder (records
 * the violation row it is asked for), apply_cancellation_violation_consequence (records a 'cancel_with_helper' row:
 * a poster strike is observable), payout_waits_on_identity (false: the identity_check switch is off on prod).
 * The jobs BEFORE UPDATE status chain is not loaded: it only refuses or allows the cancel, never prices it.
 *
 * A funded crew of 2 (budget 90, shares 4500 + 4500), both confirmed while the start was ahead. The start passes
 * with nobody having set out, so the job is still 'accepted' (a crew turns in_progress only on a member's
 * on-the-way / check-in). The poster reports both no-shows through the RPC, then cancels through the RPC.
 *   C0 the state the client reads: status accepted, start passed, roster empty
 *   C1 poster_cancel_job: cancellation_fee 0, cancellation_fee_status NULL (nothing captured: the whole hold comes back),
 *      late_cancellation false, no fee-share rows, no poster strike; each no-show keeps exactly one no_show strike
 *   C2 the dialog's quote (p_expected_fee_cents = 0) is accepted
 *   C3 control: only ONE member reported (the other still on, client shows no full-refund wording): the server
 *      charges a fee, so "all your money back" would be wrong there; the client's roster check is what separates them
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const PLANT = process.argv.includes("--plant");

const DEFS = effectiveDefs(DIR);
function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  let stmt = `${d.stmt.slice(0, end + open[1].length)};`;
  if (PLANT && name === "rpc_poster_report_member_no_show") {
    const find = "DELETE FROM public.group_job_helpers WHERE id = v_slot.id;";
    if (!stmt.includes(find)) throw new Error("plant: the no-show DELETE is not in the newest definition");
    stmt = stmt.replace(find, "UPDATE public.group_job_helpers SET status = 'no_show' WHERE id = v_slot.id;");
  }
  return stmt;
}
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration creates trigger ${name}`);
  return found;
}
function notificationTypeCheck() {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(DIR + f, "utf8"));
    for (const m of sql.matchAll(/ADD\s+CONSTRAINT\s+notifications_type_check\s+(CHECK\s*\([\s\S]*?\)\s*\));/gi)) found = m[1];
  }
  return `ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check ${found};`;
}
const FNS = [
  "is_server_context", "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation",
  "crew_slot_share_cents", "crew_completes_when_hired_done", "crew_fee_pays_unconfirmed", "helpr_flat_fee_cents",
  "job_offer_cutoff", "group_member_slot",
  "enforce_group_member_lifecycle_server_owned", "enforce_group_member_completion_gates",
  "enforce_group_member_completion_not_clearable", "sync_job_after_roster_departure",
  "rpc_group_member_confirm", "rpc_poster_report_member_no_show", "poster_cancel_job",
  "notification_job_id_from_link", "notification_crosses_seed_boundary", "notifications_seed_boundary",
];
const TRIGGERS = [
  "zza_group_member_lifecycle_server_owned", "zzb_group_member_completion_gates", "zzc_group_member_completion_not_clearable",
  "trg_sync_job_after_roster_departure", "trg_notifications_seed_boundary",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), M1 = U(3), M2 = U(4), CREW = U(101);

const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE TYPE public.job_status AS ENUM ('open','pending_approval','accepted','in_progress','revision_requested','completed','cancelled','disputed');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric, payment_status text,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  is_seed boolean DEFAULT false, date_needed date, start_time time, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, response_deadline timestamptz, latitude numeric, longitude numeric,
  require_photo_proof boolean DEFAULT false, proof_before_urls text[], proof_after_urls text[],
  poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_arrived_at timestamptz,
  helper_on_the_way_at timestamptz, helper_fee_percent numeric, helper_fee_flat_cents integer,
  cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
  cancellation_fee numeric, cancellation_fee_status text);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  response_deadline timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.crew_cancellation_fee_shares (job_id uuid, helper_id uuid, committed boolean, share_basis_cents bigint,
  fee_percent integer, share_amount numeric, UNIQUE (job_id, helper_id));
CREATE TABLE public.job_cancel_id_waivers (job_id uuid PRIMARY KEY);
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, offer_message text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.notification_logs (user_id uuid, category text, channel text, status text, subject text, job_id uuid, error_message text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid,
  description text, reported_by uuid);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.job_detail_change_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, decided_at timestamptz);
CREATE TABLE public.error_logs (severity text, message text, url text, tags jsonb, context jsonb);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_test_subject(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.settle_job_detail_change(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
-- STUB: identity_check is off on prod, so nobody's payout waits on an ID.
CREATE FUNCTION public.payout_waits_on_identity(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
-- STUB: the poster's cancel strike, observable as one row.
CREATE FUNCTION public.apply_cancellation_violation_consequence(p_job uuid) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id) SELECT customer_id, 'cancel_with_helper', id FROM public.jobs WHERE id = p_job
     RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, 'job_denial', p_job, p_desc) RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, p_violation_type, p_job_id, p_description)
     RETURNING jsonb_build_object('action', p_rungs[LEAST(p_prior_count, array_length(p_rungs, 1) - 1) + 1], 'prior_count', p_prior_count) $$;

${notificationTypeCheck()}

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}
`;

const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const call = async (uid, sql) => {
  await as(uid);
  try {
    return (await one(`SELECT ${sql} AS r`)).r;
  } catch (e) {
    return { error: e.message };
  } finally {
    await server();
  }
};

await db.exec(SCHEMA);
if (PLANT) console.log("--plant: the no-show report marks the roster row instead of closing it (C1 must FAIL)");
await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('${POSTER}'), ('${M1}'), ('${M2}');`);

async function seed() {
  await server();
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.crew_cancellation_fee_shares;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, payment_status, status, is_group_job, helpers_needed, date_needed, start_time, helper_fee_percent)
      VALUES ('${CREW}', '${POSTER}', 'Move a couch', 90, 'escrow', 'accepted', true, 2,
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::time, 10);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, response_deadline) VALUES
      ('${CREW}', '${M1}', 0, 4500, now() + interval '6 hours'), ('${CREW}', '${M2}', 1, 4500, now() + interval '6 hours');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted');
  `);
  for (const m of [M1, M2]) {
    const r = await call(m, `public.rpc_group_member_confirm('${CREW}')`);
    if (r && r.error) throw new Error(`confirm ${m}: ${r.error}`);
  }
  // The start passes (3 hours ago). Nobody set out, so the job stays 'accepted'.
  await db.exec(`UPDATE public.jobs SET
                   date_needed = (now() AT TIME ZONE 'America/Chicago' - interval '3 hours')::date,
                   start_time = (now() AT TIME ZONE 'America/Chicago' - interval '3 hours')::time
                 WHERE id = '${CREW}'`);
}
const strikes = async (u, type) => Number((await one(`SELECT count(*) AS n FROM public.user_violations WHERE user_id = '${u}' AND job_id = '${CREW}' AND violation_type = '${type}'`)).n);

// C0-C2: both reported, then the cancel.
await seed();
const r1 = await call(POSTER, `public.rpc_poster_report_member_no_show('${CREW}', '${M1}')`);
const r2 = await call(POSTER, `public.rpc_poster_report_member_no_show('${CREW}', '${M2}')`);
const state = await one(`SELECT j.status::text AS status,
  (SELECT count(*) FROM public.group_job_helpers g WHERE g.job_id = j.id AND g.helper_id IS NOT NULL)::int AS named
  FROM public.jobs j WHERE j.id = '${CREW}'`);
check("C0 both reports land; the job is still 'accepted' past its start", !r1.error && !r2.error && state.status === "accepted",
  `r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)} state=${JSON.stringify(state)}`);
check("C0b the roster the client reads names nobody (crewNobodyLeft's input)", state.named === 0, `named=${state.named}`);
const c = await call(POSTER, `public.poster_cancel_job('${CREW}', 'nobody came', 0)`);
const after = await one(`SELECT status::text AS status, cancellation_fee::numeric AS fee, cancellation_fee_status AS fs, late_cancellation AS late
  FROM public.jobs WHERE id = '${CREW}'`);
const shares = Number((await one(`SELECT count(*) AS n FROM public.crew_cancellation_fee_shares WHERE job_id = '${CREW}'`)).n);
check("C1 the cancel charges nothing: fee 0, no fee status (the whole hold is released), not late, no fee shares, no poster strike",
  !c.error && Number(c.cancellation_fee) === 0 && c.late_cancellation === false && after.status === "cancelled"
    && Number(after.fee) === 0 && after.fs === null && after.late === false && shares === 0
    && (await strikes(POSTER, "cancel_with_helper")) === 0,
  `r=${JSON.stringify(c)} job=${JSON.stringify(after)} shares=${shares} posterStrikes=${await strikes(POSTER, "cancel_with_helper")}`);
check("C1b each no-show has exactly one no_show strike", (await strikes(M1, "no_show")) === 1 && (await strikes(M2, "no_show")) === 1);
check("C2 the dialog's $0 quote (p_expected_fee_cents 0) was accepted, not refused quote_changed", !/quote_changed/.test(c.error ?? ""), c.error ?? "");

// C3 control: one member still on the crew.
await seed();
await call(POSTER, `public.rpc_poster_report_member_no_show('${CREW}', '${M1}')`);
const c3 = await call(POSTER, `public.poster_cancel_job('${CREW}', 'one came', NULL)`);
check("C3 control: one member still on, the cancel charges a fee (so the full-refund wording must not show there)",
  !c3.error && Number(c3.cancellation_fee) > 0, `r=${JSON.stringify(c3)}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (PLANT) {
  // The planted defect leaves both rows naming their Helpr: C0b and C1 must fail.
  const ok = failures >= 2;
  console.log(ok ? `RED as expected (${failures} failed)` : `NOT RED: ${failures} failed`);
  process.exit(ok ? 0 : 1);
}
process.exit(failures ? 1 : 0);
