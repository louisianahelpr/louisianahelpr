#!/usr/bin/env node
/**
 * PGlite proof for 20261007131605_crew_block_slotless_fee_by_hire_order (Q1380):
 * a poster who blocks a member of a crew whose roster rows have NO slot_no
 * (legacy rows) owes that member a fee priced on the member's hire-order slot
 * share, as poster_cancel_job prices it, not $0.
 *
 *   npx tsx src/test/pglite/crewSlotlessBlockFee.pglite.mjs [--replay] [--before]
 *
 * Harness copied from crewBlockAndUnansweredSpot.pglite.mjs: every function at
 * its EFFECTIVE definition before this migration (= live), the real roster
 * lifecycle trigger; --before leaves the migration out (expect the FAIL).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261007131605_crew_block_slotless_fee_by_hire_order.sql";
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

// A legacy crew of two ($100.03: slots of 50.02 and 50.01, whose 25% fees round to 12.51 and 12.50), both
// confirmed, slot_no and share_cents NULL, 10 hours out. The poster blocks the
// SECOND-hired member, so a wrong hire-order index (rn instead of rn - 1, or
// the wrong ORDER BY) prices the other slot and the cent shows (lh-money-escrow
// review of Q1380, finding 4).
await db.exec(`
  RESET ROLE;
  INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
    VALUES ('${CREW}', '${POSTER}', 'Move a piano', 100.03, 'accepted', true, 2,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::time);
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at, joined_at) VALUES
    ('${CREW}', '${M1}', NULL, NULL, now() - interval '2 days', now() - interval '3 days'),
    ('${CREW}', '${M2}', NULL, NULL, now() - interval '2 days', now() - interval '2 days');
  INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted');
`);
const pct = Number((await one(`SELECT public.cancellation_fee_percent(true, public.job_hours_until_start((now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date, (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::time, now())) AS p`)).p);
const share = Number((await one(`SELECT public.crew_slot_share_cents(10003::bigint, 2, 1) AS s`)).s);
const other = Number((await one(`SELECT public.crew_slot_share_cents(10003::bigint, 2, 0) AS s`)).s);
check("fixture: the two slots' fees differ, so the slot index is pinned", share !== other && share > 0 && other > 0 && Math.round((share * pct) / 100) !== Math.round((other * pct) / 100), `slot1=${share} slot0=${other}`);
await as(POSTER);
const r = await one(`SELECT public.block_user_and_settle('${M2}', NULL) AS r`).catch((e) => ({ r: { error: e.message } }));
await db.exec("RESET ROLE");
const alert = await one(`SELECT message FROM public.notifications WHERE type = 'admin_alert'`);
const owed = /owed a \$(\d+\.\d\d) cancellation fee/.exec(alert?.message ?? "")?.[1];
const expected = (Math.round((share * pct) / 100) / 100).toFixed(2);
check("the second-hired slotless member's fee is slot 1's share's fee, not $0 and not slot 0's",
  pct > 0 && share > 0 && owed === expected && owed !== "0.00" && owed !== (Math.round((other * pct) / 100) / 100).toFixed(2),
  `owed=${owed} expected=${expected} pct=${pct} share=${share} result=${JSON.stringify(r?.r)} alert=${alert?.message}`);

// And the FIRST-hired member, on the same crew: slot 0 (12.51). Pins rn - 1
// from the other side (rn would price them on slot 1, 12.50).
await db.exec("RESET ROLE; DELETE FROM public.notifications;");
await as(POSTER);
const r1 = await one(`SELECT public.block_user_and_settle('${M1}', NULL) AS r`).catch((e) => ({ r: { error: e.message } }));
await db.exec("RESET ROLE");
const alert1 = await one(`SELECT message FROM public.notifications WHERE type = 'admin_alert'`);
const owed1 = /owed a \$(\d+\.\d\d) cancellation fee/.exec(alert1?.message ?? "")?.[1];
const expected1 = (Math.round((other * pct) / 100) / 100).toFixed(2);
check("the first-hired slotless member's fee is slot 0's share's fee",
  owed1 === expected1 && owed1 !== expected,
  `owed=${owed1} expected=${expected1} result=${JSON.stringify(r1?.r)} alert=${alert1?.message}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  console.log(failures === 2 ? "RED as expected (2/3: both fee checks)" : `NOT RED: ${failures}/3 failed`);
  process.exit(failures === 2 ? 0 : 1);
}
process.exit(failures ? 1 : 0);
