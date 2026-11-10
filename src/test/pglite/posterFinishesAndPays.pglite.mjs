#!/usr/bin/env node
/**
 * PGlite proof for 20261110160451_poster_finishes_and_pays (owner 11-10: the poster of "Mow and Weed Eat" 7b1da54b had
 * no way to mark the job done and release the $100 after its continue day passed with no done from the Helpr).
 *
 *   npx tsx src/test/pglite/posterFinishesAndPays.pglite.mjs                    # GREEN (the migration 3x)
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/posterFinishesAndPays.pglite.mjs # RED (no rule: the old state)
 *   MUTANT=<name> npx tsx src/test/pglite/posterFinishesAndPays.pglite.mjs      # a planted defect: must FAIL
 *
 * The rule is THIS migration's poster_finish_job_refusal (checked against effectiveDefs: the newest); the trigger that
 * ends the continue day is the newest close_continue_day_on_job_change, run verbatim.
 *   Y1 Yusef's shape (in progress, money held, Helpr not done, its set continue day 4 days past): allowed
 *   R1 the Helpr asking: refused not_the_poster          R2 a stranger: refused      R3 nobody: refused
 *   R4 a banned poster: refused account_restricted      R4b a lapsed temp ban: allowed again
 *   R5 the continue day still ahead: refused day_not_reached (also a proposed one)
 *   R6 no continue day and the job's own start ahead: refused; past: allowed
 *   R7 the Helpr marked done: helpr_marked_done   R8 already approved   R9 money not held   R10 a dispute open
 *   R11 a crew job: not_a_solo_job   R12 not in progress
 *   G1 an authenticated member cannot call it (service role only), nor anon
 *   W1 the release write create-payment makes for the poster (poster_completed_at + completed + payout_pending, pinned
 *      to the row it read) ends the open continue day as 'finished' with event reason poster_approved; replaying the
 *      same pinned write matches no row (no second scheduling), and the rule then refuses (not_in_progress)
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261110160451_poster_finishes_and_pays.sql";
const skip = process.env.NEW_MIGRATION === "skip";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  poster: ["  IF v_job.customer_id IS DISTINCT FROM p_user_id THEN", "  IF false THEN"],
  ban: ["            OR p.under_13_blocked_at IS NOT NULL)\n  ) THEN", "            OR p.under_13_blocked_at IS NOT NULL) AND false\n  ) THEN"],
  day: ["  IF v_now < v_starts THEN", "  IF false THEN"],
  done: ["  IF v_job.helper_completed_at IS NOT NULL THEN", "  IF false THEN"],
  escrow: ["  IF v_job.payment_status IS DISTINCT FROM 'escrow' THEN", "  IF false THEN"],
  grant: ["REVOKE ALL ON FUNCTION public.poster_finish_job_refusal(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;", "GRANT EXECUTE ON FUNCTION public.poster_finish_job_refusal(uuid, uuid, timestamptz) TO authenticated, anon;"],
};
if (MUTANT && !MUTANTS[MUTANT]) throw new Error(`unknown MUTANT ${MUTANT}`);

const defs = effectiveDefs(DIR);
const stmtOf = (name) => {
  const d = defs.get(name);
  if (!d) throw new Error(`no definition of ${name}`);
  const open = /\bAS\s+(\$\w*\$)/i.exec(d.stmt);
  return d.stmt.slice(0, d.stmt.indexOf(open[1], open.index + open[0].length) + open[1].length) + ";";
};
if (!skip && !defs.get("poster_finish_job_refusal")?.file.startsWith("20261110160451")) {
  throw new Error("the newest poster_finish_job_refusal is not THIS migration's");
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [POSTER, HELPR, STRANGER] = [1, 2, 3].map(id);
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
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status text, is_group_job boolean DEFAULT false,
  helper_completed_at timestamptz, poster_completed_at timestamptz, payment_status text DEFAULT 'escrow', has_active_dispute boolean DEFAULT false,
  date_needed date, start_time time, helper_arrived_at timestamptz, payout_scheduled_at timestamptz, budget numeric DEFAULT 100);
CREATE TABLE public.job_continue_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE, proposed_by uuid, new_date date,
  new_start_time time, status text NOT NULL DEFAULT 'proposed', closed_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.job_continue_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, continue_id uuid, actor_id uuid, action text, detail jsonb);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text, auto_suspended_until timestamptz, under_13_blocked_at timestamptz);
INSERT INTO public.profiles (user_id) VALUES ('${POSTER}'), ('${HELPR}'), ('${STRANGER}');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
`);
await db.exec(stmtOf("close_continue_day_on_job_change"));
await db.exec(`CREATE TRIGGER trg_close_continue_day_on_job_change AFTER UPDATE OF helper_completed_at, poster_completed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.close_continue_day_on_job_change();`);
if (!skip) {
  let sql = readFileSync(DIR + THIS, "utf8");
  if (MUTANT) {
    const [find, repl] = MUTANTS[MUTANT];
    if (!sql.includes(find)) throw new Error(`MUTANT ${MUTANT}: text not found`);
    sql = sql.replace(find, repl);
  }
  for (let i = 0; i < 3; i++) await db.exec(sql);
  console.log("migration applied 3x");
} else console.log("NEW_MIGRATION=skip: no rule (the live state)");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  ${extra}`}`); if (!cond) failed++; };
const rows = async (q) => (await db.query(q)).rows;
/** The rule as the edge asks it (service role): null = allowed, else the code; a thrown error is returned as ERR:... */
const rule = async (uid) => {
  try {
    const r = await rows(`SELECT public.poster_finish_job_refusal('${JOB}', ${uid ? `'${uid}'` : "NULL"}) AS r`);
    return r[0].r;
  } catch (e) { return `ERR:${String(e.message ?? e)}`; }
};
const as = async (role, q) => {
  await db.exec(`SET ROLE ${role};`);
  try { await db.query(q); return null; } catch (e) { return String(e.message ?? e); } finally { await db.exec(`RESET ROLE;`); }
};
/** Yusef's shape: day 1 a week ago, a set continue day `dayHoursAgo` hours past its start (negative: ahead). */
const seed = async ({ dayHoursAgo = 96, dayStatus = "set", noDay = false, jobStartHoursAgo = 24 * 9, over = "" } = {}) => {
  await db.exec(`
    DELETE FROM public.job_continue_events; DELETE FROM public.job_continue_days; DELETE FROM public.jobs;
    UPDATE public.profiles SET ban_status = NULL, auto_suspended_until = NULL, under_13_blocked_at = NULL;
    INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, helper_arrived_at)
      SELECT '${JOB}', 'Mow and Weed Eat', '${POSTER}', '${HELPR}', 'in_progress', (s AT TIME ZONE 'America/Chicago')::date,
             (s AT TIME ZONE 'America/Chicago')::time, now() - interval '9 days'
        FROM (SELECT date_trunc('minute', now() - interval '${jobStartHoursAgo} hours') AS s) x;
    ${noDay ? "" : `INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, status)
      SELECT '${JOB}', '${POSTER}', (s AT TIME ZONE 'America/Chicago')::date, (s AT TIME ZONE 'America/Chicago')::time, '${dayStatus}'
        FROM (SELECT date_trunc('minute', now() - interval '${dayHoursAgo} hours') AS s) x;`}
    ${over ? `UPDATE public.jobs SET ${over};` : ""}`);
};

