#!/usr/bin/env node
/**
 * PGlite proof for 20261007073145_crew_block_fee_ledger.sql (docs/OPEN.md Q1390; owner decision 2026-10-07,
 * option (a)): a poster who blocks a committed crew member close to the start
 * owes that member a fee, which goes on public.crew_block_fees (paid from the
 * job's escrow when it settles, _shared/crewBlockFees.ts), and the spot stays
 * closed.
 *
 *   npx tsx src/test/pglite/crewBlockFeeLedger.pglite.mjs [--replay] [--before]
 *
 * Every function is loaded from its EFFECTIVE definition before this migration
 * (src/test/helpers/effectiveFunctionDefs.ts), with the real roster lifecycle
 * trigger. --before leaves the migration out and every Q1390 check must FAIL;
 * without it the migration is applied (3x with --replay) and all must PASS.
 * Stubs (not under test): is_caller_banned, are_users_blocked,
 * helper_accept_block_reason, apply_consequence_ladder,
 * apply_job_denial_consequence.
 *
 *   F1 the poster blocks a confirmed member 10h out: one ledger row (slot,
 *      25% of the share), the spot stays closed, no by-hand admin alert, the
 *      poster and the member are told
 *   F2 a repeat block writes no second row
 *   F3 a booked crew with a closed spot is full: no hire into it
 *   F4 a staffing crew: the next hire takes a free slot, never the closed one
 *   F5 (control, passes in both states) a block three days out (no fee): no
 *      row, the spot reopens as before
 *   F6 every spot closed: nothing reopens it, admins are told to cancel
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs, migrationFiles } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261007073145_crew_block_fee_ledger.sql";
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

// Only the parts of the migration this proof exercises: the ledger, the spot
// count and the two RPCs (open_jobs_browse and export_my_data need the whole
// app schema; src/test/crewBlockFeeLedger.test.ts pins them).
function migrationUnderTest() {
  const keep = [];
  const t = MIGRATION;
  const table = t.slice(t.indexOf("CREATE TABLE IF NOT EXISTS public.crew_block_fees"), t.indexOf("-- crew_spots_open: a closed spot is taken."));
  keep.push(table);
  for (const fn of ["crew_spots_open", "accept_group_application", "block_user_and_settle"]) {
    const i = t.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    // The body's own dollar tag ($function$, $$, $fn$ ...), whatever the source used.
    const open = /\bAS\s+(\$\w*\$)/i.exec(t.slice(i));
    const tag = open[1];
    const close = t.indexOf(tag, i + open.index + open[0].length);
    keep.push(t.slice(i, close + tag.length) + ";");
  }
  return keep.join("\n\n");
}

const db = new PGlite();
const one = async (sql, p) => (await db.query(sql, p)).rows[0];
const all = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid}', false)`);

await db.exec(SCHEMA);
await db.exec(`INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${POSTER}'), ('${M1}'), ('${M2}'), ('${M3}');`);
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try {
      await db.exec(migrationUnderTest());
      console.log(`applied ${THIS} (run ${i})`);
    } catch (e) {
      check(`migration applies (run ${i})`, false, e.message);
    }
  }
} else {
  console.log(`--before: ${THIS} NOT applied (every Q1390 check must FAIL)`);
}
await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin'); INSERT INTO public.profiles (user_id) VALUES ('${M1}'), ('${M2}'), ('${M3}');`);

const hasLedger = async () => !!(await one(`SELECT to_regclass('public.crew_block_fees') AS t`)).t;
const fees = async () => (await hasLedger()) ? await all(`SELECT helper_id, slot_no, share_basis_cents, fee_percent, fee_cents, status FROM public.crew_block_fees WHERE job_id = '${CREW}' ORDER BY slot_no`) : [];

/** A crew of `needed`, members as given (confirmed), starting `offset` from now. */
async function seed(offset, { needed = 2, members = [M1, M2], status = "accepted" } = {}) {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.notifications; DELETE FROM public.user_violations; DELETE FROM public.user_blocks;
    DELETE FROM public.applications; DELETE FROM public.group_job_helpers; DELETE FROM public.jobs;
    INSERT INTO public.jobs (id, customer_id, title, budget, status, is_group_job, helpers_needed, date_needed, start_time)
      VALUES ('${CREW}', '${POSTER}', 'Move a piano', ${needed * 50}, '${status}', true, ${needed},
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::date,
              (now() AT TIME ZONE 'America/Chicago' + interval '${offset}')::time);
    ${members.map((m, i) => `INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES ('${CREW}', '${m}', ${i}, 5000, now() - interval '2 days');
    INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${m}', 'accepted');`).join("\n")}
  `);
}
const spotsOpen = async () => (await one(`SELECT public.crew_spots_open('${CREW}') AS n`)).n;
const jobStatus = async () => (await one(`SELECT status FROM public.jobs WHERE id = '${CREW}'`)).status;
const block = async (who, whom) => {
  await as(who);
  try { return (await one(`SELECT public.block_user_and_settle('${whom}', NULL) AS r`)).r; } catch (e) { return { error: e.message }; }
};

// F1
await seed("10 hours");
let r = await block(POSTER, M1);
let f = await fees();
check("F1 a block 10h out records the member's fee on the ledger (slot 0, 25% of the 5000c share)",
  f.length === 1 && f[0].helper_id === M1 && f[0].slot_no === 0 && f[0].fee_percent === 25 && f[0].fee_cents === 1250 && f[0].status === "owed",
  `fees=${JSON.stringify(f)} result=${JSON.stringify(r)}`);
check("F1 the spot stays closed: no spot open, the crew stays booked", (await spotsOpen()) === 0 && (await jobStatus()) === "accepted",
  `spots=${await spotsOpen()} status=${await jobStatus()}`);
const byHand = await all(`SELECT title FROM public.notifications WHERE title = 'Crew block: fee owed by hand'`);
const posterNote = await one(`SELECT message FROM public.notifications WHERE user_id = '${POSTER}' AND title = 'Crew spot closed'`);
const memberNote = await one(`SELECT message FROM public.notifications WHERE user_id = '${M1}'`);
check("F1 no by-hand admin alert; the poster is told the spot is closed and the fee comes out of its share",
  byHand.length === 0 && /\$12\.50 cancellation fee comes out of that spot's \$50\.00 share/.test(posterNote?.message ?? ""),
  `byHand=${byHand.length} poster=${JSON.stringify(posterNote)}`);
check("F1 the member is told the fee is paid from the job's payment when it settles",
  /paid to you from the job's payment when the job settles/.test(memberNote?.message ?? ""), JSON.stringify(memberNote));

// F2
await db.exec(`RESET ROLE; INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents, helper_confirmed_at) VALUES ('${CREW}', '${M1}', 0, 5000, now())`).catch(() => {});
await block(POSTER, M1);
f = await fees();
check("F2 a repeat block on the same slot writes no second row", f.length === 1, JSON.stringify(f));

// F3
await seed("10 hours");
await block(POSTER, M1);
await db.exec(`RESET ROLE; INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M3}', 'pending')`);
let appId = (await one(`SELECT id FROM public.applications WHERE helper_id = '${M3}'`)).id;
await as(POSTER);
let refused = "";
try { await db.exec(`SELECT * FROM public.accept_group_application('${appId}', now() + interval '6 hours', NULL)`); } catch (e) { refused = e.message; }
check("F3 a booked crew with a closed spot is full: no hire into it", /roster_full/.test(refused), refused || "hired");

