#!/usr/bin/env node
/**
 * PGlite proof for 20261103032329_solo_hire_takes_helpr_schedule_lock and
 * 20261103032330_series_claim_takes_helpr_schedule_lock (docs/OPEN.md Q1919,
 * part 2: the solo hire writers).
 *
 *   npx tsx src/test/pglite/soloHireTakesHelprScheduleLock.pglite.mjs           # AFTER: both migrations applied 3x
 *   npx tsx src/test/pglite/soloHireTakesHelprScheduleLock.pglite.mjs --before  # RED: the live definitions
 *
 * The four functions are loaded from their EFFECTIVE definitions (before these
 * migrations with --before; md5(prosrc) of each = live prod, measured
 * 2026-11-02, listed in the migration headers). Stubs (not under test):
 * are_users_blocked (a spy: records whether this backend already holds the
 * Helpr's schedule lock; every function under test calls it first after its
 * job row is locked), direct_accept_block_reason (a spy too: the setup
 * trigger calls it in its FOR UPDATE OF j cursor; it raises a deadlock error
 * on demand), helper_accept_block_reason, complete_job_accept,
 * job_offer_cutoff, is_caller_banned, is_series_party, series_visit_dates,
 * member_display_name, helper_accept_missing.
 *
 * PGlite is one connection, so the race itself cannot be run here. What this
 * proves is the half the race depends on: each hire writer holds the SAME
 * advisory lock respond_job_schedule_change takes,
 * pg_advisory_xact_lock(hashtext('helpr_schedule:' || helper)), before its
 * checks and its booking write, until its transaction ends. Two transactions
 * that both take one advisory lock take turns (Postgres semantics). The lock
 * order is argued per function in the migration headers and pinned by
 * src/test/crewSeatTakesHelprScheduleLock.test.ts.
 *
 *   A1 accept_application holds helpr_schedule:<the hired Helpr> at its end           RED before
 *   A2 it already holds it at the first call after its job lock                       RED before
 *   A3 it holds no schedule lock for another Helpr; A4 the hire is made
 *   D1 complete_direct_offer_accept holds the lock at its end                         RED before
 *   D2 it already holds it at the first call after its job lock                       RED before
 *   D3 the direct offer is accepted
 *   C1 claim_series_dates holds the caller's lock at its end                          RED before
 *   C2 it already holds it at the first call after the series lock                    RED before
 *   C3 the vacated visit is booked to the caller
 *   S1 the setup trigger holds the lock when its FOR UPDATE OF j cursor runs          RED before
 *   S2 the pending direct offer is completed and the Helpr told
 *   S3 a deadlock in the trigger's loop keeps the Stripe status write and logs it     RED before
 *      (the error_logs row carries user_id and pending_count)
 *   claim_series_dates AFTER is Q2247's body (20261102230059, the unready-holds-one cap) plus the lock.
 *   L  every schedule lock is released at COMMIT
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const SOLO = "20261103032329_solo_hire_takes_helpr_schedule_lock.sql";
const SERIES = "20261103032330_series_claim_takes_helpr_schedule_lock.sql";
const BEFORE = process.argv.includes("--before");
const FNS = ["accept_application", "complete_direct_offer_accept", "complete_pending_accepts_on_setup", "claim_series_dates"];

function fnStmt(defs, name) {
  const d = defs.get(name);
  if (!d) throw new Error(`no migration defines ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  const end = d.stmt.indexOf(open[1], open.index + open[0].length);
  return `${d.stmt.slice(0, end + open[1].length)};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), H = U(2), OTHER = U(3);
const JOB_A = U(101), APP_A = U(201), JOB_D = U(102), JOB_S = U(103), PARENT = U(104), CHILD = U(105);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open','accepted','in_progress','completed','cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, budget numeric,
  status public.job_status NOT NULL DEFAULT 'open', is_group_job boolean DEFAULT false,
  date_needed date, start_time time, response_deadline timestamptz, payment_status text,
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, is_seed boolean DEFAULT false,
  recurring_helper_id uuid, recurrence_days smallint[], recurrence_weeks integer, parent_job_id uuid,
  series_ended_on date, helper_confirmed_at timestamptz);
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, status text, message text, offer_message text,
  UNIQUE (job_id, helper_id));
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, full_name text, is_seed boolean DEFAULT false, ban_status text, auto_suspended_until timestamptz,
  stripe_account_id text, stripe_payouts_enabled boolean DEFAULT false, stripe_identity_verified boolean, idv_status text);
CREATE TABLE public.job_accept_pending (job_id uuid, helper_id uuid, requested_at timestamptz DEFAULT now());
CREATE TABLE public.notifications (user_id uuid, job_id uuid, title text, message text, type text, link text);
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb);
CREATE TABLE public.series_date_offers (parent_job_id uuid, helper_id uuid);
CREATE TABLE public.series_visit_holds (parent_job_id uuid, visit_date date, helper_id uuid, UNIQUE (parent_job_id, visit_date));
CREATE TABLE public.recurring_visit_releases (parent_job_id uuid, visit_date date, helper_id uuid);

-- The spy: whether this backend holds the Helpr's schedule lock right now.
CREATE TABLE public.spy (at text, held boolean);
CREATE FUNCTION public.holds_schedule_lock(p_helper uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM pg_locks l
                  WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                    AND ((l.classid::bigint << 32) | l.objid::bigint) = hashtext('helpr_schedule:' || p_helper::text)::bigint)
$$;
CREATE FUNCTION public.are_users_blocked(a uuid, b uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.spy VALUES ('are_users_blocked', public.holds_schedule_lock('${H}'));
  RETURN false;
END $$;
CREATE FUNCTION public.direct_accept_block_reason(p_job uuid, p_helper uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.spy VALUES ('direct_accept_block_reason', public.holds_schedule_lock(p_helper));
  IF current_setting('test.deadlock', true) = '1' THEN
    RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION public.helper_accept_block_reason(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.helper_accept_missing(p uuid) RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY[]::text[] $$;
CREATE FUNCTION public.complete_job_accept(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.job_offer_cutoff(p_date date, p_time time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT now() + interval '5 days' $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.is_series_party(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.series_visit_dates(d date, days smallint[], weeks integer) RETURNS SETOF date LANGUAGE sql AS $$
  SELECT g::date FROM generate_series(d, d + 60, interval '1 day') g $$;
CREATE FUNCTION public.member_display_name(n text, fallback text) RETURNS text LANGUAGE sql AS $$ SELECT coalesce(n, fallback) $$;
`);

if (BEFORE) {
  const defs = effectiveDefs(DIR, { before: SOLO });
  for (const f of FNS) await db.exec(fnStmt(defs, f));
  console.log("--before: the live definitions (expect A1 A2 D1 D2 C1 C2 S1 S3 to FAIL)");
} else {
  for (const file of [SOLO, SERIES]) {
    const sql = readFileSync(DIR + file, "utf8");
    for (let i = 0; i < 3; i++) await db.exec(sql);
  }
  check("both migrations apply 3x (replay-safe)", true);
  const defs = effectiveDefs(DIR);
  check("the newest definitions are these migrations'",
    FNS.every((f) => defs.get(f)?.file === (f === "claim_series_dates" ? SERIES : SOLO)),
    FNS.map((f) => `${f}=${defs.get(f)?.file}`).join(" "));
}
// The trigger as prod has it (20261020*; not under test).
await db.exec(`CREATE TRIGGER trg_profiles_complete_pending_accepts
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.complete_pending_accepts_on_setup();`);

const locksNow = async () => (await db.query(`SELECT public.holds_schedule_lock('${H}') AS h, public.holds_schedule_lock('${OTHER}') AS o`)).rows[0];
const spyAt = async (at) => (await db.query(`SELECT held FROM public.spy WHERE at = $1`, [at])).rows.map((r) => r.held);
const advisoryLeft = async () => (await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n;
const leftAfter = [];

await db.exec(`
INSERT INTO public.profiles (user_id, full_name) VALUES ('${H}', 'Hana Helpr'), ('${POSTER}', 'Pat Poster');
INSERT INTO public.jobs (id, title, customer_id, status, date_needed, start_time) VALUES ('${JOB_A}', 'Move a couch', '${POSTER}', 'open', current_date + 5, '10:00');
INSERT INTO public.applications (id, job_id, helper_id, status) VALUES ('${APP_A}', '${JOB_A}', '${H}', 'pending');
INSERT INTO public.jobs (id, title, customer_id, status, date_needed, start_time, payment_status, offered_to_helper_id, direct_offer_status)
VALUES ('${JOB_D}', 'Hang shelves', '${POSTER}', 'open', current_date + 6, '10:00', 'escrow', '${H}', 'pending'),
       ('${JOB_S}', 'Rake leaves', '${POSTER}', 'open', current_date + 7, '10:00', 'escrow', '${H}', 'pending');
INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${JOB_S}', '${H}');
INSERT INTO public.jobs (id, title, customer_id, helper_id, recurring_helper_id, status, date_needed, recurrence_days, recurrence_weeks)
VALUES ('${PARENT}', 'Weekly mowing', '${POSTER}', '${OTHER}', '${OTHER}', 'accepted', current_date, '{1}', 1);
INSERT INTO public.jobs (id, title, customer_id, status, date_needed, start_time, parent_job_id)
VALUES ('${CHILD}', 'Weekly mowing', '${POSTER}', 'open', current_date + 5, '10:00', '${PARENT}');
INSERT INTO public.series_date_offers VALUES ('${PARENT}', '${H}');
`);

// A: accept_application, as the poster.
await db.exec(`DELETE FROM public.spy; BEGIN; SELECT set_config('request.jwt.claim.sub', '${POSTER}', true);`);
await db.query(`SELECT public.accept_application('${APP_A}', now() + interval '6 hours', NULL)`);
let end = await locksNow();
let spy = await spyAt("are_users_blocked");
await db.exec("COMMIT");
leftAfter.push(await advisoryLeft());
const a = (await db.query(`SELECT status::text AS s, helper_id FROM public.jobs WHERE id = '${JOB_A}'`)).rows[0];
check("A1 accept_application holds helpr_schedule:<the hired Helpr> at its end", end.h === true, `held=${end.h}`);
check("A2 it already holds it at the first call after its job lock", spy.length === 1 && spy[0] === true, JSON.stringify(spy));
check("A3 no schedule lock for another Helpr", end.o === false);
check("A4 the hire is made", a.s === "accepted" && a.helper_id === H, JSON.stringify(a));

// D: complete_direct_offer_accept, from a server context (its callers run it there).
await db.exec(`DELETE FROM public.spy; BEGIN;`);
const d = (await db.query(`SELECT public.complete_direct_offer_accept('${JOB_D}', '${H}') AS r`)).rows[0].r;
end = await locksNow();
spy = await spyAt("are_users_blocked");
await db.exec("COMMIT");
leftAfter.push(await advisoryLeft());
const dj = (await db.query(`SELECT status::text AS s, helper_id, direct_offer_status AS o FROM public.jobs WHERE id = '${JOB_D}'`)).rows[0];
check("D1 complete_direct_offer_accept holds the lock at its end", end.h === true, `held=${end.h}`);
check("D2 it already holds it at the first call after its job lock", spy.length === 1 && spy[0] === true, JSON.stringify(spy));
check("D3 the direct offer is accepted", d?.action === "accepted" && dj.s === "accepted" && dj.helper_id === H && dj.o === "accepted", JSON.stringify({ d, dj }));

// C: claim_series_dates, as the Helpr, picking up the vacated visit.
await db.exec(`DELETE FROM public.spy; BEGIN; SELECT set_config('request.jwt.claim.sub', '${H}', true);`);
const c = (await db.query(`SELECT public.claim_series_dates('${PARENT}', ARRAY[current_date + 5]) AS r`)).rows[0].r;
end = await locksNow();
spy = await spyAt("are_users_blocked");
await db.exec("COMMIT");
leftAfter.push(await advisoryLeft());
const cj = (await db.query(`SELECT status::text AS s, helper_id FROM public.jobs WHERE id = '${CHILD}'`)).rows[0];
check("C1 claim_series_dates holds the caller's lock at its end", end.h === true, `held=${end.h}`);
check("C2 it already holds it at the first call after the series lock", spy.length === 1 && spy[0] === true, JSON.stringify(spy));
check("C3 the vacated visit is booked to the caller", c?.claimed?.length === 1 && cj.s === "accepted" && cj.helper_id === H, JSON.stringify({ c, cj }));

// S: the setup trigger, fired by the Stripe status write.
await db.exec(`DELETE FROM public.spy; BEGIN;`);
await db.exec(`UPDATE public.profiles SET stripe_payouts_enabled = true WHERE user_id = '${H}'`);
end = await locksNow();
spy = await spyAt("direct_accept_block_reason");
await db.exec("COMMIT");
leftAfter.push(await advisoryLeft());
const sj = (await db.query(`SELECT status::text AS s, helper_id FROM public.jobs WHERE id = '${JOB_S}'`)).rows[0];
const told = (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${H}' AND job_id = '${JOB_S}' AND title = 'You''re all set'`)).rows[0].n;
check("S1 the setup trigger holds the lock when its FOR UPDATE OF j cursor runs", spy.length > 0 && spy[0] === true, JSON.stringify(spy));
check("S2 the pending direct offer is completed and the Helpr told", sj.s === "accepted" && sj.helper_id === H && told === 1, JSON.stringify({ sj, told }));

// S3: a deadlock raised inside the trigger's loop (the cursor's own check).
await db.exec(`
UPDATE public.profiles SET stripe_payouts_enabled = false WHERE user_id = '${H}';
INSERT INTO public.jobs (id, title, customer_id, status, date_needed, start_time, payment_status, offered_to_helper_id, direct_offer_status)
VALUES ('${U(106)}', 'Wash windows', '${POSTER}', 'open', current_date + 8, '10:00', 'escrow', '${H}', 'pending');
INSERT INTO public.job_accept_pending (job_id, helper_id) VALUES ('${U(106)}', '${H}');
`);
let s3err = null;
await db.exec(`BEGIN; SELECT set_config('test.deadlock', '1', true);`);
try {
  await db.exec(`UPDATE public.profiles SET stripe_payouts_enabled = true WHERE user_id = '${H}'`);
  await db.exec("COMMIT");
} catch (e) {
  s3err = e.code ?? String(e.message);
  await db.exec("ROLLBACK");
}
leftAfter.push(await advisoryLeft());
const kept = (await db.query(`SELECT stripe_payouts_enabled AS e FROM public.profiles WHERE user_id = '${H}'`)).rows[0].e;
// The row names the Helpr and how many accepts are still pending, so a stuck accept is findable (lead 2026-11-02).
const logged = (await db.query(`SELECT count(*)::int AS n FROM public.error_logs WHERE message = 'pending accept completion deadlocked'
  AND context->>'sqlstate' = '40P01' AND context->>'user_id' = '${H}' AND tags->>'user_id' = '${H}' AND (context->>'pending_count')::int = (SELECT count(*) FROM public.job_accept_pending WHERE helper_id = '${H}')
  AND (context->>'pending_count')::int >= 1`)).rows[0].n;
const stillPending = (await db.query(`SELECT count(*)::int AS n FROM public.job_accept_pending WHERE job_id = '${U(106)}'`)).rows[0].n;
check("S3 a deadlock in the trigger's loop keeps the Stripe status write and logs it",
  s3err === null && kept === true && logged === 1 && stillPending === 1, JSON.stringify({ s3err, kept, logged, stillPending }));

check("L every schedule lock is released at COMMIT", leftAfter.every((n) => n === 0), JSON.stringify(leftAfter));

await db.close();
if (BEFORE) {
  // RED must be exactly the eight lock checks; anything else means the world is wrong.
  console.log(`\n--before: ${failures} FAILED (expected 8)`);
  process.exit(failures === 8 ? 0 : 1);
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log("\nALL PASS");
