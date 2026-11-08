#!/usr/bin/env node
/**
 * PGlite proof for 20261108203000_continue_day_lapsed_evening_and_refund (Jobs audit 11-08 #9, #11).
 *
 *   npx tsx src/test/pglite/continueDayLapsedAndRefund.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/continueDayLapsedAndRefund.pglite.mjs # RED (20261108160000's sweep)
 *   MUTANT=<name> npx tsx src/test/pglite/continueDayLapsedAndRefund.pglite.mjs      # a planted defect: must FAIL
 *
 * The sweep and every helper it calls are the NEWEST definitions (effectiveDefs) on a minimal schema.
 *   L1 a day that lapsed two days ago (Yusef's shape: set, not done, no stalled nudge yet): the next sweep sends the
 *      evening ask to the Helpr and the evening notice to the poster, once each, naming the day (never "today")
 *   L2 a second sweep sends nothing more
 *   L3 the stalled ladder already nudged: a late evening send is not made
 *   L4 the same evening (inside the 6 hours): still sent, with "today"
 *   R1 a member's new continue day while a refund request is live: refused continue_day_refund_open, nothing written
 *   R2 with no live request (closed): allowed          R3 a server writer: never refused
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261108203000_continue_day_lapsed_evening_and_refund.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  window: ["(v_now < a.evening_at + interval '6 hours' OR NOT a.nudged) THEN 'evening_not_done_helpr'", "v_now < a.evening_at + interval '6 hours' THEN 'evening_not_done_helpr'"],
  nudged: ["n.job_id = j.id AND n.first_sent_at IS NOT NULL) AS nudged", "false) AS nudged"],
  today: ["THEN 'on ' || to_char(rec.new_date, 'FMDy FMMM/FMDD') ELSE 'today' END", "THEN 'today' ELSE 'today' END"],
  refund: ["  IF NEW.status IN ('proposed', 'set') AND EXISTS (", "  IF false AND EXISTS ("],
  server: ["  IF public.is_server_context() THEN\n    RETURN NEW;\n  END IF;\n  IF NEW.status IN", "  IF NEW.status IN"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const defs = effectiveDefs(DIR);
const stmtOf = (name) => {
  const d = defs.get(name);
  if (!d) throw new Error(`no definition of ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  return d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length) + ";";
};
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, HELPR] = [1, 2].map(id);
const JOB = id(11);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text, helper_completed_at timestamptz);
CREATE TABLE public.job_continue_days (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, proposed_by uuid, new_date date, new_start_time time,
  note text, status text, decided_at timestamptz, decided_by uuid, helper_confirmed_at timestamptz, closed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.job_continue_reminder_sends (continue_id uuid, kind text, sent_at timestamptz, PRIMARY KEY (continue_id, kind));
CREATE TABLE public.job_continue_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, continue_id uuid, actor_id uuid, action text, detail jsonb);
CREATE TABLE public.job_completion_nudges (job_id uuid PRIMARY KEY, first_sent_at timestamptz, second_sent_at timestamptz, escalated_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
CREATE TABLE public.disputes (id uuid PRIMARY KEY, status text, execution_status text);
CREATE TABLE public.refund_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, status text, dispute_id uuid);
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
`);
for (const fn of ["is_server_context", "refund_request_is_live"]) await db.exec(stmtOf(fn));
// The sweep as it was before THIS (20261108160000's), so NEW_MIGRATION=skip is the live state.
{
  const prev = readFileSync(DIR + "20261108160000_continue_day_resumes_checks_in_and_new_photos.sql", "utf8");
  const at = prev.indexOf("CREATE OR REPLACE FUNCTION public.sweep_job_continue_day_reminders(");
  await db.exec(prev.slice(at, prev.indexOf("$fn$;", prev.indexOf("AS $fn$", at) + 7) + 5));
}
if (!skip && !defs.get("sweep_job_continue_day_reminders")?.file.startsWith("20261108203000")) throw new Error("the newest sweep is not THIS migration's");
if (!skip) {
  let sql = readFileSync(DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: 20261108160000's sweep, no refund refusal");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const rows = async (q) => (await db.query(q)).rows;
/** A job on a set continue day `daysAgo` days back (Central) at 15:15. */
const seed = (daysAgo, nudged = false) => db.exec(`
  DELETE FROM public.notifications; DELETE FROM public.job_continue_reminder_sends; DELETE FROM public.job_continue_events;
  DELETE FROM public.job_continue_days; DELETE FROM public.job_completion_nudges; DELETE FROM public.jobs; DELETE FROM public.refund_requests;
  INSERT INTO public.jobs VALUES ('${JOB}', 'Mow and Weed Eat', '${POSTER}', '${HELPR}', 'in_progress', NULL);
  INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status, helper_confirmed_at)
    VALUES ('${JOB}', '${HELPR}', (now() AT TIME ZONE 'America/Chicago')::date - ${daysAgo}, '15:15', 'set', now() - interval '3 days');
  ${nudged ? `INSERT INTO public.job_completion_nudges (job_id, first_sent_at) VALUES ('${JOB}', now() - interval '1 hour');` : ""}`);
