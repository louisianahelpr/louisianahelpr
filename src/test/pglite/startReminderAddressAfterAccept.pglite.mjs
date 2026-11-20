#!/usr/bin/env node
/**
 * PGlite proof for 20261120220306_start_reminder_address_after_accept (owner 2026-11-20): a Helpr's "Your job starts in
 * 2 hours" reminder names the street address only once they accepted (jobs.helper_confirmed_at, or the crew seat's);
 * an offered Helpr, or an unconfirmed crew seat, gets the town (mask_job_location). Every reminder still goes out.
 *
 *   node src/test/pglite/startReminderAddressAfterAccept.pglite.mjs                     # ALL PASS (the migration 3x)
 *   NEW_MIGRATION=skip node src/test/pglite/startReminderAddressAfterAccept.pglite.mjs  # RED: every [RED] check fails
 *
 * Base, read verbatim: sweep_helpr_start_reminders (20261104114456) and mask_job_location (20261031000945).
 * Stubbed, and said so: tables cut to the columns the sweep reads; job_posted_by_seed false; log_cron_defect records.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = process.env.MIGRATION_PATH ?? MIG_DIR + "20261120220306_start_reminder_address_after_accept.sql";
const skip = process.env.NEW_MIGRATION === "skip";
let failures = 0;
let reds = 0;
let redFails = 0;
const check = (ok, name, red = false, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${red ? "[RED] " : ""}${name}${!ok && detail ? `  (${detail})` : ""}`);
  if (red) reds++;
  if (!ok) {
    failures++;
    if (red) redFails++;
  }
};

/** The LAST `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in one migration file, any dollar tag. */
function fnFrom(file, name) {
  const t = readFileSync(MIG_DIR + file, "utf8");
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`, "gi");
  let m, last = null;
  while ((m = re.exec(t))) last = m.index;
  if (last === null) throw new Error(`no ${name} in ${file}`);
  const tag = /\bAS\s+(\$\w*\$)/g;
  tag.lastIndex = last;
  const a = tag.exec(t);
  const end = t.indexOf(a[1], a.index + a[0].length);
  return t.slice(last, end + a[1].length) + ";";
}

const U = (n) => `0f0f0f0f-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POSTER = U(1), OFFERED = U(2), BOOKED = U(3), CREW_OPEN = U(4), CREW_IN = U(5);
const STREET = "1 Main St, Delcambre, LA 70528";

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, helper_id uuid, title text, location text,
  date_needed date, start_time time, status text, is_group_job boolean DEFAULT false, parent_job_id uuid,
  helper_on_the_way_at timestamptz, helper_arrived_at timestamptz, helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_on_the_way_at timestamptz, helper_arrived_at timestamptz,
  helper_confirmed_at timestamptz);
CREATE TABLE public.helpr_travel_estimates (job_id uuid, user_id uuid, minutes integer);
CREATE TABLE public.helpr_start_reminder_sends (job_id uuid, user_id uuid, kind text, merged boolean, sent_at timestamptz,
  PRIMARY KEY (job_id, user_id, kind));
CREATE TABLE public.notification_preferences (user_id uuid, remind_starting_soon boolean, remind_two_hours boolean);
CREATE TABLE public.notifications (user_id uuid, type text, title text, message text, link text, read boolean, job_id uuid);
CREATE TABLE public.defects (fn text, key text, err text);
CREATE FUNCTION public.job_posted_by_seed(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE FUNCTION public.log_cron_defect(f text, k text, e text, c jsonb) RETURNS void LANGUAGE sql AS
  \$f\$ INSERT INTO public.defects VALUES (f, k, e) \$f\$;
`);
await db.exec(fnFrom("20261031000945_guests_get_no_poster_id_or_street.sql", "mask_job_location"));
await db.exec(fnFrom("20261104114456_helpr_head_out_travel_time.sql", "sweep_helpr_start_reminders"));
if (!skip) {
  const mig = readFileSync(THIS, "utf8");
  for (let k = 1; k <= 3; k++) await db.exec(mig);
}
const q = async (s) => (await db.query(s)).rows;

try {
  // Every job starts 2026-12-01 at 2:00 PM Central (20:00 UTC); the sweep runs 110 minutes before: the 2-hour reminder.
  const job = async (cols) => (await q(`INSERT INTO public.jobs (customer_id, title, location, date_needed, start_time, ${Object.keys(cols).join(", ")})
      VALUES ('${POSTER}', 'Move a couch', '${STREET}', '2026-12-01', '14:00', ${Object.values(cols).map((v) => (v === null ? "NULL" : `'${v}'`)).join(", ")}) RETURNING id`))[0].id;
  const jOffered = await job({ helper_id: OFFERED, status: "accepted", helper_confirmed_at: null });
  const jBooked = await job({ helper_id: BOOKED, status: "accepted", helper_confirmed_at: "2026-11-30T10:00:00Z", helper_dayof_confirmed_at: "2026-12-01T12:00:00Z" });
  const jCrew = await job({ is_group_job: "true", status: "accepted" });
  await q(`INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at) VALUES ('${jCrew}', '${CREW_OPEN}', NULL), ('${jCrew}', '${CREW_IN}', '2026-11-30T10:00:00Z')`);

  const sent = (await q(`SELECT public.sweep_helpr_start_reminders('2026-12-01T18:10:00Z') AS n`))[0].n;
  const msg = async (u, j) => (await q(`SELECT message FROM public.notifications WHERE user_id = '${u}' AND job_id = '${j}'`))[0]?.message ?? "";
  const defects = await q(`SELECT * FROM public.defects`);
  check(defects.length === 0, "the sweep ran without a defect", false, JSON.stringify(defects));
  check(sent === 4, "every Helpr still gets the 2-hour reminder (never trimmed)", false, String(sent));

  const mOffered = await msg(OFFERED, jOffered);
  check(!mOffered.includes("1 Main St") && /at Delcambre, LA\. Tap for directions\.$/.test(mOffered), "offered, not accepted: the reminder names the town, never the street", true, mOffered);
  const mBooked = await msg(BOOKED, jBooked);
  check(mBooked.includes(`at ${STREET}. Tap for directions.`), "accepted: the reminder names the street address", false, mBooked);
  const mCrewOpen = await msg(CREW_OPEN, jCrew);
  check(!mCrewOpen.includes("1 Main St") && /Delcambre, LA/.test(mCrewOpen), "unconfirmed crew seat: the town, never the street", true, mCrewOpen);
  const mCrewIn = await msg(CREW_IN, jCrew);
  check(mCrewIn.includes(STREET), "confirmed crew seat: the street address", false, mCrewIn);

  const acl = (await q(`SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE proname = 'sweep_helpr_start_reminders'`))[0]?.a ?? "";
  check(/service_role=X/.test(acl) && !/authenticated=|anon=/.test(acl), "sweep_helpr_start_reminders: service_role only", true, acl);
} catch (err) {
  check(false, `threw: ${err.message}`);
}
console.log(`\n${reds} RED checks, ${redFails} failed`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
