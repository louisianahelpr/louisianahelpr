#!/usr/bin/env node
/**
 * PGlite proof for 20261006031350_crew_completion_rechecks_after_closing_spots
 * (docs/OPEN.md Q1378; lh-money-escrow review of bc9ea3a47, 2026-10-05, the
 * RACE: a member who confirms while the last member's Done runs the roll-up was
 * told "Your offer closed", kept on the roster, and the crew completed, so the
 * payout (which pays every roster row) would pay them for work never done).
 *
 *   npx tsx src/test/pglite/crewCompletionRace.pglite.mjs [--replay] [--before]
 *
 * Same harness as crewUnconfirmedSpot.pglite.mjs (EFFECTIVE definitions before
 * this migration, the REAL arrival and completion triggers, every member step
 * through its RPC), plus one TEST-ONLY trigger standing in for the second
 * session: when the roll-up's DELETE reaches member B's row, B's confirm lands
 * first and the DELETE skips the row (what READ COMMITTED does after waiting on
 * B's row lock). --before leaves the migration out and the RED checks must
 * FAIL (count asserted); without it the migration is applied (3x with --replay).
 *
 * A booked crew of three starting in 3 days: M1 and M2 confirmed, B not.
 *   X1 M1 and M2 do the work; B confirms DURING the last Done's roll-up: the
 *      crew does NOT complete (B now counts and has not worked)          RED before
 *   X2 B is not told "Your offer closed", B's application stays accepted, B
 *      stays on the roster                                               RED before
 *   X3 the last member's own Done stands either way
 *   X5 that member then works and marks Done, and the crew completes
 *   X4 control, no confirm in flight: B's unconfirmed spot closes and the crew
 *      completes, as 20261006022526 decided
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261006031350_crew_completion_rechecks_after_closing_spots.sql";
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

-- TEST ONLY: the interleaving the review found. When the roll-up's DELETE
-- reaches the named member's row, their confirm "commits" first: the row is
-- now confirmed, and the DELETE skips it, which is exactly what Postgres does
-- when a DELETE waits on a row lock and re-checks the updated row (READ
-- COMMITTED). PGlite has one connection, so the hook stands in for the second.
CREATE FUNCTION public.test_confirm_lands_mid_delete() RETURNS trigger LANGUAGE plpgsql AS $hook$
BEGIN
  IF OLD.helper_id::text = current_setting('test.confirm_on_delete', true) THEN
    UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = OLD.id;
    RETURN NULL;
  END IF;
  RETURN OLD;
END
$hook$;
CREATE TRIGGER zzz_test_confirm_lands_mid_delete BEFORE DELETE ON public.group_job_helpers
  FOR EACH ROW EXECUTE FUNCTION public.test_confirm_lands_mid_delete();
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

// X1-X3: B confirms mid roll-up.
await seed();
await server();
await db.exec(`SELECT set_config('test.confirm_on_delete', '${R}', false)`);
let err = (await arriveAndWork(M1)) || (await arriveAndWork(M2));
await markDone(M2);
const last = await markDone(M1);
await server();
await db.exec(`SELECT set_config('test.confirm_on_delete', '', false)`);
const j1 = await job();
const r1 = await roster();
const bApp = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${R}'`);
const bTold = (await all(`SELECT 1 FROM public.notifications WHERE user_id = '${R}' AND title = 'Your offer closed'`)).length;
const m1Done = (await one(`SELECT helper_completed_at IS NOT NULL AS ok FROM public.group_job_helpers WHERE helper_id = '${M1}'`)).ok;
check("X1 a member who confirms during the last Done's roll-up counts: the crew does NOT complete",
  !err && !last.error && j1.done === false, `err=${err} last=${JSON.stringify(last)} job=${JSON.stringify(j1)}`);
check("X2 that member is not told their offer closed, keeps their application and their spot",
  bTold === 0 && bApp.status === "accepted" && bApp.closed_reason === null && r1.includes(R),
  `told=${bTold} app=${JSON.stringify(bApp)} roster=${r1.length}`);
check("X3 the last member's own Done stands", m1Done === true);
// ...and the crew completes on the confirmed member's own Done. In the real
// interleaving B's confirm is its OWN committed transaction; here the hook ran
// inside the roll-up's subtransaction, which the fix rolls back, so B's confirm
// is replayed through its RPC (idempotent: COALESCE keeps the first stamp).
await as(R);
await db.exec(`SELECT public.rpc_group_member_confirm('${CREW}')`);
const e5 = await arriveAndWork(R);
const bDone = await markDone(R);
check("X5 the member who confirmed then works and finishes, and the crew completes on their Done",
  !e5 && !bDone.error && (await job()).done === true, `${e5} ${JSON.stringify(bDone)}`);

// X4: control, nobody confirming: B's spot closes and the crew completes.
await seed();
err = (await arriveAndWork(M1)) || (await arriveAndWork(M2));
await markDone(M2);
const done = await markDone(M1);
const j4 = await job();
const r4 = await roster();
const bApp4 = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${R}'`);
const bTold4 = (await all(`SELECT 1 FROM public.notifications WHERE user_id = '${R}' AND title = 'Your offer closed'`)).length;
check("X4 control: with no confirm in flight the unconfirmed spot closes (offer_expired, told) and the crew completes",
  !err && done?.job_complete === true && j4.done === true && !r4.includes(R) && bApp4.status === "rejected"
    && bApp4.closed_reason === "offer_expired" && bTold4 === 1,
  `done=${JSON.stringify(done)} job=${JSON.stringify(j4)} roster=${r4.length} app=${JSON.stringify(bApp4)} told=${bTold4}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // X1 and X2 are RED on the old roll-up; X3, X4 and X5 hold either way.
  const expected = 2;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