// F4
await seed("10 hours", { needed: 3, members: [M1], status: "open" });
await block(POSTER, M1);
await db.exec(`RESET ROLE; INSERT INTO public.applications (job_id, helper_id, status) VALUES ('${CREW}', '${M2}', 'pending')`);
appId = (await one(`SELECT id FROM public.applications WHERE helper_id = '${M2}'`)).id;
await as(POSTER);
try { await db.exec(`SELECT * FROM public.accept_group_application('${appId}', now() + interval '6 hours', NULL)`); } catch (e) { check("F4 hire", false, e.message); }
const m2Slot = await one(`SELECT slot_no FROM public.group_job_helpers WHERE helper_id = '${M2}'`);
check("F4 the next hire takes a free slot, never the closed one; one spot is left",
  m2Slot?.slot_no === 1 && (await spotsOpen()) === 1, `slot=${JSON.stringify(m2Slot)} spots=${await spotsOpen()}`);

// F5
await seed("3 days");
await block(POSTER, M1);
f = await fees();
check("F5 a block three days out owes no fee: no ledger row, and the spot reopens", f.length === 0 && (await spotsOpen()) === 1,
  `fees=${JSON.stringify(f)} spots=${await spotsOpen()}`);

// F6
await seed("10 hours");
await block(POSTER, M1);
await block(POSTER, M2);
const noSpots = await all(`SELECT user_id FROM public.notifications WHERE title = 'Crew job has no spots left'`);
check("F6 every spot closed: nothing reopens it and every admin is told to cancel it",
  (await fees()).length === 2 && (await jobStatus()) === "accepted" && noSpots.length === 1 && noSpots[0].user_id === ADMIN,
  `status=${await jobStatus()} alerts=${JSON.stringify(noSpots)}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (BEFORE) {
  // F5 is the control: a fee-free block behaves the same before and after.
  const expected = 8;
  console.log(failures === expected ? `RED as expected (${failures}/${expected})` : `NOT RED: ${failures}/${expected} failed`);
  process.exit(failures === expected ? 0 : 1);
}
process.exit(failures ? 1 : 0);
