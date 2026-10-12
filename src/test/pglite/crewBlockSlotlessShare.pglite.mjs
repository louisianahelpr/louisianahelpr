#!/usr/bin/env node
/**
 * PGlite proof for 20261012124103_crew_block_slotless_share_by_hire_order
 * (docs/OPEN.md Q1380): a poster who blocks a committed crew member on a
 * roster row from before the slots existed (no slot_no, no share_cents) owes
 * that member the fee on their share BY HIRE ORDER, as poster_cancel_job
 * prices it, not on a $0 share.
 *
 *   npx tsx src/test/pglite/crewBlockSlotlessShare.pglite.mjs [--before]
 *
 * Fixture = crewBlockFeeLedger.pglite.mjs's (every function at its effective
 * definition before this migration, the real roster trigger, the same stubs),
 * plus 20261007073145's crew_block_fees table. The migration's
 * block_user_and_settle is applied 3x. --before leaves it out: S1, S2 and S4 FAIL.
 *
 *   S1 two slotless rows, $100 for 2, the later hire blocked 10h out: the
 *      admins get "fee owed by hand" for $12.50 of a $50.00 share, and the
 *      result says fee_owed_by_hand 12.5
 *   S2 the member is told they are owed $12.50
 *   S3 (control) a slotted row still goes on the ledger as before
 *   S4 the position is hire order (joined_at, then id), not id: $100 for 3
 *      splits 3334/3333/3333, and the member who joined FIRST (not the
 *      lowest id) gets the 3334 share, so a fee of $8.34
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261012124103_crew_block_slotless_share_by_hire_order.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const LEDGER = readFileSync(DIR + "20261007073145_crew_block_fee_ledger.sql", "utf8");
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
  "crew_slot_share_cents", "job_offer_cutoff", "enforce_group_member_lifecycle_server_owned",
  "crew_spots_open", "accept_group_application", "block_user_and_settle",
];

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = U(1), POSTER = U(2), M1 = U(3), M2 = U(4), M3 = U(5), CREW = U(101);

// The migration's other statements need these to exist (they are restated
// whole); they are not under test here (vitest pins them).
const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
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

// The ledger table first: crew_spots_open (a SQL function, checked at
// creation) already reads it at its effective definition.
const TABLE = LEDGER.slice(LEDGER.indexOf("CREATE TABLE IF NOT EXISTS public.crew_block_fees"), LEDGER.indexOf("-- crew_spots_open: a closed spot is taken."));
await db.exec(SCHEMA.replace("CREATE FUNCTION public.is_caller_banned()", `${TABLE}\nCREATE FUNCTION public.is_caller_banned()`));
await db.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${POSTER}'), ('${M1}'), ('${M2}'), ('${M3}');`);
if (!BEFORE) {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(MIGRATION);
      check(`apply ${THIS.slice(0, 14)} pass #${i}`, true);
    } catch (e) {
      check(`apply ${THIS.slice(0, 14)} pass #${i}`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (S1, S2 and S4 must FAIL)`);
}
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'); INSERT INTO public.profiles (user_id) VALUES ('${M1}'), ('${M2}'), ('${M3}');`);

async function seed({ slotted }) {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.crew_block_fees; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', 100, 'accepted', true, 2,
              (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::time);
    INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, joined_at, helper_confirmed_at)
      VALUES ('${CREW}', '${M1}', ${slotted ? 0 : "NULL"}, ${slotted ? 5000 : "NULL"}, now() - interval '3 days', now() - interval '2 days'),
             ('${CREW}', '${M2}', ${slotted ? 1 : "NULL"}, ${slotted ? 5000 : "NULL"}, now() - interval '2 days', now() - interval '2 days');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M1}', 'accepted'), ('${CREW}', '${M2}', 'accepted');
  `);
}
const block = async (who, whom) => {
  await as(who);
  try { return (await one(`SELECT public.block_user_and_settle('${whom}', NULL) AS r`)).r; } catch (e) { return { error: e.message }; }
};

// S1, S2
await seed({ slotted: false });
const r = await block(POSTER, M2);
await db.exec("RESET ROLE");
const crewEntry = (Array.isArray(r) ? r : (r?.settled ?? [])).find?.((x) => x.crew) ?? JSON.stringify(r);
const byHand = await all(`SELECT user_id, message FROM public.notifications WHERE title = 'Crew block: fee owed by hand'`);
check("S1 the slotless later hire's fee is priced on its $50.00 share by hire order and alerted by hand",
  byHand.length === 1 && byHand[0].user_id === ADMIN && /owed a \$12\.50 cancellation fee \(25% of their \$50\.00 share\)/.test(byHand[0].message),
  `byHand=${JSON.stringify(byHand)} result=${JSON.stringify(r).slice(0, 300)}`);
const memberNote = await one(`SELECT message FROM public.notifications WHERE user_id = '${M2}'`);
check("S2 the member is told they are owed $12.50", /owed a \$12\.50 cancellation fee; our team will send it to you/.test(memberNote?.message ?? ""), JSON.stringify(memberNote));

// S3 control
await seed({ slotted: true });
await block(POSTER, M1);
await db.exec("RESET ROLE");
const fees = await all(`SELECT slot_no, fee_cents FROM public.crew_block_fees WHERE job_id = '${CREW}'`);
check("S3 (control) a slotted row still goes on the ledger (slot 0, 1250c)", fees.length === 1 && fees[0].slot_no === 0 && fees[0].fee_cents === 1250, JSON.stringify(fees));

// S4
await db.exec(`
  RESET ROLE;
  DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks;
  DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.crew_block_fees; DELETE FROM public.jobs;
  INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
    VALUES ('${CREW}', '${POSTER}', 'Move a piano', 100, 'accepted', true, 3,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::date,
            (now() AT TIME ZONE 'America/Chicago' + interval '10 hours')::time);
  INSERT INTO public.group_job_helpers (job_id, helper_id, joined_at, helper_confirmed_at)
    VALUES ('${CREW}', '${M1}', now() - interval '2 days', now() - interval '1 day'),
           ('${CREW}', '${M3}', now() - interval '3 days', now() - interval '1 day'),
           ('${CREW}', '${M2}', NULL, now() - interval '1 day');
`);
await block(POSTER, M3);
await db.exec("RESET ROLE");
const s4 = await all(`SELECT message FROM public.notifications WHERE title = 'Crew block: fee owed by hand'`);
check("S4 the earliest joiner (not the lowest id) holds the 3334c share: $8.34 of $33.34",
  s4.length === 1 && /owed a \$8\.34 cancellation fee \(25% of their \$33\.34 share\)/.test(s4[0].message), JSON.stringify(s4));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  console.log(failures === 3 ? "RED as expected (3/3)" : `NOT RED as expected: ${failures} failed`);
  process.exit(failures === 3 ? 0 : 1);
}
process.exit(failures ? 1 : 0);
