#!/usr/bin/env node
/**
 * PGlite proof for 20261006015121_crew_rest_carry_on (docs/OPEN.md Q1378;
 * owner decision 2026-10-05 ~18:40 CT: when a member leaves a full crew, THE
 * REST CARRY ON).
 *
 *   npx tsx src/test/pglite/crewRestCarryOn.pglite.mjs [--replay] [--before]
 *
 * Every function is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts), with the REAL roster lifecycle
 * trigger. --before leaves the migration out and the RED checks must FAIL
 * (the count is printed and asserted); without it the migration is applied
 * (3x with --replay) and every check must PASS.
 * Stubs (not under test): is_caller_banned (false), are_users_blocked (false),
 * helper_accept_block_reason (NULL), apply_consequence_ladder and
 * apply_job_denial_consequence (record a strike row). The completion-gate
 * triggers on jobs / group_job_helpers are not installed: D1 measures the
 * roll-up's status rule, not the per-member photo and arrival gates.
 *
 * A crew of three (budget $90, $30 a spot), booked ('accepted'), all three
 * confirmed, starting in 3 days unless said:
 *   C1 a member leaves (helper_cancel_booking): the job STAYS booked, two left   RED before
 *   C2 the two left can still set out (rpc_group_member_on_the_way)               RED before
 *   C3 the poster's notice says the rest of the crew is still on                  RED before
 *   D1 the two left finish and the crew completes (rpc_group_member_mark_done)
 *   B1 the POSTER blocks one member: the job stays booked                         RED before
 *   B2 one MEMBER blocks the poster: the job stays booked, poster told so         RED before
 *   E1 an unanswered spot expires: the job stays booked; the member is told
 *      they lost the spot (not that it "went back to everyone")                RED before
 *   R1 the poster refills the empty spot before the start: same slot, same
 *      share, the job stays booked                                                RED before
 *   R2 a refill inside 15 minutes of the start is refused (job_starts_too_soon)
 *   R3 a refill into a booked crew that is full is refused (no 4th member)
 *   Z1 a crew with NOBODY left reopens (nothing to carry on)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261006015121_crew_rest_carry_on.sql";
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
  "job_hours_until_start", "cancellation_fee_percent", "is_late_cancellation", "crew_fee_pays_unconfirmed",
  "crew_slot_share_cents", "crew_completes_when_hired_done", "job_offer_cutoff", "group_member_slot",
  "enforce_group_member_lifecycle_server_owned", "accept_group_application", "expire_unanswered_offers",
  "block_user_and_settle", "helper_cancel_booking", "rpc_group_member_on_the_way", "rpc_group_member_mark_done",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), POSTER = U(2), M1 = U(3), M2 = U(4), M3 = U(5), NEWBIE = U(6), CREW = U(101);

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
  id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, title text, budget numeric,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false, helpers_needed integer DEFAULT 1,
  is_seed boolean DEFAULT false, date_needed date, start_time time, helper_confirmed_at timestamptz,
  helper_completed_at timestamptz, response_deadline timestamptz, cancelled_by uuid, cancelled_at timestamptz,
  cancellation_reason text, late_cancellation boolean, cancellation_fee numeric, cancellation_fee_status text,
  direct_offer_status text, direct_offer_expires_at timestamptz, offered_to_helper_id uuid,
  parent_job_id uuid, recurrence_days integer[]);
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
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid, description text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.job_tracking (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  latitude double precision, longitude double precision, created_at timestamptz DEFAULT now(), updated_at timestamptz);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.group_job_helpers TO authenticated;

CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.are_users_blocked(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.helper_accept_block_reason(uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.apply_job_denial_consequence(p_user uuid, p_job uuid, p_desc text) RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, 'job_denial', p_job, p_desc) RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text, p_job_id uuid,
  p_prior_count integer, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
  p_suspension_days integer, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS
  $$ INSERT INTO public.user_violations (user_id, violation_type, job_id, description) VALUES (p_user, p_violation_type, p_job_id, p_description) RETURNING jsonb_build_object('action', 'strike') $$;
CREATE FUNCTION public.apply_cancellation_violation_consequence(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

${FNS.map(fnStmt).join("\n\n")}

${triggerStmt("zza_group_member_lifecycle_server_owned")}
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);
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
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');
  INSERT INTO public.profiles (user_id) VALUES ('${M1}'), ('${M2}'), ('${M3}'), ('${NEWBIE}');`);

/** A booked crew of three ($90, $30 a spot), starting `offset` from now, plus NEWBIE's pending application. */
async function seed(offset, { m3Confirmed = true } = {}) {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.job_tracking; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 90, 'accepted', true, 3,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents) VALUES
      ('${CREW}', '${M1}', 0, 3000), ('${CREW}', '${M2}', 1, 3000), ('${CREW}', '${M3}', 2, 3000);
    -- Server-owned stamps: written as the table owner (the lifecycle trigger
    -- passes a non-client role), the way the confirm RPC writes them.
    UPDATE public.group_job_helpers SET helper_confirmed_at = now() - interval '2 days'
     WHERE helper_id IN ('${M1}', '${M2}'${m3Confirmed ? `, '${M3}'` : ""});
    INSERT INTO public.applications (job_id, helper_id, status) VALUES
      ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted'), ('${CREW}', '${M3}', 'accepted'),
      ('${CREW}', '${NEWBIE}', 'pending');
  `);
}
const roster = async () => (await all(`SELECT helper_id FROM public.group_job_helpers WHERE job_id = '${CREW}' ORDER BY slot_no`)).map((r) => r.helper_id);
const jobStatus = async () => (await one(`SELECT status FROM public.jobs WHERE id = '${CREW}'`)).status;
const posterNotice = async () => (await one(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}' ORDER BY title LIMIT 1`))?.message ?? "";
const STILL_ON = /The rest of your crew is still on\. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot's share is refunded to you once the job is done\./;

