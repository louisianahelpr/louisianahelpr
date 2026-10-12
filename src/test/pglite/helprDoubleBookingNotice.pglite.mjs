#!/usr/bin/env node
/**
 * PGlite proof for 20261012171958_helpr_double_booking_notice (docs/OPEN.md
 * Q1326, owner decision 2026-10-12: ALLOW a Helpr to be hired for two jobs at
 * overlapping times, and tell them to get one rescheduled).
 *
 *   node src/test/pglite/helprDoubleBookingNotice.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprDoubleBookingNotice.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The hire itself is the UPDATE the hire RPCs make (helper_id + status
 * 'accepted'; a crew seat is a group_job_helpers row 'accepted'); the new
 * triggers ride on those writes, so the stand-in tables carry only the columns
 * the rule reads.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
// MIGRATION_PATH: run an older copy of the file (the red half of a fix).
const NEW = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : read("../../../supabase/migrations/20261012171958_helpr_double_booking_notice.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TYPE public.job_status AS ENUM ('open', 'accepted', 'in_progress', 'completed', 'cancelled');
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, title text, customer_id uuid, helper_id uuid, status public.job_status NOT NULL DEFAULT 'open',
  date_needed date, start_time time, estimated_hours numeric, helper_completed_at timestamptz, is_group_job boolean DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.group_job_helpers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, helper_id uuid,
  status text NOT NULL DEFAULT 'accepted', helper_completed_at timestamptz);
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL, message text NOT NULL,
  url text, tags jsonb NOT NULL DEFAULT '{}', context jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text, message text, type text, link text);
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`);
if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("migration applies 3x (replay-safe)", true);
}

const H = "aaaaaaaa-0000-4000-8000-000000000001";
const P = "bbbbbbbb-0000-4000-8000-000000000002";
const OTHER = "cccccccc-0000-4000-8000-000000000003";
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
// A date 30 days out, so the "today or later" rule keeps holding whenever this runs.
const day = (await db.query("SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 30)::text AS d")).rows[0].d;
const past = (await db.query("SELECT ((now() AT TIME ZONE 'America/Chicago')::date - 1)::text AS d")).rows[0].d;
await db.exec(`
INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, estimated_hours) VALUES
  ('${id(1)}', 'Fence', '${P}', '${day}', '09:00', 2),
  ('${id(2)}', 'Gutters', '${P}', '${day}', '10:00', 1),
  ('${id(3)}', 'Mow', '${P}', '${day}', '13:00', 1),
  ('${id(4)}', 'Any time', '${P}', '${day}', NULL, 3),
  ('${id(5)}', 'Crew move', '${P}', '${day}', '09:30', 1);
UPDATE public.jobs SET is_group_job = true WHERE id = '${id(5)}';
`);

const notes = async () => (await db.query(`SELECT job_id, title, message, type, link FROM public.notifications WHERE user_id = '${H}' ORDER BY title, job_id`)).rows;
const hire = async (n) => {
  try {
    await db.exec(`UPDATE public.jobs SET helper_id = '${H}', status = 'accepted' WHERE id = '${id(n)}'`);
    return null;
  } catch (e) {
    return e.message;
  }
};

check("first booking (Fence 9-11): hired, no notice", (await hire(1)) === null && (await notes()).length === 0, JSON.stringify(await notes()));

const err = await hire(2);
const n2 = await notes();
check("an overlapping hire (Gutters 10-11) is ALLOWED (not refused)", err === null, String(err));
check(
  "...and the Helpr is told, once, on the new job, to get one rescheduled",
  n2.length === 1 && n2[0].job_id === id(2) && n2[0].type === "job_updates" && n2[0].link === `/jobs?job=${id(2)}` &&
    /"Gutters" and "Fence" overlap/.test(n2[0].message) && /rescheduled/.test(n2[0].message),
  JSON.stringify(n2),
);
check("no error was logged on the way", (await db.query("SELECT count(*)::int AS n FROM public.error_logs")).rows[0].n === 0);

await hire(3);
await hire(4);
check("a non-overlapping (13:00) and a time-less booking add no notice", (await notes()).length === 1, JSON.stringify(await notes()));

await db.exec(`UPDATE public.jobs SET status = 'in_progress' WHERE id = '${id(2)}'`);
check("starting work on a clashing job does not repeat the notice", (await notes()).length === 1);

// accept_group_application's real order: the seat row is inserted (status
// 'accepted' by default) while the crew job is still 'open', and jobs.helper_id
// is never set; the job flips to 'accepted' only when the last seat fills.
await db.exec(`INSERT INTO public.group_job_helpers (job_id, helper_id) VALUES ('${id(5)}', '${H}')`);
check("a crew seat taken while the crew is still filling is told at once", (await notes()).filter((r) => r.job_id === id(5)).length === 1, JSON.stringify(await notes()));
await db.exec(`UPDATE public.jobs SET status = 'accepted' WHERE id = '${id(5)}'`);
check("...and not told again when the crew fills", (await notes()).filter((r) => r.job_id === id(5)).length === 1);
await db.exec(`UPDATE public.group_job_helpers SET helper_completed_at = now() WHERE job_id = '${id(5)}'`);

await db.exec(`UPDATE public.jobs SET start_time = '10:30' WHERE id = '${id(3)}'`);
check("a booked job moved into a clash is told", (await notes()).filter((r) => r.job_id === id(3)).length === 1, JSON.stringify(await notes()));

// charge-recurring-visits INSERTs a series visit already booked.
await db.exec(`INSERT INTO public.jobs (id, title, customer_id, helper_id, status, date_needed, start_time, estimated_hours)
  VALUES ('${id(6)}', 'Weekly clean', '${P}', '${H}', 'accepted', '${day}', '09:15', 1)`);
check("a series visit inserted already booked into a clash is told", (await notes()).filter((r) => r.job_id === id(6)).length === 1, JSON.stringify(await notes()));

// Two overlapping bookings that are already over: nothing to reschedule.
await db.exec(`INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time) VALUES
  ('${id(7)}', 'Old A', '${P}', '${past}', '09:00'), ('${id(8)}', 'Old B', '${P}', '${past}', '09:30')`);
await hire(7);
await hire(8);
check("a clash dated before today is not raised", (await notes()).filter((r) => r.job_id === id(8)).length === 0);

async function clashesAs(uid) {
  try {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.uid', '${uid ?? ""}', false);`);
    return (await db.query("SELECT job_id, other_job_id, other_title FROM public.my_schedule_clashes()")).rows;
  } catch (e) {
    return `error: ${e.message}`;
  } finally {
    await db.exec("RESET ROLE;");
  }
}
const mine = await clashesAs(H);
const pairs = Array.isArray(mine) ? mine.map((r) => `${r.job_id.slice(-1)}>${r.other_job_id.slice(-1)}`).sort() : mine;
check(
  "my_schedule_clashes: the Helpr's card notice sees every live pair, both ways (a crew seat they marked done drops out)",
  JSON.stringify(pairs) === JSON.stringify(["1>2", "1>3", "1>6", "2>1", "2>3", "2>6", "3>1", "3>2", "6>1", "6>2"].sort()),
  JSON.stringify(pairs),
);
const theirs = await clashesAs(OTHER);
check("another account sees none of them", Array.isArray(theirs) && theirs.length === 0, JSON.stringify(theirs));
const anonCall = await clashesAs(null);
check("no session sees nothing", Array.isArray(anonCall) && anonCall.length === 0, JSON.stringify(anonCall));

async function can(role, sig) {
  try {
    return (await db.query(`SELECT has_function_privilege('${role}', '${sig}', 'EXECUTE') AS v`)).rows[0].v;
  } catch (e) {
    return `error: ${e.message}`;
  }
}
check("anon cannot call my_schedule_clashes", (await can("anon", "public.my_schedule_clashes()")) === false);
check("authenticated can call my_schedule_clashes", (await can("authenticated", "public.my_schedule_clashes()")) === true);
check("the raw rule (any Helpr's id) is not client-callable", (await can("authenticated", "public.helpr_booking_clashes(uuid)")) === false);

console.log(failures ? `\n${failures} FAIL(s)` : "\nall PASS");
process.exit(failures ? 1 : 0);
