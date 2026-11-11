#!/usr/bin/env node
/**
 * PGlite proof for 20261111190845_helpr_booking_clash_notice_once (F444, whole-app audit 11-10: the same
 * "Two jobs booked at the same time" notice showed three times in the bell).
 *
 *   node src/test/pglite/helprBookingClashNoticeOnce.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/helprBookingClashNoticeOnce.pglite.mjs # RED: the state on main
 *
 * Base: 20261012171958 (the triggers and the first body). pglite is loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const BASE = read("../../../supabase/migrations/20261012171958_helpr_double_booking_notice.sql");
const NEW = process.env.MIGRATION_PATH
  ? readFileSync(process.env.MIGRATION_PATH, "utf8")
  : read("../../../supabase/migrations/20261111190845_helpr_booking_clash_notice_once.sql");
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
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid, title text,
  message text, type text, link text, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
`);
await db.exec(BASE);
if (MODE !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(NEW);
  check("migration applies 3x (replay-safe)", true);
}

const H = "aaaaaaaa-0000-4000-8000-000000000001";
const P = "bbbbbbbb-0000-4000-8000-000000000002";
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const day = (await db.query("SELECT ((now() AT TIME ZONE 'America/Chicago')::date + 30)::text AS d")).rows[0].d;
await db.exec(`
INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, estimated_hours) VALUES
  ('${id(1)}', 'Fence', '${P}', '${day}', '09:00', 2),
  ('${id(2)}', 'Gutters', '${P}', '${day}', '10:00', 1),
  ('${id(3)}', 'Mow', '${P}', '${day}', '15:00', 1),
  ('${id(4)}', 'Paint', '${P}', '${day}', '15:30', 1);
`);
const count = async (where = "true") =>
  (await db.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${H}' AND (${where})`)).rows[0].n;
const hire = (n) => db.exec(`UPDATE public.jobs SET helper_id = '${H}', status = 'accepted' WHERE id = '${id(n)}'`);
const unassign = (n) => db.exec(`UPDATE public.jobs SET helper_id = NULL, status = 'open' WHERE id = '${id(n)}'`);

await hire(1);
await hire(2);
check("the first clash is told once (unchanged)", (await count()) === 1, String(await count()));

await unassign(2);
await hire(2);
check("a re-hire into the same clash while the notice is unread adds no second notice", (await count()) === 1, String(await count()));

await db.exec(`UPDATE public.jobs SET start_time = '10:15' WHERE id = '${id(2)}'`);
check("a time change that keeps the clash adds no second notice", (await count()) === 1, String(await count()));

await db.exec(`UPDATE public.jobs SET start_time = '09:30' WHERE id = '${id(1)}'`);
check("a change on the OTHER job of the pair adds no second notice", (await count()) === 1, String(await count()));

await db.exec(`UPDATE public.notifications SET created_at = now() - interval '3 days' WHERE user_id = '${H}'`);
await unassign(2);
await hire(2);
check("unread and days old: still not repeated (the unread notice says it)", (await count()) === 1, String(await count()));
await db.exec(`UPDATE public.notifications SET created_at = now() WHERE user_id = '${H}'`);

await db.exec(`UPDATE public.notifications SET read = true WHERE user_id = '${H}'`);
await unassign(2);
await hire(2);
check("read but under a day old: still not repeated", (await count()) === 1, String(await count()));

await db.exec(`UPDATE public.notifications SET created_at = now() - interval '25 hours' WHERE user_id = '${H}'`);
await unassign(2);
await hire(2);
check("read and over a day old: the clash raised again IS told again", (await count()) === 2, String(await count()));

await hire(3);
await hire(4);
check("a different clash (other jobs) is still told while the first notice exists",
  (await count(`job_id IN ('${id(3)}', '${id(4)}')`)) === 1, String(await count()));

// Review 11-11: a NEW clash that shares one job with an earlier, still-unread one is told: Wash car (16:15) overlaps
// only Paint, the job the Mow/Paint notice sits on.
await db.exec(`INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, estimated_hours) VALUES
  ('${id(7)}', 'Wash car', '${P}', '${day}', '16:15', 1)`);
await db.exec(`UPDATE public.notifications SET read = false, created_at = now() - interval '3 days' WHERE user_id = '${H}'`);
await hire(7);
check("a new clash sharing one job with an unread earlier clash IS told", (await count(`job_id = '${id(7)}'`)) === 1,
  String(await count(`job_id = '${id(7)}'`)));
await unassign(7);
await hire(7);
check("...and that new pair is then told only once", (await count(`job_id = '${id(7)}'`)) === 1, String(await count(`job_id = '${id(7)}'`)));

await db.exec(`INSERT INTO public.notifications (user_id, job_id, title, message, type)
  VALUES ('${H}', '${id(5)}', 'You''re booked for two jobs at the same time',
          '"Old title job" and "Pair" overlap on Mon Dec 1. Please get one of them rescheduled.', 'job_updates')`);
await db.exec(`INSERT INTO public.jobs (id, title, customer_id, date_needed, start_time, estimated_hours) VALUES
  ('${id(5)}', 'Old title job', '${P}', '${day}', '18:00', 1), ('${id(6)}', 'Pair', '${P}', '${day}', '18:30', 1)`);
await hire(5);
await hire(6);
check("an unread notice under the old title also counts", (await count(`job_id IN ('${id(5)}', '${id(6)}')`)) === 1,
  String(await count(`job_id IN ('${id(5)}', '${id(6)}')`)));

check("no error was logged", (await db.query("SELECT count(*)::int AS n FROM public.error_logs")).rows[0].n === 0);
const can = async (role) =>
  (await db.query(`SELECT has_function_privilege('${role}', 'public.notify_helpr_of_booking_clash()', 'EXECUTE') AS v`)).rows[0].v;
check("the trigger function is not callable by anon or authenticated", (await can("anon")) === false && (await can("authenticated")) === false);

console.log(failures ? `\n${failures} FAIL(s)` : "\nall PASS");
process.exit(failures ? 1 : 0);
