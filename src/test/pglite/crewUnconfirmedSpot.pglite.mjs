#!/usr/bin/env node
/**
 * PGlite proof for 20261006022526_crew_unconfirmed_spot_never_blocks_completion
 * (docs/OPEN.md Q1378; lh-money-escrow review of 50a721785, 2026-10-05: "an
 * unconfirmed refill on a crew that goes in_progress is never removed by the
 * expiry sweep, so the job can't complete and the escrow stays held").
 *
 *   npx tsx src/test/pglite/crewUnconfirmedSpot.pglite.mjs [--replay] [--before]
 *
 * Every function is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts), and this time the REAL arrival
 * and completion triggers are installed: the roster's server-owned stamps
 * (zza), the per-member completion gates (zzb: arrival confirmed by the
 * poster, 30 minutes of work, photos when the job asks), the done stamp that
 * cannot be cleared (zzc), the job-level completion gate
 * (trg_helper_completion_gates) and the departure trigger
 * (trg_sync_job_after_roster_departure). Every step a member takes goes
 * through its RPC: confirm, arrive, the poster's arrival confirm, Done. The
 * only direct writes are the test's clock: a reply deadline moved into the
 * past and the poster's "working" stamp moved two hours back (so the
 * 30-minute rule is met without waiting).
 * Stubs (not under test): is_caller_banned (false), are_users_blocked (false),
 * helper_accept_block_reason (NULL), apply_job_denial_consequence (records a
 * strike row).
 *
 * A booked crew of three ($90, $30 a spot) starting in 3 days: M1 and M2
 * confirmed, R (a refill) hired but not yet confirmed.
 *   U1 M1 arrives early (crew -> in_progress), R's answer-by passes: the sweep
 *      takes R off, the crew carries on in_progress, the poster is told the
 *      share comes back at payout                                         RED before
 *   U2 M1 and M2 do the work and mark Done while R is still unconfirmed: the
 *      crew COMPLETES, R's spot closes (application offer_expired, R told,
 *      no strike)                                                          RED before
 *   U3 the roster the payout reads is the two who worked: budget minus their
 *      frozen shares is the 3000c the payout refunds to the poster         RED before
 *   U4 a CONFIRMED member who has not finished still holds completion
 *   U5 R confirms in time: R counts, and the crew does not complete without R
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261006022526_crew_unconfirmed_spot_never_blocks_completion.sql";
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
function triggerStmt(name) {
  let found = null;
  for (const f of migrationFiles(DIR)) {
    if (f >= THIS) break;
    const raw = readFileSync(DIR + f, "utf8");
    for (const m of blankSqlComments(raw).matchAll(new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi"))) {
      found = raw.slice(m.index, m.index + m[0].length);
    }
  }
  if (!found) throw new Error(`no migration before ${THIS} creates trigger ${name}`);
  return found;
}
const FNS = [
  "is_server_context", "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation",
  "crew_slot_share_cents", "crew_completes_when_hired_done", "job_offer_cutoff", "group_member_slot",
  "enforce_group_member_lifecycle_server_owned", "enforce_group_member_completion_gates",
  "enforce_group_member_completion_not_clearable", "enforce_helper_completion_gates", "sync_job_after_roster_departure",
  "rpc_group_member_confirm", "rpc_group_member_mark_arrival", "rpc_poster_confirm_member_arrival",
  "rpc_group_member_mark_done", "expire_unanswered_offers",
];
const TRIGGERS = [
  "zza_group_member_lifecycle_server_owned", "zzb_group_member_completion_gates", "zzc_group_member_completion_not_clearable",
  "trg_helper_completion_gates", "trg_sync_job_after_roster_departure",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(2), M1 = U(3), M2 = U(4), R = U(5), CREW = U(101);

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
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  is_seed boolean DEFAULT false, date_needed date, start_time time, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, response_deadline timestamptz, latitude numeric, longitude numeric,
  require_photo_proof boolean DEFAULT false, proof_before_urls text[], proof_after_urls text[],
  poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz, helper_arrived_at timestamptz);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  response_deadline timestamptz,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, offer_message text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid, description text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, 'job_denial', p_job, p_desc) RETURNING jsonb_build_object('action', 'strike') $$;

${FNS.map(fnStmt).join("\n\n")}

${TRIGGERS.map(triggerStmt).join("\n")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
const server = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
const attempt = async (sql) => {
  try {
    await db.exec(sql);
    return "";
  } catch (e) {
    return e.message;
  }
};

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
  console.log(`--before: ${THIS} NOT applied (the RED checks must FAIL)`);
}
await db.exec(`INSERT INTO public.profiles (user_id) VALUES ('${M1}'), ('${M2}'), ('${R}');`);

/** A booked crew of three starting in 3 days; M1 and M2 confirmed through the RPC, R unconfirmed. */
async function seed() {
  await server();
  await db.exec(`
    DELETE FROM public.notifications; DELETE FROM public.user_violations;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 90, 'accepted', true, 3,
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '3 days')::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, response_deadline) VALUES
      ('${CREW}', '${M1}', 0, 3000, now() + interval '6 hours'), ('${CREW}', '${M2}', 1, 3000, now() + interval '6 hours'),
      ('${CREW}', '${R}', 2, 3000, now() + interval '6 hours');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES
      ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted'), ('${CREW}', '${R}', 'accepted');
  `);
  for (const m of [M1, M2]) {
    await as(m);
    await db.exec(`SELECT public.rpc_group_member_confirm('${CREW}')`);
  }
}
/** A confirmed member arrives, the poster confirms it, and two hours pass (the test's clock). */
async function arriveAndWork(member) {
  await as(member);
  const e1 = await attempt(`SELECT public.rpc_group_member_mark_arrival('${CREW}')`);
  await as(POSTER);
  const e2 = await attempt(`SELECT public.rpc_poster_confirm_member_arrival('${CREW}', '${member}')`);
  await server();
  await db.exec(`UPDATE public.group_job_helpers SET poster_confirmed_working_at = now() - interval '2 hours',
                   helper_arrived_at = now() - interval '2 hours' WHERE job_id = '${CREW}' AND helper_id = '${member}'`);
  return e1 || e2;
}
async function markDone(member) {
  await as(member);
  try {
    return (await one(`SELECT public.rpc_group_member_mark_done('${CREW}') AS r`)).r;
  } catch (e) {
    return { error: e.message };
  }
}
const roster = async () => (await all(`SELECT helper_id FROM public.group_job_helpers WHERE job_id = '${CREW}' ORDER BY slot_no`)).map((r) => r.helper_id);
const job = async () => one(`SELECT status::text AS status, helper_completed_at IS NOT NULL AS done FROM public.jobs WHERE id = '${CREW}'`);