// C1-C3, D1: a confirmed member leaves 3 days out.
await seed("3 days");
await as(M3);
let err = await attempt(`SELECT public.helper_cancel_booking('${CREW}')`);
let r1 = await roster();
check("C1 a member leaves a booked crew: the job STAYS booked with the two left",
  !err && r1.length === 2 && !r1.includes(M3) && (await jobStatus()) === "accepted", `err=${err} roster=${r1.length} status=${await jobStatus()}`);
check("C3 the poster is told the rest of the crew is still on and how the spot is filled or refunded",
  STILL_ON.test(await posterNotice()), await posterNotice());
await as(M1);
err = await attempt(`SELECT public.rpc_group_member_on_the_way('${CREW}')`);
const otw = await one(`SELECT helper_on_the_way_at IS NOT NULL AS ok FROM public.group_job_helpers WHERE helper_id = '${M1}'`);
check("C2 a member left can still set out (on the way needs a booked or started job)",
  !err && otw.ok === true && (await jobStatus()) === "in_progress", err || `status=${await jobStatus()}`);
await as(M1);
const d1 = await attempt(`SELECT public.rpc_group_member_mark_done('${CREW}')`);
await as(M2);
let done = null;
try {
  done = (await one(`SELECT public.rpc_group_member_mark_done('${CREW}') AS r`)).r;
} catch (e) { done = { error: e.message }; }
const jobDone = await one(`SELECT helper_completed_at IS NOT NULL AS ok FROM public.jobs WHERE id = '${CREW}'`);
check("D1 the two left finish and the crew completes (every HIRED member done)",
  !d1 && done?.job_complete === true && jobDone.ok === true, `${d1} ${JSON.stringify(done)} jobDone=${jobDone.ok}`);

// B1: the POSTER blocks one confirmed member 3 days out.
await seed("3 days");
await as(POSTER);
err = await attempt(`SELECT public.block_user_and_settle('${M1}', NULL)`);
r1 = await roster();
check("B1 the poster blocks one member: only that member leaves and the job stays booked",
  !err && r1.length === 2 && !r1.includes(M1) && (await jobStatus()) === "accepted", `err=${err} roster=${r1.length} status=${await jobStatus()}`);

// B2: one MEMBER blocks the poster 3 days out.
await seed("3 days");
await as(M2);
err = await attempt(`SELECT public.block_user_and_settle('${POSTER}', NULL)`);
r1 = await roster();
check("B2 a member blocks the poster: the job stays booked and the poster is told the crew is still on",
  !err && r1.length === 2 && !r1.includes(M2) && (await jobStatus()) === "accepted" && STILL_ON.test(await posterNotice()),
  `err=${err} roster=${r1.length} status=${await jobStatus()} notice=${await posterNotice()}`);

