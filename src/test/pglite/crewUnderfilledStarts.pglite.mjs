#!/usr/bin/env node
/**
 * PGlite proof for 20261006225402_underfilled_crew_starts_with_who_is_hired
 * (docs/OPEN.md Q1460; owner decision 2026-10-06: an under-filled crew STARTS
 * WITH WHO IS HIRED instead of being auto-cancelled at its start).
 *
 *   npx tsx src/test/pglite/crewUnderfilledStarts.pglite.mjs [--replay] [--before]
 *
 * --before leaves the migration out: the RED checks must FAIL (count asserted).
 * Without it the migration is applied (3x with --replay) and every check PASSes.
 * Stubs (not under test): job_payment_is_funded (escrow), log_cron_defect (a
 * row in a defects table).
 *
 *   U1 a funded, expired crew of 3 with 2 hired (1 confirmed) is booked  RED before
 *   U2 the poster's one 'Your crew is starting' notice counts CONFIRMED members only (1 of 3)  RED before
 *   U3 an expired crew with NOBODY hired stays 'open' (the cancel step cancels it)
 *   U3b an expired crew whose hires never confirmed stays 'open'
 *   U8 a crew 10 minutes from its start (hiring closed, listing not yet expired) with a
 *      confirmed member is booked NOW, not an hour later at the sweep     RED before
 *   U4 an unfunded expired crew with hired members stays 'open'
 *   U5 a crew whose listing has not expired yet stays 'open' (still fillable)
 *   U6 a single-Helpr open job is untouched
 *   U7 a second run books nothing and sends no second notice              RED before
 *   G1 anon and authenticated cannot execute it                          RED before
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const MIGRATION = readFileSync(DIR + "20261006225402_underfilled_crew_starts_with_who_is_hired.sql", "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

const db = new PGlite();
await db.exec(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TYPE job_status AS ENUM ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, helpers_needed int, status job_status NOT NULL,
  is_group_job boolean, payment_status text, expires_at timestamptz, date_needed date, start_time time);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid, helper_confirmed_at timestamptz);
-- Stub: the hire cutoff is the scheduled start (the live function is not under test).
CREATE FUNCTION public.job_offer_cutoff(d date, t time) RETURNS timestamptz LANGUAGE sql AS $$ SELECT (d + COALESCE(t, '23:59:59'::time)) AT TIME ZONE 'America/Chicago' $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text, read boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.defects (fn text, ref text, msg text);
CREATE FUNCTION public.job_payment_is_funded(p text) RETURNS boolean LANGUAGE sql AS $$ SELECT p = 'escrow' $$;
CREATE FUNCTION public.log_cron_defect(f text, r text, m text, c jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.defects VALUES (f, r, m) $$;
`);
const P = "00000000-0000-4000-8000-0000000000aa";
const H = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const J = { UNDER: "10000000-0000-4000-8000-000000000001", EMPTY: "10000000-0000-4000-8000-000000000002",
  UNFUNDED: "10000000-0000-4000-8000-000000000003", LATER: "10000000-0000-4000-8000-000000000004", SINGLE: "10000000-0000-4000-8000-000000000005",
  NOCONF: "10000000-0000-4000-8000-000000000006", SOON: "10000000-0000-4000-8000-000000000007" };
await db.exec(`
INSERT INTO public.jobs VALUES
 ('${J.UNDER}','${P}','Paint the fence',3,'open',true,'escrow',now()-interval '5 minutes',current_date-1,'09:00'),
 ('${J.EMPTY}','${P}','Empty crew',3,'open',true,'escrow',now()-interval '5 minutes',current_date-1,'09:00'),
 ('${J.UNFUNDED}','${P}','Unpaid crew',3,'open',true,'unpaid',now()-interval '5 minutes',current_date-1,'09:00'),
 ('${J.LATER}','${P}','Tomorrow crew',3,'open',true,'escrow',now()+interval '2 days',current_date+2,'09:00'),
 ('${J.SINGLE}','${P}','Single job',1,'open',false,'escrow',now()-interval '5 minutes',current_date-1,'09:00'),
 ('${J.NOCONF}','${P}','Nobody confirmed',3,'open',true,'escrow',now()-interval '5 minutes',current_date-1,'09:00'),
 ('${J.SOON}','${P}','Starts in 10',2,'open',true,'escrow',now()+interval '10 minutes',(now()+interval '10 minutes') AT TIME ZONE 'America/Chicago','00:00');
UPDATE public.jobs SET date_needed = ((now()+interval '10 minutes') AT TIME ZONE 'America/Chicago')::date,
  start_time = ((now()+interval '10 minutes') AT TIME ZONE 'America/Chicago')::time WHERE id = '${J.SOON}';
INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at) VALUES
 ('${J.UNDER}','${H(1)}',now()),('${J.UNDER}','${H(2)}',NULL),
 ('${J.UNFUNDED}','${H(3)}',now()),('${J.LATER}','${H(4)}',now()),
 ('${J.NOCONF}','${H(5)}',NULL),('${J.NOCONF}','${H(6)}',NULL),
 ('${J.SOON}','${H(7)}',now());
`);

if (!BEFORE) for (let i = 0; i < (REPLAY ? 3 : 1); i++) await db.exec(MIGRATION);

const results = [];
const check = (id, red, ok, detail) => results.push({ id, red, ok, detail });
const status = async (id) => (await db.query(`SELECT status::text s FROM public.jobs WHERE id=$1`, [id])).rows[0].s;
const run = async () => { try { return (await db.query(`SELECT public.start_underfilled_crews() n`)).rows[0].n; } catch (e) { return `ERR ${e.message}`; } };

const first = await run();
check("U1", true, (await status(J.UNDER)) === "accepted", `first run -> ${first}; UNDER = ${await status(J.UNDER)}`);
const notes = (await db.query(`SELECT title, message FROM public.notifications WHERE job_id=$1 AND user_id=$2`, [J.UNDER, P])).rows;
check("U2", true, notes.length === 1 && notes[0].title === "Your crew is starting" && /the 1 of 3 Helprs who confirmed/.test(notes[0].message) && /once the job is done/.test(notes[0].message), JSON.stringify(notes));
check("U3", false, (await status(J.EMPTY)) === "open", `EMPTY = ${await status(J.EMPTY)}`);
check("U3b", false, (await status(J.NOCONF)) === "open", `NOCONF = ${await status(J.NOCONF)}`);
check("U8", true, (await status(J.SOON)) === "accepted", `SOON = ${await status(J.SOON)}`);
check("U4", false, (await status(J.UNFUNDED)) === "open", `UNFUNDED = ${await status(J.UNFUNDED)}`);
check("U5", false, (await status(J.LATER)) === "open", `LATER = ${await status(J.LATER)}`);
check("U6", false, (await status(J.SINGLE)) === "open", `SINGLE = ${await status(J.SINGLE)}`);
const second = await run();
const notes2 = (await db.query(`SELECT count(*)::int n FROM public.notifications`)).rows[0].n;
check("U7", true, second === 0 && notes2 === 2, `second run -> ${second}; notices ${notes2} (one each for UNDER and SOON)`);
let grantsOk = false;
try {
  const g = (await db.query(`SELECT has_function_privilege('anon','public.start_underfilled_crews()','EXECUTE') a,
    has_function_privilege('authenticated','public.start_underfilled_crews()','EXECUTE') u,
    has_function_privilege('service_role','public.start_underfilled_crews()','EXECUTE') s`)).rows[0];
  grantsOk = !g.a && !g.u && g.s;
} catch { grantsOk = false; }
check("G1", true, grantsOk, `grants ok = ${grantsOk}`);

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id}${r.red ? " (red before)" : ""}: ${r.detail}`);
  if (!r.ok) failed++;
}
const reds = results.filter((r) => r.red).length;
if (BEFORE) {
  const ok = results.filter((r) => r.red).every((r) => !r.ok) && results.filter((r) => !r.red).every((r) => r.ok);
  console.log(ok ? `BEFORE: all ${reds} red checks FAIL as expected` : "BEFORE: a red check passed or a control failed");
  process.exit(ok ? 0 : 1);
}
console.log(failed ? `${failed} FAIL` : `all ${results.length} PASS${REPLAY ? " (migration applied 3x)" : ""}`);
process.exit(failed ? 1 : 0);
