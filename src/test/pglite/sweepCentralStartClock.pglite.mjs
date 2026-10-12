/**
 * Q1357 PGlite proof: the sweeps that read a job's Central-time start (or a
 * stamp relative to it) act on the edge of their window and not 1 ms outside
 * it, at a Central midnight and on both 2026 DST nights.
 *
 *   node src/test/pglite/sweepCentralStartClock.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite.
 *
 * Sweeps (newest CREATE across the migrations, clock reads pointed at a fixed
 * instant by ./lib/fixedClock.mjs):
 *   sweep_dayof_confirm_reminders       start within [now, now+24 h]: remind; within
 *                                       [now, now+12 h] still unanswered: alert the poster;
 *                                       an accept more than 24 h before the start is reminded
 *   sweep_no_show_alerts                start within [now-6 h, now-30 min]
 *   sweep_backout_notice_reminders      notice older than 30 min, last push older than 2 h,
 *                                       start within [now, now+24 h]
 *   sweep_release_last_chance           Helpr finished within (now-24 h, now-22 h]
 *   sweep_confirm_reminders_and_repost  start within [now, now+24 h]; at most 2 h out it is
 *                                       reposted; a reminder repeats after 3 h
 * A start is written as Central wall-clock date + time (ms precision) computed
 * from the target instant, and read back through PG's own AT TIME ZONE before
 * use; a target that is not one Central wall-clock time (the repeated hour, the
 * missing hour) is reported and skipped, never silently passed.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
let skipped = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);

await db.exec(`
SET TIME ZONE 'UTC';
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text DEFAULT 'j', status text,
  customer_id uuid, helper_id uuid, date_needed date, start_time time(3), is_group_job boolean DEFAULT false,
  parent_job_id uuid, payment_status text, response_deadline timestamptz,
  helper_confirmed_at timestamptz, helper_dayof_confirmed_at timestamptz, poster_confirmed_at timestamptz,
  dayof_confirm_reminder_sent_at timestamptz, dayof_unanswered_poster_alert_sent_at timestamptz,
  start_reminder_sent_at timestamptz, no_show_alert_sent_at timestamptz, release_last_chance_notif_sent_at timestamptz,
  poster_completed_at timestamptz, revision_requested_at timestamptz, helper_completed_at timestamptz);
CREATE TABLE public.group_job_helpers (job_id uuid, helper_id uuid, helper_confirmed_at timestamptz,
  helper_dayof_confirmed_at timestamptz, helper_arrived_at timestamptz);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text,
  message text, link text, read boolean, job_id uuid, created_at timestamptz DEFAULT public._probe_now());
CREATE TABLE public.applications (job_id uuid, helper_id uuid, status text, closed_reason text);
CREATE TABLE public.backout_notices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, job_id uuid,
  backout_kind text, actor_name text, acknowledged_at timestamptz, created_at timestamptz, last_push_at timestamptz);
CREATE FUNCTION public.backout_notice_text(k text, a text, t text, OUT title text, OUT message text)
  LANGUAGE sql AS $f$ SELECT 'Backed out'::text, t $f$;
CREATE FUNCTION public.job_posted_by_seed(u uuid) RETURNS boolean LANGUAGE sql AS $f$ SELECT false $f$;
CREATE FUNCTION public.log_cron_defect(text, text, text, jsonb) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
`);

const SWEEPS = ["sweep_dayof_confirm_reminders", "sweep_no_show_alerts", "sweep_backout_notice_reminders", "sweep_release_last_chance", "sweep_confirm_reminders_and_repost"];
for (const name of SWEEPS) {
  const { file, stmt } = newestFunction(name);
  const fixed = onFixedClock(stmt);
  check(`${name}: every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
  // A plain CREATE (sweep_release_last_chance) follows its migration's DROP FUNCTION IF EXISTS, as there.
  const drop = /^create\s+function/i.test(stmt) ? `DROP FUNCTION IF EXISTS public.${name}();` : "";
  for (let i = 0; i < 3; i++) await db.exec(drop + fixed); // replay-safe: applies 3x
}

const POSTER = "00000000-0000-0000-0000-0000000000b2";
const HELPR = "00000000-0000-0000-0000-0000000000a1";
const fresh = () => db.exec(`DELETE FROM public.jobs; DELETE FROM public.group_job_helpers; DELETE FROM public.notifications;
  DELETE FROM public.applications; DELETE FROM public.backout_notices;`);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const CENTRAL = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" });
/** The Central wall-clock date and time of `ms`, or null when PG does not read it back as that same instant. */
async function central(ms) {
  const p = Object.fromEntries(CENTRAL.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, time = `${p.hour}:${p.minute}:${p.second}.${p.fractionalSecond}`;
  const back = (await q(`SELECT ($1::date + $2::time(3)) AT TIME ZONE 'America/Chicago' AS t`, [date, time]))[0].t;
  return new Date(back).getTime() === ms ? { date, time } : null;
}
/** One accepted single-Helpr job starting at `start`, with column overrides. */
async function startingAt(start, cols = {}) {
  const c = await central(start);
  if (!c) return null;
  const all = { status: "accepted", customer_id: POSTER, helper_id: HELPR, date_needed: c.date, start_time: c.time, ...cols };
  const keys = Object.keys(all);
  return (await q(`INSERT INTO public.jobs (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    keys.map((k) => all[k])))[0].id;
}
async function cases(at, label, list, body) {
  for (const [what, start, want, extra] of list) {
    await fresh(); await setClock(db, at);
    const id = await startingAt(start, extra?.(start) ?? {});
    if (!id) { skipped++; console.log(`SKIP  ${at} ${label}: ${what} is not one Central wall-clock time`); continue; }
    const [got, detail] = await body(id, start);
    check(`${at} ${label}: ${what} -> ${want}`, got === want, `${detail ?? got}`);
  }
}
const notes = async (title) => Number((await q(`SELECT count(*)::int AS n FROM public.notifications WHERE title = $1`, [title]))[0].n);

// A Central midnight (00:00 CDT), the fall-back night (01:30 CST, the repeated
// hour's second pass) and the spring-forward night (03:30 CDT, just after the gap).
const INSTANTS = ["2026-10-12T05:00:00Z", "2026-11-01T07:30:00Z", "2026-03-08T08:30:00Z"];

for (const at of INSTANTS) {
  const now = Date.parse(at);

  // sweep_dayof_confirm_reminders pass 1 (the poster already confirmed, pass 2 already sent: only the Helpr's reminder counts).
  const p1 = (s) => ({ poster_confirmed_at: iso(s - 2 * DAY), dayof_unanswered_poster_alert_sent_at: iso(now - DAY) });
  await cases(at, "sweep_dayof_confirm_reminders remind", [
    ["start 1 ms before now", now - 1, 0, p1], ["start AT now", now, 1, p1],
    ["start AT now+24h", now + DAY, 1, p1], ["start 1 ms past now+24h", now + DAY + 1, 0, p1],
    ["accepted exactly 24 h before the start", now + HOUR, 0, (s) => ({ ...p1(s), helper_confirmed_at: iso(s - DAY) })],
    ["accepted 1 ms more than 24 h before", now + HOUR, 1, (s) => ({ ...p1(s), helper_confirmed_at: iso(s - DAY - 1) })],
  ], async () => [(await q(`SELECT public.sweep_dayof_confirm_reminders() AS n`))[0].n]);
  // ...pass 2: the poster is told when the Helpr is still silent within 12 h.
  const p2 = () => ({ dayof_confirm_reminder_sent_at: iso(now - HOUR) });
  await cases(at, "sweep_dayof_confirm_reminders poster alert", [
    ["start 1 ms before now", now - 1, 0, p2], ["start AT now", now, 1, p2],
    ["start AT now+12h", now + 12 * HOUR, 1, p2], ["start 1 ms past now+12h", now + 12 * HOUR + 1, 0, p2],
  ], async () => [(await q(`SELECT public.sweep_dayof_confirm_reminders() AS n`))[0].n]);

  // sweep_no_show_alerts: both edges inclusive; each hit pushes 2.
  await cases(at, "sweep_no_show_alerts", [
    ["start 1 ms after now-30min", now - 30 * MIN + 1, 0], ["start AT now-30min", now - 30 * MIN, 2],
    ["start AT now-6h", now - 6 * HOUR, 2], ["start 1 ms before now-6h", now - 6 * HOUR - 1, 0],
  ], async () => [(await q(`SELECT public.sweep_no_show_alerts() AS n`))[0].n]);

  // sweep_backout_notice_reminders: notice age and last push are strict, the start window inclusive.
  const notice = async (id, created, lastPush) =>
    q(`INSERT INTO public.backout_notices (user_id, job_id, backout_kind, created_at, last_push_at) VALUES ($1, $2, 'helper', $3, $4)`,
      [POSTER, id, iso(created), lastPush === null ? null : iso(lastPush)]);
  const backout = (created, lastPush) => async (id) => { await notice(id, created, lastPush); return [(await q(`SELECT public.sweep_backout_notice_reminders() AS n`))[0].n]; };
  await cases(at, "sweep_backout_notice_reminders", [["notice AT now-30min", now + HOUR, 0]], backout(now - 30 * MIN, null));
  await cases(at, "sweep_backout_notice_reminders", [["notice 1 ms older than 30 min", now + HOUR, 1]], backout(now - 30 * MIN - 1, null));
  await cases(at, "sweep_backout_notice_reminders", [["last push AT now-2h", now + HOUR, 0]], backout(now - DAY, now - 2 * HOUR));
  await cases(at, "sweep_backout_notice_reminders", [["last push 1 ms older than 2 h", now + HOUR, 1]], backout(now - DAY, now - 2 * HOUR - 1));
  await cases(at, "sweep_backout_notice_reminders", [
    ["start 1 ms before now", now - 1, 0], ["start AT now", now, 1],
    ["start AT now+24h", now + DAY, 1], ["start 1 ms past now+24h", now + DAY + 1, 0],
  ], backout(now - DAY, null));

  // sweep_release_last_chance: finished within (now-24h, now-22h].
  for (const [what, done, want] of [["finished AT now-22h", now - 22 * HOUR, 1], ["finished 1 ms after now-22h", now - 22 * HOUR + 1, 0],
    ["finished AT now-24h", now - DAY, 0], ["finished 1 ms after now-24h", now - DAY + 1, 1]]) {
    await fresh(); await setClock(db, at);
    await q(`INSERT INTO public.jobs (status, customer_id, helper_id, payment_status, helper_completed_at) VALUES ('in_progress', $1, $2, 'escrow', $3)`, [POSTER, HELPR, iso(done)]);
    const r = (await q(`SELECT public.sweep_release_last_chance() AS r`))[0].r;
    check(`${at} sweep_release_last_chance: ${what} -> ${want}`, Number(r.pushed) === want, JSON.stringify(r));
  }

  // sweep_confirm_reminders_and_repost: inside 2 h of the start the job is reposted, beyond it reminded.
  const accepted = (s) => ({ helper_confirmed_at: iso(s - 2 * DAY) });
  const crr = async (id) => {
    await q(`INSERT INTO public.applications VALUES ($1, $2, 'accepted', NULL)`, [id, HELPR]);
    const r = (await q(`SELECT public.sweep_confirm_reminders_and_repost() AS r`))[0].r;
    return [`reminded ${r.reminded} reposted ${r.reposted}`];
  };
  await cases(at, "sweep_confirm_reminders_and_repost", [
    ["start 1 ms before now", now - 1, "reminded 0 reposted 0", accepted], ["start AT now", now, "reminded 0 reposted 1", accepted],
    ["start AT now+2h", now + 2 * HOUR, "reminded 0 reposted 1", accepted], ["start 1 ms past now+2h", now + 2 * HOUR + 1, "reminded 1 reposted 0", accepted],
    ["start AT now+24h", now + DAY, "reminded 1 reposted 0", accepted], ["start 1 ms past now+24h", now + DAY + 1, "reminded 0 reposted 0", accepted],
  ], crr);
  // ...a reminder sent exactly 3 h ago no longer holds the next one.
  for (const [what, prev, want] of [["last reminder AT now-3h", now - 3 * HOUR, "reminded 1 reposted 0"], ["last reminder 1 ms inside 3 h", now - 3 * HOUR + 1, "reminded 0 reposted 0"]]) {
    await cases(at, "sweep_confirm_reminders_and_repost", [[what, now + 6 * HOUR, want, accepted]], async (id) => {
      await q(`INSERT INTO public.notifications (user_id, job_id, title, created_at) VALUES ($1, $2, 'Confirm you''ll be there', $3)`, [HELPR, id, iso(prev)]);
      return crr(id);
    });
  }
}

// Every case above must have run: a skip is a target the probe could not express.
check(`no case skipped (a Central start the probe could not write)`, skipped === 0, `${skipped} skipped`);
console.log(failures ? `\n${failures} FAIL` : "\nall PASS");
process.exit(failures ? 1 : 0);
