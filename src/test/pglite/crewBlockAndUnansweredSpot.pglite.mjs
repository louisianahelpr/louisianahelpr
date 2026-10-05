#!/usr/bin/env node
/**
 * PGlite proof for 20261005172453_crew_block_and_unanswered_spot (docs/OPEN.md
 * Q729 + Q1282; a crew has no lead, Q407; owner decisions 2026-10-05).
 *
 *   npx tsx src/test/pglite/crewBlockAndUnansweredSpot.pglite.mjs [--replay] [--before]
 *
 * Every function is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts), with the REAL roster lifecycle
 * trigger. --before leaves the migration out and every crew check must FAIL;
 * without it the migration is applied (3x with --replay) and all must PASS.
 * Stubs (not under test): is_caller_banned (false), are_users_blocked (false),
 * helper_accept_block_reason (NULL), apply_consequence_ladder and
 * apply_job_denial_consequence (record a strike row).
 *
 *   B1 the POSTER blocks a confirmed member 10h out: only that member leaves,
 *      the crew reopens, the poster gets the cancel-with-Helpr strike, every
 *      admin is alerted with the member's fee to settle by hand
 *   B2 the MEMBER blocks the poster 10h out: they leave with
 *      helper_cancel_booking's crew strike; the poster is told
 *   B3 a crew past its start: nothing moves, every admin is alerted once
 *      (a repeat block does not re-alert: authz review #2)
 *   E1 a crew hire keeps the poster's reply deadline on the member's row
 *   E1b a backdated deadline is clamped to about an hour (authz review #1)
 *   E2 an unconfirmed member past their deadline loses the spot (strike,
 *      application offer_expired, crew reopened, both told); a confirmed
 *      member is untouched
 *   L1 the poster cannot move a member's deadline (server-owned)
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261005172453_crew_block_and_unanswered_spot.sql";
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
  "crew_slot_share_cents", "enforce_group_member_lifecycle_server_owned", "accept_group_application",
  "expire_unanswered_offers", "block_user_and_settle",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), POSTER = U(2), M1 = U(3), M2 = U(4), CREW = U(101);

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
  direct_offer_status text, direct_offer_expires_at timestamptz, offered_to_helper_id uuid);
CREATE TABLE public.group_job_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid, status text NOT NULL DEFAULT 'accepted', joined_at timestamptz DEFAULT now(), slot_no integer, share_cents integer,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, helper_on_the_way_at timestamptz,
  helper_arrived_at timestamptz, helper_arrival_verified_at timestamptz, helper_arrival_near_miss_at timestamptz,
  helper_arrival_near_miss_ft integer, poster_confirmed_arrival_at timestamptz, poster_confirmed_working_at timestamptz,
  helper_completed_at timestamptz, poster_confirmed_completion_at timestamptz, proof_before_urls text[], proof_after_urls text[],
  UNIQUE (job_id, helper_id));
CREATE TABLE public.applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text,
  closed_reason text, offer_message text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, message text, link text, job_id uuid);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, is_seed boolean DEFAULT false);
CREATE TABLE public.user_blocks (blocker_id uuid, blocked_id uuid, reason text, PRIMARY KEY (blocker_id, blocked_id));
CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, violation_type text, job_id uuid, description text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
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
-- Present in both states, so the BEFORE run measures behaviour, not a missing column.
ALTER TABLE public.group_job_helpers ADD COLUMN IF NOT EXISTS response_deadline timestamptz;
`;

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);

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
  console.log(`--before: ${THIS} NOT applied (every crew check must FAIL)`);
}
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'); INSERT INTO public.profiles (user_id) VALUES ('${M1}'), ('${M2}');`);

/** A full crew of two (accepted), both confirmed unless said, starting `offset` from now. */
async function seed(offset, { m1Confirmed = true, m2Confirmed = true, status = "accepted" } = {}) {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 100, '${status}', true, 2,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES
      ('${CREW}', '${M1}', 0, 5000, ${m1Confirmed ? "now() - interval '2 days'" : "NULL"}),
      ('${CREW}', '${M2}', 1, 5000, ${m2Confirmed ? "now() - interval '2 days'" : "NULL"});
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted');
  `);
}
const roster = async () => (await all(`SELECT helper_id FROM public.group_job_helpers WHERE job_id = '${CREW}' ORDER BY slot_no`)).map((r) => r.helper_id);
const jobStatus = async () => (await one(`SELECT status FROM public.jobs WHERE id = '${CREW}'`)).status;

// B1
await seed("10 hours");
await as(POSTER);
let r = await one(`SELECT public.block_user_and_settle('${M1}', NULL) AS r`).catch((e) => ({ r: { error: e.message } }));
let strikes = await all(`SELECT user_id, violation_type FROM public.user_violations`);
let adminAlerts = await all(`SELECT message FROM public.notifications WHERE type = 'admin_alert'`);
let r1 = await roster();
check("B1 poster blocks a confirmed member: only that member leaves and the crew reopens",
  r1.length === 1 && r1[0] === M2 && (await jobStatus()) === "open", `roster=${JSON.stringify(r1)} result=${JSON.stringify(r?.r)}`);
check("B1 the poster takes the cancel-with-Helpr strike",
  strikes.length === 1 && strikes[0].user_id === POSTER && strikes[0].violation_type === "cancel_with_helper", JSON.stringify(strikes));
check("B1 every admin is alerted with the member's fee to settle by hand",
  adminAlerts.length === 1 && /owed a \$\d+\.\d\d cancellation fee/.test(adminAlerts[0].message), JSON.stringify(adminAlerts));
const m1Note = await one(`SELECT title FROM public.notifications WHERE user_id = '${M1}'`);
const m1App = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${M1}'`);
check("B1 the member is told and their application closed party_blocked",
  !!m1Note && m1App.status === "rejected" && m1App.closed_reason === "party_blocked", `${JSON.stringify(m1Note)} ${JSON.stringify(m1App)}`);