// E1: an unconfirmed member's reply deadline passes.
await seed("3 days", { m3Confirmed: false });
await db.exec(`RESET ROLE; UPDATE public.group_job_helpers SET response_deadline = now() - interval '1 minute' WHERE helper_id = '${M3}';`);
const n = (await one(`SELECT public.expire_unanswered_offers() AS n`)).n;
r1 = await roster();
check("E1 an unanswered spot expires: the member loses it and the job stays booked; the poster is told the crew is still on",
  n === 1 && r1.length === 2 && !r1.includes(M3) && (await jobStatus()) === "accepted" && STILL_ON.test(await posterNotice()),
  `n=${n} roster=${r1.length} status=${await jobStatus()}`);
const m3Note = (await one(`SELECT message FROM public.notifications WHERE user_id = '${M3}'`))?.message ?? "";
check("E1 the member who lost the spot is told they lost it (not that it went back to everyone)", /you lost your spot/.test(m3Note), m3Note);

// R1: the poster refills the empty spot of a crew that stayed booked (the
// state C1 leaves), from NEWBIE's pending application.
await seed("3 days");
await db.exec(`RESET ROLE; DELETE FROM public.group_job_helpers WHERE helper_id = '${M3}';`);
const newbieAppId = async () => (await one(`SELECT id FROM public.applications WHERE helper_id = '${NEWBIE}'`)).id;
let app = await newbieAppId();
await as(POSTER);
err = await attempt(`SELECT * FROM public.accept_group_application('${app}', now() + interval '6 hours', NULL)`);
const refilled = await one(`SELECT slot_no, share_cents FROM public.group_job_helpers WHERE helper_id = '${NEWBIE}'`);
const newbieApp = await one(`SELECT status FROM public.applications WHERE id = '${app}'`);
check("R1 the poster refills the spot before the start: same slot, same share, the job stays booked",
  !err && refilled?.slot_no === 2 && refilled?.share_cents === 3000 && newbieApp.status === "accepted"
    && (await roster()).length === 3 && (await jobStatus()) === "accepted",
  `err=${err} slot=${JSON.stringify(refilled)} status=${await jobStatus()}`);

// R2: a refill inside 15 minutes of the start is refused.
await seed("10 minutes");
await as(M3);
await db.exec(`RESET ROLE; DELETE FROM public.group_job_helpers WHERE helper_id = '${M3}';`);
app = await newbieAppId();
await as(POSTER);
err = await attempt(`SELECT * FROM public.accept_group_application('${app}', now() + interval '6 hours', NULL)`);
check("R2 a refill inside 15 minutes of the start is refused", /job_starts_too_soon/.test(err) && (await roster()).length === 2, err);

// R3: no fourth member on a booked crew that is full.
await seed("3 days");
app = await newbieAppId();
await as(POSTER);
err = await attempt(`SELECT * FROM public.accept_group_application('${app}', now() + interval '6 hours', NULL)`);
check("R3 a booked crew that is full takes no one else", /roster_full|job_not_open/.test(err) && (await roster()).length === 3, err);

// Z1: the last member leaves; nobody is left to carry on, so the job reopens.
await seed("3 days");
await db.exec(`RESET ROLE; DELETE FROM public.group_job_helpers WHERE helper_id IN ('${M1}', '${M2}');`);
await as(M3);
err = await attempt(`SELECT public.helper_cancel_booking('${CREW}')`);
check("Z1 a crew with nobody left reopens to everyone", !err && (await roster()).length === 0 && (await jobStatus()) === "open"
  && /their spot is open to everyone again/.test(await posterNotice()), `err=${err} status=${await jobStatus()}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // C1 C2 C3 B1 B2 E1 (both lines) R1 are RED on the old functions. R2 R3 Z1
  // hold either way. D1 holds either way in THIS harness: the old roll-up
  // already re-booked an open crew on its last Done, and the arrival gates
  // that stop an open crew from ever getting there are not installed (C2 is
  // the red check for that).
  const expected = 8;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