const sweep = (at) => db.query(`SELECT public.sweep_job_continue_day_reminders(${at}) AS n`);
const evening = async () => rows(`SELECT user_id, title, message FROM public.notifications WHERE title IN ('Did you finish today?', 'Not marked done yet') ORDER BY title`);

// L1/L2: lapsed two days ago, no nudge.
await seed(2);
await sweep("NULL");
const l1 = await evening();
ok("L1 the lapsed day's evening ask reaches the Helpr and the poster, once each", l1.length === 2 && l1.some((r) => r.user_id === HELPR) && l1.some((r) => r.user_id === POSTER), JSON.stringify(l1));
ok("L1 the words name the day, never 'today'", l1.length === 2 && l1.every((r) => !/today/.test(r.message) && /(on|since) \w{3} \d{1,2}\/\d{1,2}/.test(r.message)), JSON.stringify(l1));
await sweep("NULL");
ok("L2 a second sweep sends nothing more", (await evening()).length === 2);

// L3: the stalled ladder already nudged.
await seed(2, true);
await sweep("NULL");
ok("L3 already nudged: no late evening send", (await evening()).length === 0);

// L4: same evening, inside the window (sweep run at 8 PM Central on the day).
await seed(0);
await sweep(`((now() AT TIME ZONE 'America/Chicago')::date + time '20:00') AT TIME ZONE 'America/Chicago'`);
const l4 = await evening();
ok("L4 inside the evening window: sent, with 'today'", l4.length === 2 && l4.every((r) => /today/.test(r.message)), JSON.stringify(l4));

// R1-R3: the refund request.
const asMember = async (q) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${HELPR}', false); SELECT set_config('request.jwt.claim.role', 'authenticated', false);`);
  try { await db.query(q); return null; } catch (e) { return String(e.message ?? e); } finally {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.jwt.claim.role', '', false);`);
  }
};
const newDay = `INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status) VALUES ('${JOB}', '${HELPR}', current_date + 3, '09:00', 'proposed')`;
await seed(5);
await db.exec(`DELETE FROM public.job_continue_days; INSERT INTO public.refund_requests (job_id, status) VALUES ('${JOB}', 'open');`);
const r1 = await asMember(newDay);
ok("R1 a member's new day while a refund request is open: refused continue_day_refund_open", /continue_day_refund_open/.test(r1 ?? ""), String(r1));
ok("R1 nothing written", (await rows(`SELECT 1 FROM public.job_continue_days`)).length === 0);
await db.exec(`UPDATE public.refund_requests SET status = 'closed'`);
ok("R2 with the request closed: allowed", (await asMember(newDay)) === null);
await db.exec(`DELETE FROM public.job_continue_days; UPDATE public.refund_requests SET status = 'open'`);
let r3 = null;
try { await db.query(newDay); } catch (e) { r3 = String(e.message ?? e); }
ok("R3 a server writer is never refused", r3 === null, String(r3));

console.log(failed ? `\n${failed} FAILED` : "\nall PASS");
process.exit(failed ? 1 : 0);