// Y1
await seed();
ok("Y1 Yusef's shape: the poster may finish it", (await rule(POSTER)) === null, String(await rule(POSTER)));
// R1-R3
ok("R1 the Helpr asking: refused not_the_poster", (await rule(HELPR)) === "not_the_poster", String(await rule(HELPR)));
ok("R2 a stranger: refused not_the_poster", (await rule(STRANGER)) === "not_the_poster", String(await rule(STRANGER)));
ok("R3 nobody: refused", (await rule(null)) === "not_the_poster", String(await rule(null)));
// R4
await db.exec(`UPDATE public.profiles SET ban_status = 'banned' WHERE user_id = '${POSTER}'`);
ok("R4 a banned poster: refused account_restricted", (await rule(POSTER)) === "account_restricted", String(await rule(POSTER)));
await db.exec(`UPDATE public.profiles SET ban_status = 'temp_banned', auto_suspended_until = now() - interval '1 hour' WHERE user_id = '${POSTER}'`);
ok("R4b a temp ban that has run out: allowed again", (await rule(POSTER)) === null, String(await rule(POSTER)));
// R5
await seed({ dayHoursAgo: -20 });
ok("R5 the set continue day still ahead: refused day_not_reached", (await rule(POSTER)) === "day_not_reached", String(await rule(POSTER)));
await seed({ dayHoursAgo: -20, dayStatus: "proposed" });
ok("R5 a proposed continue day still ahead: refused day_not_reached", (await rule(POSTER)) === "day_not_reached", String(await rule(POSTER)));
await seed({ dayHoursAgo: 1 });
ok("R5 the continue day's start passed an hour ago: allowed", (await rule(POSTER)) === null, String(await rule(POSTER)));
// R6
await seed({ noDay: true, jobStartHoursAgo: -5 });
ok("R6 no continue day, the job's own start ahead: refused day_not_reached", (await rule(POSTER)) === "day_not_reached", String(await rule(POSTER)));
await seed({ noDay: true, jobStartHoursAgo: 30 });
ok("R6 no continue day, the job's start passed: allowed", (await rule(POSTER)) === null, String(await rule(POSTER)));
// R7-R12
await seed({ over: "helper_completed_at = now()" });
ok("R7 the Helpr marked done: refused helpr_marked_done (Approve is the way)", (await rule(POSTER)) === "helpr_marked_done", String(await rule(POSTER)));
await seed({ over: "poster_completed_at = now()" });
ok("R8 already approved: refused", (await rule(POSTER)) === "already_approved", String(await rule(POSTER)));
await seed({ over: "payment_status = 'cancelling'" });
ok("R9 money not held: refused money_not_held", (await rule(POSTER)) === "money_not_held", String(await rule(POSTER)));
await seed({ over: "has_active_dispute = true" });
ok("R10 a dispute open: refused", (await rule(POSTER)) === "dispute_open", String(await rule(POSTER)));
await seed({ over: "is_group_job = true" });
ok("R11 a crew job: refused not_a_solo_job", (await rule(POSTER)) === "not_a_solo_job", String(await rule(POSTER)));
await seed({ over: "status = 'accepted'" });
ok("R12 not in progress: refused", (await rule(POSTER)) === "not_in_progress", String(await rule(POSTER)));
// G1
await seed();
const call = `SELECT public.poster_finish_job_refusal('${JOB}', '${POSTER}')`;
ok("G1 an authenticated member cannot call it", /permission denied|does not exist/.test(String(await as("authenticated", call))), String(await as("authenticated", call)));
ok("G1 anon cannot call it", /permission denied|does not exist/.test(String(await as("anon", call))), String(await as("anon", call)));
ok("G1 the service role can", (await as("service_role", call)) === null, String(await as("service_role", call)));