// U1: early arrival starts the crew; R's answer-by passes.
await seed();
let err = await arriveAndWork(M1);
const started = (await job()).status;
await server();
await db.exec(`UPDATE public.group_job_helpers SET response_deadline = now() - interval '1 minute' WHERE helper_id = '${R}'`);
const n = (await one(`SELECT public.expire_unanswered_offers() AS n`)).n;
let r1 = await roster();
const posterNote = (await one(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}' AND title LIKE 'Offer expired%'`))?.message ?? "";
check("U1 an unconfirmed spot on a STARTED crew expires on its answer-by; the crew carries on in_progress",
  !err && started === "in_progress" && n === 1 && r1.length === 2 && !r1.includes(R) && (await job()).status === "in_progress"
    && /that spot's share is refunded to you once the job is done/.test(posterNote),
  `err=${err} started=${started} n=${n} roster=${r1.length} status=${(await job()).status} note=${posterNote}`);

// U2 + U3: the two confirmed members do the work while R is still unconfirmed.
await seed();
err = (await arriveAndWork(M1)) || (await arriveAndWork(M2));
const d1 = await markDone(M1);
const d2 = await markDone(M2);
const j2 = await job();
r1 = await roster();
const rApp = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${R}'`);
const rNote = (await one(`SELECT title, message FROM public.notifications WHERE user_id = '${R}'`)) ?? {};
const strikes = (await all(`SELECT 1 FROM public.user_violations`)).length;
check("U2 the members who worked finish and the crew COMPLETES with a spot still unconfirmed",
  !err && !d1.error && d2?.job_complete === true && j2.done === true, `err=${err} d1=${JSON.stringify(d1)} d2=${JSON.stringify(d2)} job=${JSON.stringify(j2)}`);
check("U2 the unconfirmed spot closes: off the roster, application offer_expired, told, no strike",
  r1.length === 2 && !r1.includes(R) && rApp.status === "rejected" && rApp.closed_reason === "offer_expired"
    && /before you confirmed your spot/.test(rNote.message ?? "") && strikes === 0,
  `roster=${r1.length} app=${JSON.stringify(rApp)} note=${JSON.stringify(rNote)} strikes=${strikes}`);
// What process-scheduled-payouts reads: it pays each roster row its frozen
// share and refunds budget minus those shares (refundUnfilledCrewShares).
const pay = await one(`SELECT count(*)::int AS paid_members, (round(j.budget * 100) - COALESCE(sum(g.share_cents), 0))::int AS refund_cents
                         FROM public.jobs j LEFT JOIN public.group_job_helpers g ON g.job_id = j.id WHERE j.id = '${CREW}' GROUP BY j.budget`);
check("U3 the payout's roster is the two who worked: 2 paid, 3000c refunded to the poster",
  pay.paid_members === 2 && pay.refund_cents === 3000, JSON.stringify(pay));

// U4: a confirmed member who has not finished still holds completion.
await seed();
await arriveAndWork(M1);
await arriveAndWork(M2);
await markDone(M1);
check("U4 a CONFIRMED member who has not finished still holds completion", (await job()).done === false && (await roster()).length === 3);

// U5: R confirms in time and counts.
await seed();
await as(R);
await db.exec(`SELECT public.rpc_group_member_confirm('${CREW}')`);
await arriveAndWork(M1);
await arriveAndWork(M2);
await markDone(M1);
await markDone(M2);
check("U5 a refill who confirmed counts: the crew does not complete without them", (await job()).done === false && (await roster()).includes(R));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // U1, U2 (both lines) and U3 are RED on the old functions; U4 and U5 hold either way.
  const expected = 4;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