// B2
await seed("10 hours");
await as(M1);
r = await one(`SELECT public.block_user_and_settle('${POSTER}', NULL) AS r`).catch((e) => ({ r: { error: e.message } }));
strikes = await all(`SELECT user_id, violation_type FROM public.user_violations`);
const pNote = await one(`SELECT title FROM public.notifications WHERE user_id = '${POSTER}'`);
r1 = await roster();
check("B2 the member blocks the poster: they leave with helper_cancel_booking's crew strike, the poster is told",
  r1.length === 1 && r1[0] === M2 && strikes.length === 1 && strikes[0].user_id === M1 && strikes[0].violation_type === "job_denial"
    && pNote?.title === "A Helpr left your crew",
  `roster=${JSON.stringify(r1)} strikes=${JSON.stringify(strikes)} poster=${JSON.stringify(pNote)} result=${JSON.stringify(r?.r)}`);

// B3
await seed("-2 hours", { status: "in_progress" });
await as(POSTER);
await db.exec(`SELECT public.block_user_and_settle('${M1}', NULL)`);
// A repeat call (the block already exists) must not re-alert (review #2).
await db.exec(`SELECT public.block_user_and_settle('${M1}', NULL)`);
adminAlerts = await all(`SELECT title FROM public.notifications WHERE type = 'admin_alert'`);
r1 = await roster();
check("B3 a crew past its start: nothing moves, every admin is alerted",
  r1.length === 2 && adminAlerts.length === 1, `roster=${JSON.stringify(r1)} alerts=${JSON.stringify(adminAlerts)}`);

// E1
await seed("3 days", { m2Confirmed: false });
await db.exec(`DELETE FROM public.group_job_helpers WHERE helper_id = '${M2}'; UPDATE public.jobs SET status = 'open' WHERE id = '${CREW}';
               UPDATE public.applications SET status = 'pending' WHERE helper_id = '${M2}';`);
const appId = (await one(`SELECT id FROM public.applications WHERE helper_id = '${M2}'`)).id;
await as(POSTER);
await db.exec(`SELECT * FROM public.accept_group_application('${appId}', now() + interval '6 hours', NULL)`);
const dl = await one(`SELECT response_deadline FROM public.group_job_helpers WHERE helper_id = '${M2}'`);
check("E1 a crew hire keeps the poster's reply deadline on the member's row", !!dl?.response_deadline, JSON.stringify(dl));
// E1b: a backdated deadline is clamped to about an hour (review #1).
await db.exec(`RESET ROLE; DELETE FROM public.group_job_helpers WHERE helper_id = '${M2}'; UPDATE public.jobs SET status = 'open' WHERE id = '${CREW}'; UPDATE public.applications SET status = 'pending' WHERE helper_id = '${M2}';`);
await as(POSTER);
await db.exec(`SELECT * FROM public.accept_group_application('${appId}', '2000-01-01T00:00:00Z', NULL)`);
const dl2 = await one(`SELECT response_deadline > now() + interval '50 minutes' AS ok, response_deadline FROM public.group_job_helpers WHERE helper_id = '${M2}'`);
check("E1b a backdated reply deadline is clamped to about an hour from now", dl2?.ok === true, JSON.stringify(dl2));

// L1
await db.exec(`SET ROLE authenticated`);
let refused = "";
try {
  await db.exec(`UPDATE public.group_job_helpers SET response_deadline = now() - interval '1 hour' WHERE helper_id = '${M2}'`);
} catch (e) { refused = e.message; }
await db.exec(`RESET ROLE`);
check("L1 the poster cannot move a member's deadline", /stamped by the server/.test(refused), refused || "the write went through");

// E2
await seed("3 days", { m2Confirmed: false });
await db.exec(`UPDATE public.group_job_helpers SET response_deadline = now() - interval '1 minute';`);
await as(ADMIN);
await db.exec(`RESET ROLE`);
const n = (await one(`SELECT public.expire_unanswered_offers() AS n`)).n;
r1 = await roster();
strikes = await all(`SELECT user_id FROM public.user_violations`);
const m2App = await one(`SELECT status, closed_reason FROM public.applications WHERE helper_id = '${M2}'`);
const told = await all(`SELECT user_id FROM public.notifications WHERE user_id IN ('${POSTER}', '${M2}')`);
check("E2 an unconfirmed member past their deadline loses the spot; the confirmed member stays; the crew reopens",
  n === 1 && r1.length === 1 && r1[0] === M1 && (await jobStatus()) === "open", `n=${n} roster=${JSON.stringify(r1)}`);
check("E2 strike, application closed offer_expired, both sides told",
  strikes.length === 1 && strikes[0].user_id === M2 && m2App.status === "rejected" && m2App.closed_reason === "offer_expired" && told.length === 2,
  `strikes=${JSON.stringify(strikes)} app=${JSON.stringify(m2App)} told=${told.length}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  const expected = 11;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