// W1 the release write create-payment makes once the rule allows it (the poster's stamp + completed + payout_pending,
// pinned to the row as read: status, both stamps NULL, escrow).
await seed();
const releaseWrite = `UPDATE public.jobs SET poster_completed_at = now(), status = 'completed', payment_status = 'payout_pending',
  payout_scheduled_at = now() + interval '3 days'
  WHERE id = '${JOB}' AND status = 'in_progress' AND poster_completed_at IS NULL AND helper_completed_at IS NULL AND payment_status = 'escrow'
  RETURNING id`;
const allowed = (await rule(POSTER)) === null;
const first = allowed ? await rows(releaseWrite) : [];
ok("W1 the release write goes through once the rule allows it", allowed && first.length === 1, JSON.stringify(first));
const day = (await rows(`SELECT status, closed_at FROM public.job_continue_days`))[0];
ok("W1 it ends the open continue day as 'finished'", day?.status === "finished" && !!day?.closed_at, JSON.stringify(day));
const ev = await rows(`SELECT action, detail FROM public.job_continue_events`);
ok("W1 the day's event says poster_approved", ev.length === 1 && ev[0].action === "finished" && ev[0].detail?.reason === "poster_approved", JSON.stringify(ev));
const again = await rows(releaseWrite);
ok("W1 replaying the same pinned write matches 0 rows (nothing scheduled twice)", again.length === 0, JSON.stringify(again));
ok("W1 and the rule refuses a second finish (not_in_progress)", (await rule(POSTER)) === "not_in_progress", String(await rule(POSTER)));

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
